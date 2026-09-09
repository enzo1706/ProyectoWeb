/**
 * Fixture de prueba para el flujo de suscripciones/Mercado Pago (Etapa I-B.7-D).
 *
 * Etapa I-C.1.1 (hallazgo F2, auditoría I-C.1): antes `status()`/`teardown()` importaban
 * `server/db` (la conexión REAL de producción, sin ningún guard) — solo `create()` (vía
 * `DatabaseStorage.createUser`, que internamente sí respeta `TEST_DATABASE_URL`) quedaba
 * protegida. Si alguien corría `status`/`teardown` con `DATABASE_URL` apuntando a producción,
 * el script leía/borraba contra la base real sin ningún aviso.
 *
 * Ahora las tres operaciones usan EXCLUSIVAMENTE `server/test-db.ts` — el guard de
 * `test-db-guard.ts` corre de forma síncrona al importar ese módulo, así que este script ni
 * siquiera arranca sin una `TEST_DATABASE_URL` válida (host loopback + nombre terminado en
 * "_test"). Estructuralmente ya no puede tocar producción, sea cual sea el modo que se le pase.
 */
import "../server/load-env";
import { testDb as db, testPool as pool } from "../server/test-db";
import { DatabaseStorage } from "../server/storage";
import { users, consultants, subscriptions, payments } from "@shared/schema";
import { eq } from "drizzle-orm";

const USERNAME = "mp_test_etapa_d";
const PASSWORD = "fixtureMP12345";

async function create() {
  const storage = new DatabaseStorage();
  const user = await storage.createUser({ username: USERNAME, password: PASSWORD, role: "consultant", status: true });
  const sub = await storage.getSubscriptionByConsultantId(user.consultantId!);
  console.log(JSON.stringify({
    userId: user.id,
    consultantId: user.consultantId,
    subscriptionStatus: sub?.status,
    trialStartAt: sub?.trialStartAt,
    trialEndAt: sub?.trialEndAt,
  }, null, 2));
}

async function status() {
  const [user] = await db.select().from(users).where(eq(users.username, USERNAME));
  if (!user) {
    console.log(JSON.stringify({ status: "no existe" }));
    return;
  }
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.consultantId, user.consultantId!));
  const pays = await db.select().from(payments).where(eq(payments.consultantId, user.consultantId!));
  console.log(JSON.stringify({ consultantId: user.consultantId, subscription: sub, payments: pays }, null, 2));
}

async function teardown() {
  const [user] = await db.select().from(users).where(eq(users.username, USERNAME));
  if (!user) {
    console.log(JSON.stringify({ status: "no-op" }));
    return;
  }
  const consultantId = user.consultantId!;
  await db.delete(payments).where(eq(payments.consultantId, consultantId));
  await db.delete(subscriptions).where(eq(subscriptions.consultantId, consultantId));
  await db.delete(users).where(eq(users.id, user.id));
  await db.delete(consultants).where(eq(consultants.id, consultantId));
  console.log(JSON.stringify({ status: "torn-down" }));
}

const mode = process.argv[2];
const fn = mode === "teardown" ? teardown : mode === "status" ? status : create;
fn()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
