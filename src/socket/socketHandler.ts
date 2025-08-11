import { Server, Socket } from 'socket.io';
import { ChatService } from '../services/chatService';
import { OpenAIService } from '../services/openaiService';

const chatService = new ChatService();
const openaiService = new OpenAIService();

// Set up the transfer callback to work with new services
openaiService.setTransferCallback(async (sessionId, reason, priority) => {
  await chatService.transferToQueue(sessionId, reason, priority);
});

export function handleSocketConnection(io: Server, socket: Socket) {
  console.log('👤 New connection:', socket.id);

  // Update the transfer callback to include io instance
  openaiService.setTransferCallback(async (sessionId, reason, priority) => {
    await chatService.transferToQueue(sessionId, reason, priority);

    // Emit status change
    socket.emit('status:changed', { status: 'waiting' });

    // Notify available agents
    io.to('agents:available').emit('queue:customer_waiting', {
      sessionId,
      session: await chatService.getSession(sessionId),
      transferReason: reason,
      priority,
    });

    // Send queue update to all agents
    const waitingSessions = await chatService.getWaitingSessions();
    io.to('agents:available').emit('queue:update', {
      sessions: waitingSessions,
    });

    // Add system message
    const queuePosition = await chatService.getQueuePosition(sessionId);
    const systemMessage = await chatService.addMessage(
      sessionId,
      `You are being transferred to a human agent. You are #${queuePosition} in the queue.`,
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
        const session = await chatService.createSession(
          data.userId || socket.id,
          data.botContext,
          data.metadata
        );

        socket.join(`session:${session.id}`);
        socket.data.sessionId = session.id;
        socket.data.role = 'customer';

        socket.emit('session:created', {
          sessionId: session.id,
          status: session.status,
        });

        const greeting = await openaiService.generateGreeting(data.botContext);
        const greetingMessage = await chatService.addMessage(
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
        const session = await chatService.getSession(sessionId);

        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        // Add customer message
        const userMessage = await chatService.addMessage(
          sessionId,
          content,
          'user'
        );
        if (userMessage) {
          io.to(`session:${sessionId}`).emit('message:received', userMessage);
        }

        // Handle based on session status
        if (session.status === 'bot') {
          // AI processes message and may auto-transfer
          const messages = await chatService.getSessionMessages(sessionId);
          const response = await openaiService.generateResponse(
            sessionId,
            messages,
            session.botContext ?? undefined
          );

          // Add bot response
          const botMessage = await chatService.addMessage(
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

  // Handle explicit customer chat ending
  socket.on('customer:end_chat', async (data: { sessionId: string }) => {
    try {
      const session = await chatService.getSession(data.sessionId);
      if (!session) return;

      console.log(
        `👋 Customer explicitly ending chat: ${data.sessionId} (Status: ${session.status})`
      );

      // Close the session (this handles queue removal automatically)
      await chatService.closeSession(data.sessionId);

      // Notify anyone in the session room
      io.to(`session:${data.sessionId}`).emit('session:closed');

      // Update agents with new queue state
      if (session.status === 'waiting') {
        const waitingSessions = await chatService.getWaitingSessions();
        io.to('agents:available').emit('queue:update', {
          sessions: waitingSessions,
        });
      }

      console.log(
        `✅ Session ${data.sessionId} properly closed and cleaned up`
      );
    } catch (error) {
      console.error('Error ending customer chat:', error);
    }
  });

  // ============= AGENT EVENTS =============
  socket.on('agent:join', async (data: { name: string }) => {
    try {
      const agent = await chatService.addAgent(socket.id, data.name);
      socket.join('agents:available');
      socket.data.agentId = agent.id;
      socket.data.role = 'agent';

      socket.emit('agent:joined', { agentId: agent.id, agent });

      const waitingSessions = await chatService.getWaitingSessions();
      socket.emit('queue:update', { sessions: waitingSessions });

      console.log(`👨‍💼 Agent joined: ${data.name} (${agent.id})`);
    } catch (error) {
      console.error('Error joining as agent:', error);
      socket.emit('error', { message: 'Failed to join as agent' });
    }
  });

  socket.on('agent:pickup_session', async (data: { sessionId: string }) => {
    try {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Not authenticated as agent' });
        return;
      }

      const success = await chatService.assignSessionToAgent(
        data.sessionId,
        agentId
      );

      if (success) {
        const session = await chatService.getSession(data.sessionId);
        const agent = await chatService.getAgent(agentId);

        socket.join(`session:${data.sessionId}`);

        io.to(`session:${data.sessionId}`).emit('status:changed', {
          status: 'agent',
          agentName: agent?.name,
        });

        const notificationMessage = await chatService.addMessage(
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

        // Update queue for all agents
        const waitingSessions = await chatService.getWaitingSessions();
        io.to('agents:available').emit('queue:update', {
          sessions: waitingSessions,
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
    async (data: { sessionId: string; content: string }) => {
      try {
        const agentId = socket.data.agentId;
        if (!agentId) {
          socket.emit('error', { message: 'Not authenticated as agent' });
          return;
        }

        const message = await chatService.addMessage(
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

  socket.on('agent:close_session', async (data: { sessionId: string }) => {
    try {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Not authenticated as agent' });
        return;
      }

      await chatService.closeSession(data.sessionId);
      io.to(`session:${data.sessionId}`).emit('session:closed');

      // Check if agent is now available
      const agent = await chatService.getAgent(agentId);
      if (agent) {
        const activeSessions = await chatService.getStats();
        if (activeSessions) {
          io.to('agents:available').emit('agent:available', { agentId });
        }
      }

      console.log(`🔒 Session ${data.sessionId} closed by agent ${agentId}`);
    } catch (error) {
      console.error('Error closing session:', error);
      socket.emit('error', { message: 'Failed to close session' });
    }
  });

  // ============= ADMIN/DEBUG EVENTS =============
  socket.on('admin:get_stats', async () => {
    try {
      const stats = await chatService.getStats();
      socket.emit('stats:update', stats);
    } catch (error) {
      console.error('Error getting stats:', error);
    }
  });

  socket.on('admin:debug_queue', async () => {
    try {
      const debugInfo = await chatService.debugQueue();
      socket.emit('queue:debug_info', debugInfo);
      console.log('🔍 Debug info sent:', debugInfo);
    } catch (error) {
      console.error('Error getting debug info:', error);
    }
  });

  socket.on('admin:clear_queue', async () => {
    try {
      const clearedCount = await chatService.clearQueue();

      // Notify all agents
      const waitingSessions = await chatService.getWaitingSessions();
      io.to('agents:available').emit('queue:update', {
        sessions: waitingSessions,
      });

      console.log(`🗑️ Cleared ${clearedCount} sessions from queue (DEBUG)`);
    } catch (error) {
      console.error('Error clearing queue:', error);
    }
  });

  // ============= ENHANCED DISCONNECTION HANDLING =============
  socket.on('disconnect', async () => {
    console.log('👤 User disconnected:', socket.id);

    try {
      // Handle agent disconnection
      if (socket.data.role === 'agent' && socket.data.agentId) {
        const agentId = socket.data.agentId;

        // Remove agent (this automatically transfers sessions back to queue)
        await chatService.removeAgent(agentId);

        // Update queue for remaining agents
        const waitingSessions = await chatService.getWaitingSessions();
        io.to('agents:available').emit('queue:update', {
          sessions: waitingSessions,
        });

        return;
      }

      // Handle customer disconnection
      if (socket.data.role === 'customer' && socket.data.sessionId) {
        const sessionId = socket.data.sessionId as string;
        const session = await chatService.getSession(sessionId);

        if (session) {
          console.log(
            `👋 Customer disconnected: ${sessionId} (Status: ${session.status})`
          );

          // Close the session (this handles queue removal automatically)
          await chatService.closeSession(sessionId);
          io.to(`session:${sessionId}`).emit('session:closed');

          // Update agents if customer was in queue
          if (session.status === 'waiting') {
            const waitingSessions = await chatService.getWaitingSessions();
            io.to('agents:available').emit('queue:update', {
              sessions: waitingSessions,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  // ============= HEALTH CHECK EVENT =============
  socket.on('admin:health_check', async () => {
    try {
      const health = await chatService.healthCheck();
      socket.emit('health:status', health);
    } catch (error) {
      console.error('Error checking health:', error);
      socket.emit('health:status', {
        database: false,
        queue: false,
        overall: false,
      });
    }
  });
}
