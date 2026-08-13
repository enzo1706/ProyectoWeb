ALTER TABLE "products" ADD COLUMN "discontinued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source" text DEFAULT 'import' NOT NULL;