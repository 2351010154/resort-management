ALTER TABLE "system_config" DROP CONSTRAINT "system_config_vat_rate_within_bounds";--> statement-breakpoint
ALTER TABLE "system_config" RENAME COLUMN "vat_rate_bps" TO "reduced_vat_rate_bps";--> statement-breakpoint
-- The standard rate has no value this migration may invent. §8 forbids a
-- DEFAULT here as firmly as it forbids the constant, and carrying the reduced
-- rate across would bill the relief rate on every date the window does not
-- cover. The row is seeded from the environment at boot, so a database that
-- already holds one is emptied and lets the seeder write it again with both
-- rates; without this, adding a NOT NULL column to the seeded row fails.
DELETE FROM "system_config";--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "standard_vat_rate_bps" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_standard_vat_rate_within_bounds" CHECK ("system_config"."standard_vat_rate_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_reduced_vat_rate_within_bounds" CHECK ("system_config"."reduced_vat_rate_bps" between 0 and 10000);
