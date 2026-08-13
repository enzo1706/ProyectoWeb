CREATE TABLE "product_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"consultant_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"unidades" integer DEFAULT 0 NOT NULL,
	"stock_minimo" integer DEFAULT 5 NOT NULL,
	"cost_price" integer,
	"selected_discount" integer,
	"discontinued" boolean DEFAULT false NOT NULL,
	CONSTRAINT "product_stock_consultant_product_unique" UNIQUE("consultant_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_consultant_id_consultants_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_stock_consultant_id_idx" ON "product_stock" USING btree ("consultant_id");--> statement-breakpoint
CREATE INDEX "product_stock_product_id_idx" ON "product_stock" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "unidades";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "stock_minimo";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "cost_price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "selected_discount";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "discontinued";