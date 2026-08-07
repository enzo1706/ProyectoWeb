CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"client_name" text NOT NULL,
	"date" text NOT NULL,
	"time" text NOT NULL,
	"type" text DEFAULT 'seguimiento' NOT NULL,
	"location" text,
	"notes" text,
	"status" text DEFAULT 'pendiente' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"phone" text NOT NULL,
	"email" text,
	"birthday" text,
	"address" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sale_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"installment_number" integer NOT NULL,
	"amount" integer NOT NULL,
	"due_date" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"product_id" integer,
	"product_name" text NOT NULL,
	"category" text NOT NULL,
	"quantity" integer NOT NULL,
	"original_price" integer NOT NULL,
	"price" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"client_name" text NOT NULL,
	"date" text NOT NULL,
	"subtotal" integer NOT NULL,
	"order_discount_type" text,
	"order_discount_value" integer,
	"order_surcharge_type" text,
	"order_surcharge_value" integer,
	"shipping_cost" integer,
	"total" integer NOT NULL,
	"profit" integer NOT NULL,
	"payment_method" text DEFAULT 'efectivo' NOT NULL,
	"installments_count" integer DEFAULT 1 NOT NULL,
	"installment_frequency" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "variante" SET DEFAULT 'Estándar';--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "puntos" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'consultant';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unidades" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "imagen" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_minimo" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cost_price" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "selected_discount" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_installments" ADD CONSTRAINT "sale_installments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_date_idx" ON "appointments" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sale_installments_due_date_idx" ON "sale_installments" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "sale_installments_status_idx" ON "sale_installments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_id_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_client_id_idx" ON "sales" USING btree ("client_id");