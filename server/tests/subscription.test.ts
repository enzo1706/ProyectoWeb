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
let TRIAL_DAYS: number;

beforeAll(async () => {
  // Import dinámico: tiene que pasar DESPUÉS de fijar DATABASE_MODE, porque storage.ts decide
  // memoria-vs-Postgres una sola vez al importarse (mismo criterio que auth.test.ts).
  ({ storage } = await import("../storage"));
  ({ getConsultantAccessStatus, hasActiveAccess } = await import("../subscription"));
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

describe("getConsultantAccessStatus — trial", () => {
  it("2. trial vigente → hasAccess true", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.status).toBe("trial");
  });

  it("3. trial vencido → hasAccess false", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 11 * DAY_MS), new Date(now.getTime() - 1 * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(false);
  });

  it("4. trial vencido → status calculado y persistido queda en expired", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 11 * DAY_MS), new Date(now.getTime() - 1 * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.status).toBe("expired");
    const persisted = await storage.getSubscriptionByConsultantId(consultantId);
    expect(persisted!.status).toBe("expired");
  });

  it("7. currentPeriodEnd es null durante el trial (todavía no pagó nunca)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.currentPeriodEnd).toBeNull();
  });

  it("8. trialEndAt no cambia entre consultas sucesivas", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const first = await getConsultantAccessStatus(consultantId);
    const second = await getConsultantAccessStatus(consultantId);
    expect(first.trialEndAt!.getTime()).toBe(second.trialEndAt!.getTime());
  });

  it("9. daysRemaining muestra 10 recién creado el trial (ceil, no regala ni quita un día)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.daysRemaining).toBe(10);
  });

  it("último día del trial (< 24hs restantes) → daysRemaining 1, no 0, mientras hay acceso", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 9 * DAY_MS), new Date(now.getTime() + 1 * 60 * 60 * 1000));
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.daysRemaining).toBe(1);
  });

  it("vencimiento exacto (ahora === trialEndAt) → todavía hay acceso (inclusive)", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 10 * DAY_MS), now);
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
  });
});

describe("getConsultantAccessStatus — período pago (active)", () => {
  it("5. subscription active vigente → hasAccess true", async () => {
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
    expect(status.status).toBe("active");
  });

  it("6. subscription active vencida (currentPeriodEnd pasado) → hasAccess false", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 45 * DAY_MS), new Date(now.getTime() - 35 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: new Date(now.getTime() - 31 * DAY_MS),
      currentPeriodEnd: new Date(now.getTime() - 1 * DAY_MS),
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(false);
    expect(status.status).toBe("expired");
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
    // Trial vencido hace rato, pero currentPeriodEnd vigente — el pago manda, siempre.
    await storage.createTrialSubscription(consultantId, new Date(now.getTime() - 45 * DAY_MS), new Date(now.getTime() - 35 * DAY_MS));
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: new Date(now.getTime() - 1 * DAY_MS),
      currentPeriodEnd: new Date(now.getTime() + 29 * DAY_MS),
    });
    const status = await getConsultantAccessStatus(consultantId);
    expect(status.hasAccess).toBe(true);
    expect(status.status).toBe("active");
  });
});

describe("Casos límite", () => {
  it("11. consultantId inexistente → sin acceso, sin inventar un trial fantasma", async () => {
    const status = await getConsultantAccessStatus(fakeConsultantId());
    expect(status.hasAccess).toBe(false);
    expect(status.status).toBe("expired");
    expect(status.trialEndAt).toBeNull();
    expect(status.daysRemaining).toBe(0);
  });

  it("hasActiveAccess() es equivalente al hasAccess de getConsultantAccessStatus()", async () => {
    const consultantId = fakeConsultantId();
    const now = new Date();
    await storage.createTrialSubscription(consultantId, now, new Date(now.getTime() + TRIAL_DAYS * DAY_MS));
    expect(await hasActiveAccess(consultantId)).toBe(true);
  });
});
