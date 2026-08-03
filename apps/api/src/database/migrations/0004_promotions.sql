CREATE TYPE "public"."loyalty_tier" AS ENUM('SILVER', 'GOLD');--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT');--> statement-breakpoint
CREATE TABLE "promotion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "promotion_type" NOT NULL,
	"value" bigint NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"min_nights" smallint,
	"requires_loyalty_tier" "loyalty_tier",
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "promotion_code_unique" UNIQUE("code"),
	CONSTRAINT "promotion_value_reduces_within_its_scale" CHECK (("promotion"."type" = 'PERCENTAGE' and "promotion"."value" between -99 and -1)
        or ("promotion"."type" = 'FIXED_AMOUNT' and "promotion"."value" < 0)),
	CONSTRAINT "promotion_window_opens_before_it_closes" CHECK ("promotion"."valid_from" is null or "promotion"."valid_to" is null
        or "promotion"."valid_to" >= "promotion"."valid_from"),
	CONSTRAINT "promotion_minimum_at_least_one_night" CHECK ("promotion"."min_nights" is null or "promotion"."min_nights" >= 1)
);
