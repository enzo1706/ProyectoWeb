import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"),
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const isLocalHost =
  databaseUrl.hostname === "localhost" ||
  databaseUrl.hostname === "127.0.0.1" ||
  databaseUrl.hostname === "::1";

export default defineConfig({
  out: "./drizzle",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  // "session" la crea connect-pg-simple en tiempo de ejecución (server/session.ts,
  // createTableIfMissing) — no vive en shared/schema.ts a propósito, así que push NUNCA debe
  // tocarla. Sin esto, push la ve como "sobrante" y propone borrarla — en producción eso
  // cierra la sesión de TODAS las consultoras de una, y con --force lo hace sin preguntar.
  // Confirmado reproduciendo el caso real: con la tabla ya creada por la app, "push" (sin
  // --force) mostraba "You're about to delete session table" antes de este filtro.
  tablesFilter: ["!session"],
  dbCredentials: {
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port) || 5432,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.replace(/^\//, ""),
    ssl: isLocalHost ? false : { rejectUnauthorized: false },
  },
});
