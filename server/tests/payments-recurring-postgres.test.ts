import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, payments, subscriptions } from "@shared/schema";
import { DatabaseStorage } from "../storage";
import { PERIOD_DAYS, SUBSCRIPTION_PRICE_ARS } from "../config/subscription";

/**
 * Etapa MP-1 — modelo de pagos recurrentes contra Postgres REAL (TEST_DATABASE_URL, nunca la
 * base real — ver server/test-db-guard.ts). Nada de esto se puede demostrar con MemoryStorage:
 * lo que se prueba son constraints UNIQUE, FOR UPDATE y carreras reales.
 *
 * Los payloads son fixtures explícitos del DOMINIO de la app (un pago aprobado ya validado
 * contra MP y traducido a ApplyApprovedPaymentInput). No asumen nada sobre cómo Mercado Pago
 * arma `external_reference` en los cobros recurrentes: eso es un requisito de MP-2 (ver
 * informe MP-1). Lo que se fija acá es el CONTRATO DE LA APP: cada cobro se identifica por
 * `mpPaymentId`; `externalReference` es una referencia de correlación que puede repetirse.
 */

const storage = new DatabaseStorage();
const DAY_MS = 24 * 60 * 60 * 1000;
const createdConsultantIds: number[] = [];

async function fixtureSubscription(label: string, preapprovalId: string): Promise<number> {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: `VITEST mp-1 ${label} (borrar si queda huérfano)`, currency: "ARS" })
    .returning();
  createdConsultantIds.push(consultant.id);
  const now = new Date();
  await storage.createTrialSubscription(consultant.id, now, new Date(now.getTime() + 10 * DAY_MS));
  await storage.updateSubscription(consultant.id, { mpPreapprovalId: preapprovalId });
  return consultant.id;
}

function paymentInput(overrides: { mpPaymentId: string; mpPreapprovalId: string; externalReference: string }) {
  return {
    amount: SUBSCRIPTION_PRICE_ARS,
    statusDetail: "accredited",
    rawPayload: { fixture: true },
    ...overrides,
  };
}

async function paymentsOf(consultantId: number) {
  return db.select().from(payments).where(eq(payments.consultantId, consultantId));
}

afterAll(async () => {
  if (createdConsultantIds.length > 0) {
    // subscriptions.last_payment_id → payments: primero subscriptions, después payments.
    await db.delete(subscriptions).where(inArray(subscriptions.consultantId, createdConsultantIds));
    await db.delete(payments).where(inArray(payments.consultantId, createdConsultantIds));
    await db.delete(consultants).where(inArray(consultants.id, createdConsultantIds));
  }
  await pool.end();
});

