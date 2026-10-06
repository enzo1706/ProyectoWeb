import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, products, productStock } from "@shared/schema";
import { DatabaseStorage, ProductValidationError } from "../storage";

/**
 * Prompt 4 — product_stock.price_override contra Postgres real: confirma que el UPSERT (mismo
 * patrón que costPrice/discontinued) funciona con la columna nueva, y que la fila de cada
 * consultora queda aislada (el aislamiento por consultantId+productId del índice único
 * compuesto, no algo que pueda confiarse solo a la lógica en memoria).
 */

const storage = new DatabaseStorage();
const createdConsultantIds: number[] = [];
const createdManualProductIds: number[] = [];
const createdGlobalProductIds: number[] = [];

afterAll(async () => {
  if (createdConsultantIds.length > 0) {
    await db.delete(productStock).where(inArray(productStock.consultantId, createdConsultantIds));
    if (createdManualProductIds.length > 0) {
      await db.delete(products).where(inArray(products.id, createdManualProductIds));
    }
    await db.delete(consultants).where(inArray(consultants.id, createdConsultantIds));
  }
  if (createdGlobalProductIds.length > 0) {
    await db.delete(products).where(inArray(products.id, createdGlobalProductIds));
  }
  await pool.end();
});

async function fixtureConsultant(label: string): Promise<number> {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: `VITEST price-override ${label} (borrar si queda huérfano)`, currency: "ARS" })
    .returning();
  createdConsultantIds.push(consultant.id);
  return consultant.id;
}

async function fixtureGlobalProduct(precio: number) {
  const [product] = await db
    .insert(products)
    .values({ consultantId: null, seccion: "VITEST", producto: "Global", precio, codigo: `vitest-global-${Date.now()}-${Math.random()}` })
    .returning();
  createdGlobalProductIds.push(product.id);
  return product;
}

describe("product_stock.price_override sobre Postgres real", () => {
  it("UPSERT real, aislado por consultora, con costo siempre sobre products.precio", async () => {
    const consultantA = await fixtureConsultant("A");
    const consultantB = await fixtureConsultant("B");
    const product = await fixtureGlobalProduct(20000);

    await storage.setProductPriceOverride(consultantA, product.id, 18000);
    await storage.setProductPriceOverride(consultantB, product.id, 22000);

    const [rowA] = await db
      .select()
      .from(productStock)
      .where(inArray(productStock.consultantId, [consultantA]));
    const [rowB] = await db
      .select()
      .from(productStock)
      .where(inArray(productStock.consultantId, [consultantB]));
    expect(rowA.priceOverride).toBe(18000);
    expect(rowB.priceOverride).toBe(22000);

    const valuationA = await storage.getStockValuation(consultantA);
    // Sin unidades todavía -> $0, pero confirmamos que no tira y que el cálculo corre limpio.
    expect(valuationA.valueAtPrice).toBe(0);
  });

  it("rechaza price_override sobre un producto manual (ProductValidationError)", async () => {
    const consultantId = await fixtureConsultant("manual-reject");
    const [manual] = await db
      .insert(products)
      .values({ consultantId, seccion: "VITEST", producto: "Manual", precio: 5000, codigo: `vitest-manual-${Date.now()}`, source: "manual" })
      .returning();
    createdManualProductIds.push(manual.id);

    await expect(storage.setProductPriceOverride(consultantId, manual.id, 4000)).rejects.toThrow(ProductValidationError);
  });
});
