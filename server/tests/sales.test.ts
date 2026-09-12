import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;
let productId: number; // precio 1000, unidades 20

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function baseSale(overrides: Record<string, unknown> = {}) {
  return {
    clientId,
    date: "2026-09-03",
    items: [{ productId, quantity: 2 }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments: [{ amount: 2000 }],
    status: "pendiente",
    ...overrides,
  };
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
    username: `vitest_sales_${Date.now()}`,
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

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST Sales", phone: "9990000003" });
  clientId = (await clientRes.json()).id;

  const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto para ventas", precio: 1000, unidades: 20 });
  productId = (await productRes.json()).id;

  // costPrice = 600 (descuento de compra 40% sobre el precio 1000) — mismos números que los
  // ejemplos numéricos de la Etapa I-B.7-D-C, para poder reusarlos tal cual en los tests de
  // profit de más abajo.
  await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 40 });
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("POST /api/sales — creación", () => {
  it("happy path: calcula subtotal/total, persiste saleItems y cuotas, descuenta stock", async () => {
    const before = await (await api("GET", "/api/products")).json();
    const stockBefore = before.find((p: any) => p.id === productId).unidades;

    const res = await api("POST", "/api/sales", baseSale());
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.subtotal).toBe(2000); // 1000 * 2
    expect(sale.total).toBe(2000);
    expect(sale.status).toBe("pendiente");

    const detailRes = await api("GET", `/api/sales/${sale.id}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].productId).toBe(productId);
    expect(detail.items[0].quantity).toBe(2);
    expect(detail.installments).toHaveLength(1);
    expect(detail.installments[0].amount).toBe(2000);
    expect(detail.installments[0].status).toBe("pendiente");

    const after = await (await api("GET", "/api/products")).json();
    const stockAfter = after.find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore - 2);
  });

  it("aplica descuento de orden y lo refleja en el total", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ orderDiscount: { type: "percent", value: 10 }, items: [{ productId, quantity: 1 }], installments: [{ amount: 900 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.subtotal).toBe(1000);
    expect(sale.total).toBe(900); // 1000 - 10%
  });

  it("rechaza sin persistir ni descontar stock: stock insuficiente", async () => {
    const before = await (await api("GET", "/api/products")).json();
    const stockBefore = before.find((p: any) => p.id === productId).unidades;

    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId, quantity: 999 }], installments: [{ amount: 999000 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/stock insuficiente/i);

    const after = await (await api("GET", "/api/products")).json();
    expect(after.find((p: any) => p.id === productId).unidades).toBe(stockBefore);
  });

  it("rechaza sin persistir: producto inexistente", async () => {
    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId: 999999, quantity: 1 }], installments: [{ amount: 1000 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no encontrado/i);
  });

  it("rechaza sin persistir: cliente inexistente", async () => {
    const res = await api("POST", "/api/sales", baseSale({ clientId: 999999 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/clienta no encontrada/i);
  });

  it("rechaza sin persistir: cuotas que no suman el total", async () => {
    const res = await api("POST", "/api/sales", baseSale({ installments: [{ amount: 500 }] })); // total real es 2000
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cuotas no coincide/i);
  });

  it("rechaza sin persistir: payload inválido (items vacío)", async () => {
    const res = await api("POST", "/api/sales", baseSale({ items: [] }));
    expect(res.status).toBe(400);
  });

  it("rechaza sin persistir: cantidad negativa", async () => {
    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId, quantity: -1 }] }));
    expect(res.status).toBe(400);
  });

  it("rechaza sin persistir: body vacío", async () => {
    const res = await api("POST", "/api/sales", {});
    expect(res.status).toBe(400);
  });
});

describe("Validación de porcentaje en orderDiscount/orderSurcharge — hardening post-I-B.8-F", () => {
  // Reset a un valor generoso, mismo criterio que "Ganancia" más abajo — no depender del
  // remanente que dejan los tests de creación de arriba.
  beforeAll(async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 100 });
    expect(res.status).toBe(200);
  });

  it("acepta 0% como descuento válido", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderDiscount: { type: "percent", value: 0 }, installments: [{ amount: 1000 }] }),
    );
    expect(res.status).toBe(201);
  });

  it("acepta un porcentaje normal (50%)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderDiscount: { type: "percent", value: 50 }, installments: [{ amount: 500 }] }),
    );
    expect(res.status).toBe(201);
  });

  it("acepta exactamente 100% (borde superior)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderDiscount: { type: "percent", value: 100 }, installments: [{ amount: 0 }] }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).total).toBe(0);
  });

  it("rechaza un descuento >100% sin persistir (antes pasaba y dejaba el total en $0 en silencio, sin avisar del error de carga)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderDiscount: { type: "percent", value: 150 }, installments: [{ amount: 0 }] }),
    );
    expect(res.status).toBe(400);
  });

  it("rechaza un recargo >100% también", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderSurcharge: { type: "percent", value: 101 }, installments: [{ amount: 2000 }] }),
    );
    expect(res.status).toBe(400);
  });

  it("un porcentaje negativo sigue rechazándose (comportamiento previo, sin cambios)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderDiscount: { type: "percent", value: -10 }, installments: [{ amount: 1000 }] }),
    );
    expect(res.status).toBe(400);
  });

  it("un descuento 'fixed' mayor a 100 sigue siendo válido — el límite de 100 es exclusivo de 'percent'", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 5 }], orderDiscount: { type: "fixed", value: 500 }, installments: [{ amount: 4500 }] }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).total).toBe(4500); // 5000 - 500
  });

  it("orderDiscount/orderSurcharge ausentes (null) siguen siendo válidos — el campo sigue opcional", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], orderDiscount: null, orderSurcharge: null, installments: [{ amount: 1000 }] }),
    );
    expect(res.status).toBe(201);
  });
});

describe("Ganancia (profit) — Etapa I-B.7-D-C", () => {
  // Producto compartido con costPrice=600 (ver beforeAll principal) — mismos números que los
  // ejemplos numéricos de la etapa. Reset de stock a un valor generoso, igual patrón que
  // I-B.7-B, para no depender del remanente acumulado del resto de la suite.
  beforeAll(async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 100 });
    expect(res.status).toBe(200);
  });

  it("Test 8 — shippingCharged/shippingCost negativos se rechazan (400), no crean venta", async () => {
    const res1 = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }], shippingCharged: -1 }),
    );
    expect(res1.status).toBe(400);

    const res2 = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }], shippingCost: -1 }),
    );
    expect(res2.status).toBe(400);
  });

  it("createSale: profit persiste correctamente con descuento + recargo + envío cobrado + costo real de envío", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        items: [{ productId, quantity: 1 }],
        orderDiscount: { type: "percent", value: 20 },
        orderSurcharge: { type: "percent", value: 10 },
        shippingCharged: 200,
        shippingCost: 120,
        installments: [{ amount: 1100 }],
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.subtotal).toBe(1000);
    expect(sale.total).toBe(1100); // 1000 - 200 + 100 + 200
    expect(sale.profit).toBe(380); // 1100 - 600(costo) - 120(costo real de envío)
    expect(sale.shippingCharged).toBe(200);
    expect(sale.shippingCost).toBe(120);
  });

  it("createSale: shippingCost null (no informado) no se inventa — profit no lo descuenta", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], shippingCharged: 200, installments: [{ amount: 1200 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.total).toBe(1200);
    expect(sale.profit).toBe(600); // 1200 - 600 - 0 (shippingCost null)
    expect(sale.shippingCost).toBeNull();
  });

  it("updateSale: cada cambio (descuento/recargo/shippingCharged/shippingCost) recalcula profit correctamente, sin romper la regla de cuotas pagadas de I-B.7-B", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }),
    );
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();
    expect(sale.profit).toBe(400); // sin ajustes: 1000 - 600

    const r1 = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: { type: "percent", value: 20 },
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 800 }],
    });
    expect(r1.status).toBe(200);
    expect((await r1.json()).profit).toBe(200); // 800 - 600

    const r2 = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: { type: "percent", value: 10 },
      paymentMethod: "efectivo",
      installments: [{ amount: 1100 }],
    });
    expect(r2.status).toBe(200);
    expect((await r2.json()).profit).toBe(500); // 1100 - 600

    const r3 = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      shippingCharged: 300,
      paymentMethod: "efectivo",
      installments: [{ amount: 1300 }],
    });
    expect(r3.status).toBe(200);
    const afterR3 = await r3.json();
    expect(afterR3.total).toBe(1300);
    expect(afterR3.profit).toBe(700); // 1300 - 600 - 0 (shippingCost todavía no informado en esta edición)

    const r4 = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      shippingCharged: 300,
      shippingCost: 150,
      paymentMethod: "efectivo",
      installments: [{ amount: 1300 }],
    });
    expect(r4.status).toBe(200);
    expect((await r4.json()).profit).toBe(550); // 1300 - 600 - 150

    // Sigue en pie la regla de I-B.7-B: si esta venta tuviera una cuota pagada, este mismo
    // PATCH tendría que rechazarse — no repetido acá en detalle (ya cubierto en su propio
    // describe), solo se confirma que esta venta editable sigue siéndolo.
    expect(r4.status).not.toBe(400);
  });
});

describe("Ingresos Brutos — Etapa 4", () => {
  // Mismo producto compartido (costPrice=600) — mismo criterio de reset de stock que los
  // demás describe de este archivo, para no depender del remanente acumulado.
  beforeAll(async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 100 });
    expect(res.status).toBe(200);
  });

  it("1. venta sin Ingresos Brutos ni envío: queda null, profit sin descontar nada extra", async () => {
    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }));
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.ingresosBrutos).toBeNull();
    expect(sale.total).toBe(1000);
    expect(sale.profit).toBe(400); // 1000 - 600(costo), sin IIBB
  });

  it("2. venta con Ingresos Brutos: se persiste, resta de profit, NUNCA se suma a total (a diferencia de shippingCharged)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], ingresosBrutos: 80, installments: [{ amount: 1000 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.ingresosBrutos).toBe(80);
    expect(sale.total).toBe(1000); // IIBB no participa del total que paga la clienta
    expect(sale.profit).toBe(320); // 1000 - 600(costo) - 80(IIBB)
  });

  it("5+6. venta con Ingresos Brutos + envío cobrado + costo real de envío distinto: profit descuenta ambos costos, total solo suma lo cobrado", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        items: [{ productId, quantity: 1 }],
        shippingCharged: 200,
        shippingCost: 120,
        ingresosBrutos: 50,
        installments: [{ amount: 1200 }],
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.total).toBe(1200); // 1000 + 200 (shippingCharged) -- shippingCost/IIBB no tocan total
    expect(sale.shippingCharged).toBe(200);
    expect(sale.shippingCost).toBe(120);
    expect(sale.ingresosBrutos).toBe(50);
    expect(sale.profit).toBe(430); // 1200 - 600(costo) - 120(envío real) - 50(IIBB)
  });

  it("8. edición de venta editable: Ingresos Brutos se puede agregar/cambiar y recalcula profit sin perder otros valores", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], shippingCharged: 100, installments: [{ amount: 1100 }] }),
    );
    const sale = await createRes.json();
    expect(sale.ingresosBrutos).toBeNull();

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      shippingCharged: 100,
      ingresosBrutos: 40,
      paymentMethod: "efectivo",
      installments: [{ amount: 1100 }],
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.total).toBe(1100); // sin cambios (shippingCharged sigue igual)
    expect(updated.shippingCharged).toBe(100); // no se perdió al editar solo IIBB
    expect(updated.ingresosBrutos).toBe(40);
    expect(updated.profit).toBe(460); // 1100 - 600 - 40(IIBB), shippingCost sigue null
  });

  it("9. una venta con cuota pagada rechaza el PATCH aunque solo se intente cambiar Ingresos Brutos", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }),
    );
    const sale = await createRes.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const installmentId = detail.installments[0].id;

    const markPaidRes = await api("PATCH", `/api/sales/${sale.id}/installments/${installmentId}`, { status: "pagado" });
    expect(markPaidRes.status).toBe(200);

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      ingresosBrutos: 999,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(patchRes.status).toBe(400);
    expect((await patchRes.json()).error).toMatch(/cuotas pagadas/i);

    const after = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(after.ingresosBrutos).toBeNull(); // no se coló el intento de cambio
  });

  it("7. venta cancelada con Ingresos Brutos queda excluida de los totales financieros del período", async () => {
    const date = "2026-01-15";
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ date, items: [{ productId, quantity: 1 }], ingresosBrutos: 70, installments: [{ amount: 1000 }] }),
    );
    const sale = await res.json();

    const before = await (
      await api("GET", `/api/reports/sales-summary?start=2026-01-01&end=2026-02-01&groupBy=month`)
    ).json();
    const totalBefore = before.reduce((sum: number, p: any) => sum + p.totalSales, 0);
    expect(totalBefore).toBeGreaterThanOrEqual(1000);

    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`);
    expect(cancelRes.status).toBe(200);

    const after = await (
      await api("GET", `/api/reports/sales-summary?start=2026-01-01&end=2026-02-01&groupBy=month`)
    ).json();
    const totalAfter = after.reduce((sum: number, p: any) => sum + p.totalSales, 0);
    expect(totalAfter).toBe(totalBefore - 1000); // la venta cancelada sale del total, sin importar ingresosBrutos
  });

  it("10. tenant A no puede modificar (ni inyectar Ingresos Brutos en) una venta de tenant B", async () => {
    const { storage } = await import("../storage");
    const userB = await storage.createUser({
      username: `vitest_iibb_tenantb_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const loginB = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: userB.username, password: "vitest-test-password-123" }),
    });
    const cookieB = loginB.headers.get("set-cookie")!.split(";")[0];
    const clientB = await (
      await fetch(`${baseUrl}/api/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ name: "Clienta de B", phone: "9990000099" }),
      })
    ).json();
    const productB = await (
      await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ seccion: "VITEST-B", producto: "Producto de B", precio: 500, unidades: 10 }),
      })
    ).json();
    const saleB = await (
      await fetch(`${baseUrl}/api/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify(
          baseSale({ clientId: clientB.id, items: [{ productId: productB.id, quantity: 1 }], installments: [{ amount: 500 }] }),
        ),
      })
    ).json();

    // A (la sesión por defecto de este archivo) intenta editar la venta de B.
    const attackRes = await api("PATCH", `/api/sales/${saleB.id}`, {
      items: [{ productId: productB.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      ingresosBrutos: 999,
      paymentMethod: "efectivo",
      installments: [{ amount: 500 }],
    });
    expect(attackRes.status).toBe(404); // ni siquiera revela que existe

    const stillB = await (await fetch(`${baseUrl}/api/sales/${saleB.id}`, { headers: { Cookie: cookieB } })).json();
    expect(stillB.ingresosBrutos).toBeNull();
  });

  it("11. idempotencia de creación sigue funcionando con Ingresos Brutos en el payload", async () => {
    const clientRequestId = randomUUID();
    const payload = baseSale({
      items: [{ productId, quantity: 1 }],
      ingresosBrutos: 30,
      installments: [{ amount: 1000 }],
      clientRequestId,
    });

    const first = await api("POST", "/api/sales", payload);
    expect(first.status).toBe(201);
    const firstSale = await first.json();

    const second = await api("POST", "/api/sales", payload);
    expect(second.status).toBe(201); // mismo criterio ya existente: reintento -> misma venta
    const secondSale = await second.json();
    expect(secondSale.id).toBe(firstSale.id);
    expect(secondSale.ingresosBrutos).toBe(30);
  });

  it("12. Ingresos Brutos negativo es rechazado por el backend, no crea la venta", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], ingresosBrutos: -1, installments: [{ amount: 1000 }] }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales — idempotencia (clientRequestId, Etapa I-B.6)", () => {
  it("Caso 1: mismo clientRequestId repetido -> misma venta, no duplica items/cuotas, stock descontado una sola vez", async () => {
    const key = randomUUID();
    const before = await (await api("GET", "/api/products")).json();
    const stockBefore = before.find((p: any) => p.id === productId).unidades;

    const res1 = await api("POST", "/api/sales", baseSale({ clientRequestId: key }));
    expect(res1.status).toBe(201);
    const sale1 = await res1.json();

    const res2 = await api("POST", "/api/sales", baseSale({ clientRequestId: key }));
    expect(res2.status).toBe(201);
    const sale2 = await res2.json();

    expect(sale2.id).toBe(sale1.id);

    const detail = await (await api("GET", `/api/sales/${sale1.id}`)).json();
    expect(detail.items).toHaveLength(1);
    expect(detail.installments).toHaveLength(1);

    const allSales = await (await api("GET", "/api/sales")).json();
    expect(allSales.filter((s: any) => s.id === sale1.id)).toHaveLength(1);

    const after = await (await api("GET", "/api/products")).json();
    const stockAfter = after.find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore - 2); // solo se descontó una vez, no dos
  });

  it("Caso 2: mismo clientRequestId con payload distinto -> 409, no crea segunda venta ni toca stock ni la original", async () => {
    const key = randomUUID();
    const res1 = await api("POST", "/api/sales", baseSale({ clientRequestId: key, items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }));
    expect(res1.status).toBe(201);
    const sale1 = await res1.json();

    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const res2 = await api(
      "POST",
      "/api/sales",
      baseSale({ clientRequestId: key, items: [{ productId, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toMatch(/clientRequestId ya fue utilizado/i);

    const original = await (await api("GET", `/api/sales/${sale1.id}`)).json();
    expect(original.items[0].quantity).toBe(1); // la venta original no se tocó

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore); // el request rechazado no descontó stock
  });

  it("Caso 3: clientRequestId distintos -> dos ventas legítimas, dos descuentos de stock", async () => {
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const res1 = await api("POST", "/api/sales", baseSale({ clientRequestId: randomUUID() }));
    const res2 = await api("POST", "/api/sales", baseSale({ clientRequestId: randomUUID() }));
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const sale1 = await res1.json();
    const sale2 = await res2.json();
    expect(sale1.id).not.toBe(sale2.id);

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore - 4); // 2 unidades x 2 ventas
  });

  it("Caso 4: venta legacy sin clientRequestId sigue funcionando exactamente igual", async () => {
    const res = await api("POST", "/api/sales", baseSale());
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.clientRequestId ?? null).toBeNull();
  });

  it("Caso 5: clientRequestId no-UUID -> 400, no crea venta ni toca stock", async () => {
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const res = await api("POST", "/api/sales", baseSale({ clientRequestId: "no-es-un-uuid" }));
    expect(res.status).toBe(400);

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore);
  });
});

describe("GET /api/sales/:id", () => {
  it("404 para una venta inexistente", async () => {
    const res = await api("GET", "/api/sales/999999");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/sales/:id — edición", () => {
  let saleId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/sales", baseSale());
    saleId = (await res.json()).id;
  });

  it("happy path: cambia la cantidad, recalcula el total y ajusta el stock (restaura + reserva de nuevo)", async () => {
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const res = await api("PATCH", `/api/sales/${saleId}`, {
      items: [{ productId, quantity: 5 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 5000 }],
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.total).toBe(5000);

    // Antes tenía reservadas 2 unidades; ahora reserva 5 -> el stock baja 3 más respecto de antes.
    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore - 3);
  });

  it("404 para una venta inexistente, sin efecto en stock", async () => {
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    const res = await api("PATCH", "/api/sales/999999", {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(res.status).toBe(404);
    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore);
  });
});

describe("PATCH /api/sales/:id — protección de cuotas pagadas (Etapa I-B.7-B)", () => {
  // Este archivo comparte un único producto (20 unidades iniciales) entre TODOS los tests, en
  // orden — para cuando se llega acá, el remanente real depende de cuánto consumieron los
  // bloques anteriores y es frágil de calcular a mano. En vez de asumirlo, se resetea el
  // stock a un valor generoso con el mismo endpoint real que usa la app (`PATCH
  // /api/products/:id/stock`), así este bloque no depende del orden ni del estado dejado por
  // el resto de la suite.
  beforeAll(async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 100 });
    expect(res.status).toBe(200);
  });

  it("una cuota pagada de dos -> PATCH rechazado (400), sales/items/installments/stock sin cambios", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 2 }], installments: [{ amount: 1000 }, { amount: 1000 }] }),
    );
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();

    const detailBefore = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const firstInstallmentId = detailBefore.installments[0].id;

    const markPaidRes = await api("PATCH", `/api/sales/${sale.id}/installments/${firstInstallmentId}`, { status: "pagado" });
    expect(markPaidRes.status).toBe(200);

    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(patchRes.status).toBe(400);
    expect((await patchRes.json()).error).toMatch(/cuotas pagadas/i);

    const detailAfter = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detailAfter.total).toBe(detailBefore.total); // sales no cambió
    expect(detailAfter.items).toEqual(detailBefore.items); // sale_items no cambió
    expect(detailAfter.installments).toHaveLength(2); // installments no se recrearon
    expect(detailAfter.installments[0].id).toBe(firstInstallmentId); // misma fila, no una nueva
    expect(detailAfter.installments[0].status).toBe("pagado"); // el pago no se resetea
    expect(detailAfter.installments[1].status).toBe("pendiente");

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore); // stock no cambió
  });

  it("varias cuotas con una sola pagada -> igual se rechaza (alcanza con UNA cuota pagada)", async () => {
    // quantity:1 a propósito — este archivo comparte un único producto (20 unidades) entre
    // TODOS los tests, en orden; usar cantidades chicas evita agotar el stock disponible en
    // este punto de la suite (ver los otros tests del archivo, mismo patrón).
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({
        items: [{ productId, quantity: 1 }],
        installments: [{ amount: 400 }, { amount: 300 }, { amount: 300 }],
      }),
    );
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();

    // Solo la última de las 3 cuotas se marca pagada — no la primera, para confirmar que la
    // regla no depende de qué posición ocupa la cuota pagada.
    const lastInstallmentId = detail.installments[2].id;
    await api("PATCH", `/api/sales/${sale.id}/installments/${lastInstallmentId}`, { status: "pagado" });

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(patchRes.status).toBe(400);
    expect((await patchRes.json()).error).toMatch(/cuotas pagadas/i);
  });

  it("todas las cuotas pendientes -> PATCH permitido (contraste directo con los dos casos de arriba)", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 500 }, { amount: 500 }] }),
    );
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(patchRes.status).toBe(200);
  });
});

