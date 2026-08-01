CREATE TYPE "public"."staff_role" AS ENUM('HOUSEKEEPING', 'RECEPTIONIST', 'ACCOUNTANT', 'MANAGER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "guest_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "guest_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_session_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_signed_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_account" ADD CONSTRAINT "guest_account_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_session" ADD CONSTRAINT "guest_session_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_account_user_id_idx" ON "guest_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_account_provider_key" ON "guest_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "guest_session_user_id_idx" ON "guest_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_user_email_lower_key" ON "guest_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "guest_verification_identifier_idx" ON "guest_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "staff_session_staff_user_id_idx" ON "staff_session" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_email_lower_key" ON "staff_user" USING btree (lower("email"));