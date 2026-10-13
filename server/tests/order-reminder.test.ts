import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;

async function api(cookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let nextTag = 1;
async function createConsultant(): Promise<string> {
  const { storage } = await import("../storage");
  const username = `vitest_orderreminder_${nextTag++}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password: "vitest-test-password-123" }),
  });
  return loginRes.headers.get("set-cookie")!.split(";")[0];
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
async function createProductSold(cookie: string, date: string, quantity: number, stockAfter: number): Promise<number> {
  // Crea un producto con stock exactamente igual a `stockAfter` + lo vendido, para que después
  // de la venta en `date` quede en `stockAfter` (sea o no "poco stock").
  const res = await api(cookie, "POST", "/api/products", {
    seccion: "VITEST",
    producto: `Producto recordatorio ${nextCodigo}`,
    codigo: `vitest-reminder-${nextCodigo++}-${Date.now()}`,
    precio: 1000,
    unidades: quantity + stockAfter,
  });
  const product = await res.json();
  const client = await (await api(cookie, "POST", "/api/clients", { name: "Clienta recordatorio", phone: `999${String(nextCodigo).padStart(7, "0")}` })).json();
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
  return product.id;
}

function setArgentinaNow(dateStr: string) {
  // T12:00Z = mediodía UTC = 9am Argentina, mismo día calendario sin ambigüedad de huso.
  // shouldAdvanceTime: los timers reales (fetch, keep-alive del server HTTP) siguen
  // avanzando de verdad — solo se mockea el instante inicial de Date.now().
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${dateStr}T12:00:00.000Z`));
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
});

