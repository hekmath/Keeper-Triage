import {
  pgTable,
  pgEnum,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  unique,
  customType,
  serial,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Custom pgvector type helper
 * IMPORTANT: If you switch to text-embedding-3-small, change to vector(1536)
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value: number[]): string {
    // pgvector array literal (unquoted)
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});

// ======================== Enums ========================
export const sessionStatusEnum = pgEnum('session_status', [
  'bot',
  'waiting',
  'agent',
  'closed',
]);

export const messageSenderEnum = pgEnum('message_sender', [
  'user',
  'bot',
  'agent',
  'system',
]);

export const agentStatusEnum = pgEnum('agent_status', [
  'available',
  'busy',
  'offline',
]);

export const transferPriorityEnum = pgEnum('transfer_priority', [
  'low',
  'normal',
  'high',
]);

// ======================== Knowledge Documents ========================
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding'), // can be null (we'll compute centroid)
    metadata: jsonb('metadata')
      .$type<Record<string, any>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    titleIdx: index('knowledge_documents_title_idx').on(table.title),
    createdAtIdx: index('knowledge_documents_created_at_idx').on(
      table.createdAt
    ),
  })
);

// NEW: Chunk table for RAG
export const knowledgeDocumentChunks = pgTable(
  'knowledge_document_chunks',
  {
    id: serial('id').primaryKey(),
    docId: integer('doc_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    docIdIdx: index('kdc_doc_id_idx').on(table.docId),
    orderIdx: index('kdc_doc_order_idx').on(table.docId, table.chunkIndex),
  })
);

// Relations for future use
export const knowledgeDocumentsRelations = relations(
  knowledgeDocuments,
  ({ many }) => ({
    // add if needed later
  })
);

export const knowledgeDocumentChunksRelations = relations(
  knowledgeDocumentChunks,
  ({ one }) => ({
    document: one(knowledgeDocuments, {
      fields: [knowledgeDocumentChunks.docId],
      references: [knowledgeDocuments.id],
    }),
  })
);

// ======================== Chat Sessions ========================
export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    status: sessionStatusEnum('status').notNull().default('bot'),
    assignedAgent: varchar('assigned_agent', { length: 36 }).references(
      () => agents.id
    ),
    botContext: text('bot_context'),
    metadata: jsonb('metadata')
      .$type<Record<string, any>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index('chat_sessions_user_id_idx').on(table.userId),
    statusIdx: index('chat_sessions_status_idx').on(table.status),
    assignedAgentIdx: index('chat_sessions_assigned_agent_idx').on(
      table.assignedAgent
    ),
    createdAtIdx: index('chat_sessions_created_at_idx').on(table.createdAt),
  })
);

// ======================== Messages ========================
export const messages = pgTable(
  'messages',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    sessionId: varchar('session_id', { length: 36 })
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    sender: messageSenderEnum('sender').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, any>>()
      .notNull()
      .default({}),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index('messages_session_id_idx').on(table.sessionId),
    senderIdx: index('messages_sender_idx').on(table.sender),
    timestampIdx: index('messages_timestamp_idx').on(table.timestamp),
  })
);

// ======================== Agents ========================
export const agents = pgTable(
  'agents',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    socketId: varchar('socket_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: agentStatusEnum('status').notNull().default('available'),
    metadata: jsonb('metadata')
      .$type<Record<string, any>>()
      .notNull()
      .default({}),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at').notNull().defaultNow(),
  },
  (table) => ({
    socketIdIdx: unique('agents_socket_id_unique').on(table.socketId),
    statusIdx: index('agents_status_idx').on(table.status),
    lastActiveIdx: index('agents_last_active_idx').on(table.lastActiveAt),
  })
);

// ======================== Transfer Queue ========================
export const transferQueue = pgTable(
  'transfer_queue',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sessionId: varchar('session_id', { length: 36 })
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    priority: transferPriorityEnum('priority').notNull().default('normal'),
    position: integer('position').notNull().default(0),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
    isActive: integer('is_active').notNull().default(1),
  },
  (table) => ({
    sessionIdIdx: unique('transfer_queue_session_id_unique').on(
      table.sessionId
    ),
    priorityIdx: index('transfer_queue_priority_idx').on(table.priority),
    positionIdx: index('transfer_queue_position_idx').on(table.position),
    requestedAtIdx: index('transfer_queue_requested_at_idx').on(
      table.requestedAt
    ),
    activeIdx: index('transfer_queue_active_idx').on(table.isActive),
  })
);

// ======================== Session Analytics ========================
export const sessionAnalytics = pgTable(
  'session_analytics',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sessionId: varchar('session_id', { length: 36 })
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    totalMessages: integer('total_messages').notNull().default(0),
    botMessages: integer('bot_messages').notNull().default(0),
    userMessages: integer('user_messages').notNull().default(0),
    agentMessages: integer('agent_messages').notNull().default(0),
    sessionDuration: integer('session_duration'),
    queueWaitTime: integer('queue_wait_time'),
    agentResponseTime: integer('agent_response_time'),
    wasTransferred: integer('was_transferred').notNull().default(0),
    transferReason: text('transfer_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: unique('session_analytics_session_id_unique').on(
      table.sessionId
    ),
    transferredIdx: index('session_analytics_transferred_idx').on(
      table.wasTransferred
    ),
    createdAtIdx: index('session_analytics_created_at_idx').on(table.createdAt),
  })
);

// ======================== Relations ========================
export const chatSessionsRelations = relations(
  chatSessions,
  ({ many, one }) => ({
    messages: many(messages),
    agent: one(agents, {
      fields: [chatSessions.assignedAgent],
      references: [agents.id],
    }),
    transferQueue: one(transferQueue, {
      fields: [chatSessions.id],
      references: [transferQueue.sessionId],
    }),
    analytics: one(sessionAnalytics, {
      fields: [chatSessions.id],
      references: [sessionAnalytics.sessionId],
    }),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [messages.sessionId],
    references: [chatSessions.id],
  }),
}));

export const agentsRelations = relations(agents, ({ many }) => ({
  assignedSessions: many(chatSessions),
}));

export const transferQueueRelations = relations(transferQueue, ({ one }) => ({
  session: one(chatSessions, {
    fields: [transferQueue.sessionId],
    references: [chatSessions.id],
  }),
}));

export const sessionAnalyticsRelations = relations(
  sessionAnalytics,
  ({ one }) => ({
    session: one(chatSessions, {
      fields: [sessionAnalytics.sessionId],
      references: [chatSessions.id],
    }),
  })
);

// ======================== Type exports ========================
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type NewKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;

export type KnowledgeDocumentChunk =
  typeof knowledgeDocumentChunks.$inferSelect;
export type NewKnowledgeDocumentChunk =
  typeof knowledgeDocumentChunks.$inferInsert;

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type TransferQueueEntry = typeof transferQueue.$inferSelect;
export type NewTransferQueueEntry = typeof transferQueue.$inferInsert;
export type SessionAnalytics = typeof sessionAnalytics.$inferSelect;
export type NewSessionAnalytics = typeof sessionAnalytics.$inferInsert;
