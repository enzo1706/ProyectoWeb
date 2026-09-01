CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"consultant_id" integer NOT NULL,
	"external_reference" text NOT NULL,
	"mp_preapproval_id" text,
	"mp_payment_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"period_days_granted" integer DEFAULT 30 NOT NULL,
	"mp_status_detail" text,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_external_reference_unique" UNIQUE("external_reference"),
	CONSTRAINT "payments_mp_payment_id_unique" UNIQUE("mp_payment_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"consultant_id" integer NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"trial_start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trial_end_at" timestamp with time zone NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"last_payment_id" integer,
	"mp_preapproval_id" text,
	"mp_preapproval_created_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "subscriptions_consultant_id_unique" UNIQUE("consultant_id")
);
--> statement-breakpoint
ALTER TABLE "consultants" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_last_payment_id_payments_id_fk" FOREIGN KEY ("last_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_consultant_id_idx" ON "payments" USING btree ("consultant_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions" USING btree ("current_period_end");