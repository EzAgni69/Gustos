CREATE TABLE `kot_station_status` (
	`id` text PRIMARY KEY NOT NULL,
	`kot_id` text NOT NULL,
	`order_id` text NOT NULL,
	`station_id` text NOT NULL,
	`ready_at` text NOT NULL,
	FOREIGN KEY (`kot_id`) REFERENCES `kitchen_order_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kot_station_status_kot_station_idx` ON `kot_station_status` (`kot_id`,`station_id`);--> statement-breakpoint
ALTER TABLE `kitchen_order_tickets` ADD `expo_bumped_at` text;