// Fuerza UTC (igual que Railway en producción) — así este archivo prueba de verdad que el
// endpoint usa getArgentinaDateStr() y no el reloj del proceso, sin depender de en qué zona
// horaria esté configurada la máquina de quien corre los tests.
process.env.TZ = "UTC";

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Prompt 11 — GET /api/reports/overview. Modo memoria, HTTP real — mismo criterio que
 * sales.test.ts/clients-payments.test.ts.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;
let productId: number;

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function baseSale(overrides: Record<string, unknown> = {}) {
  const installments = (overrides.installments as { amount: number }[] | undefined) ?? [{ amount: 1000 }];
  const total = installments.reduce((sum, i) => sum + i.amount, 0);
  return {
    clientId,
    date: "2026-10-05",
    items: [{ productId, quantity: total }], // precio 1 — la cantidad ES el total, calza siempre
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments,
    paidNow: true,
    firstDueDate: "2026-10-05",
    ...overrides,
  };
}

async function overview(period: string, start: string, end: string) {
  const res = await api("GET", `/api/reports/overview?period=${period}&start=${start}&end=${end}`);
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { storage } = await import("../storage");
  const user = await storage.createUser({
    username: `vitest_overview_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: "vitest-test-password-123" }),
  });
  cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST Overview", phone: "9990007001" });
  clientId = (await clientRes.json()).id;

  const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto overview", precio: 1, unidades: 10_000_000 });
  productId = (await productRes.json()).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/reports/overview — canceladas y borradores no cuentan", () => {
  it("una venta cancelada y un borrador no suman a Vendiste/Ganaste", async () => {
    const before = await overview("custom", "2026-10-01", "2026-10-31");

    await api("POST", "/api/sales", baseSale({ installments: [{ amount: 1000 }] }));
    const cancelSale = await (await api("POST", "/api/sales", baseSale({ installments: [{ amount: 2000 }] }))).json();
    await api("POST", `/api/sales/${cancelSale.id}/cancel`);

    await api("POST", "/api/drafts", {
      clientDraftId: "11111111-1111-1111-1111-111111111111",
      type: "sale",
      payload: {
        formatVersion: 1,
        step: "pago",
        clientId,
        clientName: "Clienta VITEST Overview",
        clientSkipped: false,
        date: "2026-10-05",
        lines: [],
        paymentMethod: "efectivo",
        installmentsCount: 1,
        installmentAmounts: [5000],
        paidNow: true,
        dueDatePreset: "7",
      },
    });

    const after = await overview("custom", "2026-10-01", "2026-10-31");
    // Solo la venta NO cancelada (1000) — ni la cancelada (2000) ni el borrador (5000) cuentan.
    expect(after.totalSales - before.totalSales).toBe(1000);
  });
});

describe("GET /api/reports/overview — pagos parciales", () => {
  it("'Te deben hoy' refleja amount - amountPaid, no el monto bruto de la cuota", async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const before = await overview("custom", "2020-01-01", "2030-01-01");

    const sale = await (
      await api(
        "POST",
        "/api/sales",
        baseSale({ installments: [{ amount: 5000 }], paidNow: false, firstDueDate: todayStr, date: todayStr }),
      )
    ).json();
    void sale;
    await api("POST", `/api/clients/${clientId}/payments`, { amount: 2000, date: todayStr, paymentMethod: "efectivo" });

    const after = await overview("custom", "2020-01-01", "2030-01-01");
    expect(after.pendingBalanceToday - before.pendingBalanceToday).toBe(3000);
  });
});

describe("GET /api/reports/overview — 'Vendiste'/'Ganaste' coinciden con Inicio (sales-summary)", () => {
  it("usa la MISMA fuente que 'Este mes vendiste' de Inicio, no un cálculo paralelo", async () => {
    await api("POST", "/api/sales", baseSale({ installments: [{ amount: 1234 }] }));
    await api("POST", "/api/sales", baseSale({ paymentMethod: "tarjeta", installments: [{ amount: 4321 }] }));

    const overviewResult = await overview("custom", "2026-10-01", "2026-10-31");

    // Mismo endpoint y mismo rango que usa Dashboard.tsx para "Este mes vendiste" (sales-summary,
    // sumando los puntos que devuelve) — si "Vendiste" alguna vez se recalculara distinto acá,
    // este test se rompe.
    const summaryRes = await api("GET", "/api/reports/sales-summary?start=2026-10-01&end=2026-10-31&groupBy=day");
    const summaryPoints = (await summaryRes.json()) as { totalSales: number; totalProfit: number }[];
    const totalSalesFromSummary = summaryPoints.reduce((sum, p) => sum + p.totalSales, 0);
    const totalProfitFromSummary = summaryPoints.reduce((sum, p) => sum + p.totalProfit, 0);

    expect(overviewResult.totalSales).toBe(totalSalesFromSummary);
    expect(overviewResult.totalProfit).toBe(totalProfitFromSummary);
  });
});

describe("GET /api/reports/overview — ventas sin clienta", () => {
  it("cuenta en Vendiste/Ganaste pero no en 'Compra promedio por clienta'", async () => {
    const before = await overview("custom", "2026-10-01", "2026-10-31");

    await api("POST", "/api/sales", baseSale({ clientId: undefined, paymentMethod: "tarjeta", installments: [{ amount: 4000 }] }));

    const after = await overview("custom", "2026-10-01", "2026-10-31");
    expect(after.totalSales - before.totalSales).toBe(4000);
    // La venta sin clienta no suma ninguna clienta nueva al promedio.
    expect(after.distinctClientCount).toBe(before.distinctClientCount);
    expect(after.totalSalesToClients).toBe(before.totalSalesToClients);
  });
});

describe("GET /api/reports/overview — 'Te deben hoy' coincide con Clientas (Pendiente de pago)", () => {
  it("con cuotas pagadas, pendientes, pago parcial, una venta cancelada y una venta sin clienta", async () => {
    const todayStr = new Date().toISOString().slice(0, 10);

    // Pagada entera (paidNow) — no suma a lo pendiente.
    await api("POST", "/api/sales", baseSale({ installments: [{ amount: 1500 }], paidNow: true, date: todayStr }));
    // Pendiente, sin tocar.
    await api("POST", "/api/sales", baseSale({ installments: [{ amount: 2500 }], paidNow: false, firstDueDate: todayStr, date: todayStr }));
    // Pendiente con pago parcial.
    const partialSale = await (
      await api("POST", "/api/sales", baseSale({ installments: [{ amount: 3000 }], paidNow: false, firstDueDate: todayStr, date: todayStr }))
    ).json();
    void partialSale;
    await api("POST", `/api/clients/${clientId}/payments`, { amount: 1000, date: todayStr, paymentMethod: "efectivo" });
    // Cancelada, con una cuota que habría quedado pendiente — no tiene que contar en ningún lado.
    const toCancel = await (
      await api("POST", "/api/sales", baseSale({ installments: [{ amount: 9999 }], paidNow: false, firstDueDate: todayStr, date: todayStr }))
    ).json();
    await api("POST", `/api/sales/${toCancel.id}/cancel`);
    // Sin clienta (tarjeta, pagada entera automáticamente) — no puede tener saldo pendiente,
    // pero tampoco tiene que "perderse" en ningún cálculo.
    await api("POST", "/api/sales", baseSale({ clientId: undefined, paymentMethod: "tarjeta", installments: [{ amount: 6000 }] }));

    const overviewResult = await overview("custom", "2020-01-01", "2030-01-01");

    const clientsRes = await api("GET", "/api/clients?page=1&pageSize=50&filter=pendiente_pago");
    const clientsBody = await clientsRes.json();
    const sumFromClientas = (clientsBody.items as { pendingBalance: number }[]).reduce((sum, c) => sum + c.pendingBalance, 0);

    expect(overviewResult.pendingBalanceToday).toBe(sumFromClientas);
  });
});

describe("GET /api/reports/overview — 'hoy' en hora de Argentina, no UTC del proceso", () => {
  it("23:30 del 31 de marzo en Argentina: el período de comparación no se corre al 1 de abril", async () => {
    vi.useFakeTimers();
    // 23:30 del 31/03 en Argentina (UTC-3) = 02:30 del 01/04 en UTC.
    vi.setSystemTime(new Date("2026-04-01T02:30:00.000Z"));

    const result = await overview("this_month", "2026-03-01", "2026-04-01");

    // Si "hoy" se calculara con el reloj del proceso (UTC, ya 1 de abril), el período de
    // comparación quedaría roto (más días que los que tiene marzo). En hora de Argentina,
    // "hoy" sigue siendo el 31 de marzo — los mismos días contra febrero, que es más corto
    // (28 días en 2026), así que se toma completo.
    expect(result.comparisonPeriod).toEqual({ start: "2026-02-01", end: "2026-03-01", truncated: true });
  });

  it("una venta cargada a las 23:30 del 31/03 (Argentina) cuenta en marzo, no se corre a abril", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T02:30:00.000Z")); // 23:30 del 31/03 en Argentina

    const before = await overview("this_month", "2026-03-01", "2026-04-01");
    // El date de la venta es el que ya elige el navegador (hora local, no el reloj del
    // servidor) — acá se simula directamente con el string que habría guardado esa carga.
    await api("POST", "/api/sales", baseSale({ date: "2026-03-31", installments: [{ amount: 777 }] }));
    const after = await overview("this_month", "2026-03-01", "2026-04-01");

    expect(after.totalSales - before.totalSales).toBe(777);
  });
});
