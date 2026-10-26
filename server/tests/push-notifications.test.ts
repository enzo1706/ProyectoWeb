import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";
process.env.VAPID_SUBJECT = "mailto:vitest@example.com";
process.env.VAPID_PUBLIC_KEY = "vitest-public-key";
process.env.VAPID_PRIVATE_KEY = "vitest-private-key";

/**
 * Prompt 8, Parte 4 — avisos push del día de pedido.
 *
 * `sendWebPush` se mockea: estos tests prueban la LÓGICA de la revisión (ventana horaria,
 * reserva/no-duplicado, reintento vs. borrado de suscripción vencida) con el reloj simulado,
 * nunca el envío real contra un servicio de push de verdad — eso no se puede probar sin un
 * navegador real (ver el plan: Chrome de escritorio en localhost, o un celular con staging).
 */
const sendWebPushMock = vi.fn();
vi.mock("../push-vapid", () => ({
  sendWebPush: (...args: unknown[]) => sendWebPushMock(...args),
  isExpiredSubscriptionStatus: (statusCode: number | undefined) => statusCode === 404 || statusCode === 410,
  getVapidPublicKey: () => "vitest-public-key",
}));

let httpServer: Server;
let baseUrl: string;

async function api(cookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Mismo criterio que agenda-month.test.ts/order-reminder.test.ts: loginRateLimiter cuenta por
// IP, cada consultora de prueba usa la suya para no pisar el balde de otra.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.90.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

let nextTag = 1;
async function createConsultant(): Promise<{ cookie: string; consultantId: number }> {
  const { storage } = await import("../storage");
  const username = `vitest_push_${nextTag++}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextTestIp() },
    body: JSON.stringify({ identifier: username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  return { cookie, consultantId: user.consultantId! };
}

async function setOrderDays(cookie: string, day1: number | null, day2: number | null = null) {
  const current = await (await api(cookie, "GET", "/api/business-settings")).json();
  const res = await api(cookie, "PATCH", "/api/business-settings", {
    businessName: current.businessName,
    currency: current.currency,
    orderReminderDay1: day1,
    orderReminderDay2: day2,
  });
  expect(res.status).toBe(200);
}

let nextCodigo = 1;
// Mismo helper que order-reminder.test.ts: un producto que queda con poco stock después de
// venderlo, para que el recordatorio del día de pedido no quede vacío.
async function createProductSold(cookie: string, date: string, quantity: number, stockAfter: number): Promise<void> {
  const res = await api(cookie, "POST", "/api/products", {
    seccion: "VITEST",
    producto: `Producto push ${nextCodigo}`,
    codigo: `vitest-push-${nextCodigo++}-${Date.now()}`,
    precio: 1000,
    unidades: quantity + stockAfter,
  });
  const product = await res.json();
  const client = await (await api(cookie, "POST", "/api/clients", { name: "Clienta push", phone: `998${String(nextCodigo).padStart(7, "0")}` })).json();
  const saleRes = await api(cookie, "POST", "/api/sales", {
    clientId: client.id,
    date,
    items: [{ productId: product.id, quantity }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    paidNow: true,
    installments: [{ amount: quantity * 1000 }],
  });
  expect(saleRes.status).toBe(201);
}

let nextEndpointTag = 1;
async function subscribeDevice(cookie: string): Promise<string> {
  const endpoint = `https://push.example.com/vitest-${nextEndpointTag++}-${Date.now()}`;
  const res = await api(cookie, "POST", "/api/push/subscribe", {
    endpoint,
    keys: { p256dh: "vitest-p256dh", auth: "vitest-auth" },
  });
  expect(res.status).toBe(204);
  return endpoint;
}

// T12:00Z = 9am Argentina. Hora/minuto EN ARGENTINA — se traduce a UTC dejando que Date
// normalice cualquier desborde de día (ej. 21:30 Argentina = 00:30 UTC del día siguiente).
function setArgentinaDateTime(dateStr: string, hour: number, minute: number) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const midnightUtc = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  const minutesFromMidnightUtc = hour * 60 + minute + 3 * 60; // Argentina = UTC-3
  vi.setSystemTime(new Date(midnightUtc + minutesFromMidnightUtc * 60_000));
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  vi.useRealTimers();
  sendWebPushMock.mockReset();
});

