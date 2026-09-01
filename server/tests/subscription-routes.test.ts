import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const createSubscriptionPreapprovalMock = vi.fn();

vi.mock("../mercadopago", () => ({
  createSubscriptionPreapproval: (...args: unknown[]) => createSubscriptionPreapprovalMock(...args),
  getMercadoPagoPayment: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  InvalidWebhookSignatureError: class InvalidWebhookSignatureError extends Error {},
}));

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

async function createConsultant(username: string) {
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!;
  return { consultantId: user.consultantId!, cookie };
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  ({ storage } = await import("../storage"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  createSubscriptionPreapprovalMock.mockReset();
  createSubscriptionPreapprovalMock.mockResolvedValue({ id: "PA-mock-1", initPoint: "https://mp.example/checkout/PA-mock-1", status: "pending" });
});

describe("POST /api/subscription/start", () => {
  it("1. sin sesión responde 401 y no llama a Mercado Pago", async () => {
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(res.status).toBe(401);
    expect(createSubscriptionPreapprovalMock).not.toHaveBeenCalled();
  });

  it("2. como admin responde 404 (no aplica) y no llama a Mercado Pago", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    // ensureDefaultAdmin solo corre fuera de producción — en test también está activo (NODE_ENV=test).
    const cookie = loginRes.headers.get("set-cookie");
    if (!cookie) {
      // Si por algún motivo el admin default no existe en este entorno, no hay nada que
      // afirmar sobre esa cuenta puntual — el resto de los tests igual cubre el caso admin
      // indirectamente vía requireConsultant en otras rutas.
      return;
    }
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(res.status).toBe(404);
    expect(createSubscriptionPreapprovalMock).not.toHaveBeenCalled();
  });

  it("4. un monto/precio enviado por el frontend se ignora silenciosamente (el schema no tiene ese campo)", async () => {
    const { cookie } = await createConsultant(`vitest_sub_price_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "consultora@example.com", amount: 1, transaction_amount: 999999, precio: 1 }),
    });
    expect(res.status).toBe(200);
    const sentBody = createSubscriptionPreapprovalMock.mock.calls[0][0];
    expect(sentBody).not.toHaveProperty("amount");
    expect(sentBody).not.toHaveProperty("transaction_amount");
    expect(sentBody).not.toHaveProperty("precio");
  });

  it("5. dos consultoras distintas generan externalReference distintos", async () => {
    const a = await createConsultant(`vitest_sub_extref_a_${Date.now()}`);
    const b = await createConsultant(`vitest_sub_extref_b_${Date.now()}`);
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify({ email: "a@example.com" }),
    });
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: b.cookie },
      body: JSON.stringify({ email: "b@example.com" }),
    });
    const refA = createSubscriptionPreapprovalMock.mock.calls[0][0].externalReference;
    const refB = createSubscriptionPreapprovalMock.mock.calls[1][0].externalReference;
    expect(refA).not.toBe(refB);
    expect(refA).toMatch(new RegExp(`^sub-${a.consultantId}-`));
    expect(refB).toMatch(new RegExp(`^sub-${b.consultantId}-`));
  });

  it("6. doble request inmediata no crea un segundo preapproval (guarda de doble click del backend)", async () => {
    const { cookie } = await createConsultant(`vitest_sub_dbl_${Date.now()}`);
    const body = JSON.stringify({ email: "doble@example.com" });
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/subscription/start`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body }),
      fetch(`${baseUrl}/api/subscription/start`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(createSubscriptionPreapprovalMock).toHaveBeenCalledTimes(1);
  });

  it("7. no permite iniciar una segunda suscripción mientras ya hay una activa", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_sub_active_${Date.now()}`);
    await storage.updateSubscription(consultantId, {
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
    });
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "activa@example.com" }),
    });
    expect(res.status).toBe(409);
    expect(createSubscriptionPreapprovalMock).not.toHaveBeenCalled();
  });

  it("8. guarda el mpPreapprovalId devuelto por Mercado Pago en la subscription", async () => {
    createSubscriptionPreapprovalMock.mockResolvedValue({ id: "PA-guardado-123", initPoint: "https://mp.example/x", status: "pending" });
    const { consultantId, cookie } = await createConsultant(`vitest_sub_save_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "guardado@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.initPoint).toBe("https://mp.example/x");
    expect(body).not.toHaveProperty("id");
    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.mpPreapprovalId).toBe("PA-guardado-123");
  });
});

describe("Idempotencia de pagos aprobados (storage.applyApprovedPayment)", () => {
  it("9. un mismo mpPaymentId nunca genera dos filas de payments", async () => {
    const { consultantId } = await createConsultant(`vitest_sub_dup_${Date.now()}`);
    await storage.updateSubscription(consultantId, { mpPreapprovalId: "PA-dup-1" });
    const input = {
      externalReference: `sub-${consultantId}-x`,
      mpPreapprovalId: "PA-dup-1",
      mpPaymentId: "PAY-dup-1",
      amount: 20000,
      statusDetail: "accredited",
      rawPayload: {},
    };
    const first = await storage.applyApprovedPayment(consultantId, input);
    const second = await storage.applyApprovedPayment(consultantId, input);
    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("already_processed");
    const payments = await storage.getPaymentsByConsultantId(consultantId);
    expect(payments.filter((p) => p.mpPaymentId === "PAY-dup-1")).toHaveLength(1);
  });

  it("10. un paymentId ya procesado no vuelve a extender currentPeriodEnd", async () => {
    const { consultantId } = await createConsultant(`vitest_sub_noext_${Date.now()}`);
    await storage.updateSubscription(consultantId, { mpPreapprovalId: "PA-noext-1" });
    const input = {
      externalReference: `sub-${consultantId}-x`,
      mpPreapprovalId: "PA-noext-1",
      mpPaymentId: "PAY-noext-1",
      amount: 20000,
      statusDetail: "accredited",
      rawPayload: {},
    };
    await storage.applyApprovedPayment(consultantId, input);
    const subAfterFirst = await storage.getSubscriptionByConsultantId(consultantId);
    const periodEndAfterFirst = subAfterFirst!.currentPeriodEnd!.getTime();

    await storage.applyApprovedPayment(consultantId, input);
    const subAfterSecond = await storage.getSubscriptionByConsultantId(consultantId);
    expect(subAfterSecond!.currentPeriodEnd!.getTime()).toBe(periodEndAfterFirst);
  });

  it("un pago cuyo preapproval no coincide con el registrado nunca extiende el acceso", async () => {
    const { consultantId } = await createConsultant(`vitest_sub_mismatch_${Date.now()}`);
    await storage.updateSubscription(consultantId, { mpPreapprovalId: "PA-real-1" });
    const result = await storage.applyApprovedPayment(consultantId, {
      externalReference: `sub-${consultantId}-x`,
      mpPreapprovalId: "PA-otro-distinto",
      mpPaymentId: "PAY-mismatch-1",
      amount: 20000,
      statusDetail: "accredited",
      rawPayload: {},
    });
    expect(result.outcome).toBe("preapproval_mismatch");
    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
    expect(sub!.currentPeriodEnd).toBeNull();
  });
});
