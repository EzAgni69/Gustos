ALTER TABLE `kitchen_order_tickets` ADD `kot_type` text DEFAULT 'ORIGINAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchen_order_tickets` ADD `is_rush` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchen_order_tickets` ADD `is_reprint` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchen_order_tickets` ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE `kitchen_order_tickets` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `kitchen_order_tickets` ADD `cancel_approved_by` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `void_reason` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `void_approved_by` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `is_ncr` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `item_discount_type` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `item_discount_value` real;--> statement-breakpoint
ALTER TABLE `order_items` ADD `item_discount_reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `previous_order_mode` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `is_complimentary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `complimentary_reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `complimentary_approved_by` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `merged_into_order_id` text;