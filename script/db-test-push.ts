/**
 * Aplica el schema real (shared/schema.ts, vía drizzle-kit push — el mismo mecanismo que ya
 * usa el proyecto, no uno nuevo) contra TEST_DATABASE_URL. Nunca toca la base real.
 *
 * IMPORTANTE (incidente documentado en Etapa I-B.5.1): una primera versión de este script
 * pasaba DATABASE_URL sobreescrita solo en el env del proceso hijo, confiando en que
 * drizzle.config.ts la respetara. No fue así — ese archivo llama a
 * dotenv.config({ override: true }), que vuelve a cargar el .env real y PISA cualquier
 * override que se le pase por env, así que terminó corriendo contra la base real. Por eso
 * ahora se usa drizzle.config.test.ts (--config), que nunca toca dotenv y solo lee
 * TEST_DATABASE_URL — sin ninguna posibilidad de que la real se cuele.
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import { assertTestDatabaseAuthorized } from "../server/test-db-guard";

// Corre el guard ACÁ TAMBIÉN (además de en drizzle.config.test.ts) — si algo está mal,
// falla antes de siquiera invocar drizzle-kit.
assertTestDatabaseAuthorized();

console.log("Aplicando schema a la base de test (loopback, confirmado por el guard)...");

const result = spawnSync("npx", ["drizzle-kit", "push", "--config=drizzle.config.test.ts", "--force"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (result.status !== 0) {
  console.error("Falló drizzle-kit push contra la base de test.");
  process.exit(result.status ?? 1);
}

console.log("Schema aplicado correctamente a la base de test.");
