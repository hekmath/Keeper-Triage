import { v4 as uuidv4 } from 'uuid';
import { ChatSession, Message, Agent } from '../types/chat.types';

export class ChatManager {
  private sessions: Map<string, ChatSession> = new Map();
  private agents: Map<string, Agent> = new Map();
  private transferQueue: Array<{
    sessionId: string;
    reason: string;
    priority: 'low' | 'normal' | 'high';
    requestedAt: Date;
  }> = [];

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
      metadata: {},
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Enhanced transfer method
  async transferToQueue(
    sessionId: string,
    reason: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Update session status
    session.status = 'waiting';
    session.updatedAt = new Date();
    session.metadata = {
      ...session.metadata,
      transferReason: reason,
      priority,
    };

    // Add to queue with priority handling
    const queueEntry = {
      sessionId,
      reason,
      priority,
      requestedAt: new Date(),
    };

    if (priority === 'high') {
      this.transferQueue.unshift(queueEntry);
    } else if (priority === 'low') {
      this.transferQueue.push(queueEntry);
    } else {
      // Normal priority - insert before low priority items
      const lowPriorityIndex = this.transferQueue.findIndex(
        (item) => item.priority === 'low'
      );
      if (lowPriorityIndex === -1) {
        this.transferQueue.push(queueEntry);
      } else {
        this.transferQueue.splice(lowPriorityIndex, 0, queueEntry);
      }
    }

    console.log(
      `🔄 Session ${sessionId} added to queue - Reason: ${reason} (Priority: ${priority})`
    );
  }

  updateSessionStatus(sessionId: string, status: ChatSession['status']): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = new Date();

      if (status === 'agent' || status === 'closed') {
        this.removeFromQueue(sessionId);
      }
    }
  }

  // Enhanced removeFromQueue with logging and return value
  removeFromQueue(sessionId: string): boolean {
    const initialLength = this.transferQueue.length;
    const index = this.transferQueue.findIndex(
      (item) => item.sessionId === sessionId
    );

    if (index > -1) {
      const removed = this.transferQueue.splice(index, 1)[0];
      console.log(
        `🗑️ Removed ${sessionId} from queue (was at position ${index + 1})`
      );
      console.log(
        `📊 Queue length: ${initialLength} → ${this.transferQueue.length}`
      );
      return true;
    } else {
      console.log(`⚠️ Session ${sessionId} not found in queue`);
      return false;
    }
  }

  getNextInQueue(): string | undefined {
    const queueEntry = this.transferQueue.shift();
    return queueEntry?.sessionId;
  }

  getQueueLength(): number {
    return this.transferQueue.length;
  }

  getWaitingSessions(): ChatSession[] {
    return this.transferQueue
      .map((item) => this.sessions.get(item.sessionId))
      .filter((session): session is ChatSession => session !== undefined);
  }

  getQueuePosition(sessionId: string): number {
    const index = this.transferQueue.findIndex(
      (item) => item.sessionId === sessionId
    );
    return index === -1 ? 0 : index + 1;
  }

  // Add method to get queue status for debugging
  getQueueStatus(): Array<{
    sessionId: string;
    status: string;
    priority: string;
    waitTime: number;
  }> {
    return this.transferQueue.map((item) => {
      const session = this.sessions.get(item.sessionId);
      return {
        sessionId: item.sessionId,
        status: session?.status || 'unknown',
        priority: item.priority,
        waitTime: Math.floor(
          (new Date().getTime() - item.requestedAt.getTime()) / 60000
        ),
      };
    });
  }

  // Enhanced debugging method
  debugQueue(): void {
    console.log('🔍 Queue Debug Info:');
    console.log(`📊 Total in queue: ${this.transferQueue.length}`);
    const queueStatus = this.getQueueStatus();
    queueStatus.forEach((item, index) => {
      console.log(
        `  ${index + 1}. ${item.sessionId} - Status: ${
          item.status
        }, Priority: ${item.priority}, Wait: ${item.waitTime}m`
      );
    });
  }

  // Clear entire queue (for debugging)
  clearQueue(): number {
    const clearedCount = this.transferQueue.length;
    this.transferQueue = [];
    console.log(`🗑️ Cleared ${clearedCount} items from queue`);
    return clearedCount;
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
      // Move their sessions back to queue
      agent.activeSessions.forEach((sessionId) => {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'waiting';
          session.assignedAgent = undefined;
          this.transferQueue.push({
            sessionId,
            reason: 'Agent disconnected',
            priority: 'normal',
            requestedAt: new Date(),
          });
        }
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
      (agent) => agent.status === 'available' && agent.activeSessions.length < 3
    );
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // Enhanced closeSession with better queue cleanup
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`⚠️ Cannot close session ${sessionId}: not found`);
      return;
    }

    console.log(`🔒 Closing session ${sessionId} (Status: ${session.status})`);

    session.status = 'closed';
    session.updatedAt = new Date();

    // Clean up agent assignment
    if (session.assignedAgent) {
      const agent = this.agents.get(session.assignedAgent);
      if (agent) {
        const index = agent.activeSessions.indexOf(sessionId);
        if (index > -1) {
          agent.activeSessions.splice(index, 1);
          console.log(
            `👨‍💼 Removed session ${sessionId} from agent ${session.assignedAgent}`
          );
        }
        if (agent.activeSessions.length === 0) {
          agent.status = 'available';
          console.log(`👨‍💼 Agent ${session.assignedAgent} is now available`);
        }
      }
    }

    // Always try to remove from queue (in case session was waiting)
    const wasInQueue = this.removeFromQueue(sessionId);
    if (wasInQueue) {
      console.log(`✅ Session ${sessionId} removed from queue during close`);
    }
  }

  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status !== 'closed'
      ).length,
      queueLength: this.transferQueue.length,
      totalAgents: this.agents.size,
      availableAgents: Array.from(this.agents.values()).filter(
        (a) => a.status === 'available'
      ).length,
    };
  }
}
