CREATE TABLE `media_jobs` (
	`lecture_id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`media_type` text NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	`upload_url` text,
	`remote_id` text,
	`remote_status` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`lecture_id`) REFERENCES `lectures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `upload_parts` (
	`lecture_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`bytes` integer NOT NULL,
	PRIMARY KEY(`lecture_id`, `part_number`),
	FOREIGN KEY (`lecture_id`) REFERENCES `lectures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chunks` ADD `start_seconds` integer;