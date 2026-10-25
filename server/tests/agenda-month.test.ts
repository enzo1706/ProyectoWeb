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

// Mismo criterio que dashboard-overview.test.ts/order-reminder.test.ts: loginRateLimiter cuenta
// por IP, cada test usa la suya para no pisar el balde de otro.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.80.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

let nextTag = 1;
async function createConsultant(): Promise<string> {
  const { storage } = await import("../storage");
  const username = `vitest_agenda_${nextTag++}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextTestIp() },
    body: JSON.stringify({ identifier: username, password: "vitest-test-password-123" }),
  });
  return loginRes.headers.get("set-cookie")!.split(";")[0];
}

let nextCodigo = 1;
async function createProduct(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
  const res = await api(cookie, "POST", "/api/products", {
    seccion: "VITEST",
    producto: `Producto agenda ${nextCodigo}`,
    codigo: `vitest-agenda-${nextCodigo++}-${Date.now()}`,
    precio: 1000,
    unidades: 5,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function createClient(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
  const res = await api(cookie, "POST", "/api/clients", {
    name: `Clienta agenda ${nextCodigo}`,
    phone: `998${String(nextCodigo++).padStart(7, "0")}`,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
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

function setArgentinaNow(dateStr: string) {
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

describe("GET /api/agenda/month — Prompt 12", () => {
  it("cobros del mes: vencida, con pago parcial (monto = saldo) y pagada (no aparece)", async () => {
    setArgentinaNow("2026-10-15");
    const cookie = await createConsultant();
    // Una clienta por venta: evita que el pago parcial se asigne por FIFO a la cuota
    // equivocada cuando una misma clienta tiene más de una cuota pendiente.
    const clientOverdue = await createClient(cookie, { phone: "2615551111" });
    const clientPartial = await createClient(cookie);
    const clientPaid = await createClient(cookie);
    const product = await createProduct(cookie, { precio: 10000 });

    // Vencida: vence el 10, hoy es el 15. La cuota es el precio completo (10000), nunca pagada.
    const overdueSale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: clientOverdue.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-10",
        installments: [{ amount: 10000 }],
      })
    ).json();

    // Con pago parcial: vence el 20, saldo 7000 de 10000.
    const partialSale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: clientPartial.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-20",
        installments: [{ amount: 10000 }],
      })
    ).json();
    await api(cookie, "POST", `/api/clients/${clientPartial.id}/payments`, { amount: 3000, date: "2026-10-16", paymentMethod: "efectivo" });

    // Pagada del todo: vence el 25, no debería aparecer en absoluto.
    const paidSale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: clientPaid.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-25",
        installments: [{ amount: 10000 }],
      })
    ).json();
    const paidDetail = await (await api(cookie, "GET", `/api/sales/${paidSale.id}`)).json();
    await api(cookie, "PATCH", `/api/sales/${paidSale.id}/installments/${paidDetail.installments[0].id}`, { status: "pagado" });

    const month = await (await api(cookie, "GET", "/api/agenda/month?start=2026-10-01&end=2026-11-01")).json();

    const overdueRow = month.cobros.find((c: any) => c.saleId === overdueSale.id);
    expect(overdueRow.isOverdue).toBe(true);
    expect(overdueRow.amount).toBe(10000);
    expect(overdueRow.clientPhone).toBe("2615551111");

    const partialRow = month.cobros.find((c: any) => c.saleId === partialSale.id);
    expect(partialRow.isOverdue).toBe(false);
    expect(partialRow.amount).toBe(7000); // el saldo, no el monto original

    expect(month.cobros.find((c: any) => c.saleId === paidSale.id)).toBeUndefined();
  });

  it("una cuota de una venta cancelada no aparece entre los cobros del mes", async () => {
    setArgentinaNow("2026-10-05");
    const cookie = await createConsultant();
    const client = await createClient(cookie);
    const product = await createProduct(cookie);
    const sale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: client.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-20",
        installments: [{ amount: 1000 }],
      })
    ).json();
    const cancelRes = await api(cookie, "POST", `/api/sales/${sale.id}/cancel`);
    expect(cancelRes.status).toBe(200);

    const month = await (await api(cookie, "GET", "/api/agenda/month?start=2026-10-01&end=2026-11-01")).json();
    expect(month.cobros.find((c: any) => c.saleId === sale.id)).toBeUndefined();
  });

  it("cumpleaños del 29 de febrero se muestra el 28 en un año no bisiesto", async () => {
    setArgentinaNow("2026-02-01"); // 2026 no es bisiesto
    const cookie = await createConsultant();
    const client = await createClient(cookie, { birthday: "2000-02-29" }); // 2000 sí fue bisiesto, fecha válida para guardar

    const month = await (await api(cookie, "GET", "/api/agenda/month?start=2026-02-01&end=2026-03-01")).json();
    const row = month.cumpleanos.find((b: any) => b.clientId === client.id);
    expect(row).toBeDefined();
    expect(row.day).toBe(28);
  });

  it("sin recordatorio abierto, el PRÓXIMO día de pedido igual trae una lista en vivo (sin guardar ninguna fila)", async () => {
    // Configurado el 15 de septiembre (ANTES del ciclo del 20 de septiembre, que es el último
    // día de pedido ya pasado respecto de "hoy" = 15 de octubre) para que el ciclo sea válido.
    setArgentinaNow("2026-09-15");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 20);
    const product = await createProduct(cookie, { unidades: 5 });
    const client = await createClient(cookie);
    // Vendido DESPUÉS del último día de pedido (20/9) y ANTES de hoy (15/10).
    await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-10-01",
      items: [{ productId: product.id, quantity: 5 }], // deja el producto en 0 — "poco stock"
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 5000 }],
    });

    // La sesión es "rolling" de 10 días (Prompt 13): el salto de 15/9 a 15/10 se hace en pasos
    // de ≤9 días, cada uno con una llamada autenticada, para no expirarla a mitad del test
    // (mismo criterio que server/tests/order-reminder.test.ts).
    for (const next of ["2026-09-24", "2026-10-03", "2026-10-12"]) {
      setArgentinaNow(next);
      await api(cookie, "GET", "/api/business-settings");
    }
    setArgentinaNow("2026-10-15"); // antes del día 20 — no hay recordatorio real abierto todavía
    const openReminder = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(openReminder).toBeNull();

    const month = await (await api(cookie, "GET", "/api/agenda/month?start=2026-10-01&end=2026-11-01")).json();
    const orderDay20 = month.diasDePedido.find((d: any) => d.date === "2026-10-20");
    expect(orderDay20.kind).toBe("preview");
    const item = orderDay20.items.find((i: any) => i.productId === product.id);
    expect(item).toBeDefined();
    expect(item.soldInPeriod).toBe(5);

    // Sigue sin existir ninguna fila real todavía — es puramente una proyección en vivo.
    const stillNull = await (await api(cookie, "GET", "/api/order-reminder")).json();
    expect(stillNull).toBeNull();
  });

  it("cita sin clienta: se puede crear y vuelve con clientId null y clientName vacío", async () => {
    const cookie = await createConsultant();
    const res = await api(cookie, "POST", "/api/appointments", {
      date: "2026-10-15",
      time: "15:00",
      type: "visita",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.clientId).toBeNull();
    expect(created.clientName).toBe("");

    const month = await (await api(cookie, "GET", "/api/agenda/month?start=2026-10-01&end=2026-11-01")).json();
    const row = month.appointments.find((a: any) => a.id === created.id);
    expect(row).toBeDefined();
    expect(row.clientId).toBeNull();
  });

  it("el contador de citas cuenta solo lo cargado a mano: cobros/cumpleaños/días de pedido viven en listas separadas, nunca mezclados en 'appointments'", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await setOrderDays(cookie, 20);
    const client = await createClient(cookie, { birthday: "1990-10-12" });
    const product = await createProduct(cookie);
    await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-10-01",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: false,
      firstDueDate: "2026-10-18",
      installments: [{ amount: 1000 }],
    });
    await api(cookie, "POST", "/api/appointments", { date: "2026-10-15", time: "10:00", type: "visita" });

    const month = await (await api(cookie, "GET", "/api/agenda/month?start=2026-10-01&end=2026-11-01")).json();
    expect(month.appointments.length).toBe(1); // solo la cita cargada a mano
    expect(month.cobros.length).toBeGreaterThan(0);
    expect(month.cumpleanos.length).toBeGreaterThan(0);
    expect(month.diasDePedido.length).toBeGreaterThan(0);
  });
});
