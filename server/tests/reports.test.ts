import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, users, clients, products, productStock, sales, saleItems, saleInstallments, subscriptions } from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Etapa 7.8 — auditoría y corrección de Reportes/consistencia financiera, contra Postgres real
 * (nunca DATABASE_URL): valida que los endpoints /api/reports/* respeten período, tenant
 * isolation, exclusión de canceladas, COGS histórico y la diferenciación facturación/cobrado
 * que pedía la etapa. Sigue el mismo patrón que tenant-isolation-deep.test.ts (dos tenants,
 * DatabaseStorage directo para fixtures + HTTP real para los endpoints).
 */

const storage = new DatabaseStorage();
let httpServer: Server;
let baseUrl: string;

const USERNAME_A = `vitest_reports_a_${Date.now()}`;
const USERNAME_B = `vitest_reports_b_${Date.now()}`;
const PASSWORD = "vitest-test-password-123";

let consultantAId: number;
let consultantBId: number;
let userAId: number;
let userBId: number;
let cookieA: string;
let cookieB: string;

let clientAId: number;
let clientBId: number;
let productAId: number; // precio 1000, costPrice 600
let productA3Id: number; // precio 2000, costPrice 1200, categoría distinta
let productBId: number;

// IDs de ventas de A usadas en varios describe blocks.
let saleJun15Id: number; // 2026-06-15, dentro del período, clientA
let saleJun20Id: number; // 2026-06-20, dentro del período, clientA, con cuotas
let saleMayId: number; // 2026-05-20, fuera del período (antes de start)
let saleJulBoundaryId: number; // 2026-07-01, exactamente = end (debe EXCLUIRSE)
let saleJun01BoundaryId: number; // 2026-06-01, exactamente = start (debe INCLUIRSE)
let saleCancelledId: number; // 2026-06-10, cancelada
let saleNullCostId: number; // 2026-06-12, un ítem con costPrice NULL (snapshot histórico pre-D-D)
let saleCancelledWithPaidInstallmentId: number; // cancelada DESPUÉS de tener una cuota pagada

const PERIOD_START = "2026-06-01";
const PERIOD_END = "2026-07-01"; // [start, end) — 2026-07-01 excluido

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const today = new Date();
const overdueDueDate = toDateStr(new Date(today.getTime() - 5 * 86400000)); // hace 5 días
const futureDueDate = toDateStr(new Date(today.getTime() + 30 * 86400000)); // en 30 días

async function loginAs(username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

async function api(cookie: string, method: string, path: string) {
  return fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie } });
}

