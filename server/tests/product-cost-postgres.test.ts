import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, products, productStock, saleItems, saleInstallments, sales, clients, subscriptions } from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Prompt 2 — costo promedio ponderado: la parte delicada es el UPDATE atómico en SQL (un CASE
 * que referencia `unidades`/`cost_price` de la fila VIEJA en la misma sentencia que los
 * actualiza) — no se puede confirmar con MemoryStorage, que hace el mismo cálculo en JS plano.
 * Esto corre contra Postgres real para confirmar que la sintaxis y el redondeo son correctos.
 */

const storage = new DatabaseStorage();
const createdConsultantIds: number[] = [];

async function fixtureConsultant(label: string): Promise<number> {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: `VITEST prompt2 ${label} (borrar si queda huérfano)`, currency: "ARS" })
    .returning();
  createdConsultantIds.push(consultant.id);
  const now = new Date();
  await storage.createTrialSubscription(consultant.id, now, new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000));
  return consultant.id;
}

afterAll(async () => {
  if (createdConsultantIds.length > 0) {
    const saleRows = await db.select({ id: sales.id }).from(sales).where(inArray(sales.consultantId, createdConsultantIds));
    const saleIds = saleRows.map((s) => s.id);
    if (saleIds.length > 0) {
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
      await db.delete(saleInstallments).where(inArray(saleInstallments.saleId, saleIds));
    }
    await db.delete(sales).where(inArray(sales.consultantId, createdConsultantIds));
    await db.delete(clients).where(inArray(clients.consultantId, createdConsultantIds));
    await db.delete(productStock).where(inArray(productStock.consultantId, createdConsultantIds));
    await db.delete(products).where(inArray(products.consultantId, createdConsultantIds));
    await db.delete(subscriptions).where(inArray(subscriptions.consultantId, createdConsultantIds));
    await db.delete(consultants).where(inArray(consultants.id, createdConsultantIds));
  }
  await pool.end();
});

describe("Prompt 2 — costo promedio ponderado sobre Postgres real", () => {
  it("UPDATE atómico: 2 unidades a $14.960 + 3 a $16.320 -> costo $15.776, sin leer-calcular-escribir en JS", async () => {
    const consultantId = await fixtureConsultant("weighted-avg");
    const product = await storage.createProduct(consultantId, {
      seccion: "VITEST",
      producto: "Base TimeWise 3D",
      precio: 27200,
      unidades: 0,
    });

    await storage.incrementProductStockBatch(consultantId, [{ productId: product.id, delta: 2 }], 45);
    await storage.incrementProductStockBatch(consultantId, [{ productId: product.id, delta: 3 }], 40);

    const [stock] = await db
      .select()
      .from(productStock)
      .where(inArray(productStock.productId, [product.id]));
    expect(stock.unidades).toBe(5);
    expect(stock.costPrice).toBe(15776);
  });

  it("redondea a pesos enteros (promedio no exacto)", async () => {
    const consultantId = await fixtureConsultant("rounding");
    const product = await storage.createProduct(consultantId, { seccion: "VITEST", producto: "Producto", precio: 1000, unidades: 0 });

    // 1 unidad a costo 333 (precio 1000 * (1-33%) no es una opción válida de discountOptions,
    // así que armamos el redondeo con descuentos reales: 35% -> 650, luego 1 unidad a 45% -> 550.
    // (1*650 + 1*550) / 2 = 600 exacto -> probamos un caso que SÍ cae en .5 para forzar el redondeo:
    // 3 unidades a 650 + 1 unidad a 550 = (3*650+1*550)/4 = 2500/4 = 625 exacto también.
    // Usamos cantidades que fuerzan un resto: 1*650 + 2*550 = 1750/3 = 583.33... -> redondea a 583.
    await storage.incrementProductStockBatch(consultantId, [{ productId: product.id, delta: 1 }], 35); // costo 650
    await storage.incrementProductStockBatch(consultantId, [{ productId: product.id, delta: 2 }], 45); // costo 550

    const [stock] = await db.select().from(productStock).where(inArray(productStock.productId, [product.id]));
    expect(stock.unidades).toBe(3);
    expect(stock.costPrice).toBe(583); // round(1750/3) = round(583.33...) = 583
  });

  it("un pedido NUNCA recalcula ventas viejas estimadas — la ganancia de una venta vieja no cambia (acuerdo del Prompt 2)", async () => {
    const consultantId = await fixtureConsultant("no-auto-recalc");
    const product = await storage.createProduct(consultantId, { seccion: "VITEST", producto: "Sin costo", precio: 10000, unidades: 5 });
    const [client] = await db.insert(clients).values({ consultantId, name: "Clienta VITEST", phone: "9990009999" }).returning();

    const sale = await storage.createSale(consultantId, {
      clientId: client.id,
      date: "2026-10-06",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 10000 }],
      status: "pendiente",
    } as any);
    expect(sale.profit).not.toBe(0); // estimado con el 35% default, nunca "precio = costo"

    // Llega un pedido real para este producto — el producto toma el costo promedio ponderado,
    // pero la venta vieja queda EXACTAMENTE igual: sigue estimada, con su "≈".
    await storage.incrementProductStockBatch(consultantId, [{ productId: product.id, delta: 10 }], 45);

    const detail = await storage.getSaleDetails(consultantId, sale.id);
    expect(detail!.items[0].costIsEstimated).toBe(true);
    expect(detail!.profit).toBe(sale.profit);
  });

  it("recalculateEstimatedSalesForProduct (llamada directa, simulando 'Editar producto' del Prompt 4) corrige ventas viejas estimadas y recalcula el profit cacheado", async () => {
    const consultantId = await fixtureConsultant("manual-recalc");
    const product = await storage.createProduct(consultantId, { seccion: "VITEST", producto: "Sin costo", precio: 10000, unidades: 5 });
    const [client] = await db.insert(clients).values({ consultantId, name: "Clienta VITEST", phone: "9990009998" }).returning();

    const sale = await storage.createSale(consultantId, {
      clientId: client.id,
      date: "2026-10-06",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 10000 }],
      status: "pendiente",
    } as any);
    expect(sale.profit).not.toBe(0);

    // Simula la carga manual de costo desde "Editar producto" (Prompt 4, todavía no tiene UI):
    // llamar a esta función es exactamente lo que ese endpoint futuro va a hacer.
    await storage.recalculateEstimatedSalesForProduct(consultantId, product.id, 5500);

    const detail = await storage.getSaleDetails(consultantId, sale.id);
    expect(detail!.items[0].costIsEstimated).toBe(false);
    expect(detail!.items[0].costPrice).toBe(5500);
    expect(detail!.profit).toBe(4500); // 10000 - 5500
  });
});
