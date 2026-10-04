import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const createSubscriptionPreapprovalMock = vi.fn();
const getMercadoPagoPaymentMock = vi.fn();
const verifyWebhookSignatureMock = vi.fn();
const updatePreapprovalAmountMock = vi.fn();

class FakeInvalidWebhookSignatureError extends Error {}

vi.mock("../mercadopago", () => ({
  createSubscriptionPreapproval: (...args: unknown[]) => createSubscriptionPreapprovalMock(...args),
  getMercadoPagoPayment: (...args: unknown[]) => getMercadoPagoPaymentMock(...args),
  verifyWebhookSignature: (...args: unknown[]) => verifyWebhookSignatureMock(...args),
  updatePreapprovalAmount: (...args: unknown[]) => updatePreapprovalAmountMock(...args),
  InvalidWebhookSignatureError: FakeInvalidWebhookSignatureError,
}));

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;
// loginRateLimiter (15') cuenta por IP, y todos los requests de este archivo salen de la
// misma IP de loopback — se loguea UNA sola vez y se reutiliza la cookie en todo el archivo
// (mismo criterio que el resto de los tests admin existentes).
let cachedAdminCookie: string;

// loginRateLimiter (10 intentos / 15') cuenta por IP — cada consultora nueva de este archivo
// usa su propia IP sintética (X-Forwarded-For, 1 hop de trust proxy, ver server/app.ts) para no
// compartir balde con las demás, mismo patrón que auth-password-reset.test.ts.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.80.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function createConsultant(username: string) {
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextTestIp() },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!;
  return { consultantId: user.consultantId!, cookie };
}

async function adminCookie() {
  if (cachedAdminCookie) return cachedAdminCookie;
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  cachedAdminCookie = res.headers.get("set-cookie")!;
  return cachedAdminCookie;
}

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
  createSubscriptionPreapprovalMock.mockReset();
  createSubscriptionPreapprovalMock.mockResolvedValue({ id: "PA-mock-1", initPoint: "https://mp.example/checkout/PA-mock-1", status: "pending" });
  getMercadoPagoPaymentMock.mockReset();
  verifyWebhookSignatureMock.mockReset();
  verifyWebhookSignatureMock.mockImplementation(() => {});
  updatePreapprovalAmountMock.mockReset();
  updatePreapprovalAmountMock.mockResolvedValue(undefined);
});

describe("Precio de la suscripción (Prompt U)", () => {
  it("1. sin ningún cambio cargado, el precio vigente es el de config (fallback)", async () => {
    const res = await fetch(`${baseUrl}/api/admin/subscription-price`, { headers: { Cookie: await adminCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentPriceArs).toBe(20000);
    expect(body.history).toEqual([]);
  });

  it("2. el admin cambia el precio 'solo nuevas' — una alta nueva ve el precio nuevo, sin tocar nada de Mercado Pago", async () => {
    const put = await fetch(`${baseUrl}/api/admin/subscription-price`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: await adminCookie() },
      body: JSON.stringify({ newPriceArs: 25000, appliesTo: "new_only" }),
    });
    expect(put.status).toBe(201);

    const { cookie } = await createConsultant(`vitest_price_new_${Date.now()}`);
    const statusRes = await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: cookie } });
    const status = await statusRes.json();
    expect(status.plan.priceArs).toBe(25000);

    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "nueva@example.com" }),
    });
    expect(createSubscriptionPreapprovalMock.mock.calls.at(-1)![0].amount).toBe(25000);
    expect(updatePreapprovalAmountMock).not.toHaveBeenCalled();
  });

  it("3. appliesTo='all' sin effectiveAt responde 400 (el documento lo exige)", async () => {
    const put = await fetch(`${baseUrl}/api/admin/subscription-price`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: await adminCookie() },
      body: JSON.stringify({ newPriceArs: 30000, appliesTo: "all" }),
    });
    expect(put.status).toBe(400);
  });

  it("4. cambio 'a las actuales' con fecha YA pasada se aplica solo (perezoso) la próxima vez que se mira el acceso de esa consultora", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_price_all_${Date.now()}`);
    await storage.updateSubscription(consultantId, {
      status: "active",
      mpPreapprovalId: "PA-reconcile-1",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
    });

    await fetch(`${baseUrl}/api/admin/subscription-price`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: await adminCookie() },
      body: JSON.stringify({ newPriceArs: 18000, appliesTo: "all", effectiveAt: new Date(Date.now() - 1000).toISOString() }),
    });

    expect(updatePreapprovalAmountMock).not.toHaveBeenCalled();

    const statusRes = await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: cookie } });
    expect(statusRes.status).toBe(200);

    expect(updatePreapprovalAmountMock).toHaveBeenCalledWith("PA-reconcile-1", 18000);
    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.priceHistoryAppliedId).not.toBeNull();

    // Segunda consulta: ya se aplicó, no se vuelve a llamar a Mercado Pago.
    updatePreapprovalAmountMock.mockClear();
    await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: cookie } });
    expect(updatePreapprovalAmountMock).not.toHaveBeenCalled();
  });

  it("5. si falla el PUT a Mercado Pago, el chequeo de acceso NO se rompe (nunca bloquea /subscription)", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_price_fail_${Date.now()}`);
    await storage.updateSubscription(consultantId, {
      status: "active",
      mpPreapprovalId: "PA-reconcile-fail-1",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
    });
    updatePreapprovalAmountMock.mockRejectedValue(new Error("Mercado Pago no responde"));

    await fetch(`${baseUrl}/api/admin/subscription-price`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: await adminCookie() },
      body: JSON.stringify({ newPriceArs: 15000, appliesTo: "all", effectiveAt: new Date(Date.now() - 1000).toISOString() }),
    });

    const statusRes = await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: cookie } });
    expect(statusRes.status).toBe(200);
    // No quedó marcado como aplicado — se reintentará en la próxima consulta.
    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.priceHistoryAppliedId).toBeNull();
  });
});

