import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;

async function createConsultant(username: string) {
  const { storage } = await import("../storage");
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  return {
    consultantId: user.consultantId!,
    api: async (method: string, path: string, body?: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
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

describe("Prompt 2 — Costo promedio ponderado al confirmar un pedido", () => {
  it("2 unidades a $14.960 y 3 a $16.320 (mismo producto, dos pedidos) quedan con costo $15.776", async () => {
    const { api } = await createConsultant(`vitest_cost_${Date.now()}`);

    const productRes = await api("POST", "/api/products", {
      seccion: "VITEST",
      producto: "Base TimeWise 3D",
      precio: 27200,
      unidades: 0,
    });
    const productId = (await productRes.json()).id;

    // Pedido 1: 2 unidades al 45% -> costo unitario 27200*0.55 = 14960.
    const first = await api("PATCH", "/api/products/stock/increment-batch", {
      lines: [{ productId, delta: 2 }],
      discountPercent: 45,
    });
    expect(first.status).toBe(200);

    // Pedido 2: 3 unidades al 40% -> costo unitario 27200*0.60 = 16320.
    const second = await api("PATCH", "/api/products/stock/increment-batch", {
      lines: [{ productId, delta: 3 }],
      discountPercent: 40,
    });
    expect(second.status).toBe(200);

    const products = await (await api("GET", "/api/products")).json();
    const product = products.find((p: any) => p.id === productId);
    expect(product.unidades).toBe(5);
    expect(product.costPrice).toBe(15776); // (2*14960 + 3*16320) / 5
    expect(product.selectedDiscount).toBe(40); // el último descuento elegido
  });

  it("sin costo previo o con 0 unidades, el costo nuevo es directamente el de esta compra (nunca un promedio)", async () => {
    const { api } = await createConsultant(`vitest_cost_fresh_${Date.now()}`);
    const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto nuevo", precio: 10000, unidades: 0 });
    const productId = (await productRes.json()).id;

    const res = await api("PATCH", "/api/products/stock/increment-batch", {
      lines: [{ productId, delta: 4 }],
      discountPercent: 35,
    });
    expect(res.status).toBe(200);

    const products = await (await api("GET", "/api/products")).json();
    const product = products.find((p: any) => p.id === productId);
    expect(product.costPrice).toBe(6500); // 10000 * 0.65, sin mezclar con nada previo
  });

  it("un batch sin discountPercent (corrección manual de stock) no toca el costo existente", async () => {
    const { api } = await createConsultant(`vitest_cost_notouch_${Date.now()}`);
    const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto", precio: 10000, unidades: 0 });
    const productId = (await productRes.json()).id;
    await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 35 }); // costPrice = 6500

    const res = await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId, delta: 2 }] });
    expect(res.status).toBe(200);

    const products = await (await api("GET", "/api/products")).json();
    const product = products.find((p: any) => p.id === productId);
    expect(product.costPrice).toBe(6500); // sin cambios
    expect(product.unidades).toBe(2);
  });
});

describe("Prompt 2 — la venta usa el costo del momento y no cambia después", () => {
  it("se vende al costo $15.776 vigente, y un pedido posterior no altera esa venta ya confirmada", async () => {
    const { api } = await createConsultant(`vitest_freeze_${Date.now()}`);
    const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Base TimeWise 3D", precio: 27200, unidades: 0 });
    const productId = (await productRes.json()).id;

    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId, delta: 2 }], discountPercent: 45 });
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId, delta: 3 }], discountPercent: 40 });
    // costPrice ahora es 15776 (ver test de arriba).

    const clientRes = await api("POST", "/api/clients", { name: "Clienta freeze", phone: "9990001111" });
    const clientId = (await clientRes.json()).id;

    const saleRes = await api("POST", "/api/sales", {
      clientId,
      date: "2026-10-06",
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 27200 }],
      status: "pendiente",
    });
    expect(saleRes.status).toBe(201);
    const sale = await saleRes.json();
    expect(sale.profit).toBe(27200 - 15776);

    // Llega un pedido nuevo con un descuento bien distinto: el costo del producto cambia...
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId, delta: 10 }], discountPercent: 45 });
    const productsAfter = await (await api("GET", "/api/products")).json();
    const productAfter = productsAfter.find((p: any) => p.id === productId);
    expect(productAfter.costPrice).not.toBe(15776);

    // ...pero la venta ya confirmada queda exactamente como estaba.
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].costPrice).toBe(15776);
    expect(detail.profit).toBe(27200 - 15776);
  });
});