describe("POST /api/sales/:id/cancel", () => {
  let saleId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId, quantity: 3 }], installments: [{ amount: 3000 }] }));
    saleId = (await res.json()).id;
  });

  it("happy path: cancela, marca el estado y devuelve el stock reservado", async () => {
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const res = await api("POST", `/api/sales/${saleId}/cancel`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("cancelada");

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore + 3);
  });

  it("rechaza cancelar una venta ya cancelada, sin volver a devolver stock", async () => {
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;

    const res = await api("POST", `/api/sales/${saleId}/cancel`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ya está cancelada/i);

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId).unidades;
    expect(stockAfter).toBe(stockBefore); // no se duplica la devolución de stock
  });

  it("404 para una venta inexistente", async () => {
    const res = await api("POST", "/api/sales/999999/cancel");
    expect(res.status).toBe(404);
  });

  it("una venta cancelada no puede editarse por PATCH", async () => {
    const res = await api("PATCH", `/api/sales/${saleId}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/venta cancelada/i);
  });
});

describe("PATCH /api/sales/:id/installments/:installmentId", () => {
  let saleId: number;
  let installmentId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/sales", baseSale());
    saleId = (await res.json()).id;
    const detail = await (await api("GET", `/api/sales/${saleId}`)).json();
    installmentId = detail.installments[0].id;
  });

  it("happy path: marca la cuota como pagada y persiste", async () => {
    const res = await api("PATCH", `/api/sales/${saleId}/installments/${installmentId}`, { status: "pagado" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pagado");

    const detail = await (await api("GET", `/api/sales/${saleId}`)).json();
    expect(detail.installments[0].status).toBe("pagado");
  });

  it("404 para installmentId inexistente dentro de una venta real", async () => {
    const res = await api("PATCH", `/api/sales/${saleId}/installments/999999`, { status: "pendiente" });
    expect(res.status).toBe(404);
  });

  it("404 para saleId inexistente", async () => {
    const res = await api("PATCH", `/api/sales/999999/installments/${installmentId}`, { status: "pendiente" });
    expect(res.status).toBe(404);
  });

  it("rechaza status con enum inválido, sin mutar", async () => {
    const before = (await (await api("GET", `/api/sales/${saleId}`)).json()).installments[0].status;
    const res = await api("PATCH", `/api/sales/${saleId}/installments/${installmentId}`, { status: "vencida" });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", `/api/sales/${saleId}`)).json()).installments[0].status;
    expect(after).toBe(before);
  });
});

describe("Snapshot histórico de costo por ítem (saleItem.costPrice) — Etapa I-B.7-D-D", () => {
  let productBId: number; // precio 2000, costo 1400, para el test de múltiples productos
  let productNoCostId: number; // precio 1000, sin costPrice cargado (fallback)

  beforeAll(async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 100 });
    expect(res.status).toBe(200);

    const productBRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto B — snapshot", precio: 2000, unidades: 50 });
    productBId = (await productBRes.json()).id;
    // El descuento de compra solo acepta 35/40/45 (ver applyDiscountSchema) -> 35% sobre 2000 = 1300.
    await api("PATCH", `/api/products/${productBId}/discount`, { discountPercent: 35 }); // costPrice = 2000*0.65 = 1300

    const productNoCostRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto sin costo — snapshot", precio: 1000, unidades: 50 });
    productNoCostId = (await productNoCostRes.json()).id;
    // Nunca se le aplica /discount -> productStock.costPrice queda NULL a propósito.
  });

  it("Test A — createSale: snapshot correcto con costo cargado (productId, costo=600, qty=2)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.profit).toBe(800); // (1000-600)*2

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].costPrice).toBe(600); // productCost = 2*600 = 1200
  });

  it("Test B — fallback sin costPrice: snapshot = precio de catálogo", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId: productNoCostId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.profit).toBe(0); // sin costo cargado, cost=precio -> (1000-1000)*2

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].costPrice).toBe(1000); // fallback: costPrice = product.precio
  });

  it("Test C — múltiples productos: cada línea guarda SU propio snapshot (resuelve F4)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        items: [
          { productId, quantity: 2 }, // precio 1000, costo 600
          { productId: productBId, quantity: 1 }, // precio 2000, costo 1400
        ],
        installments: [{ amount: 4000 }],
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    // total = 1000*2 + 2000*1 = 4000; productCost = 2*600 + 1*1300 = 2500; profit = 1500
    expect(sale.total).toBe(4000);
    expect(sale.profit).toBe(1500);

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const itemA = detail.items.find((i: any) => i.productId === productId);
    const itemB = detail.items.find((i: any) => i.productId === productBId);
    expect(itemA.costPrice).toBe(600);
    expect(itemB.costPrice).toBe(1300);
    // Justo lo que F4 pedía poder reconstruir: el costo de CADA producto en ESTA venta,
    // sin consultar el costo actual del catálogo.
  });

  it("Test D — cambiar el costo actual del catálogo después no altera el snapshot ni el profit ya persistidos", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }),
    );
    const sale = await res.json();
    const before = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(before.items[0].costPrice).toBe(600);
    expect(before.profit).toBe(400);

    // Cambia el costo VIGENTE del producto (recuento/redescuento posterior a la venta).
    await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 45 }); // costPrice pasa a 550

    const after = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(after.items[0].costPrice).toBe(600); // snapshot histórico intacto
    expect(after.profit).toBe(400); // profit histórico intacto
    expect(after.total).toBe(1000);

    // Restaura el costo para no afectar el resto de la suite.
    await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 40 });
  });

  it("Test E — updateSale: los nuevos snapshots usan el costo VIGENTE al momento de la edición, no el histórico", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }),
    );
    const sale = await createRes.json();
    expect((await (await api("GET", `/api/sales/${sale.id}`)).json()).items[0].costPrice).toBe(600);

    // Cambia el costo vigente ANTES de editar.
    await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 45 }); // costPrice -> 550

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(patchRes.status).toBe(200);
    const edited = await patchRes.json();
    expect(edited.profit).toBe(450); // 1000 - 550, con el costo VIGENTE al momento de editar

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].costPrice).toBe(550); // nuevo snapshot, no el 600 original

    // Restaura el costo para no afectar el resto de la suite.
    await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 40 });
  });
});
