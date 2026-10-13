import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiAs(asCookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: asCookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let nextFreePlanTag = 1;
/** Prompt 14 — a diferencia del resto de este archivo (que necesita una suscripción activa
 * para no chocar con el límite de 10 productos), estos dos tests SÍ necesitan estar en el
 * plan gratis a propósito — por eso usan su propia consultora, nunca la compartida. */
async function createFreePlanConsultant(): Promise<string> {
  const { storage } = await import("../storage");
  const username = `vitest_sws_freeplan_${nextFreePlanTag++}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password: "vitest-test-password-123" }),
  });
  return loginRes.headers.get("set-cookie")!.split(";")[0];
}

async function createProductAs(asCookie: string, unidades: number, precio = 1000): Promise<{ id: number }> {
  const res = await apiAs(asCookie, "POST", "/api/products", {
    seccion: "VITEST",
    producto: `Producto plan gratis ${nextFreePlanTag}`,
    codigo: `vitest-sws-freeplan-${nextFreePlanTag++}-${Date.now()}`,
    precio,
    unidades,
  });
  expect(res.status).toBe(201);
  return res.json();
}

let nextCodigo = 1;
async function createProduct(unidades: number, precio = 1000): Promise<{ id: number }> {
  const res = await api("POST", "/api/products", {
    seccion: "VITEST",
    producto: `Producto sin stock ${nextCodigo}`,
    codigo: `vitest-sws-${nextCodigo++}-${Date.now()}`,
    precio,
    unidades,
  });
  expect(res.status).toBe(201);
  return res.json();
}

function saleBody(overrides: Record<string, unknown> = {}) {
  return {
    clientId,
    date: "2026-10-06",
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    paidNow: true,
    installments: [{ amount: 0 }],
    ...overrides,
  };
}

async function createSaleRaw(body: Record<string, unknown>) {
  const res = await api("POST", "/api/sales", body);
  return { status: res.status, body: await res.json() };
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
    username: `vitest_sws_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: user.username, password: "vitest-test-password-123" }),
  });
  cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  // Este archivo prueba el flujo de "vender sin stock", no el límite del plan gratis (Prompt
  // 14) — todos los tests comparten una sola consultora y crean muchos productos, así que se
  // le da una suscripción activa para que ese límite no interfiera (mismo criterio que
  // products.test.ts).
  const now = new Date();
  await storage.updateSubscription(user.consultantId!, {
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  });

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST sin stock", phone: "9990005551" });
  clientId = (await clientRes.json()).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Prompt 8, Parte 1 — vender sin stock", () => {
  it("producto con 0 de stock: toda la cantidad queda pendiente, deliveryStatus pendiente_entrega", async () => {
    const product = await createProduct(0);
    const { status, body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 5 }], installments: [{ amount: 5000 }] }),
    );
    expect(status).toBe(201);
    expect(sale.deliveryStatus).toBe("pendiente_entrega");

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const item = detail.items[0];
    expect(item.quantity).toBe(5);
    expect(item.quantityPending).toBe(5);
    expect(item.quantityDelivered).toBe(0);

    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(0); // nunca negativo a la vista
  });

  it("producto con stock parcial (2 de 5): 2 se entregan en el momento, 3 quedan pendientes", async () => {
    const product = await createProduct(2);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 5 }], installments: [{ amount: 5000 }] }),
    );
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const item = detail.items[0];
    expect(item.quantityPending).toBe(3);
    expect(item.quantityDelivered).toBe(2);
    expect(sale.deliveryStatus).toBe("pendiente_entrega");

    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(0);
  });

  it("stock suficiente: sigue entregándose entera, igual que siempre", async () => {
    const product = await createProduct(10);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 4 }], installments: [{ amount: 4000 }] }),
    );
    expect(sale.deliveryStatus).toBe("entregada");
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(0);
    expect(detail.items[0].quantityDelivered).toBe(4);
  });

  it("venta sin clienta con unidades pendientes: el aviso de 'listo para entregar' nunca referencia una clienta null", async () => {
    const product = await createProduct(0);
    const res = await api("POST", "/api/sales", {
      date: "2026-10-06",
      items: [{ productId: product.id, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 2000 }],
    });
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale.clientId).toBeNull();

    // Cubrir el pendiente para que aparezca en "listo para entregar".
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 2 }] });

    const ready = await (await api("GET", "/api/deliveries/ready")).json();
    const row = ready.find((r: any) => r.saleId === sale.id);
    expect(row).toBeDefined();
    expect(row.clientId).toBeNull();
    expect(row.clientName).toBe("Sin clienta"); // nunca "null" en el texto
  });
});