describe("Prompt 2 — Ingresos Brutos por porcentaje", () => {
  it("venta $20.000, costo $12.000, sin envío, IIBB 3% -> ganancia $7.400", async () => {
    const { api } = await createConsultant(`vitest_iibb_${Date.now()}`);

    const settings = await (await api("GET", "/api/business-settings")).json();
    await api("PATCH", "/api/business-settings", {
      businessName: settings.businessName,
      currency: settings.currency,
      grossIncomeTaxPercentTenths: 30, // 3.0%
    });

    const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto IIBB", precio: 20000, unidades: 1 });
    const productId = (await productRes.json()).id;
    await api("PATCH", `/api/products/${productId}/stock`, { unidades: 1 });
    // Costo real cargado a mano: 12000 (sin pasar por el % de descuento).
    await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 40 }); // 20000*0.6=12000

    const clientRes = await api("POST", "/api/clients", { name: "Clienta IIBB", phone: "9990002222" });
    const clientId = (await clientRes.json()).id;

    const saleRes = await api("POST", "/api/sales", {
      clientId,
      date: "2026-10-06",
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 20000 }],
      status: "pendiente",
    });
    expect(saleRes.status).toBe(201);
    const sale = await saleRes.json();
    expect(sale.total).toBe(20000);
    expect(sale.ingresosBrutos).toBe(600); // 20000 * 3%
    expect(sale.profit).toBe(7400); // 20000 - 12000 - 0(envío) - 600(IIBB)
  });
});

describe("Prompt 2 — nunca más 'Ganancia $0' por falta de costo, y se corrige cuando el costo llega", () => {
  it("vender sin costo nunca da ganancia $0, y un pedido posterior con costo real corrige la venta vieja estimada", async () => {
    const { api } = await createConsultant(`vitest_recalc_${Date.now()}`);
    const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Sin costo", precio: 10000, unidades: 5 });
    const productId = (await productRes.json()).id;
    // Nunca se le aplica /discount -> costPrice queda NULL.

    const clientRes = await api("POST", "/api/clients", { name: "Clienta recalc", phone: "9990003333" });
    const clientId = (await clientRes.json()).id;

    const saleRes = await api("POST", "/api/sales", {
      clientId,
      date: "2026-10-06",
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 10000 }],
      status: "pendiente",
    });
    expect(saleRes.status).toBe(201);
    const sale = await saleRes.json();
    // Sin pedidos nunca -> descuento habitual 35% -> costo estimado 6500 -> ganancia 3500 (nunca $0).
    expect(sale.profit).toBe(3500);
    expect(sale.profit).not.toBe(0);

    const beforeDetail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(beforeDetail.items[0].costIsEstimated).toBe(true);
    expect(beforeDetail.items[0].costPrice).toBe(6500);

    // Llega el primer pedido real de este producto: costo real = 10000*0.55 = 5500 (45%).
    const orderRes = await api("PATCH", "/api/products/stock/increment-batch", {
      lines: [{ productId, delta: 10 }],
      discountPercent: 45,
    });
    expect(orderRes.status).toBe(200);

    // La venta vieja se corrige sola: deja de ser estimada y pasa a usar el costo real.
    const afterDetail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(afterDetail.items[0].costIsEstimated).toBe(false);
    expect(afterDetail.items[0].costPrice).toBe(5500);
    expect(afterDetail.profit).toBe(4500); // 10000 - 5500
  });
});

describe("Prompt 2 — dato para el aviso de Inicio (productos sin costo cargado)", () => {
  it("cuenta solo productos CON unidades y sin costPrice", async () => {
    const { api } = await createConsultant(`vitest_withoutcost_${Date.now()}`);

    const a = await (await api("POST", "/api/products", { seccion: "VITEST", producto: "A", precio: 1000, unidades: 3 })).json();
    const b = await (await api("POST", "/api/products", { seccion: "VITEST", producto: "B", precio: 1000, unidades: 0 })).json(); // sin unidades, no cuenta
    const c = await (await api("POST", "/api/products", { seccion: "VITEST", producto: "C", precio: 1000, unidades: 2 })).json();
    await api("PATCH", `/api/products/${c.id}/discount`, { discountPercent: 35 }); // con costo, no cuenta

    const res = await api("GET", "/api/products/without-cost-count");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1); // solo "A"
  });
});