describe("MP-1 — pagos recurrentes sobre Postgres real", () => {
  it("1. dos pagos legítimos de la misma suscripción (mismo externalReference, distinto mpPaymentId) persisten ambos", async () => {
    const consultantId = await fixtureSubscription("dos-pagos", "PA-mp1-1");
    const ref = `sub-${consultantId}-reference`;

    const first = await storage.applyApprovedPayment(
      consultantId,
      paymentInput({ mpPaymentId: "mp-payment-1", mpPreapprovalId: "PA-mp1-1", externalReference: ref }),
    );
    const second = await storage.applyApprovedPayment(
      consultantId,
      paymentInput({ mpPaymentId: "mp-payment-2", mpPreapprovalId: "PA-mp1-1", externalReference: ref }),
    );

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("applied");

    const rows = await paymentsOf(consultantId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.mpPaymentId).sort()).toEqual(["mp-payment-1", "mp-payment-2"]);
    expect(new Set(rows.map((r) => r.externalReference))).toEqual(new Set([ref]));
    expect(rows.every((r) => r.amount === 20000 && r.periodDaysGranted === 30 && r.status === "approved")).toBe(true);
  });

  it("2. el mismo mpPaymentId procesado dos veces deja un único payment (idempotencia)", async () => {
    const consultantId = await fixtureSubscription("idempotencia", "PA-mp1-2");
    const input = paymentInput({ mpPaymentId: "mp-dup-1", mpPreapprovalId: "PA-mp1-2", externalReference: `sub-${consultantId}-r` });

    const first = await storage.applyApprovedPayment(consultantId, input);
    const afterFirst = await storage.getSubscriptionByConsultantId(consultantId);
    const second = await storage.applyApprovedPayment(consultantId, input);
    const afterSecond = await storage.getSubscriptionByConsultantId(consultantId);

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("already_processed");
    expect(await paymentsOf(consultantId)).toHaveLength(1);
    // El duplicado no extiende el período una segunda vez.
    expect(afterSecond!.currentPeriodEnd!.getTime()).toBe(afterFirst!.currentPeriodEnd!.getTime());
    expect(afterSecond!.lastPaymentId).toBe(afterFirst!.lastPaymentId);
  });

  it("3. pagos de suscripciones distintas persisten y quedan cada uno con su consultora", async () => {
    const a = await fixtureSubscription("multi-a", "PA-mp1-3a");
    const b = await fixtureSubscription("multi-b", "PA-mp1-3b");

    const resA = await storage.applyApprovedPayment(a, paymentInput({ mpPaymentId: "mp-3a-1", mpPreapprovalId: "PA-mp1-3a", externalReference: `sub-${a}-x` }));
    const resB = await storage.applyApprovedPayment(b, paymentInput({ mpPaymentId: "mp-3b-1", mpPreapprovalId: "PA-mp1-3b", externalReference: `sub-${b}-x` }));
    expect(resA.outcome).toBe("applied");
    expect(resB.outcome).toBe("applied");

    const rowsA = await paymentsOf(a);
    const rowsB = await paymentsOf(b);
    expect(rowsA.map((r) => r.mpPaymentId)).toEqual(["mp-3a-1"]);
    expect(rowsB.map((r) => r.mpPaymentId)).toEqual(["mp-3b-1"]);
    expect(rowsA[0].mpPreapprovalId).toBe("PA-mp1-3a");
    expect(rowsB[0].mpPreapprovalId).toBe("PA-mp1-3b");
  });

  it("4. el payment queda vinculado a la consultora correcta y a su suscripción (lastPaymentId)", async () => {
    const consultantId = await fixtureSubscription("vinculo", "PA-mp1-4");
    const result = await storage.applyApprovedPayment(
      consultantId,
      paymentInput({ mpPaymentId: "mp-4-1", mpPreapprovalId: "PA-mp1-4", externalReference: `sub-${consultantId}-x` }),
    );
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") return;

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(result.payment.consultantId).toBe(consultantId);
    expect(sub!.lastPaymentId).toBe(result.payment.id);
    expect(sub!.mpPreapprovalId).toBe(result.payment.mpPreapprovalId);
    expect(sub!.status).toBe("active");
  });

  it("5. tenant isolation: un pago con el preapproval de otra consultora no se acredita ni se filtra", async () => {
    const a = await fixtureSubscription("tenant-a", "PA-mp1-5a");
    const b = await fixtureSubscription("tenant-b", "PA-mp1-5b");
    const subBBefore = await storage.getSubscriptionByConsultantId(b);

    // Se intenta acreditar a la consultora A un pago que trae el preapproval de B.
    const cross = await storage.applyApprovedPayment(
      a,
      paymentInput({ mpPaymentId: "mp-5-cross", mpPreapprovalId: "PA-mp1-5b", externalReference: `sub-${a}-x` }),
    );
    expect(cross.outcome).toBe("preapproval_mismatch");
    expect(await paymentsOf(a)).toHaveLength(0);
    expect(await paymentsOf(b)).toHaveLength(0);

    // Un pago legítimo de B no aparece en el historial de A ni toca su suscripción.
    await storage.applyApprovedPayment(b, paymentInput({ mpPaymentId: "mp-5-b", mpPreapprovalId: "PA-mp1-5b", externalReference: `sub-${b}-x` }));
    expect(await storage.getPaymentsByConsultantId(a)).toHaveLength(0);
    const subA = await storage.getSubscriptionByConsultantId(a);
    expect(subA!.currentPeriodEnd).toBeNull();
    expect(subA!.status).toBe("trial");
    const subBAfter = await storage.getSubscriptionByConsultantId(b);
    expect(subBBefore!.currentPeriodEnd).toBeNull();
    expect(subBAfter!.currentPeriodEnd).not.toBeNull();
  });

  it("6. período: cada pago otorga PERIOD_DAYS desde su confirmación (contrato actual, sin acumular)", async () => {
    const consultantId = await fixtureSubscription("periodo", "PA-mp1-6");
    const ref = `sub-${consultantId}-x`;

    const first = await storage.applyApprovedPayment(consultantId, paymentInput({ mpPaymentId: "mp-6-1", mpPreapprovalId: "PA-mp1-6", externalReference: ref }));
    expect(first.outcome).toBe("applied");
    if (first.outcome !== "applied") return;
    const subAfterFirst = await storage.getSubscriptionByConsultantId(consultantId);
    expect(subAfterFirst!.currentPeriodEnd!.getTime() - first.payment.paidAt!.getTime()).toBe(PERIOD_DAYS * DAY_MS);
    expect(subAfterFirst!.currentPeriodStart!.getTime()).toBe(first.payment.paidAt!.getTime());

    await new Promise((r) => setTimeout(r, 15));
    const second = await storage.applyApprovedPayment(consultantId, paymentInput({ mpPaymentId: "mp-6-2", mpPreapprovalId: "PA-mp1-6", externalReference: ref }));
    expect(second.outcome).toBe("applied");
    if (second.outcome !== "applied") return;
    const subAfterSecond = await storage.getSubscriptionByConsultantId(consultantId);

    // El período vigente es el del ÚLTIMO pago: paidAt(2) + 30 días, lastPaymentId = pago 2.
    expect(second.payment.paidAt!.getTime()).toBeGreaterThan(first.payment.paidAt!.getTime());
    expect(subAfterSecond!.currentPeriodStart!.getTime()).toBe(second.payment.paidAt!.getTime());
    expect(subAfterSecond!.currentPeriodEnd!.getTime()).toBe(second.payment.paidAt!.getTime() + PERIOD_DAYS * DAY_MS);
    expect(subAfterSecond!.lastPaymentId).toBe(second.payment.id);
    expect(await paymentsOf(consultantId)).toHaveLength(2);
  });

  it("7. concurrencia: webhooks idénticos simultáneos (5) → exactamente un payment, sin doble extensión, sin error", async () => {
    const consultantId = await fixtureSubscription("conc-identicos", "PA-mp1-7");
    const input = paymentInput({ mpPaymentId: "mp-7-1", mpPreapprovalId: "PA-mp1-7", externalReference: `sub-${consultantId}-x` });

    // Cinco en paralelo (no dos) para que la carrera sea real y no dependa de la suerte del
    // timing: MP reintenta notificaciones y puede mandar varias casi a la vez.
    const results = await Promise.all(Array.from({ length: 5 }, () => storage.applyApprovedPayment(consultantId, input)));

    // Ninguna llamada revienta: una aplica, las demás se reconocen como duplicadas.
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "already_processed",
      "already_processed",
      "already_processed",
      "already_processed",
      "applied",
    ]);
    const rows = await paymentsOf(consultantId);
    expect(rows).toHaveLength(1);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.lastPaymentId).toBe(rows[0].id);
    expect(sub!.currentPeriodEnd!.getTime()).toBe(rows[0].paidAt!.getTime() + PERIOD_DAYS * DAY_MS);
  });

  it("8. concurrencia: dos payments distintos de la misma suscripción simultáneos → ambos persisten, período coherente", async () => {
    const consultantId = await fixtureSubscription("conc-distintos", "PA-mp1-8");
    const ref = `sub-${consultantId}-x`;

    const results = await Promise.all([
      storage.applyApprovedPayment(consultantId, paymentInput({ mpPaymentId: "mp-8-1", mpPreapprovalId: "PA-mp1-8", externalReference: ref })),
      storage.applyApprovedPayment(consultantId, paymentInput({ mpPaymentId: "mp-8-2", mpPreapprovalId: "PA-mp1-8", externalReference: ref })),
    ]);

    expect(results.map((r) => r.outcome)).toEqual(["applied", "applied"]);
    const rows = await paymentsOf(consultantId);
    expect(rows).toHaveLength(2);

    // El lock FOR UPDATE serializa las dos transacciones: el período final es el del pago
    // confirmado más tarde (paidAt más alto) + 30 días, y lastPaymentId apunta a ese pago.
    const latest = rows.reduce((a, b) => (a.paidAt!.getTime() >= b.paidAt!.getTime() ? a : b));
    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.lastPaymentId).toBe(latest.id);
    expect(sub!.currentPeriodStart!.getTime()).toBe(latest.paidAt!.getTime());
    expect(sub!.currentPeriodEnd!.getTime()).toBe(latest.paidAt!.getTime() + PERIOD_DAYS * DAY_MS);
  });

  it("9. el mismo mpPaymentId concurrente para dos consultoras distintas nunca crea dos filas (unique global)", async () => {
    const a = await fixtureSubscription("conc-cross-a", "PA-mp1-9a");
    const b = await fixtureSubscription("conc-cross-b", "PA-mp1-9b");

    const results = await Promise.all([
      storage.applyApprovedPayment(a, paymentInput({ mpPaymentId: "mp-9-shared", mpPreapprovalId: "PA-mp1-9a", externalReference: `sub-${a}-x` })),
      storage.applyApprovedPayment(b, paymentInput({ mpPaymentId: "mp-9-shared", mpPreapprovalId: "PA-mp1-9b", externalReference: `sub-${b}-x` })),
    ]);

    // Locks distintos (una por consultora): la única defensa es el unique de mp_payment_id,
    // que no debe traducirse en una excepción sino en "ya procesado".
    expect(results.map((r) => r.outcome).sort()).toEqual(["already_processed", "applied"]);
    const all = await db.select().from(payments).where(eq(payments.mpPaymentId, "mp-9-shared"));
    expect(all).toHaveLength(1);
  });
});
