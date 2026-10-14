CREATE TYPE "public"."order_mode" AS ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'ONLINE');--> statement-breakpoint
CREATE TYPE "public"."stock_transaction_type" AS ENUM('ORDER_DEDUCTION', 'MANUAL_ADD', 'MANUAL_REMOVE', 'PURCHASE_ORDER', 'ADJUSTMENT');--> statement-breakpoint
ALTER TYPE "public"."payment_mode" ADD VALUE 'OTHER';--> statement-breakpoint
CREATE TABLE "stock_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"order_id" uuid,
	"type" "stock_transaction_type" NOT NULL,
	"quantity_change" numeric(10, 3) NOT NULL,
	"balance_after" numeric(10, 3) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"customer_name" varchar(255),
	"reservation_time" timestamp NOT NULL,
	"duration_mins" integer DEFAULT 60 NOT NULL,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "receipt_status" varchar(50) DEFAULT 'ORIGINAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cgst_rate" numeric(5, 2) DEFAULT '2.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sgst_rate" numeric(5, 2) DEFAULT '2.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "total_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_sub_method" varchar(50);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_splits" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_name" varchar(255);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "add_ons" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_mode" "order_mode" DEFAULT 'DINE_IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_type" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_label" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_sub_method" varchar(50);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_splits" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "waiter_name" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cashier_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cashier_name" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "token_numbers" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pax_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_tx_org_idx" ON "stock_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stock_tx_item_idx" ON "stock_transactions" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "stock_tx_order_idx" ON "stock_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "stock_tx_created_idx" ON "stock_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "table_reservations_outlet_idx" ON "table_reservations" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "table_reservations_table_idx" ON "table_reservations" USING btree ("table_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;