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

// Etapa I-C.1 confirmó con evidencia real que este DATABASE_URL y el de producción en
// Railway llegaron a ser literalmente la misma base — este aviso es la red de seguridad
// para que eso nunca vuelva a pasar en silencio. No bloquea (NODE_ENV=development legítimo
// contra un host remoto es una decisión válida en algún escenario futuro), pero es imposible
// no verlo al arrancar.
if (!isLocalHost && process.env.NODE_ENV !== "production") {
  console.warn(
    "⚠️  ATENCIÓN: DATABASE_URL apunta a un host remoto y NODE_ENV no es \"production\" " +
      `(NODE_ENV=${process.env.NODE_ENV ?? "undefined"}). Si esto no es intencional, ` +
      "estás por escribir sobre una base que no es tu Postgres local de desarrollo — ver " +
      "docker-compose.dev.yml.",
  );
}

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