async function reportsFor(cookie: string, path: string) {
  const res = await api(cookie, "GET", path);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const userA = await storage.createUser({ username: USERNAME_A, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  const userB = await storage.createUser({ username: USERNAME_B, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  userAId = userA.id;
  userBId = userB.id;
  consultantAId = userA.consultantId!;
  consultantBId = userB.consultantId!;

  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  cookieA = await loginAs(USERNAME_A);
  cookieB = await loginAs(USERNAME_B);

  const [clientA] = await db.insert(clients).values({ consultantId: consultantAId, name: "Clienta VITEST Reports A", phone: "9990001001" }).returning();
  clientAId = clientA.id;
  const [clientB] = await db.insert(clients).values({ consultantId: consultantBId, name: "Clienta VITEST Reports B", phone: "9990001002" }).returning();
  clientBId = clientB.id;

  const [productA] = await db
    .insert(products)
    .values({ consultantId: consultantAId, seccion: "Perfumería", producto: "Producto A Reports", variante: "Estándar", codigo: `vitest-rep-a-${Date.now()}`, puntos: 0, precio: 1000, source: "manual" })
    .returning();
  productAId = productA.id;
  await db.insert(productStock).values({ consultantId: consultantAId, productId: productAId, unidades: 100, stockMinimo: 0, costPrice: 600 });

  const [productA3] = await db
    .insert(products)
    .values({ consultantId: consultantAId, seccion: "Maquillaje", producto: "Producto A3 Reports", variante: "Estándar", codigo: `vitest-rep-a3-${Date.now()}`, puntos: 0, precio: 2000, source: "manual" })
    .returning();
  productA3Id = productA3.id;
  await db.insert(productStock).values({ consultantId: consultantAId, productId: productA3Id, unidades: 100, stockMinimo: 0, costPrice: 1200 });

  const [productB] = await db
    .insert(products)
    .values({ consultantId: consultantBId, seccion: "Perfumería", producto: "Producto B Reports", variante: "Estándar", codigo: `vitest-rep-b-${Date.now()}`, puntos: 0, precio: 1000, source: "manual" })
    .returning();
  productBId = productB.id;
  await db.insert(productStock).values({ consultantId: consultantBId, productId: productBId, unidades: 100, stockMinimo: 0, costPrice: 400 });

  // --- Ventas de A ---
  const saleJun15 = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-06-15", items: [{ productId: productAId, quantity: 2 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 2000 }], status: "pendiente",
  });
  saleJun15Id = saleJun15.id; // total 2000, cost 1200, profit 800

  const saleJun20 = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-06-20", items: [{ productId: productA3Id, quantity: 1 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo",
    installments: [{ amount: 667 }, { amount: 667 }, { amount: 666 }], installmentFrequency: "mensual", status: "pendiente",
  });
  saleJun20Id = saleJun20.id; // total 2000, cost 1200, profit 800
  const jun20Installments = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, saleJun20Id));
  // Cuota 1: pagada (para "Cobrado"). Cuota 2: forzada a vencida (dueDate en el pasado real).
  // Cuota 3: forzada a futuro (pendiente, no vencida).
  await storage.updateInstallmentStatus(consultantAId, saleJun20Id, jun20Installments[0].id, "pagado");
  await db.update(saleInstallments).set({ dueDate: overdueDueDate }).where(eq(saleInstallments.id, jun20Installments[1].id));
  await db.update(saleInstallments).set({ dueDate: futureDueDate }).where(eq(saleInstallments.id, jun20Installments[2].id));

  const saleMay = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-05-20", items: [{ productId: productAId, quantity: 1 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 1000 }], status: "pendiente",
  });
  saleMayId = saleMay.id;

  const saleJulBoundary = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-07-01", items: [{ productId: productAId, quantity: 1 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 1000 }], status: "pendiente",
  });
  saleJulBoundaryId = saleJulBoundary.id;

  const saleJun01Boundary = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-06-01", items: [{ productId: productAId, quantity: 1 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 1000 }], status: "pendiente",
  });
  saleJun01BoundaryId = saleJun01Boundary.id; // total 1000, cost 600, profit 400

  const saleCancelled = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-06-10", items: [{ productId: productAId, quantity: 5 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 5000 }], status: "pendiente",
  });
  saleCancelledId = saleCancelled.id;
  await storage.cancelSale(consultantAId, saleCancelledId);

  // Venta cancelada CON una cuota ya pagada antes de cancelar — no debe contarse como "cobrado".
  const saleCancelledPaid = await storage.createSale(consultantAId, {
    clientId: clientAId, date: "2026-06-11", items: [{ productId: productAId, quantity: 1 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 1000 }], status: "pendiente",
  });
  saleCancelledWithPaidInstallmentId = saleCancelledPaid.id;
  const [instCancelledPaid] = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, saleCancelledWithPaidInstallmentId));
  await storage.updateInstallmentStatus(consultantAId, saleCancelledWithPaidInstallmentId, instCancelledPaid.id, "pagado");
  await storage.cancelSale(consultantAId, saleCancelledWithPaidInstallmentId);

  // Venta histórica con costPrice NULL en una línea (simula una venta anterior a la Etapa
  // I-B.7-D-D, insertada directo tal como cost-snapshot-migration.test.ts) — createSale SIEMPRE
  // resuelve un costPrice (fallback a product.precio), así que la única forma real de tener un
  // costPrice NULL es insertar la fila directamente, nunca a través del flujo normal.
  const [saleNullCost] = await db
    .insert(sales)
    .values({
      consultantId: consultantAId, clientId: clientAId, clientName: clientA.name!, date: "2026-06-12",
      subtotal: 500, total: 500, profit: 200, paymentMethod: "efectivo", installmentsCount: 1, status: "pendiente",
    })
    .returning();
  saleNullCostId = saleNullCost.id;
  await db.insert(saleItems).values({
    saleId: saleNullCostId, productId: productAId, productName: "Producto A Reports", category: "Perfumería",
    quantity: 1, originalPrice: 500, price: 500, costPrice: null,
  });

  // --- Venta de B (para aislamiento) ---
  await storage.createSale(consultantBId, {
    clientId: clientBId, date: "2026-06-15", items: [{ productId: productBId, quantity: 3 }],
    orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 3000 }], status: "pendiente",
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  const ownSales = await db.select({ id: sales.id }).from(sales).where(inArray(sales.consultantId, [consultantAId, consultantBId]));
  const ownSaleIds = ownSales.map((s) => s.id);
  if (ownSaleIds.length > 0) {
    await db.delete(saleInstallments).where(inArray(saleInstallments.saleId, ownSaleIds));
    await db.delete(saleItems).where(inArray(saleItems.saleId, ownSaleIds));
  }
  await db.delete(sales).where(inArray(sales.consultantId, [consultantAId, consultantBId]));
  await db.delete(productStock).where(inArray(productStock.consultantId, [consultantAId, consultantBId]));
  await db.delete(products).where(inArray(products.consultantId, [consultantAId, consultantBId]));
  await db.delete(clients).where(inArray(clients.consultantId, [consultantAId, consultantBId]));
  await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  await db.delete(subscriptions).where(inArray(subscriptions.consultantId, [consultantAId, consultantBId]));
  await db.delete(consultants).where(inArray(consultants.id, [consultantAId, consultantBId]));
  await pool.end();
});

