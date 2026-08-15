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
  // Sin esto, `pg` espera indefinidamente para conseguir una conexión si Supabase no
  // responde — un problema real para /api/health (que el hosting usa para decidir si el
  // contenedor está sano) y para cualquier request: mejor fallar rápido con un error claro
  // que quedar colgado para siempre.
  connectionTimeoutMillis: 10_000,
});

// pg emite "error" en el pool cuando un cliente IDLE pierde la conexión (ej. Supabase la
// cierra por inactividad). Sin un listener acá, Node trata eso como excepción no capturada
// y tira abajo TODO el proceso — no un query puntual. Solo logueamos (nunca la connection
// string ni credenciales) y dejamos que el pool siga: la próxima query simplemente abre
// un cliente nuevo, `pg` no necesita que nosotros hagamos nada más para recuperarse.
pool.on("error", (err) => {
  console.error("Postgres: error en una conexión inactiva del pool —", err.message);
});

export const db = drizzle(pool, { schema });
