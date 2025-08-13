-- Fixed migration with IF NOT EXISTS clauses
DO $$ 
BEGIN
  -- Create enums only if they don't exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_status') THEN
    CREATE TYPE "public"."agent_status" AS ENUM('available', 'busy', 'offline');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_sender') THEN
    CREATE TYPE "public"."message_sender" AS ENUM('user', 'bot', 'agent', 'system');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE "public"."session_status" AS ENUM('bot', 'waiting', 'agent', 'closed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_priority') THEN
    CREATE TYPE "public"."transfer_priority" AS ENUM('low', 'normal', 'high');
  END IF;
END $$;

-- Create tables with IF NOT EXISTS
CREATE TABLE IF NOT EXISTS "agents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"socket_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "agent_status" DEFAULT 'available' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_socket_id_unique" UNIQUE("socket_id")
);

CREATE TABLE IF NOT EXISTS "chat_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" "session_status" DEFAULT 'bot' NOT NULL,
	"assigned_agent" varchar(36),
	"bot_context" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_document_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(3072) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_documents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "knowledge_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(3072),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "messages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"session_id" varchar(36) NOT NULL,
	"content" text NOT NULL,
	"sender" "message_sender" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "session_analytics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_analytics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" varchar(36) NOT NULL,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"bot_messages" integer DEFAULT 0 NOT NULL,
	"user_messages" integer DEFAULT 0 NOT NULL,
	"agent_messages" integer DEFAULT 0 NOT NULL,
	"session_duration" integer,
	"queue_wait_time" integer,
	"agent_response_time" integer,
	"was_transferred" integer DEFAULT 0 NOT NULL,
	"transfer_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_analytics_session_id_unique" UNIQUE("session_id")
);

CREATE TABLE IF NOT EXISTS "transfer_queue" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" varchar(36) NOT NULL,
	"reason" text NOT NULL,
	"priority" "transfer_priority" DEFAULT 'normal' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"is_active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transfer_queue_session_id_unique" UNIQUE("session_id")
);

-- Add foreign keys (these will only be added if they don't exist)
DO $$
BEGIN
  -- Check and add foreign keys
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'chat_sessions_assigned_agent_agents_id_fk'
  ) THEN
    ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_assigned_agent_agents_id_fk" 
    FOREIGN KEY ("assigned_agent") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'knowledge_document_chunks_doc_id_knowledge_documents_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_chunks" ADD CONSTRAINT "knowledge_document_chunks_doc_id_knowledge_documents_id_fk" 
    FOREIGN KEY ("doc_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'messages_session_id_chat_sessions_id_fk'
  ) THEN
    ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_chat_sessions_id_fk" 
    FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'session_analytics_session_id_chat_sessions_id_fk'
  ) THEN
    ALTER TABLE "session_analytics" ADD CONSTRAINT "session_analytics_session_id_chat_sessions_id_fk" 
    FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'transfer_queue_session_id_chat_sessions_id_fk'
  ) THEN
    ALTER TABLE "transfer_queue" ADD CONSTRAINT "transfer_queue_session_id_chat_sessions_id_fk" 
    FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Create indexes (these will only be created if they don't exist)
CREATE INDEX IF NOT EXISTS "agents_status_idx" ON "agents" USING btree ("status");
CREATE INDEX IF NOT EXISTS "agents_last_active_idx" ON "agents" USING btree ("last_active_at");
CREATE INDEX IF NOT EXISTS "chat_sessions_user_id_idx" ON "chat_sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "chat_sessions_status_idx" ON "chat_sessions" USING btree ("status");
CREATE INDEX IF NOT EXISTS "chat_sessions_assigned_agent_idx" ON "chat_sessions" USING btree ("assigned_agent");
CREATE INDEX IF NOT EXISTS "chat_sessions_created_at_idx" ON "chat_sessions" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "kdc_doc_id_idx" ON "knowledge_document_chunks" USING btree ("doc_id");
CREATE INDEX IF NOT EXISTS "kdc_doc_order_idx" ON "knowledge_document_chunks" USING btree ("doc_id","chunk_index");
CREATE INDEX IF NOT EXISTS "knowledge_documents_title_idx" ON "knowledge_documents" USING btree ("title");
CREATE INDEX IF NOT EXISTS "knowledge_documents_created_at_idx" ON "knowledge_documents" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "messages_session_id_idx" ON "messages" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "messages_sender_idx" ON "messages" USING btree ("sender");
CREATE INDEX IF NOT EXISTS "messages_timestamp_idx" ON "messages" USING btree ("timestamp");
CREATE INDEX IF NOT EXISTS "session_analytics_transferred_idx" ON "session_analytics" USING btree ("was_transferred");
CREATE INDEX IF NOT EXISTS "session_analytics_created_at_idx" ON "session_analytics" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "transfer_queue_priority_idx" ON "transfer_queue" USING btree ("priority");
CREATE INDEX IF NOT EXISTS "transfer_queue_position_idx" ON "transfer_queue" USING btree ("position");
CREATE INDEX IF NOT EXISTS "transfer_queue_requested_at_idx" ON "transfer_queue" USING btree ("requested_at");
CREATE INDEX IF NOT EXISTS "transfer_queue_active_idx" ON "transfer_queue" USING btree ("is_active");