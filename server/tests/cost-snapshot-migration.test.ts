import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, clients, sales, saleItems } from "@shared/schema";

/**
 * Etapa I-B.7-D-D — demuestra, contra Postgres real (nunca DATABASE_URL), que una venta
 * "pre-D-D" (sus sale_items con cost_price NULL, tal como quedó cualquier venta creada antes
 * de esta etapa, ya que la columna es nueva y nadie hizo backfill) se lee sin romper, sin que
 * nada invente un costo, y sin que sales.profit/total cambien por el solo hecho de leerla.
 * No hay ningún backfill de sale_items.cost_price en esta etapa — a diferencia de
 * shippingCharged en D-C, acá no existe ninguna fuente confiable para reconstruir el costo
 * histórico por línea de ventas con más de un producto, así que se deja NULL a propósito.
 */

let testConsultantId: number;
let testClientId: number;
const saleIds: number[] = [];

beforeAll(async () => {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: "VITEST cost-snapshot-migration (borrar si queda huérfano)", currency: "ARS" })
    .returning();
  testConsultantId = consultant.id;

  const [client] = await db
    .insert(clients)
    .values({ consultantId: testConsultantId, phone: "0000000003" })
    .returning();
  testClientId = client.id;
});

afterAll(async () => {
  if (saleIds.length > 0) {
    await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
    await db.delete(sales).where(inArray(sales.id, saleIds));
  }
  await db.delete(clients).where(eq(clients.consultantId, testConsultantId));
  await db.delete(consultants).where(eq(consultants.id, testConsultantId));
  await pool.end();
});

describe("sale_items.cost_price NULL (venta histórica pre-D-D) — Etapa I-B.7-D-D", () => {
  it("una venta con sale_items.cost_price NULL se inserta y se lee sin romper, sin inventar un costo y sin alterar profit/total", async () => {
    // Simula exactamente cómo quedó una venta real creada ANTES de esta etapa: sus sale_items
    // nunca tuvieron cost_price (la columna no existía todavía), y sales.profit ya está
    // calculado con el modelo agregado de D-C (sin desglose por línea).
    const [historicalSale] = await db
      .insert(sales)
      .values({
        consultantId: testConsultantId,
        clientId: testClientId,
        clientName: "Clienta histórica VITEST (pre-D-D)",
        date: "2025-06-01",
        subtotal: 3000, // 1000*2 + 2000*1
        total: 3000,
        profit: 1400, // agregado ya calculado con D-C, sin desglose por línea
        paymentMethod: "efectivo",
        installmentsCount: 1,
        status: "pendiente",
      })
      .returning();
    saleIds.push(historicalSale.id);

    await db.insert(saleItems).values([
      {
        saleId: historicalSale.id,
        productId: null, // el producto también podría no existir más — no es relevante acá
        productName: "Producto histórico A",
        category: "VITEST",
        quantity: 2,
        originalPrice: 1000,
        price: 1000,
        costPrice: null, // pre-D-D: nunca se registró
      },
      {
        saleId: historicalSale.id,
        productId: null,
        productName: "Producto histórico B",
        category: "VITEST",
        quantity: 1,
        originalPrice: 2000,
        price: 2000,
        costPrice: null,
      },
    ]);

    // Lectura: el schema lo acepta (el INSERT de arriba no tiró), y leer no rompe ni infiere
    // nada — costPrice sigue NULL, tal cual, ninguna consulta lo "completa" con el catálogo
    // actual ni con ningún otro valor.
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, historicalSale.id));
    expect(items).toHaveLength(2);
    expect(items[0].costPrice).toBeNull();
    expect(items[1].costPrice).toBeNull();

    // sales.profit/total no cambiaron por el solo hecho de leer la venta — nadie los recalculó.
    const [saleAfterRead] = await db.select().from(sales).where(eq(sales.id, historicalSale.id));
    expect(saleAfterRead.profit).toBe(1400);
    expect(saleAfterRead.total).toBe(3000);

    // Releer una segunda vez para confirmar que no hay ningún efecto lateral acumulativo.
    const [saleAfterSecondRead] = await db.select().from(sales).where(eq(sales.id, historicalSale.id));
    const itemsAfterSecondRead = await db.select().from(saleItems).where(eq(saleItems.saleId, historicalSale.id));
    expect(saleAfterSecondRead.profit).toBe(1400);
    expect(itemsAfterSecondRead[0].costPrice).toBeNull();
    expect(itemsAfterSecondRead[1].costPrice).toBeNull();
  });
});
