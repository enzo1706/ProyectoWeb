/**
 * Seed de staging — crea una cuenta de consultora de prueba para poder entrar a la app recién
 * desplegada en staging, sin usar ninguna cuenta ni dato real. Ver docs/staging.md.
 *
 * Dos guardas obligatorias, ninguna alcanza por sí sola (ninguna de las dos se define en el
 * servicio de producción real, así que ahí este script siempre se niega a correr):
 * - APP_ENV debe ser exactamente "staging" — variable propia de este plan, separada de
 *   NODE_ENV (que en staging queda en "production" por otro motivo, ver docs/staging.md).
 * - SEED_CONFIRM debe ser exactamente "yes" — confirmación explícita aparte, para que nadie
 *   lo corra sin querer por tener el comando copiado de otra terminal.
 *
 * Uso:
 *   APP_ENV=staging SEED_CONFIRM=yes SEED_USERNAME=... SEED_PASSWORD=... npm run seed:staging
 *
 * Es idempotente: si la cuenta ya existe, no crea otra ni toca nada.
 */
import "../server/load-env";
import { storage } from "../server/storage";

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
