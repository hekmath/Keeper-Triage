// src/socket/chatManager.ts

import { v4 as uuidv4 } from 'uuid';
import { ChatSession, Message, Agent } from '../types/chat.types';

export class ChatManager {
  private sessions: Map<string, ChatSession> = new Map();
  private agents: Map<string, Agent> = new Map();
  private waitingQueue: string[] = [];

  // Session Management
  createSession(userId: string, botContext?: string): ChatSession {
    const session: ChatSession = {
      id: uuidv4(),
      userId,
      status: 'bot',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      botContext,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  updateSessionStatus(sessionId: string, status: ChatSession['status']): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = new Date();

      if (status === 'waiting') {
        this.addToQueue(sessionId);
      } else if (status === 'agent' || status === 'closed') {
        this.removeFromQueue(sessionId);
      }
    }
  }

  // Message Management
  addMessage(
    sessionId: string,
    content: string,
    sender: Message['sender'],
    metadata?: any
  ): Message | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const message: Message = {
      id: uuidv4(),
      sessionId,
      content,
      sender,
      timestamp: new Date(),
      metadata,
    };

    session.messages.push(message);
    session.updatedAt = new Date();

    return message;
  }

  getSessionMessages(sessionId: string): Message[] {
    const session = this.sessions.get(sessionId);
    return session ? session.messages : [];
  }

  // Queue Management
  addToQueue(sessionId: string): void {
    if (!this.waitingQueue.includes(sessionId)) {
      this.waitingQueue.push(sessionId);
    }
  }

  removeFromQueue(sessionId: string): void {
    const index = this.waitingQueue.indexOf(sessionId);
    if (index > -1) {
      this.waitingQueue.splice(index, 1);
    }
  }

  getNextInQueue(): string | undefined {
    return this.waitingQueue.shift();
  }

  getQueueLength(): number {
    return this.waitingQueue.length;
  }

  getWaitingSessions(): ChatSession[] {
    return this.waitingQueue
      .map((id) => this.sessions.get(id))
      .filter((session) => session !== undefined) as ChatSession[];
  }

  // Agent Management
  addAgent(socketId: string, name: string): Agent {
    const agent: Agent = {
      id: uuidv4(),
      socketId,
      name,
      status: 'available',
      activeSessions: [],
      joinedAt: new Date(),
    };

    this.agents.set(agent.id, agent);
    return agent;
  }

  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      // Reassign sessions back to queue
      agent.activeSessions.forEach((sessionId) => {
        this.updateSessionStatus(sessionId, 'waiting');
      });
      this.agents.delete(agentId);
    }
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAgentBySocketId(socketId: string): Agent | undefined {
    return Array.from(this.agents.values()).find(
      (agent) => agent.socketId === socketId
    );
  }

  assignSessionToAgent(sessionId: string, agentId: string): boolean {
    const session = this.sessions.get(sessionId);
    const agent = this.agents.get(agentId);

    if (!session || !agent) return false;

    session.assignedAgent = agentId;
    session.status = 'agent';
    session.updatedAt = new Date();

    agent.activeSessions.push(sessionId);
    agent.status = 'busy';

    this.removeFromQueue(sessionId);

    return true;
  }

  getAvailableAgent(): Agent | undefined {
    return Array.from(this.agents.values()).find(
      (agent) => agent.status === 'available' && agent.activeSessions.length < 5
    );
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // Cleanup
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'closed';
      session.updatedAt = new Date();

      // Remove from agent's active sessions
      if (session.assignedAgent) {
        const agent = this.agents.get(session.assignedAgent);
        if (agent) {
          const index = agent.activeSessions.indexOf(sessionId);
          if (index > -1) {
            agent.activeSessions.splice(index, 1);
          }
          if (agent.activeSessions.length === 0) {
            agent.status = 'available';
          }
        }
      }

      this.removeFromQueue(sessionId);
    }
  }

  // Stats
  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status !== 'closed'
      ).length,
      queueLength: this.waitingQueue.length,
      totalAgents: this.agents.size,
      availableAgents: Array.from(this.agents.values()).filter(
        (a) => a.status === 'available'
      ).length,
    };
  }
}
