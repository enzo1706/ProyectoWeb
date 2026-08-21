ALTER TABLE "product_stock" ALTER COLUMN "stock_minimo" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_stock" ALTER COLUMN "stock_minimo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consultants" ADD COLUMN "default_low_stock_threshold" integer;--> statement-breakpoint
ALTER TABLE "product_stock" ADD COLUMN "remind_stock_at" text;--> statement-breakpoint
-- Resetea el umbral viejo (5, el default histórico — nadie pudo elegirlo nunca porque no
-- existía UI para eso) a NULL, para que los productos ya cargados pasen a usar la cascada
-- nueva (perfil de la consultora, si no 2) en vez de quedar pegados al 5 de siempre.
UPDATE "product_stock" SET "stock_minimo" = NULL WHERE "stock_minimo" = 5;