-- The statements below were generated from the schema; the backfill between
-- them was not, and its position is the whole of what is hand-written here.
--
-- What it fixes: a waiver had nowhere to live. `booking.cancel-waiver` is
-- `MANAGER`+ and `booking.cancel-policy` is the desk's, and both wrote byte-
-- identical rows — the record of the waiver was which route the caller could
-- reach, which is an authorisation event and not durable state. The folio
-- prices §4's grid on a later request under a third capability, reads the
-- booking, and could see no waiver at all: a manager set the penalty aside and
-- a receptionist charged it anyway, on a route that grants nobody the reversal
-- to take it back.
--
-- `cancelled_at` is the second column with the same shape of problem.
-- `folio.service.ts` measured §4's "by 18:00, three days before arrival"
-- against `updated_at`, on the grounds that `CANCELLED` is terminal — true of
-- the state, not of the row, since any later touch moves that column and none
-- of them cancelled anything.
--
-- The backfill runs before the check that requires it. Every existing
-- `CANCELLED` row would fail `booking_records_a_cancellation_instant_exactly_when_cancelled`
-- with the column still null, and `updated_at` is exactly the instant the
-- service was reading until now — so the rows carry forward the same answer
-- they were already being given rather than a new one.
ALTER TABLE "booking" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "penalty_waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "penalty_waived_by" uuid;--> statement-breakpoint
UPDATE "booking" SET "cancelled_at" = "updated_at" WHERE "state" = 'CANCELLED';--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_penalty_waived_by_staff_user_id_fk" FOREIGN KEY ("penalty_waived_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_records_a_cancellation_instant_exactly_when_cancelled" CHECK (("booking"."state" = 'CANCELLED') = ("booking"."cancelled_at" is not null));--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_names_a_waiver_authority_exactly_when_waived" CHECK (("booking"."penalty_waived_at" is null) = ("booking"."penalty_waived_by" is null));
