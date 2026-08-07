CREATE TABLE "consultants" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"monthly_goal" integer
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_codigo_unique";--> statement-breakpoint
DROP INDEX "appointments_date_idx";--> statement-breakpoint
DROP INDEX "sales_date_idx";--> statement-breakpoint
DROP INDEX "sales_client_id_idx";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultant_id" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "consultant_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "consultant_id" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "consultant_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consultant_id" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_consultant_id_date_idx" ON "appointments" USING btree ("consultant_id","date");--> statement-breakpoint
CREATE INDEX "clients_consultant_id_idx" ON "clients" USING btree ("consultant_id");--> statement-breakpoint
CREATE INDEX "products_consultant_id_idx" ON "products" USING btree ("consultant_id");--> statement-breakpoint
CREATE INDEX "sales_consultant_id_date_idx" ON "sales" USING btree ("consultant_id","date");--> statement-breakpoint
CREATE INDEX "sales_consultant_id_client_id_idx" ON "sales" USING btree ("consultant_id","client_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_consultant_codigo_unique" UNIQUE("consultant_id","codigo");