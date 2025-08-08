// src/types/chat.types.ts

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'user' | 'bot' | 'agent' | 'system';
  timestamp: Date;
  metadata?: {
    agentId?: string;
    transferReason?: string;
    [key: string]: any;
  };
}

export interface ChatSession {
  id: string;
  userId: string;
  status: 'bot' | 'waiting' | 'agent' | 'closed';
  assignedAgent?: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  botContext?: string;
  metadata?: {
    userName?: string;
    userEmail?: string;
    [key: string]: any;
  };
}

export interface Agent {
  id: string;
  socketId: string;
  name: string;
  status: 'available' | 'busy' | 'offline';
  activeSessions: string[];
  joinedAt: Date;
}

export interface TransferRequest {
  sessionId: string;
  reason?: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface BotConfig {
  systemPrompt: string;
  contextPrompt?: string;
  transferKeywords: string[];
  model?: string;
  temperature?: number;
}
