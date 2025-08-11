import { DatabaseService } from './databaseService';
import { QueueService } from './queueService';
import type { ChatSession, Message, Agent } from '../database/schema';

export class ChatService {
  private dbService: DatabaseService;
  private queueService: QueueService;

  constructor() {
    this.dbService = new DatabaseService();
    this.queueService = new QueueService();
  }

  // ============= SESSION MANAGEMENT =============

  async createSession(
    userId: string,
    botContext?: string,
    metadata?: any
  ): Promise<ChatSession> {
    try {
      const session = await this.dbService.createSession(
        userId,
        botContext,
        metadata
      );
      console.log(`📝 New session created: ${session.id}`);
      return session;
    } catch (error) {
      console.error('Error creating session:', error);
      throw new Error('Failed to create chat session');
    }
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    return await this.dbService.getSession(sessionId);
  }

  async getSessionWithMessages(sessionId: string): Promise<{
    session: ChatSession;
    messages: Message[];
  } | null> {
    return await this.dbService.getSessionsWithMessages(sessionId);
  }

  async updateSessionStatus(
    sessionId: string,
    status: 'bot' | 'waiting' | 'agent' | 'closed'
  ): Promise<void> {
    await this.dbService.updateSessionStatus(sessionId, status);

    // If session is being closed or moved to agent, remove from queue
    if (status === 'closed' || status === 'agent') {
      await this.queueService.removeFromQueue(sessionId);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const session = await this.dbService.getSession(sessionId);
      if (!session) {
        console.log(`⚠️ Cannot close session ${sessionId}: not found`);
        return;
      }

      console.log(
        `🔒 Closing session ${sessionId} (Status: ${session.status})`
      );

      // Close the session in database
      await this.dbService.closeSession(sessionId);

      // Remove from queue if it was waiting
      if (session.status === 'waiting') {
        await this.queueService.removeFromQueue(sessionId);
        console.log(`✅ Session ${sessionId} removed from queue during close`);
      }

      // If session had an assigned agent, update agent status
      if (session.assignedAgent) {
        const agentSessions = await this.dbService.getAgentActiveSessions(
          session.assignedAgent
        );
        if (agentSessions.length === 0) {
          await this.dbService.updateAgentStatus(
            session.assignedAgent,
            'available'
          );
          console.log(`👨‍💼 Agent ${session.assignedAgent} is now available`);
        }
      }

      console.log(`✅ Session ${sessionId} closed and cleaned up`);
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
      throw error;
    }
  }

  // ============= MESSAGE MANAGEMENT =============

  async addMessage(
    sessionId: string,
    content: string,
    sender: 'user' | 'bot' | 'agent' | 'system',
    metadata?: any
  ): Promise<Message | null> {
    try {
      // Verify session exists
      const session = await this.dbService.getSession(sessionId);
      if (!session) {
        console.error(`Cannot add message: session ${sessionId} not found`);
        return null;
      }

      const message = await this.dbService.addMessage(
        sessionId,
        content,
        sender,
        metadata
      );
      return message;
    } catch (error) {
      console.error('Error adding message:', error);
      return null;
    }
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return await this.dbService.getSessionMessages(sessionId);
  }

  // ============= TRANSFER QUEUE MANAGEMENT =============

