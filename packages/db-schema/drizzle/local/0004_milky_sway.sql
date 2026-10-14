CREATE TABLE `cashier_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`cashier_id` text NOT NULL,
	`cashier_name` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`opening_float` real DEFAULT 0 NOT NULL,
	`total_cash_sales` real DEFAULT 0 NOT NULL,
	`total_card_sales` real DEFAULT 0 NOT NULL,
	`total_upi_sales` real DEFAULT 0 NOT NULL,
	`total_online_sales` real DEFAULT 0 NOT NULL,
	`total_split_sales` real DEFAULT 0 NOT NULL,
	`total_orders` integer DEFAULT 0 NOT NULL,
	`total_discounts` real DEFAULT 0 NOT NULL,
	`total_tips` real DEFAULT 0 NOT NULL,
	`total_change_due` real DEFAULT 0 NOT NULL,
	`expected_cash_in_drawer` real DEFAULT 0 NOT NULL,
	`actual_cash_in_drawer` real,
	`cash_variance` real,
	`notes` text,
	`status` text DEFAULT 'OPEN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `print_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`template_type` text NOT NULL,
	`template_data` text NOT NULL,
	`printer_target` text DEFAULT 'pos' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`last_sync_timestamp` text NOT NULL,
	`updated_at` text NOT NULL
);
