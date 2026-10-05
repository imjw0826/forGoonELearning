CREATE TABLE `chunks` (
	`lecture_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`audio_key` text NOT NULL,
	`transcript` text,
	`outline` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`lecture_id`, `ordinal`),
	FOREIGN KEY (`lecture_id`) REFERENCES `lectures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lectures` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`filename` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration` integer NOT NULL,
	`total` integer NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`notes` text,
	`created` integer NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_lectures_owner_created` ON `lectures` (`owner`,`created`);