describe("Reportes — período (Etapa 7.8)", () => {
  it("1. ventas fuera del período no aparecen en sales-summary", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=${PERIOD_START}&end=${PERIOD_END}&groupBy=day`);
    const totalCount = body.reduce((s: number, p: any) => s + p.salesCount, 0);
    // Dentro de [start,end): jun15, jun20, jun01boundary, jun10(cancelada, excluida), jun11(cancelada, excluida), jun12(nullcost).
    // Válidas: jun15, jun20, jun01boundary, jun12 = 4. May y julBoundary quedan afuera.
    expect(totalCount).toBe(4);
  });

  it("13. límite inferior incluido, límite superior excluido — [start, end)", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=${PERIOD_START}&end=${PERIOD_END}&groupBy=day`);
    const dates = body.map((p: any) => p.period);
    expect(dates).toContain("2026-06-01"); // start, inclusive
    expect(dates).not.toContain("2026-07-01"); // end, exclusivo
  });

  it("14. start/end faltantes en un endpoint que los requiere -> 400, nunca 200 con datos vacíos silenciosos", async () => {
    const res = await api(cookieA, "GET", "/api/reports/sales-summary");
    expect(res.status).toBe(400);
  });

  it("14b. start/end con formato inválido se tratan como ausentes, nunca se filtran con basura", async () => {
    const res = await api(cookieA, "GET", "/api/reports/sales-summary?start=not-a-date&end=also-not-a-date&groupBy=day");
    expect(res.status).toBe(400); // se tratan como ausentes -> mismo 400 que si faltaran
  });

  it("top-clients ahora exige start/end explícitamente (antes caía silenciosamente al mes actual)", async () => {
    const res = await api(cookieA, "GET", "/api/reports/top-clients");
    expect(res.status).toBe(400);
  });
});

