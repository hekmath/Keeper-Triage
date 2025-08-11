CREATE TYPE "public"."agent_status" AS ENUM('available', 'busy', 'offline');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('user', 'bot', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('bot', 'waiting', 'agent', 'closed');--> statement-breakpoint
CREATE TYPE "public"."transfer_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"socket_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "agent_status" DEFAULT 'available' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_socket_id_unique" UNIQUE("socket_id")
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" "session_status" DEFAULT 'bot' NOT NULL,
	"assigned_agent" varchar(36),
	"bot_context" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"session_id" varchar(36) NOT NULL,
	"content" text NOT NULL,
	"sender" "message_sender" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_analytics" (
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
--> statement-breakpoint
CREATE TABLE "transfer_queue" (
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
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_assigned_agent_agents_id_fk" FOREIGN KEY ("assigned_agent") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_analytics" ADD CONSTRAINT "session_analytics_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_queue" ADD CONSTRAINT "transfer_queue_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agents_last_active_idx" ON "agents" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_user_id_idx" ON "chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_sessions_status_idx" ON "chat_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_sessions_assigned_agent_idx" ON "chat_sessions" USING btree ("assigned_agent");--> statement-breakpoint
CREATE INDEX "chat_sessions_created_at_idx" ON "chat_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_session_id_idx" ON "messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender");--> statement-breakpoint
CREATE INDEX "messages_timestamp_idx" ON "messages" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "session_analytics_transferred_idx" ON "session_analytics" USING btree ("was_transferred");--> statement-breakpoint
CREATE INDEX "session_analytics_created_at_idx" ON "session_analytics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transfer_queue_priority_idx" ON "transfer_queue" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "transfer_queue_position_idx" ON "transfer_queue" USING btree ("position");--> statement-breakpoint
CREATE INDEX "transfer_queue_requested_at_idx" ON "transfer_queue" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "transfer_queue_active_idx" ON "transfer_queue" USING btree ("is_active");