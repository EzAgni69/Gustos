-- POS heartbeat detail for the ERP Edge Sync Monitor (idempotent).
ALTER TABLE "pos_heartbeats" ADD COLUMN IF NOT EXISTS "pending_uploads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_heartbeats" ADD COLUMN IF NOT EXISTS "dead_uploads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_heartbeats" ADD COLUMN IF NOT EXISTS "pos_version" varchar(30);