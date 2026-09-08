/**
 * Pool/db de Postgres EXCLUSIVOS para los tests que necesitan Postgres real
 * (client-isolation, stock-concurrency, tenant-isolation-deep). Nunca lo use nada de la
 * app real — `server/db.ts` (el que usa `npm run dev`/producción) sigue exactamente igual,
 * sin tocar.
 *
 * El guard corre primero, de forma síncrona, al importar este módulo — si no pasa, tira y
 * el `new pg.Pool(...)` de abajo ni se ejecuta.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { assertTestDatabaseAuthorized } from "./test-db-guard";

const { url } = assertTestDatabaseAuthorized();

export const testPool = new pg.Pool({
  connectionString: url.toString(),
  ssl: false, // siempre loopback (lo exige el guard) — nunca hace falta SSL acá
  connectionTimeoutMillis: 10_000,
});

testPool.on("error", (err) => {
  console.error("Postgres de test: error en una conexión inactiva del pool —", err.message);
});

export const testDb = drizzle(testPool, { schema });
