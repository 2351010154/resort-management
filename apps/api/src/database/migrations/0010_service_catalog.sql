CREATE TYPE "public"."tax_class" AS ENUM('STANDARD');--> statement-breakpoint
CREATE TABLE "service_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit_price_gross" bigint,
	"tax_class" "tax_class" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_catalog_code_unique" UNIQUE("code"),
	CONSTRAINT "service_catalog_price_positive_when_set" CHECK ("service_catalog"."unit_price_gross" is null or "service_catalog"."unit_price_gross" > 0)
);
