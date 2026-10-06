import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, products, productStock } from "@shared/schema";
import { findCostEqualsPriceRows, applyCostEqualsPriceFix } from "../../script/check-cost-equals-price";

/**
 * Prompt 2 — chequeo #1 del plan de migración (cost_price = precio). Confirmado leyendo el
 * código que el camino normal de la app ("Sin descuento") nunca produce este dato — este test
 * simula el caso de todas formas, insertando la fila "sospechosa" directamente en la base
 * (como si hubiera entrado por una importación vieja u otro camino no revisado), para
 * confirmar que el script la encuentra y la corrige si hiciera falta aplicarlo.
 */

let consultantId: number;
let productId: number;

afterAll(async () => {
  if (consultantId) {
    await db.delete(productStock).where(eq(productStock.consultantId, consultantId));
    await db.delete(products).where(eq(products.consultantId, consultantId));
    await db.delete(consultants).where(eq(consultants.id, consultantId));
  }
  await pool.end();
});

describe("check-cost-equals-price — dry-run y fix", () => {
  it("encuentra la fila sospechosa y, al aplicarse, la deja en NULL sin tocar nada más", async () => {
    const [consultant] = await db
      .insert(consultants)
      .values({ businessName: "VITEST cost-equals-price (borrar si queda huérfano)", currency: "ARS" })
      .returning();
    consultantId = consultant.id;

    const [product] = await db
      .insert(products)
      .values({ consultantId, seccion: "VITEST", producto: "Producto sospechoso", precio: 5000, codigo: `vitest-cost-eq-price-${Date.now()}` })
      .returning();
    productId = product.id;

    await db.insert(productStock).values({ consultantId, productId, unidades: 3, costPrice: 5000, selectedDiscount: null });

    const dryRun = await findCostEqualsPriceRows(db);
    const match = dryRun.find((r) => r.productId === productId);
    expect(match).toBeDefined();
    expect(match!.costPrice).toBe(5000);
    expect(match!.unidades).toBe(3); // el dry-run nunca modificó nada

    const fixedCount = await applyCostEqualsPriceFix(db);
    expect(fixedCount).toBeGreaterThanOrEqual(1);

    const [stock] = await db.select().from(productStock).where(eq(productStock.productId, productId));
    expect(stock.costPrice).toBeNull();
    expect(stock.selectedDiscount).toBeNull();
    expect(stock.unidades).toBe(3); // nunca se tocan las unidades

    const afterFix = await findCostEqualsPriceRows(db);
    expect(afterFix.find((r) => r.productId === productId)).toBeUndefined();
  });
});
