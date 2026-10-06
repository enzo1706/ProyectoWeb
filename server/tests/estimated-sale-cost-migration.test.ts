import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, clients, products, sales, saleItems, orderDiscountLog } from "@shared/schema";
import { findEstimatedSaleCostCandidates, applyEstimatedSaleCostMigration } from "../../script/migrate-estimated-sale-costs";

/**
 * Prompt 2 — migración #2: simula EXACTAMENTE lo que el bug viejo dejaba (sale_items.cost_price
 * grabado igual al precio) para dos consultoras distintas, cada una con su propio descuento
 * habitual, y confirma que el dry-run las encuentra, la migración las corrige con el
 * descuento de CADA consultora y nunca toca una línea que no cumple el criterio.
 */

const createdConsultantIds: number[] = [];
const createdSaleIds: number[] = [];

afterAll(async () => {
  if (createdSaleIds.length > 0) {
    await db.delete(saleItems).where(inArray(saleItems.saleId, createdSaleIds));
    await db.delete(sales).where(inArray(sales.id, createdSaleIds));
  }
  if (createdConsultantIds.length > 0) {
    await db.delete(orderDiscountLog).where(inArray(orderDiscountLog.consultantId, createdConsultantIds));
    await db.delete(clients).where(inArray(clients.consultantId, createdConsultantIds));
    await db.delete(products).where(inArray(products.consultantId, createdConsultantIds));
    await db.delete(consultants).where(inArray(consultants.id, createdConsultantIds));
  }
  await pool.end();
});

async function fixtureConsultant(label: string) {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: `VITEST estimated-cost ${label} (borrar si queda huérfano)`, currency: "ARS" })
    .returning();
  createdConsultantIds.push(consultant.id);
  const [client] = await db.insert(clients).values({ consultantId: consultant.id, phone: `000${consultant.id}` }).returning();
  const [product] = await db
    .insert(products)
    .values({ consultantId: consultant.id, seccion: "VITEST", producto: `Producto ${label}`, precio: 1000, codigo: `vitest-${label}-${Date.now()}` })
    .returning();
  return { consultantId: consultant.id, clientId: client.id, productId: product.id };
}

async function fixtureHistoricalSale(input: { consultantId: number; clientId: number; productId: number; recordedCost: number; quantity?: number }) {
  const quantity = input.quantity ?? 1;
  const unitPrice = 1000;
  const total = unitPrice * quantity;
  const [sale] = await db
    .insert(sales)
    .values({
      consultantId: input.consultantId,
      clientId: input.clientId,
      clientName: "Clienta histórica VITEST",
      date: "2025-06-01",
      subtotal: total,
      total,
      profit: 0, // como lo dejaba el bug: profit = 0 porque costo = precio
      paymentMethod: "efectivo",
      installmentsCount: 1,
      status: "pendiente",
    })
    .returning();
  createdSaleIds.push(sale.id);
  await db.insert(saleItems).values({
    saleId: sale.id,
    productId: input.productId,
    productName: "Producto histórico",
    category: "VITEST",
    quantity,
    originalPrice: unitPrice,
    price: unitPrice,
    costPrice: input.recordedCost,
    costIsEstimated: null, // pre-Prompt 2: la columna no existía
  });
  return sale.id;
}

describe("migrate-estimated-sale-costs — dry-run y migración real, por consultora", () => {
  it("encuentra las líneas candidatas, las corrige con el descuento habitual de CADA consultora, y nunca toca una línea con costo real", async () => {
    const a = await fixtureConsultant("A");
    const b = await fixtureConsultant("B");

    // Consultora A: tiene un pedido reciente con 50% de descuento -> habitual = 50%.
    await db.insert(orderDiscountLog).values({ consultantId: a.consultantId, discountPercent: 50, publicValueArs: 10000 });
    // Consultora B: nunca cargó un pedido -> habitual = 35% (default).

    const saleAId = await fixtureHistoricalSale({ consultantId: a.consultantId, clientId: a.clientId, productId: a.productId, recordedCost: 1000 });
    const saleBId = await fixtureHistoricalSale({ consultantId: b.consultantId, clientId: b.clientId, productId: b.productId, recordedCost: 1000 });

    // Línea que NO debe tocarse: costo real, distinto del precio y del precio actual del producto.
    const saleRealCostId = await fixtureHistoricalSale({ consultantId: a.consultantId, clientId: a.clientId, productId: a.productId, recordedCost: 600 });
    await db.update(sales).set({ profit: 400 }).where(eq(sales.id, saleRealCostId)); // (1000-600)*1

    const dryRun = await findEstimatedSaleCostCandidates(db);
    const consultantIds = dryRun.byConsultant.map((c) => c.consultantId);
    expect(consultantIds).toContain(a.consultantId);
    expect(consultantIds).toContain(b.consultantId);
    const aSummary = dryRun.byConsultant.find((c) => c.consultantId === a.consultantId)!;
    expect(aSummary.linesToMark).toBe(1); // solo la línea con costo=precio, no la de costo real

    const result = await applyEstimatedSaleCostMigration(db);
    expect(result.linesUpdated).toBeGreaterThanOrEqual(2);

    const [itemA] = await db.select().from(saleItems).where(eq(saleItems.saleId, saleAId));
    expect(itemA.costIsEstimated).toBe(true);
    expect(itemA.costPrice).toBe(500); // 1000 * (1 - 50%)
    const [itemB] = await db.select().from(saleItems).where(eq(saleItems.saleId, saleBId));
    expect(itemB.costIsEstimated).toBe(true);
    expect(itemB.costPrice).toBe(650); // 1000 * (1 - 35% default)

    const [saleAAfter] = await db.select().from(sales).where(eq(sales.id, saleAId));
    expect(saleAAfter.profit).toBe(500); // 1000 - 500
    const [saleBAfter] = await db.select().from(sales).where(eq(sales.id, saleBId));
    expect(saleBAfter.profit).toBe(350); // 1000 - 650

    // La línea con costo real nunca se tocó.
    const [itemRealCost] = await db.select().from(saleItems).where(eq(saleItems.saleId, saleRealCostId));
    expect(itemRealCost.costIsEstimated).toBeNull();
    expect(itemRealCost.costPrice).toBe(600);
    const [saleRealCostAfter] = await db.select().from(sales).where(eq(sales.id, saleRealCostId));
    expect(saleRealCostAfter.profit).toBe(400);

    // Correr la migración una segunda vez no vuelve a tocar nada (idempotente).
    const secondRun = await applyEstimatedSaleCostMigration(db);
    expect(secondRun.linesUpdated).toBe(0);
  });
});
