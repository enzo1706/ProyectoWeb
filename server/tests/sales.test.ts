import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { addDays } from "@shared/saleCalculations";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;
let productId: number; // precio 1000, unidades 20
let highStockProductId: number; // precio 1000, unidades 1000 — para los tests de Prompt 6 que no quieren competir por stock con el resto del archivo

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Prompt 2: el % de Ingresos Brutos vive en Configuración, no en el payload de la venta — se
// configura antes de cada test que lo necesita y se vuelve a null al final, para no contaminar
// los tests siguientes que comparten el mismo consultor/sesión de este archivo.
async function setGrossIncomeTaxPercentTenths(value: number | null) {
  const current = await (await api("GET", "/api/business-settings")).json();
  const res = await api("PATCH", "/api/business-settings", {
    businessName: current.businessName,
    currency: current.currency,
    grossIncomeTaxPercentTenths: value,
  });
  expect(res.status).toBe(200);
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

  // Prompt 6: producto aparte con stock de sobra — los tests de creación de cuotas usan
  // cantidades de hasta 6 unidades por venta y no deben competir por el stock, ya ajustado,
  // de `productId` con el resto de este archivo.
  const highStockProductRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto stock alto", precio: 1000, unidades: 1000 });
  highStockProductId = (await highStockProductRes.json()).id;
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

// Prompt 6: arma el plan de cuotas (monto, vencimiento, cobrada o no) según la forma de pago
// y si la clienta paga en el momento — reemplaza la vieja lógica que siempre dejaba la cuota
// "pendiente" con vencimiento el mismo día de la venta, el bug original de este prompt.
// Usa `highStockProductId` (no el `productId` compartido con el resto del archivo) para no
// competir por stock con tests que corren antes en el mismo archivo.
describe("POST /api/sales — Prompt 6: creación de cuotas según forma de pago", () => {
  it("efectivo, 1 pago, paga en el momento: la cuota queda cobrada con vencimiento en la fecha de la venta", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: true,
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments).toHaveLength(1);
    expect(detail.installments[0].status).toBe("pagado");
    expect(detail.installments[0].dueDate).toBe("2026-09-03");
  });

  it("efectivo, 1 pago, NO paga en el momento: la cuota queda pendiente con el vencimiento elegido", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: false,
        firstDueDate: "2026-09-10",
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments).toHaveLength(1);
    expect(detail.installments[0].status).toBe("pendiente");
    expect(detail.installments[0].dueDate).toBe("2026-09-10");
  });

  it("transferencia, 3 pagos, paga en el momento: la primera cobrada, las demás pendientes cada 30 días desde la venta", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "transferencia",
        items: [{ productId: highStockProductId, quantity: 3 }],
        installments: [{ amount: 1000 }, { amount: 1000 }, { amount: 1000 }],
        paidNow: true,
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments).toHaveLength(3);
    expect(detail.installments[0].status).toBe("pagado");
    expect(detail.installments[0].dueDate).toBe("2026-09-03");
    expect(detail.installments[1].status).toBe("pendiente");
    expect(detail.installments[1].dueDate).toBe(addDays("2026-09-03", 30));
    expect(detail.installments[2].status).toBe("pendiente");
    expect(detail.installments[2].dueDate).toBe(addDays("2026-09-03", 60));
  });

  it("efectivo, 3 pagos, NO paga en el momento: ninguna cobrada, la primera vence lo elegido y las demás cada 30 días después", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 3 }],
        installments: [{ amount: 1000 }, { amount: 1000 }, { amount: 1000 }],
        paidNow: false,
        firstDueDate: "2026-09-10",
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments).toHaveLength(3);
    expect(detail.installments.every((i: any) => i.status === "pendiente")).toBe(true);
    expect(detail.installments[0].dueDate).toBe("2026-09-10");
    expect(detail.installments[1].dueDate).toBe(addDays("2026-09-10", 30));
    expect(detail.installments[2].dueDate).toBe(addDays("2026-09-10", 60));
  });

  it("tarjeta, 1 pago: la venta queda cobrada con una sola cuota por el total (paidNow se ignora)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "tarjeta",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: false,
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.installmentsCount).toBe(1);
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments).toHaveLength(1);
    expect(detail.installments[0].amount).toBe(2000);
    expect(detail.installments[0].status).toBe("pagado");
    expect(detail.installments[0].dueDate).toBe("2026-09-03");
  });

  it("tarjeta, 6 cuotas: una sola cuota cobrada por el total; installmentsCount guarda las 6 solo como dato", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "tarjeta",
        items: [{ productId: highStockProductId, quantity: 6 }],
        installments: Array.from({ length: 6 }, () => ({ amount: 1000 })),
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.installmentsCount).toBe(6);
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments).toHaveLength(1);
    expect(detail.installments[0].amount).toBe(6000);
    expect(detail.installments[0].status).toBe("pagado");
  });

  it("toda venta nueva arranca con deliveryStatus 'entregada'", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ paymentMethod: "tarjeta", items: [{ productId: highStockProductId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.deliveryStatus).toBe("entregada");
  });
});