  async transferToQueue(
    sessionId: string,
    reason: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<void> {
    try {
      const session = await this.dbService.getSession(sessionId);
      if (!session) {
        console.error(`Cannot transfer session ${sessionId}: not found`);
        return;
      }

      // Update session status to waiting
      await this.dbService.updateSessionStatus(sessionId, 'waiting');

      // Add to queue
      await this.queueService.addToQueue(sessionId, reason, priority, {
        userId: session.userId,
        transferredAt: new Date().toISOString(),
      });

      console.log(
        `🔄 Session ${sessionId} transferred to queue - Reason: ${reason} (Priority: ${priority})`
      );
    } catch (error) {
      console.error(`Error transferring session ${sessionId} to queue:`, error);
      throw error;
    }
  }

  async getNextInQueue(): Promise<string | undefined> {
    const queueEntry = await this.queueService.getNextInQueue();
    return queueEntry?.sessionId;
  }

  async removeFromQueue(sessionId: string): Promise<boolean> {
    return await this.queueService.removeFromQueue(sessionId);
  }

  async getQueuePosition(sessionId: string): Promise<number> {
    return await this.queueService.getQueuePosition(sessionId);
  }

  async getQueueLength(): Promise<number> {
    return await this.queueService.getQueueLength();
  }

  async getWaitingSessions(): Promise<any[]> {
    const queueSessions = await this.queueService.getWaitingSessions();

    // Enrich with session data and message counts
    const enrichedSessions = await Promise.all(
      queueSessions.map(async (queueInfo) => {
        const session = await this.dbService.getSession(queueInfo.sessionId);
        if (!session) return null;

        // Get message count for this session (more efficient than loading all messages)
        const messages = await this.dbService.getSessionMessages(
          queueInfo.sessionId
        );

        return {
          ...session,
          messages, // Include messages array for frontend compatibility
          queueInfo,
        };
      })
    );

    return enrichedSessions.filter((session) => session?.id); // Filter out null sessions
  }

  async clearQueue(): Promise<number> {
    // Only allow in development
    if (process.env.NODE_ENV !== 'development') {
      console.log('⚠️ Queue clear attempted in production - blocked');
      return 0;
    }

    const clearedCount = await this.queueService.clearQueue();
    console.log(`🗑️ Cleared ${clearedCount} sessions from queue (DEBUG)`);
    return clearedCount;
  }

  // ============= AGENT MANAGEMENT =============

  async addAgent(
    socketId: string,
    name: string,
    metadata?: any
  ): Promise<Agent> {
    try {
      const agent = await this.dbService.createAgent(socketId, name, metadata);
      console.log(`👨‍💼 Agent created: ${name} (${agent.id})`);
      return agent;
    } catch (error) {
      console.error('Error creating agent:', error);
      throw new Error('Failed to create agent');
    }
  }

  async removeAgent(agentId: string): Promise<void> {
    try {
      const agent = await this.dbService.getAgent(agentId);
      if (!agent) {
        console.log(`⚠️ Cannot remove agent ${agentId}: not found`);
        return;
      }

      // Get sessions assigned to this agent
      const assignedSessions = await this.dbService.getAgentActiveSessions(
        agentId
      );

      // Move their sessions back to queue
      for (const session of assignedSessions) {
        await this.transferToQueue(session.id, 'Agent disconnected', 'normal');
      }

      // Remove the agent
      await this.dbService.removeAgent(agentId);

      console.log(
        `👨‍💼 Agent ${agentId} removed, ${assignedSessions.length} sessions transferred back to queue`
      );
    } catch (error) {
      console.error(`Error removing agent ${agentId}:`, error);
      throw error;
    }
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return await this.dbService.getAgent(agentId);
  }

  async getAgentBySocketId(socketId: string): Promise<Agent | null> {
    return await this.dbService.getAgentBySocketId(socketId);
  }

  async assignSessionToAgent(
    sessionId: string,
    agentId: string
  ): Promise<boolean> {
    try {
      const session = await this.dbService.getSession(sessionId);
      const agent = await this.dbService.getAgent(agentId);

      if (!session || !agent) {
        console.error(
          `Cannot assign session: session=${!!session}, agent=${!!agent}`
        );
        return false;
      }

      // Assign in database
      const success = await this.dbService.assignSessionToAgent(
        sessionId,
        agentId
      );

      if (success) {
        // Remove from queue
        await this.queueService.removeFromQueue(sessionId);

        // Update agent status to busy
        await this.dbService.updateAgentStatus(agentId, 'busy');

        console.log(`✅ Session ${sessionId} assigned to agent ${agentId}`);
      }

      return success;
    } catch (error) {
      console.error(
        `Error assigning session ${sessionId} to agent ${agentId}:`,
        error
      );
      return false;
    }
  }

  async getAvailableAgent(): Promise<Agent | undefined> {
    const agents = await this.dbService.getAvailableAgents();

    // Return the first available agent with less than 3 active sessions
    for (const agent of agents) {
      const activeSessions = await this.dbService.getAgentActiveSessions(
        agent.id
      );
      if (activeSessions.length < 3) {
        return agent;
      }
    }

    return undefined;
  }

  async getAllAgents(): Promise<Agent[]> {
    return await this.dbService.getAllAgents();
  }

  // ============= STATISTICS & MONITORING =============

  async getStats() {
    const [dbStats, queueStats] = await Promise.all([
      this.dbService.getSystemStats(),
      this.queueService.getQueueStats(),
    ]);

    return {
      ...dbStats,
      queueLength: queueStats.total,
      queueBreakdown: {
        high: queueStats.high,
        normal: queueStats.normal,
        low: queueStats.low,
      },
      avgWaitTime: queueStats.avgWaitTime,
    };
  }

  async getQueueStatus() {
    return await this.queueService.getWaitingSessions();
  }

  async debugQueue() {
    const [queueDebug, dbStats] = await Promise.all([
      this.queueService.debugQueue(),
      this.dbService.getSystemStats(),
    ]);

    return {
      queue: queueDebug,
      database: dbStats,
      timestamp: new Date().toISOString(),
    };
  }

  // ============= HEALTH CHECKS =============

  async healthCheck(): Promise<{
    database: boolean;
    queue: boolean;
    overall: boolean;
  }> {
    try {
      const [dbHealthy, queueHealth] = await Promise.all([
        this.dbService
          .getSystemStats()
          .then(() => true)
          .catch(() => false),
        this.queueService.healthCheck(),
      ]);

      return {
        database: dbHealthy,
        queue: queueHealth.redis && queueHealth.queuesAccessible,
        overall: dbHealthy && queueHealth.redis && queueHealth.queuesAccessible,
      };
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        database: false,
        queue: false,
        overall: false,
      };
    }
  }

  // ============= CLEANUP OPERATIONS =============

  async cleanup(): Promise<{
    sessionsDeleted: number;
    agentsDeleted: number;
  }> {
    const [sessionsDeleted, agentsDeleted] = await Promise.all([
      this.dbService.cleanupOldSessions(30), // 30 days
      this.dbService.cleanupOfflineAgents(1), // 1 hour
    ]);

    console.log(
      `🧹 Cleanup completed: ${sessionsDeleted} sessions, ${agentsDeleted} agents deleted`
    );

    return {
      sessionsDeleted,
      agentsDeleted,
    };
  }
}
