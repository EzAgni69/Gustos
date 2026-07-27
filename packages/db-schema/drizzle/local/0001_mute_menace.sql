CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`subtotal` real NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`cgst_amount` real DEFAULT 0 NOT NULL,
	`sgst_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real NOT NULL,
	`payment_mode` text NOT NULL,
	`is_paid` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kot_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kot_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`menu_item_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`modifiers` text,
	`notes` text,
	FOREIGN KEY (`kot_id`) REFERENCES `kitchen_order_tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`current_value` integer DEFAULT 0 NOT NULL,
	`date_key` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `current_order_id` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `kot_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `order_mode` text DEFAULT 'DINE_IN' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_type` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_value` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_phone` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `waiter_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `pax_count` integer DEFAULT 1 NOT NULL;