// Prompt 6, punto 1: "Completar después" — la clienta es opcional, salvo que la venta quede
// con algo pendiente de cobro. Mismo motivo que arriba para usar `highStockProductId`.
describe("POST /api/sales — Prompt 6: clienta opcional", () => {
  it("se puede crear sin clienta una venta que queda cobrada completa (tarjeta)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        clientId: undefined,
        paymentMethod: "tarjeta",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.clientId).toBeNull();
    expect(sale.clientName).toBe("Sin clienta");
  });

  it("rechaza sin persistir una venta pendiente de cobro sin clienta", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        clientId: undefined,
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: false,
        firstDueDate: "2026-09-10",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Para dejar una venta pendiente de cobro tenés que elegir la clienta");
  });

  it("una venta cobrada en el momento tampoco necesita clienta (efectivo, paidNow true)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        clientId: undefined,
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: true,
      }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.clientId).toBeNull();
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

  it("2. venta con % de Ingresos Brutos cargado en Configuración: se calcula solo, resta de profit, NUNCA se suma a total", async () => {
    await setGrossIncomeTaxPercentTenths(80); // 8%
    try {
      const res = await api("POST", "/api/sales", baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }] }));
      expect(res.status).toBe(201);
      const sale = await res.json();
      expect(sale.grossIncomeTaxPercentTenths).toBe(80);
      expect(sale.ingresosBrutos).toBe(80); // 1000 * 8%
      expect(sale.total).toBe(1000); // IIBB no participa del total que paga la clienta
      expect(sale.profit).toBe(320); // 1000 - 600(costo) - 80(IIBB)
    } finally {
      await setGrossIncomeTaxPercentTenths(null);
    }
  });

  it("5+6. venta con % de IIBB + envío cobrado + costo real de envío distinto: profit descuenta ambos costos, total solo suma lo cobrado", async () => {
    await setGrossIncomeTaxPercentTenths(100); // 10%
    try {
      const res = await api(
        "POST",
        "/api/sales",
        baseSale({
          items: [{ productId, quantity: 1 }],
          shippingCharged: 200,
          shippingCost: 120,
          installments: [{ amount: 1200 }],
        }),
      );
      expect(res.status).toBe(201);
      const sale = await res.json();
      expect(sale.total).toBe(1200); // 1000 + 200 (shippingCharged) -- shippingCost/IIBB no tocan total
      expect(sale.shippingCharged).toBe(200);
      expect(sale.shippingCost).toBe(120);
      expect(sale.ingresosBrutos).toBe(120); // 1200 * 10%
      expect(sale.profit).toBe(360); // 1200 - 600(costo) - 120(envío real) - 120(IIBB)
    } finally {
      await setGrossIncomeTaxPercentTenths(null);
    }
  });

  it("8. editar una venta recalcula el % de Ingresos Brutos vigente en Configuración, sin perder otros valores", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], shippingCharged: 100, installments: [{ amount: 1100 }] }),
    );
    const sale = await createRes.json();
    expect(sale.ingresosBrutos).toBeNull(); // todavía sin % configurado

    await setGrossIncomeTaxPercentTenths(40); // 4%
    try {
      const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
        items: [{ productId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        shippingCharged: 100,
        paymentMethod: "efectivo",
        installments: [{ amount: 1100 }],
      });
      expect(patchRes.status).toBe(200);
      const updated = await patchRes.json();
      expect(updated.total).toBe(1100); // sin cambios (shippingCharged sigue igual)
      expect(updated.shippingCharged).toBe(100); // no se perdió al editar
      expect(updated.ingresosBrutos).toBe(44); // 1100 * 4%, recién configurado al editar
      expect(updated.profit).toBe(456); // 1100 - 600 - 0(shippingCost null) - 44(IIBB)
    } finally {
      await setGrossIncomeTaxPercentTenths(null);
    }
  });

  it("9. una venta con cuota pagada: ingresosBrutos no es un campo editable (se ignora), y el saldo pendiente real ya es $0", async () => {
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

    // Mandar el total completo (1000) como saldo pendiente ya no coincide con la realidad
    // (ya se cobró todo, el saldo pendiente es $0) — Prompt 6, "edición inteligente".
    const wrongRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      ingresosBrutos: 999,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(wrongRes.status).toBe(400);
    expect((await wrongRes.json()).error).toMatch(/saldo pendiente/i);

    // Con el saldo pendiente correcto ($0), la edición se permite y la cuota pagada no se toca.
    const okRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      ingresosBrutos: 999,
      paymentMethod: "efectivo",
      installments: [{ amount: 0 }],
    });
    expect(okRes.status).toBe(200);

    const after = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(after.ingresosBrutos).toBeNull(); // no es un campo editable por esta vía, se ignora
    expect(after.installments).toHaveLength(1);
    expect(after.installments[0].id).toBe(installmentId);
    expect(after.installments[0].status).toBe("pagado");
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

  it("11. idempotencia de creación sigue funcionando con el % de Ingresos Brutos vigente", async () => {
    await setGrossIncomeTaxPercentTenths(30); // 3%
    try {
      const clientRequestId = randomUUID();
      const payload = baseSale({ items: [{ productId, quantity: 1 }], installments: [{ amount: 1000 }], clientRequestId });

      const first = await api("POST", "/api/sales", payload);
      expect(first.status).toBe(201);
      const firstSale = await first.json();

      const second = await api("POST", "/api/sales", payload);
      expect(second.status).toBe(201); // mismo criterio ya existente: reintento -> misma venta
      const secondSale = await second.json();
      expect(secondSale.id).toBe(firstSale.id);
      expect(secondSale.ingresosBrutos).toBe(30); // 1000 * 3%
    } finally {
      await setGrossIncomeTaxPercentTenths(null);
    }
  });

  it("12. mandar 'ingresosBrutos' en el payload ya no tiene efecto — lo reemplaza el % de Configuración", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 1 }], ingresosBrutos: 999, installments: [{ amount: 1000 }] }),
    );
    expect(res.status).toBe(201); // ya no es un campo validado: lo que venga ahí se ignora
    const sale = await res.json();
    expect(sale.ingresosBrutos).toBeNull(); // sin % configurado, nunca 999
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

