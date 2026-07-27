CREATE TABLE `dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`section` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kitchen_order_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`kot_number` text NOT NULL,
	`station` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `local_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pin` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `menu_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`outlet_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` real NOT NULL,
	`gst_rate` text DEFAULT '5' NOT NULL,
	`is_veg` integer DEFAULT true NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`menu_item_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` real NOT NULL,
	`gst_rate` text NOT NULL,
	`modifiers` text,
	`notes` text,
	`status` text DEFAULT 'PLACED' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`table_id` text,
	`order_number` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`payment_mode` text,
	`customer_id` text,
	`waiter_id` text,
	`notes` text,
	`is_synced` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`synced_at` text
);
