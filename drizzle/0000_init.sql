CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"seccion" text NOT NULL,
	"linea" text NOT NULL,
	"producto" text NOT NULL,
	"variante" text NOT NULL,
	"codigo" text NOT NULL,
	"puntos" integer NOT NULL,
	"precio" integer NOT NULL,
	CONSTRAINT "products_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'consultora' NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