// MemStorage es compartido por TODO este archivo (no se reinicia entre tests, igual que el
// resto de los tests de este proyecto) — una consultora de un test anterior que quedó
// suscripta puede seguir recibiendo avisos reales en los ticks de un test posterior, si su
// recordatorio sigue sin reclamar para ese día. Es el comportamiento CORRECTO (en producción
// pasaría lo mismo con varias consultoras reales) — por eso cada aserción de "cuántas veces se
// mandó" filtra por la consultora de ESE test en particular, nunca por el total global del
// mock.
function callsForConsultant(consultantId: number): unknown[] {
  return sendWebPushMock.mock.calls.filter(([subscription]) => (subscription as { consultantId: number }).consultantId === consultantId);
}

describe("Prompt 8, Parte 4 — rutas de suscripción", () => {
  it("activar guarda la suscripción, y se puede volver a mandar el mismo endpoint sin duplicar", async () => {
    const { cookie, consultantId } = await createConsultant();
    const { storage } = await import("../storage");
    const endpoint = await subscribeDevice(cookie);

    let rows = await storage.getPushSubscriptionsForConsultant(consultantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe(endpoint);

    // Reactivar (el navegador vuelve a mandar la misma suscripción) no crea una segunda fila.
    const res = await api(cookie, "POST", "/api/push/subscribe", { endpoint, keys: { p256dh: "otro", auth: "otro" } });
    expect(res.status).toBe(204);
    rows = await storage.getPushSubscriptionsForConsultant(consultantId);
    expect(rows).toHaveLength(1);
  });

  it("celular compartido: el mismo endpoint activado por otra consultora pasa a ser de ella (UPSERT)", async () => {
    const { storage } = await import("../storage");
    const a = await createConsultant();
    const b = await createConsultant();

    const endpoint = await subscribeDevice(a.cookie);
    expect(await storage.getPushSubscriptionsForConsultant(a.consultantId)).toHaveLength(1);

    const res = await api(b.cookie, "POST", "/api/push/subscribe", { endpoint, keys: { p256dh: "b-p256dh", auth: "b-auth" } });
    expect(res.status).toBe(204);

    expect(await storage.getPushSubscriptionsForConsultant(a.consultantId)).toHaveLength(0);
    const bRows = await storage.getPushSubscriptionsForConsultant(b.consultantId);
    expect(bRows).toHaveLength(1);
    expect(bRows[0].endpoint).toBe(endpoint);
  });

  it("cerrar sesión borra la suscripción (POST /api/push/unsubscribe)", async () => {
    const { cookie, consultantId } = await createConsultant();
    const { storage } = await import("../storage");
    const endpoint = await subscribeDevice(cookie);
    expect(await storage.getPushSubscriptionsForConsultant(consultantId)).toHaveLength(1);

    const res = await api(cookie, "POST", "/api/push/unsubscribe", { endpoint });
    expect(res.status).toBe(204);
    expect(await storage.getPushSubscriptionsForConsultant(consultantId)).toHaveLength(0);
  });

  it("GET /api/push/vapid-public-key devuelve la clave pública configurada", async () => {
    const { cookie } = await createConsultant();
    const res = await api(cookie, "GET", "/api/push/vapid-public-key");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: "vitest-public-key" });
  });
});

