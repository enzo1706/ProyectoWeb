import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to set it in your environment variables?",
  );
}

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.delete("sslmode");

const isLocalHost =
  databaseUrl.hostname === "localhost" ||
  databaseUrl.hostname === "127.0.0.1" ||
  databaseUrl.hostname === "::1";

export const pool = new pg.Pool({
  connectionString: databaseUrl.toString(),
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
