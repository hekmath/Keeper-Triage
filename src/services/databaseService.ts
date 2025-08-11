import { db } from '../database/db';
import {
  chatSessions,
  messages,
  agents,
  sessionAnalytics,
  type ChatSession,
  type NewChatSession,
  type Message,
  type NewMessage,
  type Agent,
  type NewAgent,
  type SessionAnalytics,
  type NewSessionAnalytics,
} from '../database/schema';
import { eq, and, desc, asc, count, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export class DatabaseService {
  // ============= SESSION OPERATIONS =============

  async createSession(
    userId: string,
    botContext?: string,
    metadata?: Record<string, any>
  ): Promise<ChatSession> {
    const sessionData: NewChatSession = {
      id: uuidv4(),
      userId,
      status: 'bot',
      botContext,
      metadata: metadata || {},
    };

    const [session] = await db
      .insert(chatSessions)
      .values(sessionData)
      .returning();
    return session;
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));

    return session || null;
  }

  async updateSessionStatus(
    sessionId: string,
    status: 'bot' | 'waiting' | 'agent' | 'closed',
    assignedAgent?: string
  ): Promise<void> {
    const updateData: Partial<NewChatSession> = {
      status,
      updatedAt: new Date(),
    };

    if (assignedAgent !== undefined) {
      updateData.assignedAgent = assignedAgent;
    }

    await db
      .update(chatSessions)
      .set(updateData)
      .where(eq(chatSessions.id, sessionId));
  }

  async assignSessionToAgent(
    sessionId: string,
    agentId: string
  ): Promise<boolean> {
    try {
      await db
        .update(chatSessions)
        .set({
          assignedAgent: agentId,
          status: 'agent',
          updatedAt: new Date(),
        })
        .where(eq(chatSessions.id, sessionId));

      return true;
    } catch (error) {
      console.error('Error assigning session to agent:', error);
      return false;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await db
      .update(chatSessions)
      .set({
        status: 'closed',
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId));
  }

  async getSessionsByStatus(
    status: 'bot' | 'waiting' | 'agent' | 'closed'
  ): Promise<ChatSession[]> {
    return await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.status, status))
      .orderBy(desc(chatSessions.createdAt));
  }

  async getSessionsWithMessages(sessionId: string): Promise<{
    session: ChatSession;
    messages: Message[];
  } | null> {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));

    if (!session) return null;

    const sessionMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.timestamp));

    return {
      session,
      messages: sessionMessages,
    };
  }

  // ============= MESSAGE OPERATIONS =============

  async addMessage(
    sessionId: string,
    content: string,
    sender: 'user' | 'bot' | 'agent' | 'system',
    metadata?: Record<string, any>
  ): Promise<Message> {
    const messageData: NewMessage = {
      id: uuidv4(),
      sessionId,
      content,
      sender,
      metadata: metadata || {},
    };

    const [message] = await db.insert(messages).values(messageData).returning();

    // Update session timestamp
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    return message;
  }

  async getSessionMessageCount(sessionId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));

    return result.count;
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.timestamp));
  }

  async getRecentMessages(
    sessionId: string,
    limit: number = 10
  ): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.timestamp))
      .limit(limit);
  }

  // ============= AGENT OPERATIONS =============

  async createAgent(
    socketId: string,
    name: string,
    metadata?: Record<string, any>
  ): Promise<Agent> {
    const agentData: NewAgent = {
      id: uuidv4(),
      socketId,
      name,
      status: 'available',
      metadata: metadata || {},
    };

    const [agent] = await db.insert(agents).values(agentData).returning();
    return agent;
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));

    return agent || null;
  }

  async getAgentBySocketId(socketId: string): Promise<Agent | null> {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.socketId, socketId));

    return agent || null;
  }

  async updateAgentStatus(
    agentId: string,
    status: 'available' | 'busy' | 'offline'
  ): Promise<void> {
    await db
      .update(agents)
      .set({
        status,
        lastActiveAt: new Date(),
      })
      .where(eq(agents.id, agentId));
  }

  async removeAgent(agentId: string): Promise<void> {
    // First, unassign any sessions assigned to this agent
    await db
      .update(chatSessions)
      .set({
        assignedAgent: null,
        status: 'waiting',
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.assignedAgent, agentId));

    // Then remove the agent
    await db.delete(agents).where(eq(agents.id, agentId));
  }

  async getAvailableAgents(): Promise<Agent[]> {
    return await db
      .select()
      .from(agents)
      .where(eq(agents.status, 'available'))
      .orderBy(asc(agents.joinedAt));
  }

  async getAllAgents(): Promise<Agent[]> {
    return await db.select().from(agents).orderBy(desc(agents.lastActiveAt));
  }

  async getAgentActiveSessions(agentId: string): Promise<ChatSession[]> {
    return await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.assignedAgent, agentId),
          eq(chatSessions.status, 'agent')
        )
      );
  }

  // ============= ANALYTICS OPERATIONS =============

  async createSessionAnalytics(
    data: NewSessionAnalytics
  ): Promise<SessionAnalytics> {
    const [analytics] = await db
      .insert(sessionAnalytics)
      .values(data)
      .returning();
    return analytics;
  }

  async updateSessionAnalytics(
    sessionId: string,
    updates: Partial<NewSessionAnalytics>
  ): Promise<void> {
    await db
      .update(sessionAnalytics)
      .set(updates)
      .where(eq(sessionAnalytics.sessionId, sessionId));
  }

  // ============= STATISTICS OPERATIONS =============

  async getSystemStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    totalAgents: number;
    availableAgents: number;
    messagesLast24h: number;
  }> {
    // Get session counts
    const [sessionCounts] = await db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where status != 'closed')`,
      })
      .from(chatSessions);

    // Get agent counts
    const [agentCounts] = await db
      .select({
        total: count(),
        available: sql<number>`count(*) filter (where status = 'available')`,
      })
      .from(agents);

    // Get messages in last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const [messageCounts] = await db
      .select({ count: count() })
      .from(messages)
      .where(sql`timestamp > ${yesterday}`);

    return {
      totalSessions: sessionCounts.total,
      activeSessions: sessionCounts.active,
      totalAgents: agentCounts.total,
      availableAgents: agentCounts.available,
      messagesLast24h: messageCounts.count,
    };
  }

  // ============= CLEANUP OPERATIONS =============

  async cleanupOldSessions(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(chatSessions)
      .where(
        and(eq(chatSessions.status, 'closed'), sql`updated_at < ${cutoffDate}`)
      );

    return result.rowCount || 0;
  }

  async cleanupOfflineAgents(olderThanHours: number = 1): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - olderThanHours);

    const result = await db
      .delete(agents)
      .where(
        and(eq(agents.status, 'offline'), sql`last_active_at < ${cutoffDate}`)
      );

    return result.rowCount || 0;
  }
}
