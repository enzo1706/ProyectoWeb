import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, clients, sales } from "@shared/schema";
import { backfillShippingCharged } from "../../script/backfill-shipping-charged";

/**
 * Etapa I-B.7-D-C — demuestra, contra Postgres real (nunca DATABASE_URL), que el backfill de
 * `shipping_charged` preserva exactamente los valores históricos de `total`/`profit`: el
 * backfill SOLO mueve `shipping_cost` -> `shipping_charged` y limpia `shipping_cost`, nunca
 * recalcula ni toca ninguna otra columna. Los datos son 100% sintéticos, insertados acá mismo
 * simulando una venta creada ANTES de esta etapa (con el schema/comportamiento viejo).
 */

// No se usa `storage` acá a propósito: se inserta directo con Drizzle para simular fielmente
// una fila "vieja" tal como habría quedado escrita por el código anterior a esta etapa.
let testConsultantId: number;
let testClientId: number;
const saleIds: number[] = [];

beforeAll(async () => {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: "VITEST shipping-migration (borrar si queda huérfano)", currency: "ARS" })
    .returning();
  testConsultantId = consultant.id;

  const [client] = await db
    .insert(clients)
    .values({ consultantId: testConsultantId, phone: "0000000002" })
    .returning();
  testClientId = client.id;
});

afterAll(async () => {
  if (saleIds.length > 0) {
    await db.delete(sales).where(inArray(sales.id, saleIds));
  }
  await db.delete(clients).where(eq(clients.consultantId, testConsultantId));
  await db.delete(consultants).where(eq(consultants.id, testConsultantId));
  await pool.end();
});

describe("Backfill shipping_charged — compatibilidad histórica (Etapa I-B.7-D-C)", () => {
  it("una venta 'pre-migración' (shipping_cost poblado, shipping_charged NULL) se migra sin alterar total/profit", async () => {
    // Simula exactamente cómo quedó una venta real creada ANTES de esta etapa: `shippingCost`
    // (el campo viejo) tiene el valor que se cobró por envío, `shippingCharged` todavía no
    // existe para esta fila (NULL, columna recién agregada), y `total`/`profit` ya están
    // calculados con la fórmula VIEJA (profit ignoraba el envío por completo).
    const [historicalSale] = await db
      .insert(sales)
      .values({
        consultantId: testConsultantId,
        clientId: testClientId,
        clientName: "Clienta histórica VITEST",
        date: "2025-01-01",
        subtotal: 1000,
        orderDiscountType: null,
        orderDiscountValue: null,
        orderSurchargeType: null,
        orderSurchargeValue: null,
        shippingCharged: null, // pre-migración: columna nueva, todavía sin poblar
        shippingCost: 200, // valor viejo: lo que efectivamente se cobró por envío
        total: 1200,
        profit: 400, // fórmula vieja: (unitPrice-cost)*qty, sin restar/sumar nada de envío
        paymentMethod: "efectivo",
        installmentsCount: 1,
        status: "pendiente",
      })
      .returning();
    saleIds.push(historicalSale.id);

    const migratedCount = await backfillShippingCharged(db);
    expect(migratedCount).toBeGreaterThanOrEqual(1);

    const [afterMigration] = await db.select().from(sales).where(eq(sales.id, historicalSale.id));

    // El valor histórico de shippingCost pasó a shippingCharged, tal cual, sin recalcular.
    expect(afterMigration.shippingCharged).toBe(200);
    // El costo real de envío de esta venta histórica nunca fue registrado por separado —
    // queda explícitamente sin informar, nunca se inventa un valor.
    expect(afterMigration.shippingCost).toBeNull();

    // LO CRÍTICO: total y profit son EXACTAMENTE los mismos que antes del backfill. El
    // backfill no recalcula nada — nunca se aplica la fórmula nueva a ventas históricas.
    expect(afterMigration.total).toBe(1200);
    expect(afterMigration.profit).toBe(400);
    expect(afterMigration.subtotal).toBe(1000);
  });

  it("el backfill es idempotente: correrlo una segunda vez no vuelve a tocar la fila ya migrada", async () => {
    const [historicalSale] = await db
      .insert(sales)
      .values({
        consultantId: testConsultantId,
        clientId: testClientId,
        clientName: "Clienta histórica VITEST 2",
        date: "2025-02-01",
        subtotal: 500,
        shippingCharged: null,
        shippingCost: 90,
        total: 590,
        profit: 150,
        paymentMethod: "efectivo",
        installmentsCount: 1,
        status: "pendiente",
      })
      .returning();
    saleIds.push(historicalSale.id);

    const firstRun = await backfillShippingCharged(db);
    expect(firstRun).toBeGreaterThanOrEqual(1);

    const [afterFirst] = await db.select().from(sales).where(eq(sales.id, historicalSale.id));
    expect(afterFirst.shippingCharged).toBe(90);
    expect(afterFirst.shippingCost).toBeNull();

    // Segunda corrida: esta fila ya tiene shippingCharged no-null -> el WHERE del backfill
    // (isNull(shippingCharged) AND isNotNull(shippingCost)) ya no la selecciona.
    await backfillShippingCharged(db);
    const [afterSecond] = await db.select().from(sales).where(eq(sales.id, historicalSale.id));
    expect(afterSecond.shippingCharged).toBe(90); // sin cambios
    expect(afterSecond.shippingCost).toBeNull(); // sin cambios
    expect(afterSecond.total).toBe(590);
    expect(afterSecond.profit).toBe(150);
  });

  it("una venta 'nueva' (ya con shippingCharged propio) nunca es tocada por el backfill", async () => {
    const [newSale] = await db
      .insert(sales)
      .values({
        consultantId: testConsultantId,
        clientId: testClientId,
        clientName: "Clienta nueva VITEST",
        date: "2026-09-07",
        subtotal: 1000,
        shippingCharged: 200, // ya viene con el campo nuevo poblado (post-etapa)
        shippingCost: 120, // y con el costo real ya informado
        total: 1200,
        profit: 480, // ya calculado con la fórmula nueva: 1200 - 600(costo) - 120
        paymentMethod: "efectivo",
        installmentsCount: 1,
        status: "pendiente",
      })
      .returning();
    saleIds.push(newSale.id);

    await backfillShippingCharged(db);

    const [after] = await db.select().from(sales).where(eq(sales.id, newSale.id));
    expect(after.shippingCharged).toBe(200); // intacto
    expect(after.shippingCost).toBe(120); // intacto — el backfill nunca borra un costo real ya informado
    expect(after.total).toBe(1200);
    expect(after.profit).toBe(480);
  });
});
