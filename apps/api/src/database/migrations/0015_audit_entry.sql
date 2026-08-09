CREATE TYPE "public"."audit_action" AS ENUM('INSERT', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TABLE "audit_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	CONSTRAINT "audit_entry_states_present" CHECK ("audit_entry"."before" is not null or "audit_entry"."after" is not null),
	CONSTRAINT "audit_entry_action_matches_states" CHECK ((
        "audit_entry"."action" = 'INSERT' and "audit_entry"."before" is null and "audit_entry"."after" is not null
      ) or (
        "audit_entry"."action" = 'UPDATE' and "audit_entry"."before" is not null and "audit_entry"."after" is not null
      ) or (
        "audit_entry"."action" = 'DELETE' and "audit_entry"."before" is not null and "audit_entry"."after" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actor_id_staff_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entry_row_idx" ON "audit_entry" USING btree ("table_name","row_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entry_actor_idx" ON "audit_entry" USING btree ("actor_id","occurred_at");