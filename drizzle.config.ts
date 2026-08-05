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
  dbCredentials: {
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port) || 5432,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.replace(/^\//, ""),
    ssl: isLocalHost ? false : { rejectUnauthorized: false },
  },
});
