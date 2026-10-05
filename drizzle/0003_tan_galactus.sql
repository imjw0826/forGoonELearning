ALTER TABLE `chunks` ADD `corrected_transcript` text;--> statement-breakpoint
ALTER TABLE `chunks` ADD `correction_audit` text;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `provider` text DEFAULT 'assemblyai' NOT NULL;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `transfer_url` text;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `transfer_parts` text;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `transfer_ready` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `media_jobs` ADD `provider_expires_at` integer;