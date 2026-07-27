CREATE TYPE "public"."order_mode" AS ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QUICK_BILL');--> statement-breakpoint
CREATE TABLE "kot_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kot_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"menu_item_name" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"modifiers" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"date_key" varchar(8) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "kot_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_mode" "order_mode" DEFAULT 'DINE_IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_type" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "waiter_name" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pax_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "kot_items" ADD CONSTRAINT "kot_items_kot_id_kitchen_order_tickets_id_fk" FOREIGN KEY ("kot_id") REFERENCES "public"."kitchen_order_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kot_items" ADD CONSTRAINT "kot_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kot_items_kot_idx" ON "kot_items" USING btree ("kot_id");