describe("Reportes — ventas canceladas excluidas (Etapa 7.8)", () => {
  it("2. una venta cancelada no aparece en sales-summary ni afecta el total", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=2026-06-10&end=2026-06-11&groupBy=day`);
    // Solo existe la venta cancelada (2026-06-10) en esta ventana de un día.
    expect(body.reduce((s: number, p: any) => s + p.salesCount, 0)).toBe(0);
  });

  it("7. categorías: solo ventas válidas del período", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/top-categories?start=${PERIOD_START}&end=${PERIOD_END}`);
    const perfumeria = body.find((c: any) => c.category === "Perfumería");
    // jun15 (qty2) + jun01boundary (qty1) + jun12/nullcost (qty1) = 4 unidades de Perfumería.
    // La cancelada (qty5, 2026-06-10) y la cancelada-con-cuota-pagada (qty1, 2026-06-11) NUNCA suman acá.
    expect(perfumeria.quantitySold).toBe(4);
  });

  it("8. top-products respeta período y excluye unidades de ventas canceladas (invariante 3)", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/top-products?start=${PERIOD_START}&end=${PERIOD_END}`);
    const productA = body.find((p: any) => p.productId === productAId);
    expect(productA.quantitySold).toBe(4); // nunca incluye las 5 unidades de la venta cancelada
  });
});

describe("Reportes — profit y ticket promedio (Etapa 7.8)", () => {
  it("3. profit de Reportes coincide con sale.profit (invariante 2)", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=${PERIOD_START}&end=${PERIOD_END}&groupBy=day`);
    const totalProfit = body.reduce((s: number, p: any) => s + p.totalProfit, 0);
    const saleDetails = await Promise.all(
      [saleJun15Id, saleJun20Id, saleJun01BoundaryId, saleNullCostId].map((id) => storage.getSaleDetails(consultantAId, id)),
    );
    const expectedProfit = saleDetails.reduce((s, sale) => s + (sale?.profit ?? 0), 0);
    expect(totalProfit).toBe(expectedProfit);
    expect(totalProfit).toBe(800 + 800 + 400 + 200);
  });

  it("6. ticket promedio = facturación válida / cantidad de ventas válidas", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=${PERIOD_START}&end=${PERIOD_END}&groupBy=day`);
    const totalSales = body.reduce((s: number, p: any) => s + p.totalSales, 0);
    const totalCount = body.reduce((s: number, p: any) => s + p.salesCount, 0);
    const expectedAvg = Math.round(totalSales / totalCount);
    // La suma de avgTicket ponderado no es lo que se verifica -- se recalcula del agregado real.
    expect(totalSales).toBe(2000 + 2000 + 1000 + 500);
    expect(totalCount).toBe(4);
    expect(expectedAvg).toBe(Math.round(5500 / 4));
  });

  it("4/invariante 1: facturación agregada del período = suma de ventas válidas del período", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=${PERIOD_START}&end=${PERIOD_END}&groupBy=day`);
    const totalSales = body.reduce((s: number, p: any) => s + p.totalSales, 0);
    expect(totalSales).toBe(5500);
  });
});

describe("Reportes — COGS histórico (Etapa 7.8)", () => {
  it("4. COGS usa sale_items.costPrice histórico, nunca el costo actual", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/product-cost-summary?start=${PERIOD_START}&end=${PERIOD_END}`);
    // jun15: 2*600=1200; jun20: 1*1200=1200; jun01boundary: 1*600=600; jun12(nullcost): excluido del sum, pero marca hasIncompleteCostData.
    expect(body.productCost).toBe(1200 + 1200 + 600);
    expect(body.hasIncompleteCostData).toBe(true);
  });

  it("5/invariante 4: cambiar productStock.costPrice actual no altera el COGS histórico ya calculado", async () => {
    const before = await reportsFor(cookieA, `/api/reports/product-cost-summary?start=${PERIOD_START}&end=${PERIOD_END}`);
    await db.update(productStock).set({ costPrice: 999 }).where(eq(productStock.productId, productAId));

    const after = await reportsFor(cookieA, `/api/reports/product-cost-summary?start=${PERIOD_START}&end=${PERIOD_END}`);
    expect(after.body.productCost).toBe(before.body.productCost);

    await db.update(productStock).set({ costPrice: 600 }).where(eq(productStock.productId, productAId)); // restaura
  });

  it("un período sin ninguna venta con costPrice NULL no marca hasIncompleteCostData", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/product-cost-summary?start=2026-06-15&end=2026-06-16`);
    expect(body.hasIncompleteCostData).toBe(false);
    expect(body.productCost).toBe(1200);
  });
});

describe("Reportes — cuotas: cobrado / pendiente / vencido (Etapa 7.8)", () => {
  it("10a. Cobrado: suma cuotas 'pagado' de ventas no canceladas, nunca depende del período", async () => {
    const { body } = await reportsFor(cookieA, "/api/reports/collected-payments");
    expect(body.totalCollected).toBe(667); // solo la cuota 1 de saleJun20, marcada pagada
  });

  it("11. venta cancelada con cuota ya pagada NO se cuenta como cobrada", async () => {
    const { body } = await reportsFor(cookieA, "/api/reports/collected-payments");
    // Si la cuota de saleCancelledWithPaidInstallment (1000) se contara, totalCollected sería 1667.
    expect(body.totalCollected).not.toBe(1667);
    expect(body.totalCollected).toBe(667);
  });

  it("10b. Pendiente/Vencido: totales reales, 'vencido' es subconjunto de 'pendiente'", async () => {
    const { body } = await reportsFor(cookieA, "/api/reports/pending-installments-totals");
    // Pendientes de A: jun15(2000, cuota única -> dueDate=fecha de venta) + jun20 cuota2(667,
    // forzada vencida) + jun20 cuota3(666, forzada a futuro) + may(1000) + julBoundary(1000) +
    // jun01boundary(1000) = 6 cuotas, 6333 total. La cancelada (jun10, 5000) y la
    // cancelada-con-pagada (jun11) NUNCA cuentan acá.
    // "Vencida" = dueDate < hoy real. Las ventas de cuota única nunca reciben una
    // installmentFrequency (ver computeInstallmentDueDate), así que su dueDate = la fecha de la
    // venta — todas están en el pasado real (2026-05/06/07) salvo julBoundary si corre después
    // de esa fecha. Solo la cuota 3 de jun20 (forzada a +30 días desde hoy) queda no vencida.
    expect(body.totalPendingCount).toBe(6);
    expect(body.totalPendingAmount).toBe(2000 + 667 + 666 + 1000 + 1000 + 1000);
    expect(body.overdueCount).toBe(5); // todas menos la cuota 3 de jun20
    expect(body.overdueAmount).toBe(body.totalPendingAmount - 666);
    expect(body.overdueAmount).toBeLessThanOrEqual(body.totalPendingAmount);
  });
});