// Prompt 13: la sesión es "rolling" de 10 días desde la última visita — cada salto de reloj
// falso dentro de un mismo test nunca tiene que superar esa ventana desde la llamada
// autenticada anterior, o la sesión queda expirada a mitad del test. Por eso las fechas de
// "configurado desde" de cada test están siempre a pocos días del momento que se verifica,
// nunca con meses de diferencia (ver mismo criterio en server/tests/session-rolling.test.ts).
describe("Prompt 8, Parte 3 — recordatorio del día de pedido", () => {
  it("sin días configurados: nunca genera nada", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await createProductSold(cookie, "2026-10-01", 5, 0);
    setArgentinaNow("2026-10-10");
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res).toBeNull();
  });

  it("entrando el mismo día de pedido: genera el recordatorio, texto 'Hoy es tu día de pedido'", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 10);
    await createProductSold(cookie, "2026-10-05", 5, 0); // queda en 0, poco stock

    setArgentinaNow("2026-10-10");
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res).not.toBeNull();
    expect(res.reminder.reminderDate).toBe("2026-10-10");
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0].soldInPeriod).toBe(5);
    expect(res.items[0].currentStock).toBe(0);
  });

  it("entrando varios días después: sigue apareciendo el mismo recordatorio (nunca se pierde)", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 10);
    await createProductSold(cookie, "2026-10-05", 5, 0);

    setArgentinaNow("2026-10-10");
    const first = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(first.reminder.reminderDate).toBe("2026-10-10");

    setArgentinaNow("2026-10-17"); // una semana después, todavía no tocó "Listo, ya lo pedí"
    const second = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(second.reminder.id).toBe(first.reminder.id); // el mismo, no uno nuevo
  });

  it("entrando dos veces el mismo día: no se duplica", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 10);
    await createProductSold(cookie, "2026-10-05", 5, 0);

    setArgentinaNow("2026-10-10");
    const first = await (await api(cookie, "GET", "/api/order-reminder")).json();
    const second = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(second.reminder.id).toBe(first.reminder.id);
  });

  it("'Listo, ya lo pedí' cierra el recordatorio, y no reaparece hasta el siguiente ciclo", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 10);
    await createProductSold(cookie, "2026-10-05", 5, 0);

    setArgentinaNow("2026-10-10");
    const first = await (await api(cookie, "GET", "/api/order-reminder")).json();
    const dismissRes = await api(cookie, "POST", `/api/order-reminder/${first.reminder.id}/dismiss`, {});
    expect(dismissRes.status).toBe(200);

    const after = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(after).toBeNull(); // mismo ciclo (10 de octubre), ya resuelto
  });

  it("lista vacía (nada con poco stock, nada pendiente): no genera recordatorio", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 10);
    await createProductSold(cookie, "2026-10-05", 2, 50); // queda con stock de sobra

    setArgentinaNow("2026-10-10");
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res).toBeNull();
  });

  it("texto cuando el día ya pasó: 'Tu día de pedido fue el 10 de octubre' (vía reminderDate, el texto lo arma el frontend)", async () => {
    setArgentinaNow("2026-10-06");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 10);
    await createProductSold(cookie, "2026-10-05", 5, 0);

    setArgentinaNow("2026-10-14"); // 8 días después de configurar — dentro de la ventana rolling
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res.reminder.reminderDate).toBe("2026-10-10"); // no "hoy" (14), el ciclo real
  });

  it("día 31 configurado, en febrero (28 días): genera el último día del mes", async () => {
    setArgentinaNow("2026-02-20");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 31);
    await createProductSold(cookie, "2026-02-01", 5, 0);

    setArgentinaNow("2026-02-28"); // 8 días después
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res.reminder.reminderDate).toBe("2026-02-28");
  });

  it("dos días de pedido por mes: el período va de un día al otro, no de un día a sí mismo", async () => {
    setArgentinaNow("2026-10-12");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 5, 20);
    await createProductSold(cookie, "2026-10-10", 5, 0); // vendido ENTRE el 5 y el 20

    setArgentinaNow("2026-10-20"); // 8 días después
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res.reminder.periodStart).toBe("2026-10-05");
    expect(res.reminder.reminderDate).toBe("2026-10-20");
    expect(res.items[0].soldInPeriod).toBe(5);
  });

  it("no genera un recordatorio de un ciclo anterior a cuando se configuraron los días (ajuste 1)", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    // Vende algo con poco stock el día 5, ANTES de configurar los días de pedido.
    await createProductSold(cookie, "2026-10-05", 5, 0);
    setArgentinaNow("2026-10-09"); // configura recién el 9, ANTES del ciclo del día 10
    await setOrderDays(cookie, 10);

    setArgentinaNow("2026-10-10"); // el ciclo de HOY (10) es posterior a cuando configuró (9): corresponde
    const resToday = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(resToday).not.toBeNull();
  });

  it("configurando el día DESPUÉS de que ya pasó ese ciclo: no aparece nada hasta el siguiente ciclo", async () => {
    setArgentinaNow("2026-10-06");
    const cookie = await createConsultant();
    await createProductSold(cookie, "2026-10-05", 5, 0);
    setArgentinaNow("2026-10-15"); // ya pasó el día 10 de este mes, configura DESPUÉS (9 días después)
    await setOrderDays(cookie, 10);

    // Sigue siendo el 15 — el único ciclo <= hoy (día 10 de octubre) es anterior a configurar.
    const res = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(res).toBeNull();
  });

  it("aparece el mismo clienta aviso 'Ya podés entregarle' cuando el pedido resuelve unidades pendientes", async () => {
    const cookie = await createConsultant();
    const product = await (
      await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Pendiente recordatorio", precio: 1000, unidades: 0 })
    ).json();
    const client = await (await api(cookie, "POST", "/api/clients", { name: "Clienta pendiente", phone: "9992345671" })).json();
    const saleRes = await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-10-01",
      items: [{ productId: product.id, quantity: 3 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 3000 }],
    });
    const sale = await saleRes.json();

    let ready = await (await api(cookie, "GET", "/api/deliveries/ready")).json();
    expect(ready.length).toBe(0); // todavía nada listo

    await api(cookie, "PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 3 }] });
    ready = await (await api(cookie, "GET", "/api/deliveries/ready")).json();
    const row = ready.find((r: any) => r.saleId === sale.id);
    expect(row).toBeDefined();
    expect(row.clientName).toBe("Clienta pendiente");
    expect(row.quantity).toBe(3);
  });
});
