import { describe, it, expect, beforeAll } from "vitest";

// Modo memoria, sin tocar Postgres/Supabase real — la migración de subscriptions/payments
// todavía no está aplicada, así que esta lógica solo se puede probar contra MemoryStorage.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const DAY_MS = 24 * 60 * 60 * 1000;

let storage: typeof import("../storage").storage;
let getConsultantAccessStatus: typeof import("../subscription").getConsultantAccessStatus;
let hasActiveAccess: typeof import("../subscription").hasActiveAccess;
let isFreePlan: typeof import("../subscription").isFreePlan;
let TRIAL_DAYS: number;

beforeAll(async () => {
  // Import dinámico: tiene que pasar DESPUÉS de fijar DATABASE_MODE, porque storage.ts decide
  // memoria-vs-Postgres una sola vez al importarse (mismo criterio que auth.test.ts).
  ({ storage } = await import("../storage"));
  ({ getConsultantAccessStatus, hasActiveAccess, isFreePlan } = await import("../subscription"));
  ({ TRIAL_DAYS } = await import("../config/subscription"));
});

let nextFakeConsultantId = 900000;
function fakeConsultantId(): number {
  return nextFakeConsultantId++;
}

describe("Trial automático al crear una consultora", () => {
  it("1. nueva consultora → nace con subscription en trial", async () => {
    const user = await storage.createUser({
      username: `vitest_sub_new_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const sub = await storage.getSubscriptionByConsultantId(user.consultantId!);
    expect(sub).toBeDefined();
    expect(sub!.status).toBe("trial");
    expect(sub!.currentPeriodEnd).toBeNull();
  });

  it("12. protección contra subscription duplicada para la misma consultora", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    await expect(storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS))).rejects.toThrow();
  });
});

describe("isFreePlan — única fuente de verdad de 'esta cuenta no tiene un pago activo' (Prompt 14)", () => {
  it("trial/expired/canceled son plan gratis; active no", () => {
    expect(isFreePlan("trial")).toBe(true);
    expect(isFreePlan("expired")).toBe(true);
    expect(isFreePlan("canceled")).toBe(true);
    expect(isFreePlan("active")).toBe(false);
  });
});

describe("getConsultantAccessStatus — trial (Prompt 14: ya no vence por días, P30)", () => {
  it("2. trial recién creado → hasAccess true, isFreePlan true", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.isFreePlan).toBe(true);
    expect(status.status).toBe("trial");
  });

  it("3. trialEndAt en el pasado NUNCA desloguea ni le quita acceso — la prueba ya no vence por fecha", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    // trialEndAt hace 100 días — bajo el código viejo esto hubiera sido "vencido hace mucho".
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 110 * DAY_MS), new Date(now.getTime() - 100 * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
  });

  it("4. trialEndAt en el pasado NUNCA cambia el status a 'expired' — sigue en 'trial' para siempre, hasta que pague", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 110 * DAY_MS), new Date(now.getTime() - 100 * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.status).toBe("trial");
    const persisted = await storage.getSubscriptionByConsultantId(consultantId);
    expect(persisted!.status).toBe("trial");
  });

  it("7. currentPeriodEnd es null durante el trial (todavía no pagó nunca)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.currentPeriodEnd).toBeNull();
  });

  it("9. daysRemaining es 0 durante el trial — ya no es un dato con sentido mientras nunca pagó", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.daysRemaining).toBe(0);
  });
});

describe("getConsultantAccessStatus — período pago (active)", () => {
  it("5. subscription active vigente → hasAccess true, isFreePlan false", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 15 * DAY_MS), new Date(now.getTime() - 5 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: new Date(now.getTime() - 1 * DAY_MS),
      currentPeriodEnd: new Date(now.getTime() + 29 * DAY_MS),
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.isFreePlan).toBe(false);
    expect(status.status).toBe("active");
  });

  it("6. subscription active vencida (currentPeriodEnd pasado) → pasa al plan gratis (nunca se bloquea, Prompt 14)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 45 * DAY_MS), new Date(now.getTime() - 35 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: new Date(now.getTime() - 31 * DAY_MS),
      currentPeriodEnd: new Date(now.getTime() - 1 * DAY_MS),
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.isFreePlan).toBe(true);
    expect(status.status).toBe("expired");
  });

  it("canceled (cancelación explícita) → pasa al plan gratis, nunca se bloquea", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 45 * DAY_MS), new Date(now.getTime() - 35 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "canceled",
      currentPeriodStart: new Date(now.getTime() - 31 * DAY_MS),
      currentPeriodEnd: new Date(now.getTime() + 29 * DAY_MS),
      canceledAt: now,
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.isFreePlan).toBe(true);
    expect(status.status).toBe("canceled");
  });

  it("10. daysRemaining durante el período pago (30 días exactos)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 15 * DAY_MS), new Date(now.getTime() - 5 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * DAY_MS),
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.daysRemaining).toBe(30);
  });

  it("un pago vigente nunca vuelve a mirar trialEndAt, aunque ya haya vencido", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    // Trial "vencido" hace rato, pero currentPeriodEnd vigente — el pago manda, siempre.
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 45 * DAY_MS), new Date(now.getTime() - 35 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: new Date(now.getTime() - 1 * DAY_MS),
      currentPeriodEnd: new Date(now.getTime() + 29 * DAY_MS),
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.status).toBe("active");
    expect(status.isFreePlan).toBe(false);
  });
});

describe("Casos límite", () => {
  it("11. consultantId inexistente → igual queda en plan gratis (Prompt 14: nadie se bloquea por el estado)", async () => {
    const status = await getConsultantAccessStatus(fakeConsultantId());
    expect(status.hasAccess).toBe(true);
    expect(status.isFreePlan).toBe(true);
    expect(status.trialEndAt).toBeNull();
    expect(status.daysRemaining).toBe(0);
  });

  it("hasActiveAccess() es siempre true ahora (Prompt 14: ya no bloquea nada por sí sola)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    expect(await hasActiveAccess(consultantId)).toBe(true);
  });
});
