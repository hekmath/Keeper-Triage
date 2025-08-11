ALTER TABLE "agents" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_sessions" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "metadata" SET NOT NULL;