describe("Prompt 8, Parte 2 — un pedido cubre primero a la venta más vieja", () => {
  it("dos ventas pendientes del mismo producto: el pedido cubre primero la más vieja", async () => {
    const product = await createProduct(0);
    const { body: saleOld } = await createSaleRaw(
      saleBody({ date: "2026-10-01", items: [{ productId: product.id, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );
    const { body: saleNew } = await createSaleRaw(
      saleBody({ date: "2026-10-05", items: [{ productId: product.id, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );

    const res = await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 3 }] });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.pendingAssignments).toEqual([{ saleId: saleOld.id, clientName: "Clienta VITEST sin stock", quantity: 3 }]);

    const detailOld = await (await api("GET", `/api/sales/${saleOld.id}`)).json();
    const detailNew = await (await api("GET", `/api/sales/${saleNew.id}`)).json();
    expect(detailOld.items[0].quantityPending).toBe(0);
    expect(detailNew.items[0].quantityPending).toBe(3); // todavía nada, el pedido no alcanzó
  });

  it("un pedido que no alcanza: asigna lo que hay y el resto sigue pendiente", async () => {
    const product = await createProduct(0);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 10 }], installments: [{ amount: 10000 }] }),
    );

    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 4 }] });
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(6);
    // Resolver lo pendiente no entrega solo: "quantityDelivered" nunca sube hasta tocar
    // "Marcar como entregado" — esto solo deja esas 4 unidades "listas para entregar".
    expect(detail.items[0].quantityDelivered).toBe(0);
    expect(detail.items[0].quantity - detail.items[0].quantityPending - detail.items[0].quantityDelivered).toBe(4);

    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(0); // nada sobró para stock disponible
  });

  it("lo que sobra después de cubrir pendientes sí se suma a stock disponible", async () => {
    const product = await createProduct(0);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 2 }], installments: [{ amount: 2000 }] }),
    );
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 5 }] });

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(0);

    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(3); // 5 - 2 cubiertas
  });

  it("'Marcar como entregado' entrega lo listo y deja la venta 'entregada' cuando todos los renglones lo están", async () => {
    const product = await createProduct(0);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 3 }] });

    const beforeDetail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(beforeDetail.deliveryStatus).toBe("pendiente_entrega"); // listo, pero todavía no "entregado"
    const itemId = beforeDetail.items[0].id;

    const deliverRes = await api("PATCH", `/api/sales/${sale.id}/items/${itemId}/deliver`, {});
    expect(deliverRes.status).toBe(200);
    const updated = await deliverRes.json();
    expect(updated.deliveryStatus).toBe("entregada");
  });
});