describe("Cupones (Prompt U)", () => {
  // El describe de "Precio" (arriba) corre antes y deja el precio global mutado (comparten el
  // mismo storage) — nunca asumir acá que sigue en el default de config, siempre leerlo.
  async function currentPriceArs(): Promise<number> {
    const res = await fetch(`${baseUrl}/api/admin/subscription-price`, { headers: { Cookie: await adminCookie() } });
    return (await res.json()).currentPriceArs;
  }

  async function createCoupon(overrides: Record<string, unknown> = {}) {
    const res = await fetch(`${baseUrl}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: await adminCookie() },
      body: JSON.stringify({ code: `CUP${Date.now()}${Math.floor(Math.random() * 1000)}`, discountType: "percentage", discountValue: 50, duration: "forever", ...overrides }),
    });
    expect(res.status).toBe(201);
    return res.json();
  }

  it("1. validar un código inexistente devuelve el mensaje correcto", async () => {
    const { cookie } = await createConsultant(`vitest_cup_404_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: "NOEXISTE123" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Ese cupón no existe");
  });

  it("2. no importan mayúsculas/minúsculas al validar", async () => {
    const coupon = await createCoupon({ code: "MIXEDCASE1" });
    const { cookie } = await createConsultant(`vitest_cup_case_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: "mixedcase1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(coupon.code);
    expect(body.discountedPriceArs).toBe(Math.round((await currentPriceArs()) * 0.5));
  });

  it("3. cupón vencido", async () => {
    const coupon = await createCoupon({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const { cookie } = await createConsultant(`vitest_cup_exp_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: coupon.code }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ese cupón ya venció");
  });

  it("4. cupón desactivado", async () => {
    const coupon = await createCoupon();
    await fetch(`${baseUrl}/api/admin/coupons/${coupon.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: await adminCookie() },
      body: JSON.stringify({ active: false }),
    });
    const { cookie } = await createConsultant(`vitest_cup_inactive_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: coupon.code }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ese cupón no está activo");
  });

  it("5. monto fijo nunca deja el precio en negativo", async () => {
    const coupon = await createCoupon({ discountType: "fixed", discountValue: 999999 });
    const { cookie } = await createConsultant(`vitest_cup_fixed_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: coupon.code }),
    });
    expect((await res.json()).discountedPriceArs).toBe(0);
  });

  it("6. /start con cupón manda el monto descontado a Mercado Pago y reserva el cupo", async () => {
    const basePrice = await currentPriceArs();
    const coupon = await createCoupon({ discountType: "percentage", discountValue: 20 });
    const { consultantId, cookie } = await createConsultant(`vitest_cup_start_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "con-cupon@example.com", couponCode: coupon.code.toLowerCase() }),
    });
    expect(res.status).toBe(200);
    expect(createSubscriptionPreapprovalMock.mock.calls[0][0].amount).toBe(Math.round(basePrice * 0.8));
    const redemption = await storage.getCouponRedemption(coupon.id, consultantId);
    expect(redemption?.status).toBe("reserved");
  });

  it("7. una consultora no puede usar el mismo cupón dos veces", async () => {
    const coupon = await createCoupon();
    const { cookie } = await createConsultant(`vitest_cup_reuse_${Date.now()}`);
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "a@example.com", couponCode: coupon.code }),
    });
    const res = await fetch(`${baseUrl}/api/subscription/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: coupon.code }),
    });
    expect((await res.json()).error).toBe("Ya usaste este cupón");
  });

  it("8. límite de usos: la N+1 consultora recibe 'límite de usos'", async () => {
    const coupon = await createCoupon({ maxUses: 1 });
    const first = await createConsultant(`vitest_cup_limit_a_${Date.now()}`);
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: first.cookie },
      body: JSON.stringify({ email: "a@example.com", couponCode: coupon.code }),
    });
    const second = await createConsultant(`vitest_cup_limit_b_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: second.cookie },
      body: JSON.stringify({ email: "b@example.com", couponCode: coupon.code }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ese cupón ya alcanzó el límite de usos");
  });

  it("9. cupón que deja el precio en $0 activa la suscripción SIN pasar por Mercado Pago", async () => {
    const coupon = await createCoupon({ discountType: "percentage", discountValue: 100 });
    const { consultantId, cookie } = await createConsultant(`vitest_cup_free_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "gratis@example.com", couponCode: coupon.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activatedWithoutPayment).toBe(true);
    expect(createSubscriptionPreapprovalMock).not.toHaveBeenCalled();

    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    expect(sub!.status).toBe("active");
    expect(sub!.currentPeriodEnd).not.toBeNull();
    const redemption = await storage.getCouponRedemption(coupon.id, consultantId);
    expect(redemption?.status).toBe("confirmed");
    const payments = await storage.getPaymentsByConsultantId(consultantId);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(0);
    expect(payments[0].status).toBe("approved");
  });

  it("10. webhook: el pago real descontado por cupón se acredita (el chequeo de monto ya NO es el precio fijo)", async () => {
    const basePrice = await currentPriceArs();
    const coupon = await createCoupon({ discountType: "percentage", discountValue: 30 });
    const { consultantId, cookie } = await createConsultant(`vitest_cup_webhook_${Date.now()}`);
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "wh@example.com", couponCode: coupon.code }),
    });
    const sub = await storage.getSubscriptionByConsultantId(consultantId);

    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({
        id: 5001,
        transaction_amount: Math.round(basePrice * 0.7),
        external_reference: `sub-${consultantId}-cafecafe01`,
        point_of_interaction: { transaction_data: { subscription_id: sub!.mpPreapprovalId } },
      }),
    );
    const res = await webhookRequest({ type: "payment", data: { id: "5001" } });
    expect(res.status).toBe(200);

    const subAfter = await storage.getSubscriptionByConsultantId(consultantId);
    expect(subAfter!.status).toBe("active");
    const redemption = await storage.getCouponRedemption(coupon.id, consultantId);
    expect(redemption?.status).toBe("confirmed");
    expect(redemption?.discountEndsAt).toBeNull(); // duration "forever" en este test → nunca vence (ver test 12 para "months")
  });

  it("11. webhook: un payment con el monto SIN descontar (cuando correspondía descuento) se ignora", async () => {
    const basePrice = await currentPriceArs();
    const coupon = await createCoupon({ discountType: "percentage", discountValue: 30 });
    const { consultantId, cookie } = await createConsultant(`vitest_cup_wrongamount_${Date.now()}`);
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "wrong@example.com", couponCode: coupon.code }),
    });
    const sub = await storage.getSubscriptionByConsultantId(consultantId);

    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({
        id: 5002,
        transaction_amount: basePrice, // el precio SIN el 30% de descuento — no debería aceptarse
        external_reference: `sub-${consultantId}-cafecafe02`,
        point_of_interaction: { transaction_data: { subscription_id: sub!.mpPreapprovalId } },
      }),
    );
    const res = await webhookRequest({ type: "payment", data: { id: "5002" } });
    expect(res.status).toBe(200); // siempre 200 a MP, pero no se acredita

    const subAfter = await storage.getSubscriptionByConsultantId(consultantId);
    expect(subAfter!.status).toBe("trial");
    expect(subAfter!.currentPeriodEnd).toBeNull();
  });

  it("12. cupón con duración 'months': discountEndsAt queda fijado al confirmar el pago, y se revierte solo al vencer", async () => {
    const basePrice = await currentPriceArs();
    const coupon = await createCoupon({ discountType: "percentage", discountValue: 25, duration: "months", durationMonths: 2 });
    const { consultantId, cookie } = await createConsultant(`vitest_cup_months_${Date.now()}`);
    await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ email: "months@example.com", couponCode: coupon.code }),
    });
    const sub = await storage.getSubscriptionByConsultantId(consultantId);
    getMercadoPagoPaymentMock.mockResolvedValue(
      approvedPayment({
        id: 5003,
        transaction_amount: Math.round(basePrice * 0.75),
        external_reference: `sub-${consultantId}-cafecafe03`,
        point_of_interaction: { transaction_data: { subscription_id: sub!.mpPreapprovalId } },
      }),
    );
    await webhookRequest({ type: "payment", data: { id: "5003" } });

    const redemption = await storage.getCouponRedemption(coupon.id, consultantId);
    expect(redemption?.status).toBe("confirmed");
    expect(redemption?.discountEndsAt).not.toBeNull();

    // Simula que ya pasaron los 2 meses: fuerza la fecha de vencimiento al pasado.
    await storage.updateSubscription(consultantId, { status: "active", currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000) });
    const allRedemptions = (storage as any).couponRedemptions ?? null; // solo MemoryStorage expone el array interno
    if (allRedemptions) {
      const row = allRedemptions.find((r: any) => r.id === redemption!.id);
      row.discountEndsAt = new Date(Date.now() - 1000);
    }

    updatePreapprovalAmountMock.mockClear();
    await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: cookie } });
    expect(updatePreapprovalAmountMock).toHaveBeenCalledWith(sub!.mpPreapprovalId, basePrice);
    const redemptionAfter = await storage.getCouponRedemption(coupon.id, consultantId);
    expect(redemptionAfter?.priceRevertedAt).not.toBeNull();
  });
});