describe("Prompt 8, Parte 4 — la revisión programada (runPushSchedulerTick)", () => {
  // Default: cualquier consultora de un test ANTERIOR que este tick vuelva a procesar (sigue
  // suscripta, su reserva todavía no está hecha para esta fecha) se da por entregada sola, sin
  // crashear ni consumir el mock configurado a propósito para la consultora de ESTE test.
  beforeEach(() => {
    sendWebPushMock.mockReset();
    sendWebPushMock.mockResolvedValue({ success: true });
  });

  it("antes de las 9:00 no manda nada, aunque haya recordatorio y suscripción", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0); // configura los días con el reloj ya simulado
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 8, 55);
    const { runPushSchedulerTick } = await import("../push-scheduler");
    await runPushSchedulerTick();

    expect(callsForConsultant(consultantId)).toHaveLength(0);
  });

  it("a las 9:05 manda una sola vez (sin que la consultora haya entrado a la app ese día), y la revisión siguiente no duplica", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 9, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");
    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(1);
    const [, payload] = callsForConsultant(consultantId)[0] as [unknown, { title: string; body: string }];
    expect(payload.title).toBe("Hoy es tu día de pedido");
    expect(payload.body).toContain("1 productos para pedir");

    // Revisión siguiente, mismo día — no vuelve a mandar.
    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(1);
  });

  it("dos instancias revisando al mismo tiempo (Promise.all) → un solo envío", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 9, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");
    await Promise.all([runPushSchedulerTick(), runPushSchedulerTick()]);
    expect(callsForConsultant(consultantId)).toHaveLength(1);
  });

  it("servidor caído hasta las 11:00 → manda a las 11:00 (no se perdió el aviso)", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    // Sin ningún tick entre las 9:00 y las 11:00 — simula el servidor caído todo ese rango.
    setArgentinaDateTime("2026-11-02", 11, 0);
    const { runPushSchedulerTick } = await import("../push-scheduler");
    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(1);
  });

  it("después de las 21:00 no manda (ese día ya no se manda; el aviso de Inicio sigue estando)", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 21, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");
    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(0);

    // El recordatorio en sí (lo que ve Inicio) no depende de esto — sigue ahí.
    const reminderRes = await api(cookie, "GET", "/api/order-reminder");
    expect((await reminderRes.json())?.items?.length).toBeGreaterThan(0);
  });

  it("lista vacía (sin ventas, sin pendientes) → no manda nada", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2); // configurado, pero sin ninguna venta todavía
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 9, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");
    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(0);
  });

  it("error transitorio en todos los envíos → libera la reserva, y la revisión siguiente (misma ventana) reintenta", async () => {
    const { cookie, consultantId } = await createConsultant();
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 9, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");

    let failedOnce = false;
    sendWebPushMock.mockImplementation(async (subscription: { consultantId: number }) => {
      if (subscription.consultantId !== consultantId) return { success: true };
      if (!failedOnce) {
        failedOnce = true;
        return { success: false }; // sin statusCode = transitorio
      }
      return { success: true };
    });

    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(1);

    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(2); // reintentó de verdad, no se quedó "ya resuelto"
  });

  it("404 o 410 → borra la suscripción vencida, y no reintenta (no queda ningún dispositivo al que mandarle)", async () => {
    const { cookie, consultantId } = await createConsultant();
    const { storage } = await import("../storage");
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 9, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");

    sendWebPushMock.mockImplementation(async (subscription: { consultantId: number }) => {
      if (subscription.consultantId !== consultantId) return { success: true };
      return { success: false, statusCode: 410 };
    });

    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(1);
    expect(await storage.getPushSubscriptionsForConsultant(consultantId)).toHaveLength(0);

    // No queda ningún dispositivo — la próxima revisión no tiene a quién mandarle.
    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(1);
  });

  it("dos dispositivos, uno 410 y el otro recibe el aviso: el vencido se borra, y queda marcado como enviado (no reintenta)", async () => {
    const { cookie, consultantId } = await createConsultant();
    const { storage } = await import("../storage");
    setArgentinaDateTime("2026-11-02", 0, 0);
    await setOrderDays(cookie, 2);
    await createProductSold(cookie, "2026-11-01", 5, 1);
    await subscribeDevice(cookie);
    await subscribeDevice(cookie);

    setArgentinaDateTime("2026-11-02", 9, 5);
    const { runPushSchedulerTick } = await import("../push-scheduler");

    let devicesSeen = 0;
    sendWebPushMock.mockImplementation(async (subscription: { consultantId: number }) => {
      if (subscription.consultantId !== consultantId) return { success: true };
      devicesSeen++;
      return devicesSeen === 1 ? { success: false, statusCode: 410 } : { success: true };
    });

    await runPushSchedulerTick();
    expect(await storage.getPushSubscriptionsForConsultant(consultantId)).toHaveLength(1);
    expect(callsForConsultant(consultantId)).toHaveLength(2);

    await runPushSchedulerTick();
    expect(callsForConsultant(consultantId)).toHaveLength(2); // no mandó una tercera vez
  });
});
