CREATE TABLE `outlet_config` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`outlet_name` text NOT NULL,
	`address` text NOT NULL,
	`phone` text,
	`gst_number` text,
	`fssai_license_no` text,
	`greeting_message` text DEFAULT 'Thank you, visit again!',
	`logo_image_path` text,
	`default_gst_rate` text DEFAULT '5' NOT NULL,
	`currency_symbol` text DEFAULT '₹' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `table_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`table_id` text NOT NULL,
	`customer_name` text,
	`reservation_time` text NOT NULL,
	`duration_mins` integer DEFAULT 60 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `receipt_status` text DEFAULT 'ORIGINAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `cgst_rate` real DEFAULT 2.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `sgst_rate` real DEFAULT 2.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `total_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `payment_sub_method` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `payment_splits` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `variant_name` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `add_ons` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_label` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_sub_method` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_splits` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `cashier_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `cashier_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `token_numbers` text;