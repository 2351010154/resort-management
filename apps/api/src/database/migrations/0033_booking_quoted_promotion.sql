ALTER TABLE "booking" ADD COLUMN "quoted_promotion_code" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "quoted_promotion_type" "promotion_type";--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "quoted_promotion_value" bigint;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_quoted_promotion_is_whole_or_absent" CHECK (num_nonnulls("booking"."quoted_promotion_code", "booking"."quoted_promotion_type", "booking"."quoted_promotion_value") in (0, 3));--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_quoted_promotion_reduces_within_its_scale" CHECK ("booking"."quoted_promotion_type" is null
        or ("booking"."quoted_promotion_type" = 'PERCENTAGE' and "booking"."quoted_promotion_value" between -99 and -1)
        or ("booking"."quoted_promotion_type" = 'FIXED_AMOUNT' and "booking"."quoted_promotion_value" < 0));