describe("Prompt 8, costo real de las unidades pendientes (ajuste 2 — verificado contra el ejemplo numérico exacto)", () => {
  it("2 en stock a costo real + 3 pendientes estimadas -> un pedido parcial combina bien (con ≈) -> el pedido final resuelve del todo (sin ≈)", async () => {
    const product = await createProduct(2, 2000); // precio 2000
    await api("PATCH", `/api/products/${product.id}/discount`, { discountPercent: 45 }); // costo real 2000*0.55=1100
    const afterDiscount = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(afterDiscount.costPrice).toBe(1100);

    const sale = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 5 }], installments: [{ amount: 10000 }] }),
    );
    let detail = await (await api("GET", `/api/sales/${sale.body.id}`)).json();
    let item = detail.items[0];
    expect(item.quantity).toBe(5);
    expect(item.quantityPending).toBe(3);
    // 2 reales a 1100 = 2200; 3 estimadas con el descuento habitual (default 35%) sobre 2000 = 1300 c/u.
    expect(item.costPrice).toBe(Math.round((2200 + 1300 * 3) / 5));
    expect(item.costIsEstimated).toBe(true);

    // Pedido de 2 a descuento 40% (costo real 2000*0.6=1200).
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 2 }], discountPercent: 40 });
    detail = await (await api("GET", `/api/sales/${sale.body.id}`)).json();
    item = detail.items[0];
    expect(item.quantityPending).toBe(1);
    // real: 2200 (2x1100) + 2400 (2x1200) = 4600; estimado restante: 1 x 1300 (congelado, no cambia).
    expect(item.costPrice).toBe(Math.round((4600 + 1300) / 5));
    expect(item.costIsEstimated).toBe(true);

    // Pedido final de 1 más al mismo descuento — resuelve la última unidad pendiente.
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 1 }], discountPercent: 40 });
    detail = await (await api("GET", `/api/sales/${sale.body.id}`)).json();
    item = detail.items[0];
    expect(item.quantityPending).toBe(0);
    expect(item.costIsEstimated).toBe(false);
    expect(item.costPrice).toBe(Math.round((4600 + 1200) / 5));
  });

  it("costo cargado a mano con unidades pendientes: solo actualiza el estimado, el pedido real que llega después combina bien las dos cosas", async () => {
    const product = await createProduct(0, 2000);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 4 }], installments: [{ amount: 8000 }] }),
    );
    let detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].costIsEstimated).toBe(true);

    // Carga manual de costo a mano desde "Editar producto": $1.200 por unidad.
    await api("PATCH", `/api/products/${product.id}/stock`, { unidades: 0 }); // no cambia nada, solo confirma el endpoint existe
    const costRes = await api("PATCH", `/api/products/${product.id}/cost`, { costPrice: 1200 });
    expect(costRes.status).toBe(200);

    detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(4); // la carga a mano no resuelve físicamente nada
    expect(detail.items[0].costIsEstimated).toBe(true); // sigue estimado: todavía no llegó ningún pedido real
    expect(detail.items[0].costPrice).toBe(1200); // ahora usa el estimado recién cargado

    // Llega un pedido real con descuento 40% (costo real 2000*0.6=1200 — a propósito igual al
    // estimado, para aislar que la COMBINACIÓN funciona y no solo que "cambió el número").
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 4 }], discountPercent: 40 });
    detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(0);
    expect(detail.items[0].costIsEstimated).toBe(false);
    expect(detail.items[0].costPrice).toBe(1200);
  });
});

describe("Prompt 8 — cancelar una venta con unidades pendientes", () => {
  it("cancelar sin pendientes: devuelve todo el stock, igual que siempre", async () => {
    const product = await createProduct(5);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );
    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`, {});
    expect(cancelRes.status).toBe(200);
    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(5);
  });

  it("cancelar con pendientes nunca cubiertos: devuelve solo lo que realmente se descontó", async () => {
    const product = await createProduct(2);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 5 }], installments: [{ amount: 5000 }] }),
    );
    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`, {});
    expect(cancelRes.status).toBe(200);
    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(2); // nunca "5" — las 3 pendientes nunca salieron del stock

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(0); // una venta cancelada no sigue "esperando"
  });

  it("cancelar con pendientes parcialmente cubiertas por un pedido: devuelve lo original + lo ya asignado", async () => {
    const product = await createProduct(2);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 5 }], installments: [{ amount: 5000 }] }),
    );
    await api("PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 2 }] });
    // Ahora: 2 originales + 2 del pedido = 4 cubiertas, 1 pendiente, 0 disponible.

    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`, {});
    expect(cancelRes.status).toBe(200);
    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(4); // las 4 ya "ear-marked" para esta venta vuelven libres
  });

  it("cancelar nunca se bloquea por el límite del plan gratis, incluso con el cupo lleno", async () => {
    const product = await createProduct(2);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );
    // Llenar el cupo de 10 con otros productos (stock = 0 en "product" tras la venta).
    for (let i = 0; i < 9; i++) {
      await createProduct(1);
    }
    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`, {});
    expect(cancelRes.status).toBe(200); // nunca 403, aunque esto "reponga" product a 2
  });
});

