import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { consultants, products, productStock, clients, sales, saleItems, saleInstallments } from "@shared/schema";
import { DatabaseStorage, SaleValidationError } from "../storage";

/**
 * Pega contra la base PostgreSQL real (misma DATABASE_URL que usa la app) — no hay forma
 * de probar el lock `FOR UPDATE` de verdad contra memoria, el punto es la concurrencia real
 * de Postgres. Todos los datos son fixtures propios, creados y borrados acá mismo; nunca
 * toca los 182 productos reales, las consultoras reales ni ninguna clienta real.
 */

const storage = new DatabaseStorage();
let testConsultantId: number;
let testProductId: number;
let testClientId: number;

beforeAll(async () => {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: "VITEST stock-concurrency (borrar si queda huérfano)", currency: "ARS" })
    .returning();
  testConsultantId = consultant.id;

  const [product] = await db
    .insert(products)
    .values({
      consultantId: testConsultantId,
      seccion: "VITEST",
      producto: "Producto de prueba — concurrencia de stock",
      variante: "Estándar",
      codigo: `vitest-concurrency-${Date.now()}`,
      puntos: 0,
      precio: 1000,
      source: "manual",
    })
    .returning();
  testProductId = product.id;

  const [client] = await db
    .insert(clients)
    .values({ consultantId: testConsultantId, phone: "0000000001" })
    .returning();
  testClientId = client.id;

  await db.insert(productStock).values({
    consultantId: testConsultantId,
    productId: testProductId,
    unidades: 10,
    stockMinimo: 0,
    costPrice: 500,
  });
});

afterAll(async () => {
  // Las ventas creadas por el test referencian products/clients por FK — hay que borrarlas
  // primero, o el DELETE de products más abajo falla con una violación de foreign key.
  const testSales = await db.select({ id: sales.id }).from(sales).where(eq(sales.consultantId, testConsultantId));
  const saleIds = testSales.map((s) => s.id);
  if (saleIds.length > 0) {
    await db.delete(saleInstallments).where(inArray(saleInstallments.saleId, saleIds));
    await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
    await db.delete(sales).where(inArray(sales.id, saleIds));
  }
  await db.delete(productStock).where(eq(productStock.consultantId, testConsultantId));
  await db.delete(products).where(eq(products.consultantId, testConsultantId));
  await db.delete(clients).where(eq(clients.consultantId, testConsultantId));
  await db.delete(consultants).where(eq(consultants.id, testConsultantId));
  await pool.end();
});

function saleOf(quantity: number) {
  return {
    clientId: testClientId,
    date: "2026-01-01",
    items: [{ productId: testProductId, quantity }],
    installments: [{ amount: quantity * 1000 }],
    paymentMethod: "efectivo" as const,
    status: "entregado" as const,
  };
}

describe("Condición de carrera de stock", () => {
  it("stock=10, ventas simultáneas de 6+6 — nunca venden 12, la rechazada no deja rastro", async () => {
    const results = await Promise.allSettled([
      storage.createSale(testConsultantId, saleOf(6)),
      storage.createSale(testConsultantId, saleOf(6)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactamente UNA de las dos ventas puede prosperar — la otra tiene que fallar por
    // stock insuficiente, no las dos, y nunca las dos al mismo tiempo con éxito.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/stock insuficiente/i);

    const [stockRow] = await db.select().from(productStock).where(eq(productStock.productId, testProductId));
    expect(stockRow.unidades).toBe(4); // 10 - 6 de la que ganó, nunca negativo ni "-2"

    // La transacción rechazada hizo rollback correctamente: no quedó ninguna venta a medias
    // (sale sin items, o con stock ya descontado dos veces) — hay exactamente 1 venta real.
    const salesForClient = await storage.getSalesByClient(testConsultantId, testClientId);
    expect(salesForClient).toHaveLength(1);
    expect(salesForClient[0].items).toHaveLength(1);
    expect(salesForClient[0].items[0].quantity).toBe(6);
  });
});
