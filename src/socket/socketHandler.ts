import { Server, Socket } from 'socket.io';
import { ChatManager } from './chatManager';
import { OpenAIService } from '../services/openaiService';

const chatManager = new ChatManager();
const openaiService = new OpenAIService();

// Set up the transfer callback
openaiService.setTransferCallback(async (sessionId, reason, priority) => {
  await chatManager.transferToQueue(sessionId, reason, priority);

  // Get the socket.io server instance to emit events
  const session = chatManager.getSession(sessionId);
  if (session) {
    // You'll need to pass the io instance to this callback
    // For now, we'll handle the notification in the main handler
  }
});

export function handleSocketConnection(io: Server, socket: Socket) {
  console.log('👤 New connection:', socket.id);

  // Update the transfer callback to include io instance
  openaiService.setTransferCallback(async (sessionId, reason, priority) => {
    await chatManager.transferToQueue(sessionId, reason, priority);

    // Emit status change
    socket.emit('status:changed', { status: 'waiting' });

    // Notify available agents
    io.to('agents:available').emit('queue:customer_waiting', {
      sessionId,
      session: chatManager.getSession(sessionId),
      transferReason: reason,
      priority,
    });

    // Send queue update to all agents
    io.to('agents:available').emit('queue:update', {
      sessions: chatManager.getWaitingSessions(),
    });

    // Add system message
    const systemMessage = chatManager.addMessage(
      sessionId,
      `You are being transferred to a human agent. You are #${chatManager.getQueuePosition(
        sessionId
      )} in the queue.`,
      'system'
    );

    if (systemMessage) {
      io.to(`session:${sessionId}`).emit('message:received', systemMessage);
    }

    console.log(
      `🔄 Auto-transferred session ${sessionId} - Reason: ${reason} (Priority: ${priority})`
    );
  });

  // ============= CUSTOMER EVENTS =============
  socket.on(
    'customer:start_chat',
    async (data: { userId?: string; botContext?: string; metadata?: any }) => {
      try {
        const session = chatManager.createSession(
          data.userId || socket.id,
          data.botContext
        );
        socket.join(`session:${session.id}`);
        socket.data.sessionId = session.id;
        socket.data.role = 'customer';

        socket.emit('session:created', {
          sessionId: session.id,
          status: session.status,
        });

        const greeting = await openaiService.generateGreeting(data.botContext);
        const greetingMessage = chatManager.addMessage(
          session.id,
          greeting,
          'bot'
        );

        if (greetingMessage) {
          io.to(`session:${session.id}`).emit(
            'message:received',
            greetingMessage
          );
        }

        console.log(`📝 New session created: ${session.id}`);
      } catch (error) {
        console.error('Error starting chat:', error);
        socket.emit('error', { message: 'Failed to start chat session' });
      }
    }
  );

  socket.on(
    'customer:send_message',
    async (data: { sessionId: string; content: string }) => {
      try {
        const { sessionId, content } = data;
        const session = chatManager.getSession(sessionId);

        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        // Add customer message
        const userMessage = chatManager.addMessage(sessionId, content, 'user');
        if (userMessage) {
          io.to(`session:${sessionId}`).emit('message:received', userMessage);
        }

        // Handle based on session status
        if (session.status === 'bot') {
          // AI processes message and may auto-transfer
          const messages = chatManager.getSessionMessages(sessionId);
          const response = await openaiService.generateResponse(
            sessionId,
            messages,
            session.botContext
          );

          // Add bot response
          const botMessage = chatManager.addMessage(
            sessionId,
            response.content,
            'bot'
          );
          if (botMessage) {
            io.to(`session:${sessionId}`).emit('message:received', botMessage);
          }
        }
        // If status is 'waiting' or 'agent', message is already sent to the room
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    }
  );

  // NEW: Handle explicit customer chat ending
  socket.on('customer:end_chat', (data: { sessionId: string }) => {
    try {
      const session = chatManager.getSession(data.sessionId);
      if (!session) return;

      console.log(
        `👋 Customer explicitly ending chat: ${data.sessionId} (Status: ${session.status})`
      );

      // Remove from queue if waiting
      if (session.status === 'waiting') {
        chatManager.removeFromQueue(data.sessionId);
        console.log(`🗑️ Removed session ${data.sessionId} from queue`);

        // Notify agents that customer left the queue
        io.to('agents:available').emit('queue:update', {
          sessions: chatManager.getWaitingSessions(),
        });
      }

      // Close the session properly
      chatManager.closeSession(data.sessionId);

      // Notify anyone in the session room
      io.to(`session:${data.sessionId}`).emit('session:closed');

      console.log(
        `✅ Session ${data.sessionId} properly closed and cleaned up`
      );
    } catch (error) {
      console.error('Error ending customer chat:', error);
    }
  });

  // ============= AGENT EVENTS =============
  socket.on('agent:join', (data: { name: string }) => {
    try {
      const agent = chatManager.addAgent(socket.id, data.name);
      socket.join('agents:available');
      socket.data.agentId = agent.id;
      socket.data.role = 'agent';

      socket.emit('agent:joined', { agentId: agent.id, agent });

      const waitingSessions = chatManager.getWaitingSessions();
      socket.emit('queue:update', { sessions: waitingSessions });

      console.log(`👨‍💼 Agent joined: ${data.name} (${agent.id})`);
    } catch (error) {
      console.error('Error joining as agent:', error);
      socket.emit('error', { message: 'Failed to join as agent' });
    }
  });

  socket.on('agent:pickup_session', (data: { sessionId: string }) => {
    try {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Not authenticated as agent' });
        return;
      }

      const success = chatManager.assignSessionToAgent(data.sessionId, agentId);

      if (success) {
        const session = chatManager.getSession(data.sessionId);
        socket.join(`session:${data.sessionId}`);

        const agent = chatManager.getAgent(agentId);
        io.to(`session:${data.sessionId}`).emit('status:changed', {
          status: 'agent',
          agentName: agent?.name,
        });

        const notificationMessage = chatManager.addMessage(
          data.sessionId,
          `${agent?.name} has joined the chat. How can I help you today?`,
          'agent',
          { agentId }
        );

        if (notificationMessage) {
          io.to(`session:${data.sessionId}`).emit(
            'message:received',
            notificationMessage
          );
        }

        socket.emit('session:assigned', { sessionId: data.sessionId, session });
        io.to('agents:available').emit('queue:update', {
          sessions: chatManager.getWaitingSessions(),
        });

        console.log(
          `✅ Session ${data.sessionId} assigned to agent ${agentId}`
        );
      } else {
        socket.emit('error', { message: 'Failed to assign session' });
      }
    } catch (error) {
      console.error('Error picking up session:', error);
      socket.emit('error', { message: 'Failed to pickup session' });
    }
  });

  socket.on(
    'agent:send_message',
    (data: { sessionId: string; content: string }) => {
      try {
        const agentId = socket.data.agentId;
        if (!agentId) {
          socket.emit('error', { message: 'Not authenticated as agent' });
          return;
        }

        const message = chatManager.addMessage(
          data.sessionId,
          data.content,
          'agent',
          { agentId }
        );

        if (message) {
          io.to(`session:${data.sessionId}`).emit('message:received', message);
        }
      } catch (error) {
        console.error('Error sending agent message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    }
  );

  socket.on('agent:close_session', (data: { sessionId: string }) => {
    try {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Not authenticated as agent' });
        return;
      }

      chatManager.closeSession(data.sessionId);
      io.to(`session:${data.sessionId}`).emit('session:closed');

      const agent = chatManager.getAgent(agentId);
      if (agent && agent.activeSessions.length === 0) {
        io.to('agents:available').emit('agent:available', { agentId });
      }

      console.log(`🔒 Session ${data.sessionId} closed by agent ${agentId}`);
    } catch (error) {
      console.error('Error closing session:', error);
      socket.emit('error', { message: 'Failed to close session' });
    }
  });

  // ============= ADMIN/DEBUG EVENTS =============
  socket.on('admin:get_stats', () => {
    const stats = chatManager.getStats();
    socket.emit('stats:update', stats);
  });

  // NEW: Debug queue information
  socket.on('admin:debug_queue', () => {
    try {
      const stats = chatManager.getStats();
      const queueStatus = chatManager.getQueueStatus();

      const debugInfo = {
        ...stats,
        queueItems: queueStatus,
        timestamp: new Date().toISOString(),
      };

      socket.emit('queue:debug_info', debugInfo);
      console.log('🔍 Debug info sent:', debugInfo);
    } catch (error) {
      console.error('Error getting debug info:', error);
    }
  });

  // NEW: Clear queue for debugging (development only)
  socket.on('admin:clear_queue', () => {
    try {
      // Only allow in development or with proper auth
      if (process.env.NODE_ENV !== 'development') {
        console.log('⚠️ Queue clear attempted in production - blocked');
        return;
      }

      // Get all sessions in queue before clearing
      const queueSessions = chatManager.getWaitingSessions();

      // Clear the queue
      chatManager.clearQueue();

      // Close all the sessions that were in queue
      queueSessions.forEach((session) => {
        chatManager.closeSession(session.id);
        io.to(`session:${session.id}`).emit('session:closed');
      });

      // Notify all agents
      io.to('agents:available').emit('queue:update', {
        sessions: [],
      });

      console.log(
        `🗑️ Cleared ${queueSessions.length} sessions from queue (DEBUG)`
      );
    } catch (error) {
      console.error('Error clearing queue:', error);
    }
  });

  // ============= ENHANCED DISCONNECTION HANDLING =============
  socket.on('disconnect', () => {
    console.log('👤 User disconnected:', socket.id);

    if (socket.data.role === 'agent' && socket.data.agentId) {
      const agentId = socket.data.agentId;
      const agent = chatManager.getAgent(agentId);

      if (agent) {
        for (const sid of agent.activeSessions) {
          chatManager.updateSessionStatus(sid, 'waiting');
          const session = chatManager.getSession(sid);
          if (session) {
            session.assignedAgent = undefined;
            io.to(`session:${sid}`).emit('status:changed', {
              status: 'waiting',
            });
            io.to(`session:${sid}`).emit(
              'message:received',
              chatManager.addMessage(
                sid,
                'Your agent disconnected. You are back in the queue. An agent will be with you shortly.',
                'system'
              )
            );
          }
        }
      }

      chatManager.removeAgent(agentId);
      io.to('agents:available').emit('queue:update', {
        sessions: chatManager.getWaitingSessions(),
      });
      return;
    }

    // Enhanced customer disconnect handling
    if (socket.data.role === 'customer' && socket.data.sessionId) {
      const sid = socket.data.sessionId as string;
      const session = chatManager.getSession(sid);

      if (session) {
        console.log(
          `👋 Customer disconnected: ${sid} (Status: ${session.status})`
        );

        // If customer was in queue, remove them
        if (session.status === 'waiting') {
          chatManager.removeFromQueue(sid);
          console.log(`🗑️ Removed disconnected customer ${sid} from queue`);

          // Update queue for agents
          io.to('agents:available').emit('queue:update', {
            sessions: chatManager.getWaitingSessions(),
          });
        }

        // Close the session
        chatManager.closeSession(sid);
        io.to(`session:${sid}`).emit('session:closed');
      }
    }
  });
}