// Prompt 6 — "edición inteligente": antes de esta etapa (I-B.7-B), CUALQUIER cuota pagada
// bloqueaba la edición entera. Eso dejó de ser viable en la práctica: con "paga en el
// momento" (Prompt 6), la mayoría de las ventas nuevas en efectivo/transferencia y TODAS las
// de tarjeta tienen su primera cuota pagada desde el instante de la creación — bloquear la
// edición en ese caso haría "Editar" inusable para casi toda venta real. De acá en más: una
// cuota ya cobrada se preserva tal cual (mismo id, status "pagado", misma dueDate — su fecha
// de pago), y solo se recalculan las cuotas que seguían pendientes, sobre el saldo que falta.
describe("PATCH /api/sales/:id — edición con cuotas ya pagadas (Prompt 6)", () => {
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

  it("una cuota pagada de dos: el PATCH se permite, la cuota pagada no se toca (mismo id, status y fecha de pago)", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 2 }], installments: [{ amount: 1000 }, { amount: 1000 }] }),
    );
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();

    const detailBefore = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const firstInstallmentId = detailBefore.installments[0].id;
    const paidDueDate = detailBefore.installments[0].dueDate;

    const markPaidRes = await api("PATCH", `/api/sales/${sale.id}/installments/${firstInstallmentId}`, { status: "pagado" });
    expect(markPaidRes.status).toBe(200);

    // Edita de verdad: sube la cantidad de 2 a 3 (el total pasa de 2000 a 3000). El saldo que
    // falta después de lo ya cobrado (1000) es 2000 — eso es lo que describe `installments` acá,
    // no el total de la venta.
    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 3 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.total).toBe(3000); // la edición se aplicó de verdad

    const detailAfter = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detailAfter.installments).toHaveLength(2);
    const paidAfter = detailAfter.installments.find((i: any) => i.id === firstInstallmentId);
    expect(paidAfter).toBeDefined();
    expect(paidAfter.status).toBe("pagado"); // el pago no se resetea
    expect(paidAfter.dueDate).toBe(paidDueDate); // su fecha de pago no cambia
    expect(paidAfter.amount).toBe(1000); // su monto tampoco
    const pending = detailAfter.installments.find((i: any) => i.id !== firstInstallmentId);
    expect(pending.status).toBe("pendiente");
    expect(pending.amount).toBe(2000); // el saldo que falta, no el total
  });

  it("rechaza bajar el total por debajo de lo que ya se cobró", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId, quantity: 2 }], installments: [{ amount: 1000 }, { amount: 1000 }] }),
    );
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    await api("PATCH", `/api/sales/${sale.id}/installments/${detail.installments[0].id}`, { status: "pagado" });

    // unitPrice manual a propósito: deja el total en 400, muy por debajo de los 1000 ya cobrados.
    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId, quantity: 1, unitPrice: 400 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 0 }],
    });
    expect(patchRes.status).toBe(400);
    expect((await patchRes.json()).error).toMatch(/no puede ser menor que lo que ya se cobró/i);
  });

  it("todas las cuotas pendientes -> PATCH permitido (sin cuotas pagadas, caso simple de siempre)", async () => {
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

// Prompt 6: estado de pago derivado de sale_installments en GET /api/sales (lista), sin
// fetch adicional por venta.
describe("GET /api/sales — Prompt 6: paymentStatus/pendingAmount/nextDueDate derivados", () => {
  it("tarjeta: paymentStatus 'cobrada', sin saldo pendiente", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ paymentMethod: "tarjeta", items: [{ productId: highStockProductId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    const sale = await res.json();
    const list = await (await api("GET", "/api/sales")).json();
    const found = list.find((s: any) => s.id === sale.id);
    expect(found.paymentStatus).toBe("cobrada");
    expect(found.pendingAmount).toBe(0);
    expect(found.nextDueDate).toBeNull();
  });

  it("efectivo sin pagar en el momento: paymentStatus 'te_debe', pendingAmount y nextDueDate correctos", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: false,
        firstDueDate: "2026-09-20",
      }),
    );
    const sale = await res.json();
    const list = await (await api("GET", "/api/sales")).json();
    const found = list.find((s: any) => s.id === sale.id);
    expect(found.paymentStatus).toBe("te_debe");
    expect(found.pendingAmount).toBe(2000);
    expect(found.nextDueDate).toBe("2026-09-20");
  });

  it("venta cancelada: paymentStatus 'cobrada' y pendingAmount $0 aunque haya una cuota pendiente sin cobrar", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({
        paymentMethod: "efectivo",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
        paidNow: false,
        firstDueDate: "2026-09-20",
      }),
    );
    const sale = await res.json();
    await api("POST", `/api/sales/${sale.id}/cancel`);
    const list = await (await api("GET", "/api/sales")).json();
    const found = list.find((s: any) => s.id === sale.id);
    expect(found.paymentStatus).toBe("cobrada");
    expect(found.pendingAmount).toBe(0);
    expect(found.nextDueDate).toBeNull();
  });
});