describe("Prompt 8, ajuste 5 — editar subiendo y bajando la cantidad", () => {
  it("editar subiendo más de lo que hay en stock: la diferencia queda pendiente, lo anterior no se toca", async () => {
    const product = await createProduct(5);
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 3 }], installments: [{ amount: 3000 }] }),
    );
    // alreadyPaidAmount queda en 3000 (la venta original, cobrada en el momento) — lo que se
    // manda en "installments" es el SALDO que falta, no el total nuevo (1000 - 3000... en
    // realidad 10000 - 3000 = 7000, ver storage.updateSale).
    const editRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId: product.id, quantity: 10 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 7000 }],
    });
    expect(editRes.status).toBe(200);
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityDelivered).toBe(5); // 3 iniciales + 2 que había disponibles
    expect(detail.items[0].quantityPending).toBe(5); // 10 - 5
  });

  it("editar bajando por debajo de lo entregado: se permite, es una devolución — todo lo que no era pendiente vuelve al stock", async () => {
    const product = await createProduct(10);
    // paidNow:false (nada cobrado todavía) — bajar el total por debajo de lo YA COBRADO está
    // bloqueado por una regla previa y ajena a este prompt (nunca se puede "descobrar" plata
    // ya recibida editando); con nada cobrado esa regla no entra en juego, y lo que se prueba
    // acá (el stock/entrega) es independiente del estado de pago.
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 8 }], installments: [{ amount: 8000 }], paidNow: false, firstDueDate: "2026-10-13" }),
    );
    // Venta entregada entera (8 de 8, stock suficiente) — ahora la baja a 2 (devolución de 6).
    const editRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId: product.id, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: false,
      firstDueDate: "2026-10-13",
      installments: [{ amount: 2000 }],
    });
    expect(editRes.status).toBe(200);
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantity).toBe(2);
    expect(detail.items[0].quantityDelivered).toBe(2);
    expect(detail.items[0].quantityPending).toBe(0);

    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(8); // 2 (nunca se vendieron) + 6 devueltas
  });

  it("editar bajando cuando hay pendiente: se descuenta primero de lo pendiente, nunca del stock", async () => {
    const product = await createProduct(2);
    // paidNow:false — igual criterio que el test anterior, para no chocar con la regla ajena
    // de "no bajar el total por debajo de lo ya cobrado".
    const { body: sale } = await createSaleRaw(
      saleBody({ items: [{ productId: product.id, quantity: 5 }], installments: [{ amount: 5000 }], paidNow: false, firstDueDate: "2026-10-13" }),
    );
    // 2 entregadas, 3 pendientes. Bajar a 2 (decreaseAmount=3): se descuenta entero de lo
    // pendiente (3 → 0), nada vuelve al stock — lo entregado nunca se toca.
    const editRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId: product.id, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: false,
      firstDueDate: "2026-10-13",
      installments: [{ amount: 2000 }],
    });
    expect(editRes.status).toBe(200);
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].quantityPending).toBe(0);
    expect(detail.items[0].quantityDelivered).toBe(2);

    const stock = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === product.id);
    expect(stock.unidades).toBe(0); // nada volvió — las 2 originales siguen entregadas
  });
});

describe("Prompt 8, punto 8 — plan gratis con asignación a pendientes", () => {
  // A propósito su propia consultora, en plan gratis de verdad (sin suscripción activa) — a
  // diferencia del resto de este archivo, que necesita la suscripción activa para no chocar
  // con el límite mientras prueba otras cosas.
  it("unidades asignadas a ventas pendientes nunca cuentan para el límite de 10 productos", async () => {
    const freeCookie = await createFreePlanConsultant();
    const product = await createProductAs(freeCookie, 0);
    await apiAs(freeCookie, "POST", "/api/sales", {
      date: "2026-10-06",
      items: [{ productId: product.id, quantity: 5 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 5000 }],
    });

    // Llenar el cupo con 10 productos distintos con stock.
    for (let i = 0; i < 10; i++) {
      await createProductAs(freeCookie, 1);
    }

    // Cubrir el pendiente del primer producto — nunca debería bloquearse por el límite, porque
    // esas unidades nunca llegan a ser stock disponible.
    const res = await apiAs(freeCookie, "PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 5 }] });
    expect(res.status).toBe(200);

    const detail = await (await apiAs(freeCookie, "GET", "/api/products")).json();
    const updated = detail.find((p: any) => p.id === product.id);
    expect(updated.unidades).toBe(0); // las 5 se fueron a la venta pendiente, nunca a disponible
  });

  it("lo que SOBRA después de cubrir pendientes sí respeta el límite normalmente", async () => {
    const freeCookie = await createFreePlanConsultant();
    const product = await createProductAs(freeCookie, 0);
    await apiAs(freeCookie, "POST", "/api/sales", {
      date: "2026-10-06",
      items: [{ productId: product.id, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      paidNow: true,
      installments: [{ amount: 2000 }],
    });

    for (let i = 0; i < 10; i++) {
      await createProductAs(freeCookie, 1);
    }

    // Pedido de 5: 2 cubren el pendiente, 3 sobrarían como stock nuevo — pero el cupo ya está
    // lleno (10/10), así que el excedente se bloquea.
    const res = await apiAs(freeCookie, "PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: product.id, delta: 5 }] });
    expect(res.status).toBe(403);
  });
});
