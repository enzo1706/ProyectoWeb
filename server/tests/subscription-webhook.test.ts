import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const getMercadoPagoPaymentMock = vi.fn();
const verifyWebhookSignatureMock = vi.fn();

class FakeInvalidWebhookSignatureError extends Error {}

vi.mock("../mercadopago", () => ({
  createSubscriptionPreapproval: vi.fn(),
  getMercadoPagoPayment: (...args: unknown[]) => getMercadoPagoPaymentMock(...args),
  verifyWebhookSignature: (...args: unknown[]) => verifyWebhookSignatureMock(...args),
  InvalidWebhookSignatureError: FakeInvalidWebhookSignatureError,
}));

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

/** Payment "aprobado" mínimo con la forma real que devuelve el SDK — mismos campos que usa
 * handleApprovedPaymentTopic (status, transaction_amount, currency_id, external_reference,
 * point_of_interaction.transaction_data.subscription_id). */
function approvedPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 999,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 20000,
    currency_id: "ARS",
    external_reference: "sub-1-placeholder",
    point_of_interaction: { transaction_data: { subscription_id: "PA-placeholder" } },
    ...overrides,
  };
}

async function webhookRequest(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/subscription/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  getMercadoPagoPaymentMock.mockReset();
  verifyWebhookSignatureMock.mockReset();
  // Firma válida por defecto — cada test negativo específico de firma la sobreescribe.
  verifyWebhookSignatureMock.mockImplementation(() => {});
});

async function fixtureConsultant(usernamePrefix: string, mpPreapprovalId: string) {
  const user = await storage.createUser({
    username: `${usernamePrefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const consultantId = user.consultantId!;
  await storage.updateSubscription(consultantId, { mpPreapprovalId });
  return consultantId;
}

describe("POST /api/subscription/webhook", () => {
  it("1. payment approved con monto/moneda/preapproval correctos → activa el período", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_ok", "PA-ok-1");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1001, external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-ok-1" } } }),
    );

    const res = await webhookRequest({ type: "payment", data: { id: "1001" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("active");
    expect(sub!.currentPeriodStart).not.toBeNull();
    expect(sub!.currentPeriodEnd).not.toBeNull();
    expect(sub!.lastPaymentId).not.toBeNull();
    const payments = await storage.getPaymentsByConsultantId(consultantId);
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("approved");
    expect(payments[0].amount).toBe(20000);
  });

  it("2. payment rejected → no activa el período", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_rej", "PA-rej-1");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1002, status: "rejected", external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-rej-1" } } }),
    );

    const res = await webhookRequest({ type: "payment", data: { id: "1002" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
    expect(sub!.currentPeriodEnd).toBeNull();
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(0);
  });

  it("3. payment in_process → no activa el período", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_proc", "PA-proc-1");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1003, status: "in_process", external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-proc-1" } } }),
    );

    const res = await webhookRequest({ type: "payment", data: { id: "1003" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(0);
  });

  it("4. mismo mpPaymentId enviado dos veces (webhook duplicado) → no duplica el pago ni extiende el período dos veces", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_dup", "PA-dup-1");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1004, external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-dup-1" } } }),
    );

    await webhookRequest({ type: "payment", data: { id: "1004" } });
    const subAfterFirst = await storage.getSubscriptionByConsultantId(consultantId);
    const periodEndAfterFirst = subAfterFirst!.currentPeriodEnd!.getTime();

    await webhookRequest({ type: "payment", data: { id: "1004" } });
    const subAfterSecond = await storage.getSubscriptionByConsultantId(consultantId);

    expect(subAfterSecond!.currentPeriodEnd!.getTime()).toBe(periodEndAfterFirst);
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(1);
  });

  it("5. payment de otra suscripción (mpPreapprovalId no coincide) → rechazado, no activa nada", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_mismatch", "PA-real-registrado");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1005, external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-otro-distinto" } } }),
    );

    const res = await webhookRequest({ type: "payment", data: { id: "1005" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(0);
  });

  it("6. payment con monto incorrecto (distinto de SUBSCRIPTION_PRICE_ARS) → rechazado, no activa nada", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_amount", "PA-amount-1");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1006, transaction_amount: 1, external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-amount-1" } } }),
    );

    const res = await webhookRequest({ type: "payment", data: { id: "1006" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(0);
  });

  it("7. payment con moneda incorrecta (distinta de ARS) → rechazado, no activa nada", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_currency", "PA-currency-1");
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({ id: 1007, currency_id: "USD", external_reference: `sub-${consultantId}-abc123`, point_of_interaction: { transaction_data: { subscription_id: "PA-currency-1" } } }),
    );

    const res = await webhookRequest({ type: "payment", data: { id: "1007" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
    expect(await storage.getPaymentsByConsultantId(consultantId)).toHaveLength(0);
  });

  it("8. webhook con firma inválida → responde 401, nunca reconsulta Mercado Pago", async () => {
    verifyWebhookSignatureMock.mockImplementation(() => {
      throw new FakeInvalidWebhookSignatureError("firma inválida de prueba");
    });

    const res = await webhookRequest({ type: "payment", data: { id: "1008" } });
    expect(res.status).toBe(401);
    expect(getMercadoPagoPaymentMock).not.toHaveBeenCalled();
  });

  it("9. payment inexistente en Mercado Pago (la reconsulta falla) → no rompe, no activa nada, responde 200", async () => {
    const consultantId = await fixtureConsultant("vitest_wh_notfound", "PA-notfound-1");
    getMercadoPagoPaymentMock.mockRejectedValue(new Error("Payment not found"));

    const res = await webhookRequest({ type: "payment", data: { id: "999999" } });
    expect(res.status).toBe(200);

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("trial");
  });

  it("10. topic subscription_preapproval es solo informativo — nunca reconsulta payments ni toca la DB", async () => {
    await fixtureConsultant("vitest_wh_preapproval", "PA-informativo-1");
    const res = await webhookRequest({ type: "subscription_preapproval", data: { id: "PA-informativo-1" } });
    expect(res.status).toBe(200);
    expect(getMercadoPagoPaymentMock).not.toHaveBeenCalled();
  });
});
