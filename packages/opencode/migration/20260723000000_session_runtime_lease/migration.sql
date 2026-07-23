ALTER TABLE `actor_registry` ADD COLUMN `lease_fence` integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE TABLE `runtime_lease` (
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `subresource_id` text NOT NULL DEFAULT '',
  `owner_instance_id` text NOT NULL,
  `owner_pid` integer NOT NULL,
  `lease_id` text NOT NULL,
  `fencing_token` integer NOT NULL,
  `heartbeat_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `cancel_requested_at` integer,
  `cancel_reason` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  PRIMARY KEY (`resource_type`, `resource_id`, `subresource_id`)
);--> statement-breakpoint
CREATE INDEX `runtime_lease_expiry_idx` ON `runtime_lease` (`expires_at`);--> statement-breakpoint
CREATE INDEX `runtime_lease_owner_idx` ON `runtime_lease` (`owner_instance_id`);--> statement-breakpoint
CREATE TABLE `session_prompt_state` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `last_recall_message_id` text,
  `last_pressure_epoch` text,
  `time_updated` integer NOT NULL
);
