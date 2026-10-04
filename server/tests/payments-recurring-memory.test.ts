import { describe, it, expect, beforeAll } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

/**
 * Etapa MP-1 — contrato lógico de MemoryStorage para pagos recurrentes. La verdad de los
 * constraints y de la concurrencia vive en payments-recurring-postgres.test.ts (Postgres real);
 * acá solo se fija que MemoryStorage NO impone una restricción distinta a la de Postgres:
 * `externalReference` repetible, `mpPaymentId` idempotente.
 */

type MemoryStorageType = InstanceType<typeof import("../storage").MemoryStorage>;
let storage: MemoryStorageType;

async function consultantWithPreapproval(prefix: string, preapprovalId: string): Promise<number> {
  const user = await storage.createUser({
    username: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  await storage.updateSubscription(user.consultantId!, { mpPreapprovalId: preapprovalId });
  return user.consultantId!;
}

const base = { amount: 20000, statusDetail: "accredited", rawPayload: { fixture: true } };

beforeAll(async () => {
  const { MemoryStorage } = await import("../storage");
  storage = new MemoryStorage();
});

describe("MP-1 — MemoryStorage: mismo contrato lógico que Postgres", () => {
  it("dos pagos de la misma suscripción con el mismo externalReference persisten ambos", async () => {
    const consultantId = await consultantWithPreapproval("mem_recurring", "PA-mem-1");
    const externalReference = `sub-${consultantId}-reference`;

    const first = await storage.applyApprovedPayment(consultantId, { ...base, mpPaymentId: "mem-payment-1", mpPreapprovalId: "PA-mem-1", externalReference });
    const second = await storage.applyApprovedPayment(consultantId, { ...base, mpPaymentId: "mem-payment-2", mpPreapprovalId: "PA-mem-1", externalReference });

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("applied");
    const rows = await storage.getPaymentsByConsultantId(consultantId);
    expect(rows.map((p) => p.mpPaymentId).sort()).toEqual(["mem-payment-1", "mem-payment-2"]);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.lastPaymentId).toBe(second.outcome === "applied" ? second.payment.id : -1);
  });

  it("el mismo mpPaymentId dos veces deja un único payment y no extiende el período de nuevo", async () => {
    const consultantId = await consultantWithPreapproval("mem_idem", "PA-mem-2");
    const input = { ...base, mpPaymentId: "mem-dup-1", mpPreapprovalId: "PA-mem-2", externalReference: `sub-${consultantId}-r` };

    const first = await storage.applyApprovedPayment(consultantId, input);
    const endAfterFirst = (await storage.getSubscriptionByConsultantId(consultantId))!.currentPeriodEnd!.getTime();
    const second = await storage.applyApprovedPayment(consultantId, input);

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("already_processed");
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(1);
    expect((await storage.getSubscriptionByConsultantId(consultantId))!.currentPeriodEnd!.getTime()).toBe(endAfterFirst);
  });

  it("aislamiento de tenant: el preapproval de otra consultora no se acredita", async () => {
    const a = await consultantWithPreapproval("mem_tenant_a", "PA-mem-3a");
    const b = await consultantWithPreapproval("mem_tenant_b", "PA-mem-3b");

    const cross = await storage.applyApprovedPayment(a, { ...base, mpPaymentId: "mem-cross", mpPreapprovalId: "PA-mem-3b", externalReference: `sub-${a}-x` });
    expect(cross.outcome).toBe("preapproval_mismatch");
    expect(await storage.getPaymentsByConsultantId(a)).toHaveLength(0);
    expect(await storage.getPaymentsByConsultantId(b)).toHaveLength(0);
  });

  it("createPendingPayment no impone unicidad de externalReference (igual que Postgres)", async () => {
    const consultantId = await consultantWithPreapproval("mem_pending", "PA-mem-4");
    const input = { externalReference: `sub-${consultantId}-same`, mpPreapprovalId: "PA-mem-4", amount: 20000, currency: "ARS", periodDaysGranted: 30 };

    const p1 = await storage.createPendingPayment(consultantId, input);
    const p2 = await storage.createPendingPayment(consultantId, input);

    expect(p2.id).not.toBe(p1.id);
    // getPaymentByExternalReference es determinista: devuelve el más reciente.
    expect((await storage.getPaymentByExternalReference(input.externalReference))!.id).toBe(p2.id);
  });
});
