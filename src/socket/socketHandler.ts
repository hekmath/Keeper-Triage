// src/socket/socketHandler.ts

import { Server, Socket } from 'socket.io';
import { ChatManager } from './chatManager';
import { OpenAIService } from '../services/openaiService';

const chatManager = new ChatManager();
const openaiService = new OpenAIService();

export function handleSocketConnection(io: Server, socket: Socket) {
  console.log('👤 New connection:', socket.id);

  // ============= CUSTOMER EVENTS =============

  // Customer starts a new chat session
  socket.on(
    'customer:start_chat',
    async (data: { userId?: string; botContext?: string; metadata?: any }) => {
      try {
        // Create new session
        const session = chatManager.createSession(
          data.userId || socket.id,
          data.botContext
        );

        // Join session room
        socket.join(`session:${session.id}`);

        // Store session ID on socket for cleanup
        socket.data.sessionId = session.id;
        socket.data.role = 'customer';

        // Send session info to customer
        socket.emit('session:created', {
          sessionId: session.id,
          status: session.status,
        });

        // Generate and send greeting
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

  // Customer sends a message
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
          // Let AI respond and decide if transfer is needed
          const messages = chatManager.getSessionMessages(sessionId);
          const response = await openaiService.generateResponse(
            messages,
            session.botContext
          );

          // Add bot message
          const botMessage = chatManager.addMessage(
            sessionId,
            response.content,
            'bot'
          );
          if (botMessage) {
            io.to(`session:${sessionId}`).emit('message:received', botMessage);
          }

          // If AI decided to transfer
          if (response.shouldTransfer) {
            chatManager.updateSessionStatus(sessionId, 'waiting');
            socket.emit('status:changed', { status: 'waiting' });

            // Notify agents
            io.to('agents:available').emit('queue:customer_waiting', {
              sessionId,
              session: chatManager.getSession(sessionId),
              transferReason: response.transferReason,
            });

            console.log(
              `🔄 Session ${sessionId} transferred - Reason: ${response.transferReason}`
            );
          }
        }
        // If status is 'waiting' or 'agent', message is already sent to the room
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    }
  );

  // ============= AGENT EVENTS =============

  // Agent joins as support
  socket.on('agent:join', (data: { name: string }) => {
    try {
      const agent = chatManager.addAgent(socket.id, data.name);

      socket.join('agents:available');
      socket.data.agentId = agent.id;
      socket.data.role = 'agent';

      socket.emit('agent:joined', {
        agentId: agent.id,
        agent,
      });

      // Send waiting queue
      const waitingSessions = chatManager.getWaitingSessions();
      socket.emit('queue:update', { sessions: waitingSessions });

      console.log(`👨‍💼 Agent joined: ${data.name} (${agent.id})`);
    } catch (error) {
      console.error('Error joining as agent:', error);
      socket.emit('error', { message: 'Failed to join as agent' });
    }
  });

  // Agent picks up a session from queue
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

        // Join session room
        socket.join(`session:${data.sessionId}`);

        // Notify customer
        const agent = chatManager.getAgent(agentId);
        io.to(`session:${data.sessionId}`).emit('status:changed', {
          status: 'agent',
          agentName: agent?.name,
        });

        // Send notification message
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

        // Update agent's view
        socket.emit('session:assigned', {
          sessionId: data.sessionId,
          session,
        });

        // Update queue for all agents
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

  // Agent sends a message
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

  // Agent closes a session
  socket.on('agent:close_session', (data: { sessionId: string }) => {
    try {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Not authenticated as agent' });
        return;
      }

      chatManager.closeSession(data.sessionId);

      io.to(`session:${data.sessionId}`).emit('session:closed');

      // Update agent status
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

  // ============= ADMIN EVENTS =============

  // Get system stats
  socket.on('admin:get_stats', () => {
    const stats = chatManager.getStats();
    socket.emit('stats:update', stats);
  });

  // ============= DISCONNECTION HANDLING =============

  // src/socket/socketHandler.ts
  socket.on('disconnect', () => {
    console.log('👤 User disconnected:', socket.id);

    if (socket.data.role === 'agent' && socket.data.agentId) {
      const agentId = socket.data.agentId;
      // Requeue their sessions *and* notify customers
      const agent = chatManager.getAgent(agentId);
      if (agent) {
        for (const sid of agent.activeSessions) {
          chatManager.updateSessionStatus(sid, 'waiting');
          const session = chatManager.getSession(sid);
          if (session) {
            session.assignedAgent = undefined; // important
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

    if (socket.data.role === 'customer' && socket.data.sessionId) {
      const sid = socket.data.sessionId as string;
      chatManager.closeSession(sid);
      io.to(`session:${sid}`).emit('session:closed');
    }
  });
}
