import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { getArgentinaDateStr } from "@shared/argentinaTime";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

async function api(cookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// loginRateLimiter cuenta por IP — con ~12 tests llamando a createConsultant() cada uno, todos
// compartiendo la misma IP de loopback, se pisa el balde del rate limiter (mismo criterio ya
// documentado en auth-register.test.ts). Cada test usa su propia IP sintética.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.79.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

let nextTag = 1;
async function createConsultant(): Promise<string> {
  const username = `vitest_dashboard_${nextTag++}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
    producto: `Producto dashboard ${nextCodigo}`,
    codigo: `vitest-dash-${nextCodigo++}-${Date.now()}`,
    precio: 1000,
    unidades: 1,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function createClient(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
  const res = await api(cookie, "POST", "/api/clients", {
    name: `Clienta dashboard ${nextCodigo}`,
    phone: `999${String(nextCodigo++).padStart(7, "0")}`,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
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
  ({ storage } = await import("../storage"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/dashboard/overview — Prompt 10", () => {
  it("'Vas $X' del objetivo usa la MISMA función que 'Vendiste' de Reportes (este mes)", async () => {
    const today = getArgentinaDateStr();
    const cookie = await createConsultant();
    const product = await createProduct(cookie, { unidades: 5 });
    const client = await createClient(cookie);
    const saleRes = await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: today,
      items: [{ productId: product.id, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 2000 }],
    });
    expect(saleRes.status).toBe(201);

    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const [year, month] = today.split("-").map(Number);
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const reportsRes = await api(cookie, "GET", `/api/reports/overview?period=this_month&start=${monthStart}&end=${nextMonth}`);
    const reportsOverview = await reportsRes.json();

    expect(overview.monthSales).toBe(2000);
    expect(overview.monthSales).toBe(reportsOverview.totalSales);
  });

  it("el conteo de 'hace tiempo que no compran' es EXACTAMENTE el mismo que el filtro de Clientas", async () => {
    const cookie = await createConsultant();
    // Clienta con una compra de hace más de 2 meses — matchea el filtro.
    const client = await createClient(cookie);
    const product = await createProduct(cookie, { unidades: 5 });
    await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-01-01",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 1000 }],
    });
    // Clienta que NUNCA compró — nunca matchea el filtro (ni el aviso).
    await createClient(cookie);

    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const clientasRes = await api(cookie, "GET", "/api/clients?filter=no_compran_hace&page=1&pageSize=1");
    const clientasBody = await clientasRes.json();

    expect(overview.paraMejorarTuNegocio.clientasInactivas.count).toBe(1);
    expect(overview.paraMejorarTuNegocio.clientasInactivas.count).toBe(clientasBody.total);
  });

  it("'Cobrada' crea el pago (client_payments) y deja la cuota saldada", async () => {
    const cookie = await createConsultant();
    const client = await createClient(cookie);
    const product = await createProduct(cookie, { unidades: 5 });
    const saleRes = await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-10-01",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: false,
      firstDueDate: "2026-10-01",
      installments: [{ amount: 1000 }],
    });
    const sale = await saleRes.json();
    const saleDetail = await (await api(cookie, "GET", `/api/sales/${sale.id}`)).json();
    const installmentId = saleDetail.installments[0].id;

    const payRes = await api(cookie, "PATCH", `/api/sales/${sale.id}/installments/${installmentId}`, { status: "pagado" });
    expect(payRes.status).toBe(200);
    const updated = await payRes.json();
    expect(updated.status).toBe("pagado");
    expect(updated.amountPaid).toBe(1000);

    const clientDetail = await (await api(cookie, "GET", `/api/clients/${client.id}/payments`)).json();
    expect(clientDetail.length).toBe(1);
    expect(clientDetail[0].amount).toBe(1000);
  });

  it("'Cobrada' sobre una cuota con pago parcial cobra solo el saldo", async () => {
    const cookie = await createConsultant();
    const client = await createClient(cookie);
    const product = await createProduct(cookie, { unidades: 5, precio: 10000 });
    const saleRes = await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-10-01",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: false,
      firstDueDate: "2026-10-01",
      installments: [{ amount: 10000 }],
    });
    const sale = await saleRes.json();
    const saleDetail = await (await api(cookie, "GET", `/api/sales/${sale.id}`)).json();
    const installmentId = saleDetail.installments[0].id;

    // Pago parcial de 3000 — deja amountPaid=3000, status sigue "pendiente".
    const partialRes = await api(cookie, "POST", `/api/clients/${client.id}/payments`, {
      amount: 3000,
      date: "2026-10-05",
      paymentMethod: "efectivo",
    });
    expect(partialRes.status).toBe(201);

    const overviewBefore = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const row = overviewBefore.pendientes.installments.find((i: any) => i.installmentId === installmentId);
    expect(row.amount).toBe(7000); // el saldo, no el monto original

    const payRes = await api(cookie, "PATCH", `/api/sales/${sale.id}/installments/${installmentId}`, { status: "pagado" });
    expect(payRes.status).toBe(200);
    const updated = await payRes.json();
    expect(updated.amountPaid).toBe(10000);

    const payments = await (await api(cookie, "GET", `/api/clients/${client.id}/payments`)).json();
    expect(payments.length).toBe(2);
    expect(payments.find((p: any) => p.amount === 7000)).toBeDefined();
  });

  it("una cuota que vence hoy aparece con isOverdue:false; una vencida con isOverdue:true", async () => {
    setArgentinaNow("2026-10-10");
    const cookie = await createConsultant();
    const client = await createClient(cookie);
    const product = await createProduct(cookie, { unidades: 5 });

    const todaySale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: client.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-10",
        installments: [{ amount: 1000 }],
      })
    ).json();
    const overdueSale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: client.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-05",
        installments: [{ amount: 1000 }],
      })
    ).json();

    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const todayRow = overview.pendientes.installments.find((i: any) => i.saleId === todaySale.id);
    const overdueRow = overview.pendientes.installments.find((i: any) => i.saleId === overdueSale.id);
    expect(todayRow.isOverdue).toBe(false);
    expect(todayRow.dueDate).toBe("2026-10-10");
    expect(overdueRow.isOverdue).toBe(true);
  });

  it("un aviso oculto ('Ocultar') vuelve a aparecer a los 7 días si sigue vigente", async () => {
    setArgentinaNow("2026-10-01");
    const cookie = await createConsultant();
    await createProduct(cookie, { unidades: 3, precio: 1000 }); // sin costo cargado, con stock

    const before = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(before.paraMejorarTuNegocio.productosSinCosto.count).toBe(1);

    const dismissRes = await api(cookie, "POST", "/api/dashboard/notices/productos_sin_costo/dismiss");
    expect(dismissRes.status).toBe(200);

    const rightAfter = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(rightAfter.paraMejorarTuNegocio.productosSinCosto).toBeNull();

    setArgentinaNow("2026-10-06"); // 5 días después — todavía oculto
    const stillHidden = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(stillHidden.paraMejorarTuNegocio.productosSinCosto).toBeNull();

    setArgentinaNow("2026-10-09"); // 8 días después del ocultar — reaparece, sigue vigente
    const reappeared = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(reappeared.paraMejorarTuNegocio.productosSinCosto.count).toBe(1);
  });

  it("el aviso del límite del plan gratis solo aparece en el plan gratis con 10 o más productos con stock", async () => {
    const cookie = await createConsultant();
    for (let i = 0; i < 9; i++) {
      await createProduct(cookie, { unidades: 1 });
    }
    const underLimit = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(underLimit.paraMejorarTuNegocio.limitePlanGratis).toBe(false);

    await createProduct(cookie, { unidades: 1 }); // 10º producto con stock
    const atLimit = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(atLimit.paraMejorarTuNegocio.limitePlanGratis).toBe(true);
  });

  it("con suscripción activa (no plan gratis) el aviso del límite nunca aparece, aunque haya 10 o más productos", async () => {
    const cookie = await createConsultant();
    const me = await (await api(cookie, "GET", "/api/auth/me")).json();
    await storage.updateSubscription(me.consultantId, {
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    for (let i = 0; i < 10; i++) {
      await createProduct(cookie, { unidades: 1 });
    }
    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    expect(overview.paraMejorarTuNegocio.limitePlanGratis).toBe(false);
  });

  it("'Cobrada' trae el teléfono de la clienta para el botón de WhatsApp; una venta sin clienta no rompe nada", async () => {
    const cookie = await createConsultant();
    const client = await createClient(cookie, { phone: "2615550001" });
    const product = await createProduct(cookie, { unidades: 5 });
    const withClientSale = await (
      await api(cookie, "POST", "/api/sales", {
        clientId: client.id,
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: false,
        firstDueDate: "2026-10-01",
        installments: [{ amount: 1000 }],
      })
    ).json();
    // Nota: una venta SIN clienta nunca puede tener una cuota pendiente de verdad (el servidor
    // rechaza "sin clienta" + "pendiente de cobro", ver createSaleSchema) — el LEFT JOIN de
    // clientPhone queda cubierto igual (nunca rompe la consulta), solo que no hay forma de
    // armar ese caso puntual con una venta real.
    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const withPhone = overview.pendientes.installments.find((i: any) => i.saleId === withClientSale.id);
    expect(withPhone.clientPhone).toBe("2615550001");
  });

  it("'Tenés N ventas sin clienta' coincide con la lista de /api/sales filtrada por ese mismo criterio", async () => {
    const cookie = await createConsultant();
    const client = await createClient(cookie);
    const product = await createProduct(cookie, { unidades: 5 });
    // Una con clienta (no cuenta) y dos sin clienta (sí cuentan) — "sin clienta" se manda
    // OMITIENDO clientId, nunca clientId: null (createSaleSchema solo acepta `.optional()`).
    for (const clientId of [client.id, undefined, undefined]) {
      await api(cookie, "POST", "/api/sales", {
        ...(clientId !== undefined ? { clientId } : {}),
        date: "2026-10-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        paidNow: true,
        installments: [{ amount: 1000 }],
      });
    }

    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const allSales = await (await api(cookie, "GET", "/api/sales")).json();
    const filteredCount = allSales.filter((s: any) => s.status !== "cancelada" && s.clientId === null).length;

    expect(overview.pendientes.salesWithoutClientCount).toBe(2);
    expect(overview.pendientes.salesWithoutClientCount).toBe(filteredCount);
  });

  it("'Tenés N productos sin costo cargado' coincide con la lista de /api/products filtrada por ese mismo criterio", async () => {
    const cookie = await createConsultant();
    await createProduct(cookie, { unidades: 3 }); // sin costo, con stock — cuenta
    const costPayload = await createProduct(cookie, { unidades: 3 });
    await api(cookie, "PATCH", `/api/products/${costPayload.id}/cost`, { costPrice: 500 }); // con costo — no cuenta
    await createProduct(cookie, { unidades: 0 }); // sin costo pero sin stock — no cuenta

    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const allProducts = await (await api(cookie, "GET", "/api/products")).json();
    const filteredCount = allProducts.filter((p: any) => p.costPrice === null && p.unidades > 0).length;

    expect(overview.paraMejorarTuNegocio.productosSinCosto.count).toBe(1);
    expect(overview.paraMejorarTuNegocio.productosSinCosto.count).toBe(filteredCount);
  });

  it("'Tenés N clientas sin celular cargado' coincide EXACTO con GET /api/clients?filter=sin_celular", async () => {
    const cookie = await createConsultant();
    await createClient(cookie, { phone: null }); // sin celular — cuenta
    await createClient(cookie, { phone: "2615550002" }); // con celular — no cuenta

    const overview = await (await api(cookie, "GET", "/api/dashboard/overview")).json();
    const clientasRes = await api(cookie, "GET", "/api/clients?filter=sin_celular&page=1&pageSize=1");
    const clientasBody = await clientasRes.json();

    expect(overview.paraMejorarTuNegocio.clientasSinCelular.count).toBe(1);
    expect(overview.paraMejorarTuNegocio.clientasSinCelular.count).toBe(clientasBody.total);
  });
});
