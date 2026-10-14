ALTER TABLE `invoices` ADD `tip_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `tendered_amount` real;--> statement-breakpoint
ALTER TABLE `invoices` ADD `change_due` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `tip_amount` real DEFAULT 0 NOT NULL;