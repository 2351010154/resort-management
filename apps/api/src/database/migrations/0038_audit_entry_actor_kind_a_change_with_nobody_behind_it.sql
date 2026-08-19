-- The statements below were generated from the schema; the backfill between
-- them was not, and neither is the split of the new column's `NOT NULL` away
-- from the `ADD COLUMN` that introduces it. Drizzle writes those as one
-- statement, and one statement is exactly what a table with rows in it refuses:
-- there is no default to fill them with, and inventing one would put the answer
-- in the schema for every row written after this migration too.
--
-- So the column arrives nullable, the rows already in the table are told what
-- they always were, and only then does the column become mandatory. Every entry
-- filed before today names a member of staff — the column it is being given did
-- not exist to say otherwise, and `actor_id` was `NOT NULL` — so `staff` is the
-- fact those rows already carried rather than an assumption made about them.
-- The predicate says so out loud: a row with no actor could not have been a
-- staff row, and there are none, so the backfill touches everything.
--
-- `actor_id` gives up its `NOT NULL` after the backfill and before the check,
-- which is the only order in which neither statement can fail. The check is
-- last because it is the thing the whole sequence exists to make true: an
-- entry names a member of staff or it names nobody, and which of the two it is
-- is stated rather than inferred from the null.
CREATE TYPE "public"."audit_actor_kind" AS ENUM('staff', 'system');--> statement-breakpoint
ALTER TABLE "audit_entry" ADD COLUMN "actor_kind" "audit_actor_kind";--> statement-breakpoint
UPDATE "audit_entry" SET "actor_kind" = 'staff' WHERE "actor_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_entry" ALTER COLUMN "actor_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_entry" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actor_check" CHECK ((
        "audit_entry"."actor_kind" = 'staff' and "audit_entry"."actor_id" is not null
      ) or (
        "audit_entry"."actor_kind" = 'system' and "audit_entry"."actor_id" is null
      ));