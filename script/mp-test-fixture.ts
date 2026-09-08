import "../server/load-env";
import { DatabaseStorage } from "../server/storage";
import { db } from "../server/db";
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
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