// Prompt 6, punto 6: cambiar a mano entre "entregada" y "pendiente_entrega".
describe("PATCH /api/sales/:id/delivery-status", () => {
  it("toda venta nueva arranca 'entregada', y se puede cambiar a 'pendiente_entrega' y volver", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ paymentMethod: "tarjeta", items: [{ productId: highStockProductId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    const sale = await createRes.json();
    expect(sale.deliveryStatus).toBe("entregada");

    const toPending = await api("PATCH", `/api/sales/${sale.id}/delivery-status`, { deliveryStatus: "pendiente_entrega" });
    expect(toPending.status).toBe(200);
    expect((await toPending.json()).deliveryStatus).toBe("pendiente_entrega");

    const backToDelivered = await api("PATCH", `/api/sales/${sale.id}/delivery-status`, { deliveryStatus: "entregada" });
    expect(backToDelivered.status).toBe(200);
    expect((await backToDelivered.json()).deliveryStatus).toBe("entregada");
  });

  it("rechaza un valor inválido de deliveryStatus", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ paymentMethod: "tarjeta", items: [{ productId: highStockProductId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    const sale = await createRes.json();
    const res = await api("PATCH", `/api/sales/${sale.id}/delivery-status`, { deliveryStatus: "entregado" });
    expect(res.status).toBe(400);
  });

  it("rechaza cambiar la entrega de una venta cancelada", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({ paymentMethod: "tarjeta", items: [{ productId: highStockProductId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    const sale = await createRes.json();
    await api("POST", `/api/sales/${sale.id}/cancel`);
    const res = await api("PATCH", `/api/sales/${sale.id}/delivery-status`, { deliveryStatus: "pendiente_entrega" });
    expect(res.status).toBe(400);
  });

  it("404 sobre una venta inexistente", async () => {
    const res = await api("PATCH", "/api/sales/99999999/delivery-status", { deliveryStatus: "pendiente_entrega" });
    expect(res.status).toBe(404);
  });
});

// Prompt 6, punto 1 — "Asignar clienta" para una venta creada con "Completar después".
describe("PATCH /api/sales/:id/client", () => {
  it("asigna una clienta a una venta 'Sin clienta'", async () => {
    const otherClientRes = await api("POST", "/api/clients", { name: "Clienta para asignar", phone: "9990000004" });
    const otherClient = await otherClientRes.json();

    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({
        clientId: undefined,
        paymentMethod: "tarjeta",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
      }),
    );
    const sale = await createRes.json();
    expect(sale.clientId).toBeNull();

    const assignRes = await api("PATCH", `/api/sales/${sale.id}/client`, { clientId: otherClient.id });
    expect(assignRes.status).toBe(200);
    const assigned = await assignRes.json();
    expect(assigned.clientId).toBe(otherClient.id);
    expect(assigned.clientName).toBe(otherClient.name);
  });

  it("rechaza asignar clienta a una venta que ya tiene una", async () => {
    const createRes = await api("POST", "/api/sales", baseSale());
    const sale = await createRes.json();
    const res = await api("PATCH", `/api/sales/${sale.id}/client`, { clientId });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ya tiene una clienta asignada/i);
  });

  it("rechaza con una clienta que no existe (o es de otra consultora)", async () => {
    const createRes = await api(
      "POST",
      "/api/sales",
      baseSale({
        clientId: undefined,
        paymentMethod: "tarjeta",
        items: [{ productId: highStockProductId, quantity: 2 }],
        installments: [{ amount: 2000 }],
      }),
    );
    const sale = await createRes.json();
    const res = await api("PATCH", `/api/sales/${sale.id}/client`, { clientId: 99999999 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/clienta no encontrada/i);
  });

  it("404 sobre una venta inexistente", async () => {
    const res = await api("PATCH", "/api/sales/99999999/client", { clientId });
    expect(res.status).toBe(404);
  });

  it("404 sobre una venta inexistente", async () => {
    const res = await api("PATCH", "/api/sales/99999999/delivery-status", { deliveryStatus: "pendiente_entrega" });
    expect(res.status).toBe(404);
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

  it("Test B — sin costPrice cargado: se estima con el descuento habitual, NUNCA con el precio de venta (Prompt 2)", async () => {
    const res = await api(
      "POST",
      "/api/sales",
      baseSale({ items: [{ productId: productNoCostId, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    expect(res.status).toBe(201);
    const sale = await res.json();
    // Esta consultora nunca cargó un pedido -> descuento habitual = 35% (default más bajo) ->
    // costo estimado = 1000 * 0.65 = 650 (nunca 1000, el precio de venta).
    expect(sale.profit).toBe(700); // (1000-650)*2

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].costPrice).toBe(650);
    expect(detail.items[0].costIsEstimated).toBe(true);
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

describe("Productos discontinuados en ventas — Etapa 7.4", () => {
  let activeProductId: number; // se discontinúa a mitad de los tests de este describe
  let alwaysActiveProductId: number;

  beforeAll(async () => {
    const p1 = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto 7.4 — se discontinúa", precio: 1000, unidades: 20 });
    activeProductId = (await p1.json()).id;
    const p2 = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto 7.4 — siempre activo", precio: 1000, unidades: 20 });
    alwaysActiveProductId = (await p2.json()).id;
  });

  it("9. se puede crear una venta con un producto ACTIVO (regresión, sin cambios de comportamiento)", async () => {
    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId: alwaysActiveProductId, quantity: 1 }], installments: [{ amount: 1000 }] }));
    expect(res.status).toBe(201);
  });

  it("8. NO se puede crear una venta NUEVA con un producto discontinuado (400, mensaje claro, stock intacto)", async () => {
    await api("PATCH", `/api/products/${activeProductId}/discontinued`, { discontinued: true });

    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === activeProductId);
    const res = await api("POST", "/api/sales", baseSale({ items: [{ productId: activeProductId, quantity: 1 }], installments: [{ amount: 1000 }] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/discontinuado/i);

    // Stock intacto — la venta rechazada no debe haber descontado nada.
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === activeProductId);
    expect(after.unidades).toBe(before.unidades);
  });

  it("10. editar una venta existente que YA contiene un producto discontinuado sigue siendo posible (histórico válido)", async () => {
    // Reactiva momentáneamente para poder crear la venta original con este producto.
    await api("PATCH", `/api/products/${activeProductId}/discontinued`, { discontinued: false });
    const createRes = await api("POST", "/api/sales", baseSale({ items: [{ productId: activeProductId, quantity: 2 }], installments: [{ amount: 2000 }] }));
    const sale = await createRes.json();

    // Se discontinúa DESPUÉS de que ya forma parte de la venta.
    await api("PATCH", `/api/products/${activeProductId}/discontinued`, { discontinued: true });

    // Editar manteniendo el mismo producto (cambiando solo la cantidad) debe seguir andando.
    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId: activeProductId, quantity: 3 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 3000 }],
    });
    expect(patchRes.status).toBe(200);
    const edited = await patchRes.json();
    expect(edited.total).toBe(3000);
  });

  it("11. agregar un producto discontinuado NUEVO durante una edición falla (400), la venta queda exactamente como estaba", async () => {
    // activeProductId sigue discontinuado desde el test anterior.
    const createRes = await api("POST", "/api/sales", baseSale({ items: [{ productId: alwaysActiveProductId, quantity: 1 }], installments: [{ amount: 1000 }] }));
    const sale = await createRes.json();
    const before = await (await api("GET", `/api/sales/${sale.id}`)).json();

    const patchRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [
        { productId: alwaysActiveProductId, quantity: 1 },
        { productId: activeProductId, quantity: 1 }, // discontinuado, NUEVO en esta edición
      ],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
    });
    expect(patchRes.status).toBe(400);
    const body = await patchRes.json();
    expect(body.error).toMatch(/discontinuado/i);

    // Rollback completo: la venta sigue teniendo exactamente su composición original.
    const after = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(after.items).toHaveLength(1);
    expect(after.items[0].productId).toBe(alwaysActiveProductId);
    expect(after.total).toBe(before.total);
  });

  it("12. cancelar una venta con un producto discontinuado sigue funcionando (restaura stock igual que siempre)", async () => {
    await api("PATCH", `/api/products/${activeProductId}/discontinued`, { discontinued: false });
    const stockBefore = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === activeProductId).unidades;

    const createRes = await api("POST", "/api/sales", baseSale({ items: [{ productId: activeProductId, quantity: 2 }], installments: [{ amount: 2000 }] }));
    const sale = await createRes.json();
    await api("PATCH", `/api/products/${activeProductId}/discontinued`, { discontinued: true });

    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`);
    expect(cancelRes.status).toBe(200);

    const stockAfter = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === activeProductId).unidades;
    expect(stockAfter).toBe(stockBefore); // restaurado, sin importar que el producto esté discontinuado
  });
});
