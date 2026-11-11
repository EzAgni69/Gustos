-- Brings the cloud database in line with the schema the API already uses:
-- vendors, purchase orders, goods-received notes, aggregator menu mappings,
-- POS heartbeats, role permissions, tax rules, organization settings and
-- menu item variants.
--
-- Every statement is idempotent. Databases that were brought up to date with
-- `drizzle-kit push` already contain these objects; the migration then simply
-- records itself as applied instead of failing on "already exists".
DO $$ BEGIN
	CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'PARTIAL', 'FULFILLED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "aggregator_menu_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"aggregator_item_id" varchar(255) NOT NULL,
	"pos_menu_item_id" uuid,
	"mapped_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_received_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"grn_number" varchar(50) NOT NULL,
	"received_date" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grn_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"received_quantity" numeric(10, 3) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'ONLINE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"po_number" varchar(50) NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"expected_delivery_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"permissions" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"percentage" numeric(5, 2) NOT NULL,
	"is_cgst_sgst_split" boolean DEFAULT false NOT NULL,
	"zone" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact_name" varchar(255),
	"phone" varchar(20),
	"email" varchar(255),
	"address" text,
	"gst_number" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "variants" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "timezone" varchar(100) DEFAULT 'Asia/Kolkata';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "currency" varchar(10) DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "notification_settings" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_settings" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "aggregator_menu_mappings" ADD CONSTRAINT "aggregator_menu_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "aggregator_menu_mappings" ADD CONSTRAINT "aggregator_menu_mappings_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "aggregator_menu_mappings" ADD CONSTRAINT "aggregator_menu_mappings_pos_menu_item_id_menu_items_id_fk" FOREIGN KEY ("pos_menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_grn_id_goods_received_notes_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_received_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pos_heartbeats" ADD CONSTRAINT "pos_heartbeats_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agg_mapping_org_idx" ON "aggregator_menu_mappings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agg_mapping_outlet_idx" ON "aggregator_menu_mappings" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agg_mapping_provider_item_idx" ON "aggregator_menu_mappings" USING btree ("provider","aggregator_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grn_org_idx" ON "goods_received_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grn_outlet_idx" ON "goods_received_notes" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grn_items_grn_idx" ON "grn_items" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeats_outlet_idx" ON "pos_heartbeats" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_items_po_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_org_idx" ON "purchase_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_outlet_idx" ON "purchase_orders" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_vendor_idx" ON "purchase_orders" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_permissions_org_idx" ON "role_permissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_rules_org_idx" ON "tax_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_org_idx" ON "vendors" USING btree ("organization_id");
