/**
 * Seed de staging — crea una cuenta de consultora de prueba para poder entrar a la app recién
 * desplegada en staging, sin usar ninguna cuenta ni dato real. Ver docs/staging.md.
 *
 * Tres guardas obligatorias, ninguna alcanza por sí sola (ninguna de las tres se da en el
 * servicio de producción real, así que ahí este script siempre se niega a correr):
 * - APP_ENV debe ser exactamente "staging" — variable propia de este plan, separada de
 *   NODE_ENV (que en staging queda en "production" por otro motivo, ver docs/staging.md).
 * - SEED_CONFIRM debe ser exactamente "yes" — confirmación explícita aparte, para que nadie
 *   lo corra sin querer por tener el comando copiado de otra terminal.
 * - La BASE misma tiene que decir que es de staging: una fila en `staging_marker` con
 *   value = 'staging'. Esa tabla se crea A MANO, una sola vez al armar el entorno de staging
 *   (ver docs/staging.md) — NUNCA agregarla a shared/schema.ts ni a ninguna migración, porque
 *   entonces `db:push` la terminaría creando también en producción. Sin esta fila, las dos
 *   variables de arriba no alcanzan: alguien podría tener APP_ENV/SEED_CONFIRM seteadas en su
 *   propia terminal por error (ej. una variable de entorno que quedó de otra sesión) y este
 *   chequeo extra, que vive en la base y no en el entorno del que corre el script, es la
 *   última red antes de escribir en datos reales.
 *
 * Uso:
 *   APP_ENV=staging SEED_CONFIRM=yes SEED_USERNAME=... SEED_PASSWORD=... npm run seed:staging
 *
 * Es idempotente: si la cuenta ya existe, no crea otra ni toca nada.
 */
import "../server/load-env";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";

async function isDatabaseMarkedAsStaging(): Promise<boolean> {
  try {
    const { db } = await import("../server/db");
    const result = await db.execute(sql`SELECT value FROM staging_marker ORDER BY id LIMIT 1`);
    const row = result.rows[0] as { value?: string } | undefined;
    return row?.value === "staging";
  } catch {
    // Tabla inexistente, sin permisos, o cualquier otro error al leerla: nunca se asume "sí es
    // staging" por defecto — negarse de más es el lado seguro.
    return false;
  }
}

async function main() {
  if (process.env.APP_ENV !== "staging") {
    console.error(
      `Este script solo corre con APP_ENV=staging. No se tocó la base. (APP_ENV actual: ${process.env.APP_ENV ?? "undefined"})`,
    );
    process.exitCode = 1;
    return;
  }

  if (process.env.SEED_CONFIRM !== "yes") {
    console.error("Falta la confirmación explícita: corré de nuevo con SEED_CONFIRM=yes. No se tocó la base.");
    process.exitCode = 1;
    return;
  }

  if (!(await isDatabaseMarkedAsStaging())) {
    console.error(
      'La base no tiene el marcador de staging (tabla "staging_marker" con una fila value=\'staging\'). ' +
        "No se tocó la base. Ver docs/staging.md — \"Marcar la base de staging\" para crearlo a mano, una sola vez.",
    );
    process.exitCode = 1;
    return;
  }

  const username = process.env.SEED_USERNAME ?? "consultora_staging";
  const password = process.env.SEED_PASSWORD;

  if (!password || password.length < 8) {
    console.error("Falta SEED_PASSWORD (al menos 8 caracteres). No se tocó la base.");
    process.exitCode = 1;
    return;
  }

  const existing = await storage.getUserByUsername(username);
  if (existing) {
    console.log(`Ya existe la cuenta "${username}" — no se creó ninguna nueva (idempotente).`);
    return;
  }

  await storage.createUser({ username, password, role: "consultant", status: true });
  console.log(`Cuenta de consultora de prueba "${username}" creada en staging.`);
  console.log('Para cargarle productos de prueba: entrá a Stock → "Cargar catálogo de prueba".');
}

main()
  .catch((err) => {
    console.error("No se pudo correr el seed de staging:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
