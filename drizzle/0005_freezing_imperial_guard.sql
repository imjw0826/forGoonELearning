ALTER TABLE `lectures` ADD `paused` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `conversion_id` text;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `audio_url` text;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `audio_expires_at` integer;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `conversion_deleted_at` integer;