describe("Reportes — top clients (Etapa 7.8)", () => {
  it("9. top-clients respeta el período seleccionado", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/top-clients?start=${PERIOD_START}&end=${PERIOD_END}&limit=5`);
    const clientRow = body.find((c: any) => c.clientId === clientAId);
    // jun15(2000) + jun20(2000) + jun01boundary(1000) + jun12/nullcost(500) = 4 ventas válidas, 5500.
    expect(clientRow.purchaseCount).toBe(4);
    expect(clientRow.totalAmount).toBe(5500);
  });
});

describe("Reportes — tenant isolation (Etapa 7.8, invariante 5)", () => {
  it("12a. sales-summary de A nunca incluye ventas de B", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/sales-summary?start=${PERIOD_START}&end=${PERIOD_END}&groupBy=day`);
    const totalSales = body.reduce((s: number, p: any) => s + p.totalSales, 0);
    expect(totalSales).toBe(5500); // nunca 8500 (que incluiría los 3000 de B)
  });

  it("12b. top-products de A nunca incluye el producto de B", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/top-products?start=${PERIOD_START}&end=${PERIOD_END}`);
    expect(body.some((p: any) => p.productId === productBId)).toBe(false);
  });

  it("12c. top-clients de A nunca incluye a la clienta de B", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/top-clients?start=${PERIOD_START}&end=${PERIOD_END}&limit=10`);
    expect(body.some((c: any) => c.clientId === clientBId)).toBe(false);
  });

  it("12d. collected-payments/pending-installments-totals de B son independientes de A", async () => {
    const collectedB = await reportsFor(cookieB, "/api/reports/collected-payments");
    const pendingB = await reportsFor(cookieB, "/api/reports/pending-installments-totals");
    expect(collectedB.body.totalCollected).toBe(0); // B no tiene ninguna cuota pagada
    expect(pendingB.body.totalPendingAmount).toBe(3000); // solo la venta propia de B
  });

  it("12e. product-cost-summary de A nunca incluye el costo del producto de B", async () => {
    const { body } = await reportsFor(cookieA, `/api/reports/product-cost-summary?start=${PERIOD_START}&end=${PERIOD_END}`);
    // Si incluyera la venta de B (3 * 400 = 1200) el total daría 4200, no 3000.
    expect(body.productCost).toBe(3000);
  });
});

describe("Reportes — datos vacíos, nunca mock (Etapa 7.8, invariante 6)", () => {
  it("15. un período sin ninguna venta devuelve ceros/listas vacías reales, nunca datos inventados", async () => {
    const summary = await reportsFor(cookieA, "/api/reports/sales-summary?start=2020-01-01&end=2020-02-01&groupBy=day");
    expect(summary.body).toEqual([]);

    const products = await reportsFor(cookieA, "/api/reports/top-products?start=2020-01-01&end=2020-02-01");
    expect(products.body).toEqual([]);

    const clients = await reportsFor(cookieA, "/api/reports/top-clients?start=2020-01-01&end=2020-02-01&limit=5");
    expect(clients.body).toEqual([]);

    const cost = await reportsFor(cookieA, "/api/reports/product-cost-summary?start=2020-01-01&end=2020-02-01");
    expect(cost.body).toEqual({ productCost: 0, hasIncompleteCostData: false });
  });
});
