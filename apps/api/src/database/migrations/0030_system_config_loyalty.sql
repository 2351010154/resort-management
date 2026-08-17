-- The loyalty figures `property-and-tariff.md` §7 proposes, as columns on the
-- one configuration row: what a đồng of net room revenue earns, the two rungs a
-- tier is derived from, and whether points expire at the end of the year after
-- the one they were earned in. Tuning one is a data edit rather than a deploy,
-- which is the whole reason they are here and not in a service.
--
-- Every column carries a DEFAULT, and that is not the prohibition §8 makes
-- being quietly relaxed. §8 forbids a default on a figure whose answer belongs
-- to an accountant or to the owner; §7 states outright that these "are the
-- developer's call until the owner tunes them", so the default records a
-- decision this repository made rather than one it invented on somebody else's
-- behalf. It is also what lets the columns be NOT NULL without emptying the row:
-- the seeder writes once and never again, so a deployed database already holds a
-- configuration whose tax figures an ADMIN may have corrected since boot, and
-- 0019 could discard that only because the value it needed was one no migration
-- was allowed to supply. Here the value is one this migration may supply, so the
-- existing row is backfilled and every edit standing against it survives.
--
-- No tier is stored, here or anywhere. `FR-GST-04` derives it at rollover from a
-- trailing window; these are the thresholds that derivation reads.
ALTER TABLE "system_config" ADD COLUMN "loyalty_points_per_unit" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "loyalty_earn_unit_vnd" bigint DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "tier_silver_stays" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "tier_silver_revenue_vnd" bigint DEFAULT 15000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "tier_gold_stays" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "tier_gold_revenue_vnd" bigint DEFAULT 40000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "points_expire_year_end" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_loyalty_earns_at_least_a_point" CHECK ("system_config"."loyalty_points_per_unit" >= 1);--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_loyalty_earn_unit_is_money" CHECK ("system_config"."loyalty_earn_unit_vnd" > 0);--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_silver_takes_at_least_one_stay" CHECK ("system_config"."tier_silver_stays" >= 1);--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_silver_revenue_is_money" CHECK ("system_config"."tier_silver_revenue_vnd" > 0);--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_gold_stays_not_below_silver" CHECK ("system_config"."tier_gold_stays" >= "system_config"."tier_silver_stays");--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_gold_revenue_not_below_silver" CHECK ("system_config"."tier_gold_revenue_vnd" >= "system_config"."tier_silver_revenue_vnd");