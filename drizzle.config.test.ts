/**
 * Config de drizzle-kit EXCLUSIVA para aplicar el schema a la base de test — nunca llama a
 * dotenv.config() (a propósito: drizzle.config.ts sí lo hace, con `override: true`, y eso
 * fue justo lo que pisó el TEST_DATABASE_URL pasado por env y terminó corriendo `push`
 * contra la base real — ver incidente documentado en el informe de la Etapa I-B.5.1).
 * Este archivo solo lee TEST_DATABASE_URL, ya puesta en process.env por quien lo invoca
 * (script/db-test-push.ts), y pasa por el mismo guard antes de construir la config.
 */
import { defineConfig } from "drizzle-kit";
import { assertTestDatabaseAuthorized } from "./server/test-db-guard";

const { url } = assertTestDatabaseAuthorized();

export default defineConfig({
  out: "./drizzle",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: false, // el guard exige loopback, nunca hace falta SSL
  },
});
