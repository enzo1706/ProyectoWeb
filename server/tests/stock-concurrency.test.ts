import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, products, productStock, clients, sales, saleItems, saleInstallments } from "@shared/schema";
import { DatabaseStorage, SaleValidationError, ProductConflictError } from "../storage";

/** Segunda consultora, exclusiva del test de aislamiento de tenant del batch de stock (Etapa
 * 7.2) — nunca comparte productos con testConsultantId. */
let otherConsultantId: number;
let otherProductId: number;

/**
 * Pega contra Postgres real vía `TEST_DATABASE_URL` (nunca `DATABASE_URL` — ver
 * `server/test-db.ts`/`server/test-db-guard.ts`, que exigen host loopback y un nombre de base
 * terminado en "_test" antes de dejar abrir ninguna conexión) — no hay forma de probar el lock
 * `FOR UPDATE` de verdad contra memoria, el punto es la concurrencia real de Postgres. Todos
 * los datos son fixtures propios, creados y borrados acá mismo; nunca toca ningún dato real.
 */

const storage = new DatabaseStorage();
let testConsultantId: number;
let testProductId: number;
let testClientId: number;
// Producto/stock aparte, exclusivo de los tests de idempotencia (Etapa I-B.6) — así no
// comparten stock con "Condición de carrera de stock" y no importa el orden de ejecución
// entre describes. Limpiado igual que testProductId: el afterAll de abajo borra TODO lo que
// quede bajo testConsultantId, sin importar el productId.
let idempotencyProductId: number;
// Producto/stock aparte, exclusivo de los tests de profit (Etapa I-B.7-D-C) — costPrice=600,
// stock generoso, mismos números que los ejemplos numéricos de la etapa, sin depender del
// remanente de stock que dejan los demás describes de este archivo.
let profitProductId: number;
// Segundo producto, con costo distinto a profitProductId — exclusivo de los tests de
// snapshot de costo por ítem (Etapa I-B.7-D-D, caso "múltiples productos").
let profitProductBId: number;
// Producto con fila product_stock ya existente (unidades=10) — exclusivo de los tests de
// incremento atómico (Etapa I-B.8-B), así la carrera real no comparte stock con ningún otro
// describe de este archivo.
let incrementProductId: number;
// Producto SIN fila product_stock todavía — exclusivo del caso "primer incremento", que
// ejercita el camino INSERT del upsert (Etapa I-B.8-B).
let incrementFreshProductId: number;

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

  const [idempotencyProduct] = await db
    .insert(products)
    .values({
      consultantId: testConsultantId,
      seccion: "VITEST",
      producto: "Producto de prueba — idempotencia concurrente",
      variante: "Estándar",
      codigo: `vitest-idempotency-${Date.now()}`,
      puntos: 0,
      precio: 1000,
      source: "manual",
    })
    .returning();
  idempotencyProductId = idempotencyProduct.id;

  await db.insert(productStock).values({
    consultantId: testConsultantId,
    productId: idempotencyProductId,
    unidades: 20,
    stockMinimo: 0,
    costPrice: 500,
  });

  const [profitProduct] = await db
    .insert(products)
    .values({
      consultantId: testConsultantId,
      seccion: "VITEST",
      producto: "Producto de prueba — profit",
      variante: "Estándar",
      codigo: `vitest-profit-${Date.now()}`,
      puntos: 0,
      precio: 1000,
      source: "manual",
    })
    .returning();
  profitProductId = profitProduct.id;

  await db.insert(productStock).values({
    consultantId: testConsultantId,
    productId: profitProductId,
    unidades: 50,
    stockMinimo: 0,
    costPrice: 600,
  });

  const [profitProductB] = await db
    .insert(products)
    .values({
      consultantId: testConsultantId,
      seccion: "VITEST",
      producto: "Producto de prueba — profit B",
      variante: "Estándar",
      codigo: `vitest-profit-b-${Date.now()}`,
      puntos: 0,
      precio: 2000,
      source: "manual",
    })
    .returning();
  profitProductBId = profitProductB.id;

  await db.insert(productStock).values({
    consultantId: testConsultantId,
    productId: profitProductBId,
    unidades: 50,
    stockMinimo: 0,
    costPrice: 1300,
  });

  const [incrementProduct] = await db
    .insert(products)
    .values({
      consultantId: testConsultantId,
      seccion: "VITEST",
      producto: "Producto de prueba — incremento atómico",
      variante: "Estándar",
      codigo: `vitest-increment-${Date.now()}`,
      puntos: 0,
      precio: 1000,
      source: "manual",
    })
    .returning();
  incrementProductId = incrementProduct.id;

  await db.insert(productStock).values({
    consultantId: testConsultantId,
    productId: incrementProductId,
    unidades: 10,
    stockMinimo: 0,
  });

  const [incrementFreshProduct] = await db
    .insert(products)
    .values({
      consultantId: testConsultantId,
      seccion: "VITEST",
      producto: "Producto de prueba — incremento sin fila de stock previa",
      variante: "Estándar",
      codigo: `vitest-increment-fresh-${Date.now()}`,
      puntos: 0,
      precio: 1000,
      source: "manual",
    })
    .returning();
  incrementFreshProductId = incrementFreshProduct.id;
  // A propósito, sin insert en product_stock — este producto no tiene fila todavía.

  const [otherConsultant] = await db
    .insert(consultants)
    .values({ businessName: "VITEST stock-concurrency — otra consultora (borrar si queda huérfano)", currency: "ARS" })
    .returning();
  otherConsultantId = otherConsultant.id;

  const [otherProduct] = await db
    .insert(products)
    .values({
      consultantId: otherConsultantId,
      seccion: "VITEST",
      producto: "Producto MANUAL de otra consultora — batch stock",
      variante: "Estándar",
      codigo: `vitest-batch-other-tenant-${Date.now()}`,
      puntos: 0,
      precio: 1000,
      source: "manual",
    })
    .returning();
  otherProductId = otherProduct.id;
  await db.insert(productStock).values({ consultantId: otherConsultantId, productId: otherProductId, unidades: 50, stockMinimo: 0 });
});

afterAll(async () => {
  await db.delete(productStock).where(eq(productStock.consultantId, otherConsultantId));
  await db.delete(products).where(eq(products.consultantId, otherConsultantId));
  await db.delete(consultants).where(eq(consultants.id, otherConsultantId));
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

function idempotentSaleOf(quantity: number, clientRequestId: string) {
  return {
    clientId: testClientId,
    date: "2026-01-01",
    items: [{ productId: idempotencyProductId, quantity }],
    installments: [{ amount: quantity * 1000 }],
    paymentMethod: "efectivo" as const,
    status: "entregado" as const,
    clientRequestId,
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

describe("Idempotencia bajo concurrencia real (clientRequestId, Etapa I-B.6)", () => {
  it("mismo clientRequestId + mismo payload, dos requests simultáneos -> una sola venta, un solo descuento de stock", async () => {
    const key = randomUUID();
    const [stockBefore] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));

    // Los dos parten del mismo estado (ninguno ve todavía al otro) -> exactamente uno de los
    // dos INSERT gana la carrera en Postgres; el otro debe recuperar esa misma venta, nunca
    // fallar y nunca crear una segunda fila. Ver DatabaseStorage.createSale, catch de 23505.
    const [saleA, saleB] = await Promise.all([
      storage.createSale(testConsultantId, idempotentSaleOf(4, key)),
      storage.createSale(testConsultantId, idempotentSaleOf(4, key)),
    ]);

    expect(saleA.id).toBe(saleB.id);

    const matchingSales = await db.select().from(sales).where(eq(sales.clientRequestId, key));
    expect(matchingSales).toHaveLength(1); // nunca dos filas para el mismo (consultantId, clientRequestId)

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleA.id));
    expect(items).toHaveLength(1);
    const installments = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, saleA.id));
    expect(installments).toHaveLength(1);

    const [stockAfter] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));
    expect(stockAfter.unidades).toBe(stockBefore.unidades - 4); // descontado una sola vez, no dos
  });

  it("clientRequestId distintos, mismo producto, dos requests simultáneos -> dos ventas legítimas, stock descontado dos veces, nunca negativo", async () => {
    const [stockBefore] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));

    const results = await Promise.allSettled([
      storage.createSale(testConsultantId, idempotentSaleOf(2, randomUUID())),
      storage.createSale(testConsultantId, idempotentSaleOf(2, randomUUID())),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof storage.createSale>>>[];
    expect(fulfilled).toHaveLength(2); // hay stock de sobra para las dos, ninguna debería rechazarse
    expect(fulfilled[0].value.id).not.toBe(fulfilled[1].value.id);

    const [stockAfter] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));
    expect(stockAfter.unidades).toBe(stockBefore.unidades - 4); // 2 + 2, nunca negativo
    expect(stockAfter.unidades).toBeGreaterThanOrEqual(0);
  });
});

describe("Protección de cuotas pagadas al editar (Etapa I-B.7-B)", () => {
  it("venta con una cuota pagada -> updateSale la rechaza, installments/items/stock quedan intactos", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }, { amount: 1000 }],
      status: "pendiente",
    });

    const allInstallments = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, sale.id));
    const firstInstallment = allInstallments.find((i) => i.installmentNumber === 1)!;
    await storage.updateInstallmentStatus(testConsultantId, sale.id, firstInstallment.id, "pagado");

    const itemsBefore = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const [stockBeforePatch] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));

    await expect(
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: idempotencyProductId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
      }),
    ).rejects.toThrow(/cuotas pagadas/i);

    // installments: exactamente las mismas filas (mismos IDs), el pago sigue ahí.
    const installmentsAfter = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, sale.id));
    expect(installmentsAfter).toHaveLength(2);
    expect(installmentsAfter.find((i) => i.id === firstInstallment.id)?.status).toBe("pagado");
    expect(installmentsAfter.find((i) => i.installmentNumber === 2)?.status).toBe("pendiente");

    // sale_items: sin cambios.
    const itemsAfter = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(itemsAfter).toEqual(itemsBefore);

    // stock: sin cambios (el rechazo ocurre antes de tocar product_stock).
    const [stockAfter] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));
    expect(stockAfter.unidades).toBe(stockBeforePatch.unidades);
  });

  it("venta sin cuotas pagadas -> updateSale sigue funcionando exactamente igual que antes de esta etapa", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
      status: "pendiente",
    });

    const updated = await storage.updateSale(testConsultantId, sale.id, {
      items: [{ productId: idempotencyProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(updated?.total).toBe(1000);
  });

  it("concurrencia real: updateInstallmentStatus marcando pagado + updateSale simultáneos sobre la misma venta", async () => {
    // Este test documenta el resultado de la carrera descrita en el informe de esta etapa
    // (punto J) — NO asume cuál de los dos gana (depende del timing real de Postgres), solo
    // verifica la invariante que sí debe sostenerse siempre: nunca queda una cuota marcada
    // "pagado" con éxito aparente que la edición haya podido borrar sin que updateSale la
    // haya visto. La carrera de fondo (que updateInstallmentStatus no tenga transacción/lock
    // propio) es el hallazgo I-B.7-A [3] — queda para I-B.7-C, no se toca acá.
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }, { amount: 1000 }],
      status: "pendiente",
    });
    const allInstallments = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, sale.id));
    const targetInstallmentId = allInstallments.find((i) => i.installmentNumber === 1)!.id;

    const [installmentResult, editResult] = await Promise.allSettled([
      storage.updateInstallmentStatus(testConsultantId, sale.id, targetInstallmentId, "pagado"),
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: idempotencyProductId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
      }),
    ]);

    const installmentSucceeded = installmentResult.status === "fulfilled" && installmentResult.value !== undefined;
    const editSucceeded = editResult.status === "fulfilled";

    // Nunca deberían "ganar" los dos: si la edición reemplazó las cuotas, el UPDATE de
    // updateInstallmentStatus (sobre el ID viejo) no debería poder afectar ninguna fila real.
    expect(installmentSucceeded && editSucceeded).toBe(false);

    if (editSucceeded) {
      expect(installmentSucceeded).toBe(false);
    } else {
      expect((editResult as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
      expect((editResult as PromiseRejectedResult).reason.message).toMatch(/cuotas pagadas/i);
    }
  });
});

describe("Concurrencia de cancelación/cuotas/edición (Etapa I-B.7-C)", () => {
  it("Test 1 — doble cancelación concurrente: exactamente una gana, stock restaurado una sola vez", async () => {
    const [stockBeforeSale] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));

    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
      status: "pendiente",
    });

    const results = await Promise.allSettled([
      storage.cancelSale(testConsultantId, sale.id),
      storage.cancelSale(testConsultantId, sale.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1); // exactamente una cancelación exitosa
    expect(rejected).toHaveLength(1); // la otra rechaza
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/ya está cancelada/i);

    const [finalSale] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(finalSale.status).toBe("cancelada");

    // El punto central del hallazgo I-B.7-A [1]: sin el lock de `sales`, esto podía terminar
    // en stockBeforeSale + 2 (restaurado dos veces). Con el lock, vuelve exactamente al valor
    // previo a la venta — nunca de más, nunca de menos.
    const [finalStock] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));
    expect(finalStock.unidades).toBe(stockBeforeSale.unidades);
  });

  it("Test 2 — cancelación + pago de cuota concurrentes: nunca un pago se pierde en silencio contra una cancelación ya ganadora", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      status: "pendiente",
    });
    const [installment] = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, sale.id));

    const [cancelResult, installmentResult] = await Promise.allSettled([
      storage.cancelSale(testConsultantId, sale.id),
      storage.updateInstallmentStatus(testConsultantId, sale.id, installment.id, "pagado"),
    ]);

    // La única cancelación del test siempre debería lograrse (nada más cancela esta venta).
    expect(cancelResult.status).toBe("fulfilled");
    const [finalSale] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(finalSale.status).toBe("cancelada");

    const [finalInstallment] = await db.select().from(saleInstallments).where(eq(saleInstallments.id, installment.id));

    if (installmentResult.status === "fulfilled") {
      // El pago ganó el lock de `sales` primero: corrió y committeó mientras la venta seguía
      // activa, y la cancelación operó DESPUÉS sobre ese estado ya actualizado. Es una
      // secuencia válida — no existe ninguna regla en el dominio actual que prohíba cancelar
      // una venta que ya tiene una cuota pagada (esa regla NO se agrega en esta etapa, ver
      // informe, análisis del "Caso A" del pedido).
      expect(finalInstallment.status).toBe("pagado");
    } else {
      // La cancelación ganó el lock primero: el intento de pago, al obtener el lock después,
      // vio la venta ya cancelada y fue rechazado explícitamente — nunca se pierde en
      // silencio con una respuesta 200 fantasma.
      expect(finalInstallment.status).toBe("pendiente");
      expect((installmentResult as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
      expect((installmentResult as PromiseRejectedResult).reason.message).toMatch(/venta cancelada/i);
    }
  });

  it("Test 3 — updateSale + cancelSale concurrentes: nunca una edición completa después de una cancelación ya ganadora", async () => {
    const [stockBeforeSale] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));

    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
      status: "pendiente",
    });

    const [updateResult, cancelResult] = await Promise.allSettled([
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: idempotencyProductId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
      }),
      storage.cancelSale(testConsultantId, sale.id),
    ]);

    // La cancelación (única en el test) siempre debería lograrse, gane quien gane la carrera.
    expect(cancelResult.status).toBe("fulfilled");
    const [finalSale] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(finalSale.status).toBe("cancelada");
    const finalItems = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(finalItems).toHaveLength(1);

    if (updateResult.status === "fulfilled") {
      // La edición ganó el lock primero: la cancelación, al obtener el lock después, canceló
      // sobre la composición YA EDITADA (1 unidad), no sobre la original.
      expect(finalItems[0].quantity).toBe(1);
    } else {
      // La cancelación ganó primero: la edición, al obtener el lock después, vio la venta ya
      // cancelada y fue rechazada explícitamente — nunca terminó escribiendo sobre ella.
      expect((updateResult as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
      expect((updateResult as PromiseRejectedResult).reason.message).toMatch(/venta cancelada/i);
      expect(finalItems[0].quantity).toBe(2); // la composición original, nunca tocada
    }

    // Invariante fuerte, sin importar quién ganó: el stock siempre vuelve exactamente al
    // valor previo a la venta — nunca de más (doble devolución) ni de menos (reserva
    // huérfana). Antes de esta etapa, este mismo escenario podía dejar el stock corrupto
    // (hallazgo I-B.7-A [5-E]).
    const [finalStock] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));
    expect(finalStock.unidades).toBe(stockBeforeSale.unidades);
  });

  it("Test 4 — updateInstallmentStatus + updateSale concurrentes, bajo el nuevo lock compartido de `sales`: nunca un 200 fantasma", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      status: "pendiente",
    });
    const [installment] = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, sale.id));

    const [installmentResult, updateResult] = await Promise.allSettled([
      storage.updateInstallmentStatus(testConsultantId, sale.id, installment.id, "pagado"),
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: idempotencyProductId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
      }),
    ]);

    const installmentSucceeded = installmentResult.status === "fulfilled" && installmentResult.value !== undefined;
    const updateSucceeded = updateResult.status === "fulfilled";

    // Con el lock compartido de `sales` (primer paso de ambas transacciones desde esta
    // etapa), el resultado es determinístico según quién gane ese lock primero — nunca los
    // dos "ganan" de forma incoherente.
    if (installmentSucceeded) {
      // El pago ganó el lock primero y committeó mientras la venta seguía sin cuotas
      // pagadas -> la edición, al tomar el lock después, ve la cuota ya pagada (I-B.7-B) y
      // se rechaza.
      expect(updateSucceeded).toBe(false);
      expect((updateResult as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
      expect((updateResult as PromiseRejectedResult).reason.message).toMatch(/cuotas pagadas/i);
    } else if (updateSucceeded) {
      // La edición ganó el lock primero, vio 0 cuotas pagadas y reemplazó las installments
      // -> el intento de pago, al tomar el lock después, busca el `installmentId` viejo, que
      // ya no existe: no tiene efecto (undefined), nunca un 200 fantasma.
      expect(installmentResult.status).toBe("fulfilled");
      expect((installmentResult as PromiseFulfilledResult<unknown>).value).toBeUndefined();
    } else {
      expect.fail("Alguna de las dos operaciones debería haber tenido éxito");
    }
  });

  it("Test 5 — dos updateSale concurrentes: sin stock negativo, sin doble devolución, resultado matemáticamente coherente", async () => {
    const [stockBeforeSale] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));

    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: idempotencyProductId, quantity: 2 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
      status: "pendiente",
    });

    const results = await Promise.allSettled([
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: idempotencyProductId, quantity: 3 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 3000 }],
      }),
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: idempotencyProductId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
      }),
    ]);

    // Ambas son válidas individualmente (ninguna choca con stock insuficiente ni con la
    // protección de cuotas pagadas) -> con el lock de `sales` serializándolas una detrás de
    // la otra (nunca intercaladas), las dos deberían poder completarse: la segunda en
    // ejecutar simplemente reemplaza lo que dejó la primera. Semántica ya conocida y
    // aceptada: last-write-wins sobre `sale_items`/`sale_installments` (ver informe I-B.7-A,
    // sección 2 Caso F) — lo que este test verifica es que el STOCK nunca queda corrupto por
    // esa superposición.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const finalItems = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(finalItems).toHaveLength(1);
    const finalQuantity = finalItems[0].quantity;
    // La composición final es la de quien haya escrito último -> 1 o 3, nunca otra cosa.
    expect([1, 3]).toContain(finalQuantity);

    const [finalStock] = await db.select().from(productStock).where(eq(productStock.productId, idempotencyProductId));
    expect(finalStock.unidades).toBeGreaterThanOrEqual(0); // nunca negativo
    // El stock reservado debe corresponder EXACTAMENTE a la composición final ganadora — ni
    // más (reserva huérfana de la que perdió) ni menos (falta descontar la que ganó).
    expect(finalStock.unidades).toBe(stockBeforeSale.unidades - finalQuantity);
  });
});

describe("Ganancia (profit) — Etapa I-B.7-D-C, contra Postgres real", () => {
  it("createSale: profit persiste correctamente en DB real con descuento + recargo + envío cobrado + costo real de envío", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: { type: "percent", value: 20 },
      orderSurcharge: { type: "percent", value: 10 },
      shippingCharged: 200,
      shippingCost: 120,
      paymentMethod: "efectivo",
      installments: [{ amount: 1100 }],
      status: "pendiente",
    });

    expect(sale.total).toBe(1100); // 1000 - 200 + 100 + 200
    expect(sale.profit).toBe(380); // 1100 - 600(costo) - 120(costo real de envío)

    const [persisted] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(persisted.total).toBe(1100);
    expect(persisted.profit).toBe(380);
    expect(persisted.shippingCharged).toBe(200);
    expect(persisted.shippingCost).toBe(120);
  });

  it("updateSale: cada cambio (descuento/recargo/shippingCharged/shippingCost) recalcula profit correctamente en DB real, sin romper la protección de I-B.7-B", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      status: "pendiente",
    });
    expect(sale.profit).toBe(400); // 1000 - 600

    const afterDiscount = await storage.updateSale(testConsultantId, sale.id, {
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: { type: "percent", value: 20 },
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 800 }],
    });
    expect(afterDiscount?.profit).toBe(200); // 800 - 600

    const afterSurcharge = await storage.updateSale(testConsultantId, sale.id, {
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: { type: "percent", value: 10 },
      paymentMethod: "efectivo",
      installments: [{ amount: 1100 }],
    });
    expect(afterSurcharge?.profit).toBe(500); // 1100 - 600

    const afterShippingCharged = await storage.updateSale(testConsultantId, sale.id, {
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      shippingCharged: 300,
      paymentMethod: "efectivo",
      installments: [{ amount: 1300 }],
    });
    expect(afterShippingCharged?.total).toBe(1300);
    expect(afterShippingCharged?.profit).toBe(700); // 1300 - 600 - 0 (shippingCost no informado)

    const afterShippingCost = await storage.updateSale(testConsultantId, sale.id, {
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      shippingCharged: 300,
      shippingCost: 150,
      paymentMethod: "efectivo",
      installments: [{ amount: 1300 }],
    });
    expect(afterShippingCost?.profit).toBe(550); // 1300 - 600 - 150

    // La regla de I-B.7-B sigue intacta: si esta venta tuviera una cuota pagada, cualquiera
    // de las ediciones de arriba debería haber sido rechazada — se confirma acá con un caso
    // real, marcando la única cuota como pagada y reintentando.
    const [installment] = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, sale.id));
    await storage.updateInstallmentStatus(testConsultantId, sale.id, installment.id, "pagado");
    await expect(
      storage.updateSale(testConsultantId, sale.id, {
        items: [{ productId: profitProductId, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1300 }],
      }),
    ).rejects.toThrow(/cuotas pagadas/i);
  });
});

describe("Snapshot histórico de costo por ítem (saleItem.costPrice) — Etapa I-B.7-D-D, contra Postgres real", () => {
  it("createSale con múltiples productos: cada línea persiste SU propio costPrice en DB real (resuelve F4)", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [
        { productId: profitProductId, quantity: 2 }, // precio 1000, costo 600
        { productId: profitProductBId, quantity: 1 }, // precio 2000, costo 1300
      ],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 4000 }],
      status: "pendiente",
    });

    // total = 2000+2000=4000; productCost = 2*600 + 1*1300 = 2500; profit = 1500
    expect(sale.total).toBe(4000);
    expect(sale.profit).toBe(1500);

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const itemA = items.find((i) => i.productId === profitProductId);
    const itemB = items.find((i) => i.productId === profitProductBId);
    expect(itemA?.costPrice).toBe(600);
    expect(itemB?.costPrice).toBe(1300);
  });

  it("cambiar el costo actual del catálogo después no altera el snapshot ni el profit ya persistidos en DB real", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      status: "pendiente",
    });

    const [itemBefore] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(itemBefore.costPrice).toBe(600);

    // Cambia el costo VIGENTE del producto directamente en product_stock.
    await db.update(productStock).set({ costPrice: 900 }).where(eq(productStock.productId, profitProductId));

    const [saleAfter] = await db.select().from(sales).where(eq(sales.id, sale.id));
    const [itemAfter] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(itemAfter.costPrice).toBe(600); // snapshot histórico intacto
    expect(saleAfter.profit).toBe(400); // profit histórico intacto (1000-600)
    expect(saleAfter.total).toBe(1000);

    // Restaura para no afectar otros tests del archivo.
    await db.update(productStock).set({ costPrice: 600 }).where(eq(productStock.productId, profitProductId));
  });

  it("updateSale: el nuevo snapshot usa el costo VIGENTE al momento de la edición, no el histórico", async () => {
    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      status: "pendiente",
    });
    const [itemBefore] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(itemBefore.costPrice).toBe(600);

    // Cambia el costo vigente ANTES de editar.
    await db.update(productStock).set({ costPrice: 700 }).where(eq(productStock.productId, profitProductId));

    const updated = await storage.updateSale(testConsultantId, sale.id, {
      items: [{ productId: profitProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(updated?.profit).toBe(300); // 1000 - 700, con el costo VIGENTE al momento de editar

    const [itemAfter] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(itemAfter.costPrice).toBe(700); // nuevo snapshot, no el 600 original

    // Restaura para no afectar otros tests del archivo.
    await db.update(productStock).set({ costPrice: 600 }).where(eq(productStock.productId, profitProductId));
  });
});

describe("Incremento atómico de stock (incrementProductStock) — Etapa I-B.8-B, contra Postgres real", () => {
  it("concurrencia real: 5 incrementos de +1 simultáneos sobre stock=10 -> 15, nunca se pierde ninguno (prueba el fix de la carrera de LoadOrderDialog)", async () => {
    const [before] = await db.select().from(productStock).where(eq(productStock.productId, incrementProductId));
    expect(before.unidades).toBe(10);

    // Antes de esta etapa, el flujo de LoadOrderDialog.tsx leía el stock en TypeScript y
    // mandaba un PATCH absoluto -> bajo concurrencia real, dos o más de estos "+1" podían
    // pisarse y el resultado final quedaba por debajo de 15. El cálculo atómico en la misma
    // sentencia SQL (`unidades = unidades + delta`) es justamente lo que elimina esa carrera.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => storage.incrementProductStock(testConsultantId, incrementProductId, 1)),
    );
    expect(results.every((r) => r !== undefined)).toBe(true);

    const [after] = await db.select().from(productStock).where(eq(productStock.productId, incrementProductId));
    expect(after.unidades).toBe(15); // 10 + 5*1, ninguno perdido
  });

  it("delta=0 se rechaza con SaleValidationError, sin tocar la fila", async () => {
    const [before] = await db.select().from(productStock).where(eq(productStock.productId, incrementProductId));

    await expect(storage.incrementProductStock(testConsultantId, incrementProductId, 0)).rejects.toBeInstanceOf(SaleValidationError);

    const [after] = await db.select().from(productStock).where(eq(productStock.productId, incrementProductId));
    expect(after.unidades).toBe(before.unidades);
  });

  it("un decremento que dejaría stock negativo se rechaza y hace rollback real: la fila queda exactamente igual", async () => {
    const [before] = await db.select().from(productStock).where(eq(productStock.productId, incrementProductId));

    await expect(storage.incrementProductStock(testConsultantId, incrementProductId, -(before.unidades + 1))).rejects.toThrow(
      /stock insuficiente/i,
    );

    const [after] = await db.select().from(productStock).where(eq(productStock.productId, incrementProductId));
    expect(after.unidades).toBe(before.unidades); // ni se aplicó ni quedó negativo a medias
  });

  it("producto sin fila product_stock previa: el primer incremento positivo la crea correctamente (camino INSERT del upsert)", async () => {
    const beforeRows = await db.select().from(productStock).where(eq(productStock.productId, incrementFreshProductId));
    expect(beforeRows).toHaveLength(0);

    const updated = await storage.incrementProductStock(testConsultantId, incrementFreshProductId, 4);
    expect(updated?.unidades).toBe(4);

    const rows = await db.select().from(productStock).where(eq(productStock.productId, incrementFreshProductId));
    expect(rows).toHaveLength(1); // una sola fila, nunca duplicada
    expect(rows[0].unidades).toBe(4);
  });

  it("un decremento sobre un producto sin fila previa se rechaza sin crear una fila corrupta", async () => {
    const [freshProduct] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto de prueba — decremento sin stock previo",
        variante: "Estándar",
        codigo: `vitest-increment-fresh-negative-${Date.now()}`,
        puntos: 0,
        precio: 1000,
        source: "manual",
      })
      .returning();

    await expect(storage.incrementProductStock(testConsultantId, freshProduct.id, -3)).rejects.toThrow(/stock insuficiente/i);

    const rows = await db.select().from(productStock).where(eq(productStock.productId, freshProduct.id));
    expect(rows).toHaveLength(0); // el rollback deshizo también el INSERT, no queda fila en -3
  });

  it("producto inexistente/no visible -> undefined, sin crear ninguna fila", async () => {
    const result = await storage.incrementProductStock(testConsultantId, 999999999, 5);
    expect(result).toBeUndefined();
    const rows = await db.select().from(productStock).where(eq(productStock.productId, 999999999));
    expect(rows).toHaveLength(0);
  });
});

describe("CRUD real de productos (updateProduct/deleteProduct) — Etapa I-B.8-C, contra Postgres real", () => {
  let crudProductId: number; // sin ventas — para UPDATE/DELETE limpios y concurrencia
  let crudSoldProductId: number; // con una venta real — para historial congelado y has_relations
  let crudSaleId: number;

  beforeAll(async () => {
    const [product] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto CRUD sin ventas",
        variante: "Estándar",
        codigo: `vitest-crud-${Date.now()}`,
        puntos: 0,
        precio: 1000,
        source: "manual",
      })
      .returning();
    crudProductId = product.id;
    await db.insert(productStock).values({ consultantId: testConsultantId, productId: crudProductId, unidades: 10, stockMinimo: 0 });

    const [soldProduct] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto CRUD con venta",
        variante: "Estándar",
        codigo: `vitest-crud-sold-${Date.now()}`,
        puntos: 0,
        precio: 2000,
        source: "manual",
      })
      .returning();
    crudSoldProductId = soldProduct.id;
    await db.insert(productStock).values({ consultantId: testConsultantId, productId: crudSoldProductId, unidades: 10, stockMinimo: 0, costPrice: 1200 });

    const sale = await storage.createSale(testConsultantId, {
      clientId: testClientId,
      date: "2026-01-01",
      items: [{ productId: crudSoldProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 2000 }],
      status: "entregado",
    });
    crudSaleId = sale.id;
  });

  it("UPDATE: cambiar nombre/precio/sección/código de un producto sin ventas, persiste en DB real", async () => {
    const updated = await storage.updateProduct(testConsultantId, crudProductId, {
      producto: "Nombre actualizado",
      precio: 1500,
      seccion: "Categoría actualizada",
      codigo: `vitest-crud-updated-${Date.now()}`,
    });
    expect(updated?.producto).toBe("Nombre actualizado");
    expect(updated?.precio).toBe(1500);

    const [row] = await db.select().from(products).where(eq(products.id, crudProductId));
    expect(row.producto).toBe("Nombre actualizado");
    expect(row.precio).toBe(1500);
    expect(row.seccion).toBe("Categoría actualizada");
  });

  it("UPDATE: cambiar el precio de un producto YA VENDIDO no altera la venta histórica (total/profit) ni sale_items (price/costPrice)", async () => {
    const [saleBefore] = await db.select().from(sales).where(eq(sales.id, crudSaleId));
    const [itemBefore] = await db.select().from(saleItems).where(eq(saleItems.saleId, crudSaleId));

    await storage.updateProduct(testConsultantId, crudSoldProductId, { precio: 9999, producto: "Nombre cambiado post-venta" });

    const [saleAfter] = await db.select().from(sales).where(eq(sales.id, crudSaleId));
    const [itemAfter] = await db.select().from(saleItems).where(eq(saleItems.saleId, crudSaleId));
    expect(saleAfter.total).toBe(saleBefore.total);
    expect(saleAfter.profit).toBe(saleBefore.profit);
    expect(itemAfter.price).toBe(itemBefore.price); // snapshot de venta, nunca sigue al precio actual
    expect(itemAfter.costPrice).toBe(itemBefore.costPrice); // snapshot histórico (I-B.7-D-D) intacto

    // El catálogo SÍ cambió (es lo que el endpoint promete) — confirma que la congelación de
    // arriba es específicamente sobre lo histórico, no que el UPDATE no haya hecho nada.
    const [productRow] = await db.select().from(products).where(eq(products.id, crudSoldProductId));
    expect(productRow.precio).toBe(9999);
  });

  it("UPDATE: código duplicado contra otro producto propio -> ProductConflictError, sin mutar", async () => {
    const [before] = await db.select().from(products).where(eq(products.id, crudProductId));
    const [otherProduct] = await db.select().from(products).where(eq(products.id, crudSoldProductId));

    await expect(
      storage.updateProduct(testConsultantId, crudProductId, { codigo: otherProduct.codigo }),
    ).rejects.toBeInstanceOf(ProductConflictError);

    const [after] = await db.select().from(products).where(eq(products.id, crudProductId));
    expect(after.codigo).toBe(before.codigo);
  });

  it("UPDATE: producto inexistente -> undefined", async () => {
    const result = await storage.updateProduct(testConsultantId, 999999999, { producto: "X" });
    expect(result).toBeUndefined();
  });

  it("concurrencia real: dos updateProduct simultáneos sobre el mismo producto -> ambos completan, resultado coherente (last-write-wins), sin error espurio", async () => {
    const results = await Promise.allSettled([
      storage.updateProduct(testConsultantId, crudProductId, { producto: "Actualización concurrente A" }),
      storage.updateProduct(testConsultantId, crudProductId, { producto: "Actualización concurrente B" }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const [row] = await db.select().from(products).where(eq(products.id, crudProductId));
    expect(["Actualización concurrente A", "Actualización concurrente B"]).toContain(row.producto);
  });

  it("concurrencia real: updateProduct + incrementProductStock simultáneos no interfieren entre sí (tocan filas distintas: products vs product_stock)", async () => {
    const [stockBefore] = await db.select().from(productStock).where(eq(productStock.productId, crudProductId));

    const [updateResult, incrementResult] = await Promise.allSettled([
      storage.updateProduct(testConsultantId, crudProductId, { producto: "Nombre tras incremento concurrente" }),
      storage.incrementProductStock(testConsultantId, crudProductId, 3),
    ]);
    expect(updateResult.status).toBe("fulfilled");
    expect(incrementResult.status).toBe("fulfilled");

    const [row] = await db.select().from(products).where(eq(products.id, crudProductId));
    const [stockAfter] = await db.select().from(productStock).where(eq(productStock.productId, crudProductId));
    expect(row.producto).toBe("Nombre tras incremento concurrente");
    expect(stockAfter.unidades).toBe(stockBefore.unidades + 3); // el incremento no se perdió
  });

  it("DELETE: producto sin ventas se borra físicamente, incluida su fila de product_stock (sin huérfanos)", async () => {
    const [toDelete] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto CRUD para borrar",
        variante: "Estándar",
        codigo: `vitest-crud-delete-${Date.now()}`,
        puntos: 0,
        precio: 500,
        source: "manual",
      })
      .returning();
    await db.insert(productStock).values({ consultantId: testConsultantId, productId: toDelete.id, unidades: 5, stockMinimo: 0 });

    const result = await storage.deleteProduct(testConsultantId, toDelete.id);
    expect(result).toBe("deleted");

    const productRows = await db.select().from(products).where(eq(products.id, toDelete.id));
    const stockRows = await db.select().from(productStock).where(eq(productStock.productId, toDelete.id));
    expect(productRows).toHaveLength(0);
    expect(stockRows).toHaveLength(0); // no queda la fila de stock huérfana
  });

  it("DELETE: producto CON ventas se rechaza (has_relations), producto y stock quedan exactamente iguales", async () => {
    const [productBefore] = await db.select().from(products).where(eq(products.id, crudSoldProductId));
    const [stockBefore] = await db.select().from(productStock).where(eq(productStock.productId, crudSoldProductId));

    const result = await storage.deleteProduct(testConsultantId, crudSoldProductId);
    expect(result).toBe("has_relations");

    const [productAfter] = await db.select().from(products).where(eq(products.id, crudSoldProductId));
    const [stockAfter] = await db.select().from(productStock).where(eq(productStock.productId, crudSoldProductId));
    expect(productAfter).toEqual(productBefore);
    expect(stockAfter).toEqual(stockBefore);

    // La venta histórica sigue siendo legible normalmente después del intento rechazado —
    // mismo endpoint/método que usa el resto de la app para reportes y el detalle de venta.
    const sale = await storage.getSaleDetails(testConsultantId, crudSaleId);
    expect(sale).toBeDefined();
    expect(sale?.items).toHaveLength(1);
  });

  it("DELETE: repetirlo sobre un producto ya eliminado devuelve not_found, nunca 'deleted' fantasma", async () => {
    const [toDelete] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto CRUD borrado dos veces",
        variante: "Estándar",
        codigo: `vitest-crud-delete-twice-${Date.now()}`,
        puntos: 0,
        precio: 500,
        source: "manual",
      })
      .returning();

    const first = await storage.deleteProduct(testConsultantId, toDelete.id);
    expect(first).toBe("deleted");
    const second = await storage.deleteProduct(testConsultantId, toDelete.id);
    expect(second).toBe("not_found");
  });

  it("concurrencia real: deleteProduct + createSale simultáneos sobre un producto SIN ventas previas -> nunca coexisten un producto borrado y una venta que lo referencia", async () => {
    const [raceProduct] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto CRUD carrera delete+venta",
        variante: "Estándar",
        codigo: `vitest-crud-race-${Date.now()}`,
        puntos: 0,
        precio: 1000,
        source: "manual",
      })
      .returning();
    await db.insert(productStock).values({ consultantId: testConsultantId, productId: raceProduct.id, unidades: 20, stockMinimo: 0, costPrice: 500 });

    const [deleteResult, saleResult] = await Promise.allSettled([
      storage.deleteProduct(testConsultantId, raceProduct.id),
      storage.createSale(testConsultantId, {
        clientId: testClientId,
        date: "2026-01-01",
        items: [{ productId: raceProduct.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
        status: "pendiente",
      }),
    ]);

    const deleted = deleteResult.status === "fulfilled" && deleteResult.value === "deleted";
    const sold = saleResult.status === "fulfilled";

    // Invariante fuerte, gane quien gane la carrera: nunca los dos a la vez. Si la venta ganó
    // primero, el DELETE debe haber visto la relación (sea por el chequeo previo o por el FK
    // real de Postgres como defensa ante la carrera) y haberse rechazado.
    expect(deleted && sold).toBe(false);

    if (deleted) {
      expect(saleResult.status).toBe("rejected"); // no pudo vender un producto que ya no existe
    } else {
      expect(sold).toBe(true);
      const [productRow] = await db.select().from(products).where(eq(products.id, raceProduct.id));
      expect(productRow).toBeDefined(); // el producto se conserva: tiene una venta real
    }
  });
});

describe("Batch atómico de confirmación de pedido (incrementProductStockBatch) — Etapa 7.2, contra Postgres real", () => {
  let productAId: number;
  let productBId: number;
  let productCId: number;

  beforeAll(async () => {
    async function makeProduct(label: string, unidades: number) {
      const [product] = await db
        .insert(products)
        .values({
          consultantId: testConsultantId,
          seccion: "VITEST",
          producto: `Producto batch — ${label}`,
          variante: "Estándar",
          codigo: `vitest-batch-${label}-${Date.now()}`,
          puntos: 0,
          precio: 1000,
          source: "manual",
        })
        .returning();
      await db.insert(productStock).values({ consultantId: testConsultantId, productId: product.id, unidades, stockMinimo: 0 });
      return product.id;
    }
    productAId = await makeProduct("A", 10);
    productBId = await makeProduct("B", 20);
    productCId = await makeProduct("C", 5);
  });

  describe("Básicos", () => {
    it("1. batch con una sola línea aplica correctamente", async () => {
      const result = await storage.incrementProductStockBatch(testConsultantId, [{ productId: productAId, delta: 2 }]);
      expect(result).toEqual({ updated: 1 });
      const [row] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      expect(row.unidades).toBe(12);
    });

    it("2. batch con múltiples líneas aplica todas en la misma operación", async () => {
      const [beforeA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      const [beforeB] = await db.select().from(productStock).where(eq(productStock.productId, productBId));

      const result = await storage.incrementProductStockBatch(testConsultantId, [
        { productId: productAId, delta: 1 },
        { productId: productBId, delta: 3 },
      ]);
      expect(result).toEqual({ updated: 2 });

      const [afterA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      const [afterB] = await db.select().from(productStock).where(eq(productStock.productId, productBId));
      expect(afterA.unidades).toBe(beforeA.unidades + 1);
      expect(afterB.unidades).toBe(beforeB.unidades + 3);
    });

    it("3. batch vacío se rechaza con SaleValidationError, sin tocar nada", async () => {
      await expect(storage.incrementProductStockBatch(testConsultantId, [])).rejects.toBeInstanceOf(SaleValidationError);
    });

    it("4. producto inexistente en el batch -> se rechaza el batch entero", async () => {
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: productAId, delta: 1 },
          { productId: 999999999, delta: 1 },
        ]),
      ).rejects.toThrow(/no encontrado/i);
    });

    it("5. producto MANUAL de otra consultora -> se rechaza igual que uno inexistente, nunca se filtra que existe", async () => {
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [{ productId: otherProductId, delta: 1 }]),
      ).rejects.toThrow(/no encontrado/i);

      // El stock de la otra consultora, intacto.
      const [row] = await db.select().from(productStock).where(eq(productStock.productId, otherProductId));
      expect(row.unidades).toBe(50);
    });

    it("6. delta inválido (0, negativo o no entero) se rechaza — este batch es solo entrada de mercadería", async () => {
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [{ productId: productAId, delta: 0 }]),
      ).rejects.toBeInstanceOf(SaleValidationError);
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [{ productId: productAId, delta: -1 }]),
      ).rejects.toBeInstanceOf(SaleValidationError);
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [{ productId: productAId, delta: 1.5 }]),
      ).rejects.toBeInstanceOf(SaleValidationError);
    });

    it("7. stock válido: varias líneas con deltas positivos dispares aplican exactamente lo esperado", async () => {
      const [beforeC] = await db.select().from(productStock).where(eq(productStock.productId, productCId));
      await storage.incrementProductStockBatch(testConsultantId, [{ productId: productCId, delta: 7 }]);
      const [afterC] = await db.select().from(productStock).where(eq(productStock.productId, productCId));
      expect(afterC.unidades).toBe(beforeC.unidades + 7);
    });
  });

  describe("Atomicidad — el caso central de esta etapa", () => {
    it("8/9/10. Stock A=10 B=20: batch A+5 B+3 + una tercera línea inválida -> falla ENTERA, A y B quedan EXACTAMENTE igual que antes (nunca A=15 B=23)", async () => {
      // Nota de diseño: el ejemplo del pedido usa "C+999999" como la línea que "debe fallar",
      // pero este batch es exclusivamente de ENTRADA de mercadería (sección 9) — un delta
      // positivo grande no es inválido, es simplemente un incremento grande, así que no sirve
      // para forzar el fallo. El equivalente real de "una línea intermedia que hace fallar
      // todo el batch" con este diseño es un producto inexistente/no visible — mismo efecto de
      // atomicidad, causa distinta (nunca hay un decremento posible en este endpoint).
      const [beforeA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      const [beforeB] = await db.select().from(productStock).where(eq(productStock.productId, productBId));

      await expect(
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: productAId, delta: 5 }, // línea 1: válida
          { productId: productBId, delta: 3 }, // línea 2: válida
          { productId: 999999999, delta: 1 }, // línea 3: inválida -> todo el batch debe revertir
        ]),
      ).rejects.toThrow(/no encontrado/i);

      const [afterA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      const [afterB] = await db.select().from(productStock).where(eq(productStock.productId, productBId));
      // Exactamente lo que pedía el caso del informe: NUNCA A+5 B+3 aplicados a medias.
      expect(afterA.unidades).toBe(beforeA.unidades);
      expect(afterB.unidades).toBe(beforeB.unidades);
    });

    it("línea 1 válida + línea 2 con delta negativo -> el batch entero se rechaza, la línea 1 tampoco queda aplicada", async () => {
      const [beforeA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      const [beforeC] = await db.select().from(productStock).where(eq(productStock.productId, productCId));

      // Un batch de importación solo suma (delta positivo) — para forzar "stock insuficiente"
      // hace falta vaciar la fila primero y mandar un delta que sería válido salvo por el
      // chequeo de negativo... como acá el batch NUNCA acepta delta negativo, el camino real
      // de "stock insuficiente" de este endpoint específico no existe por diseño (ver sección
      // 9 del pedido: solo entrada de mercadería). Documentamos esa garantía acá en vez de
      // fabricar un escenario artificial que el propio schema ya impide antes de llegar a
      // storage.
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: productAId, delta: 1 },
          { productId: productCId, delta: -1 }, // rechazado por el schema/validación de línea, nunca por stock negativo
        ]),
      ).rejects.toBeInstanceOf(SaleValidationError);

      const [afterA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      const [afterC] = await db.select().from(productStock).where(eq(productStock.productId, productCId));
      expect(afterA.unidades).toBe(beforeA.unidades); // línea 1 NO quedó aplicada pese a ser válida
      expect(afterC.unidades).toBe(beforeC.unidades);
    });

    it("10. ningún cambio si falla la validación previa (todas las líneas se validan antes de escribir cualquiera)", async () => {
      const [beforeA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));

      // La línea inválida es la PRIMERA acá — si el batch escribiera línea por línea sin
      // validar todo antes, este caso no probaría nada nuevo respecto al anterior. Puesto
      // como primera línea a propósito para confirmar que ninguna línea se aplica ni siquiera
      // cuando la inválida es la que "debería" procesarse primero.
      await expect(
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: 999999999, delta: 1 },
          { productId: productAId, delta: 5 },
        ]),
      ).rejects.toThrow(/no encontrado/i);

      const [afterA] = await db.select().from(productStock).where(eq(productStock.productId, productAId));
      expect(afterA.unidades).toBe(beforeA.unidades);
    });
  });

  describe("Duplicados dentro del mismo batch", () => {
    it("11/12. mismo productId dos veces en el batch -> se combinan los deltas (10+5+3=18), no dos escrituras separadas", async () => {
      const [before] = await db.select().from(productStock).where(eq(productStock.productId, productBId));

      const result = await storage.incrementProductStockBatch(testConsultantId, [
        { productId: productBId, delta: 5 },
        { productId: productBId, delta: 3 },
      ]);
      expect(result).toEqual({ updated: 1 }); // un solo producto afectado, no dos líneas separadas

      const [after] = await db.select().from(productStock).where(eq(productStock.productId, productBId));
      expect(after.unidades).toBe(before.unidades + 8); // 5+3 combinados, nunca solo uno de los dos
    });
  });

  describe("Concurrencia real contra Postgres", () => {
    it("13. dos batches simultáneos sobre el MISMO producto: stock=10, +5 y +7 -> 22, nunca 17/12/20", async () => {
      const [freshProduct] = await db
        .insert(products)
        .values({
          consultantId: testConsultantId,
          seccion: "VITEST",
          producto: "Producto batch — concurrencia mismo producto",
          variante: "Estándar",
          codigo: `vitest-batch-concurrency-same-${Date.now()}`,
          puntos: 0,
          precio: 1000,
          source: "manual",
        })
        .returning();
      await db.insert(productStock).values({ consultantId: testConsultantId, productId: freshProduct.id, unidades: 10, stockMinimo: 0 });

      const results = await Promise.all([
        storage.incrementProductStockBatch(testConsultantId, [{ productId: freshProduct.id, delta: 5 }]),
        storage.incrementProductStockBatch(testConsultantId, [{ productId: freshProduct.id, delta: 7 }]),
      ]);
      expect(results).toEqual([{ updated: 1 }, { updated: 1 }]);

      const [after] = await db.select().from(productStock).where(eq(productStock.productId, freshProduct.id));
      expect(after.unidades).toBe(22); // 10 + 5 + 7, ninguno perdido bajo concurrencia real
    });

    it("14/15. batch A toca productos [1,2] en ese orden, batch B toca los MISMOS dos productos en orden [2,1]: sin deadlock, sin pérdida de actualización", async () => {
      const [freshP1] = await db
        .insert(products)
        .values({
          consultantId: testConsultantId,
          seccion: "VITEST",
          producto: "Producto batch — solapado 1",
          variante: "Estándar",
          codigo: `vitest-batch-overlap-1-${Date.now()}`,
          puntos: 0,
          precio: 1000,
          source: "manual",
        })
        .returning();
      const [freshP2] = await db
        .insert(products)
        .values({
          consultantId: testConsultantId,
          seccion: "VITEST",
          producto: "Producto batch — solapado 2",
          variante: "Estándar",
          codigo: `vitest-batch-overlap-2-${Date.now()}`,
          puntos: 0,
          precio: 1000,
          source: "manual",
        })
        .returning();
      await db.insert(productStock).values([
        { consultantId: testConsultantId, productId: freshP1.id, unidades: 10, stockMinimo: 0 },
        { consultantId: testConsultantId, productId: freshP2.id, unidades: 10, stockMinimo: 0 },
      ]);

      // Órdenes de entrada DELIBERADAMENTE opuestos entre los dos batches — es justo el caso
      // que el ordenamiento ascendente de productId dentro de la transacción (Etapa I-B.7-C)
      // existe para prevenir: sin ese orden determinístico, un batch podría tomar el lock de
      // freshP1 mientras el otro tiene el de freshP2 y ambos esperan al otro -> deadlock.
      const [orderedLow, orderedHigh] = freshP1.id < freshP2.id ? [freshP1, freshP2] : [freshP2, freshP1];

      const results = await Promise.all([
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: orderedLow.id, delta: 1 },
          { productId: orderedHigh.id, delta: 2 },
        ]),
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: orderedHigh.id, delta: 3 },
          { productId: orderedLow.id, delta: 4 },
        ]),
      ]);
      expect(results).toEqual([{ updated: 2 }, { updated: 2 }]);

      const [afterLow] = await db.select().from(productStock).where(eq(productStock.productId, orderedLow.id));
      const [afterHigh] = await db.select().from(productStock).where(eq(productStock.productId, orderedHigh.id));
      expect(afterLow.unidades).toBe(10 + 1 + 4); // los dos incrementos sobre "low", ninguno perdido
      expect(afterHigh.unidades).toBe(10 + 2 + 3); // los dos incrementos sobre "high", ninguno perdido
    });

    it("batch A afecta productos 1 y 2, batch B afecta SOLO el producto 2 (subconjunto solapado) -> ambos completan sin pérdida", async () => {
      const [p1] = await db
        .insert(products)
        .values({
          consultantId: testConsultantId,
          seccion: "VITEST",
          producto: "Producto batch — subconjunto 1",
          variante: "Estándar",
          codigo: `vitest-batch-subset-1-${Date.now()}`,
          puntos: 0,
          precio: 1000,
          source: "manual",
        })
        .returning();
      const [p2] = await db
        .insert(products)
        .values({
          consultantId: testConsultantId,
          seccion: "VITEST",
          producto: "Producto batch — subconjunto 2",
          variante: "Estándar",
          codigo: `vitest-batch-subset-2-${Date.now()}`,
          puntos: 0,
          precio: 1000,
          source: "manual",
        })
        .returning();
      await db.insert(productStock).values([
        { consultantId: testConsultantId, productId: p1.id, unidades: 10, stockMinimo: 0 },
        { consultantId: testConsultantId, productId: p2.id, unidades: 10, stockMinimo: 0 },
      ]);

      const results = await Promise.all([
        storage.incrementProductStockBatch(testConsultantId, [
          { productId: p1.id, delta: 2 },
          { productId: p2.id, delta: 2 },
        ]),
        storage.incrementProductStockBatch(testConsultantId, [{ productId: p2.id, delta: 5 }]),
      ]);
      expect(results).toEqual([{ updated: 2 }, { updated: 1 }]);

      const [afterP1] = await db.select().from(productStock).where(eq(productStock.productId, p1.id));
      const [afterP2] = await db.select().from(productStock).where(eq(productStock.productId, p2.id));
      expect(afterP1.unidades).toBe(12); // 10 + 2
      expect(afterP2.unidades).toBe(17); // 10 + 2 + 5, ninguno perdido
    });
  });
});

describe("Concurrencia discontinuar/reactivar vs. vender — Etapa 7.4, contra Postgres real", () => {
  it("discontinuar + crear venta simultáneos sobre el mismo producto: nunca un resultado inconsistente, sea cual sea el orden real", async () => {
    const [product] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto 7.4 — carrera discontinuar+vender",
        variante: "Estándar",
        codigo: `vitest-discontinue-race-${Date.now()}`,
        puntos: 0,
        precio: 1000,
        source: "manual",
      })
      .returning();
    await db.insert(productStock).values({ consultantId: testConsultantId, productId: product.id, unidades: 10, stockMinimo: 0 });

    const [discontinueResult, saleResult] = await Promise.allSettled([
      storage.setProductDiscontinued(testConsultantId, product.id, true),
      storage.createSale(testConsultantId, {
        clientId: testClientId,
        date: "2026-01-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
        status: "pendiente",
      }),
    ]);

    // El "discontinuar" en sí (un UPSERT de una sola sentencia) siempre tiene éxito — nunca
    // compite por el mismo tipo de validación que la venta.
    expect(discontinueResult.status).toBe("fulfilled");

    const [finalStock] = await db.select().from(productStock).where(eq(productStock.productId, product.id));
    expect(finalStock.discontinued).toBe(true);

    // La garantía real: createSale SIEMPRE evalúa `discontinued` contra el valor que ve bajo
    // su propio `FOR UPDATE` (Etapa 7.4) — nunca un valor leído fuera de esa transacción. Acá
    // no se puede predecir determinísticamente cuál de las dos operaciones toma el lock de la
    // fila primero (depende del scheduling real de Postgres), así que el test acepta AMBOS
    // desenlaces válidos y solo verifica que cada uno sea internamente coherente:
    if (saleResult.status === "fulfilled") {
      // La venta ganó el lock primero (vio discontinued=false, todavía consistente en ese
      // instante) -> se creó una venta real, y el producto queda discontinuado DESPUÉS.
      const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleResult.value.id));
      expect(items).toHaveLength(1);
      const [stockAfterSale] = await db.select().from(productStock).where(eq(productStock.productId, product.id));
      expect(stockAfterSale.unidades).toBe(9); // 10 - 1, la venta sí se aplicó
    } else {
      // El "discontinuar" ganó el lock primero -> createSale, al tomar el lock después, vio
      // discontinued=true y rechazó explícitamente — nunca una venta fantasma sobre un
      // producto ya discontinuado.
      expect((saleResult as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
      expect((saleResult as PromiseRejectedResult).reason.message).toMatch(/discontinuado/i);
      const [stockUntouched] = await db.select().from(productStock).where(eq(productStock.productId, product.id));
      expect(stockUntouched.unidades).toBe(10); // stock intacto, la venta rechazada no descontó nada
    }
  });

  it("reactivar + crear venta simultáneos sobre un producto YA discontinuado: mismo criterio, sin resultado inconsistente", async () => {
    const [product] = await db
      .insert(products)
      .values({
        consultantId: testConsultantId,
        seccion: "VITEST",
        producto: "Producto 7.4 — carrera reactivar+vender",
        variante: "Estándar",
        codigo: `vitest-reactivate-race-${Date.now()}`,
        puntos: 0,
        precio: 1000,
        source: "manual",
      })
      .returning();
    await db.insert(productStock).values({ consultantId: testConsultantId, productId: product.id, unidades: 10, stockMinimo: 0, discontinued: true });

    const [reactivateResult, saleResult] = await Promise.allSettled([
      storage.setProductDiscontinued(testConsultantId, product.id, false),
      storage.createSale(testConsultantId, {
        clientId: testClientId,
        date: "2026-01-01",
        items: [{ productId: product.id, quantity: 1 }],
        orderDiscount: null,
        orderSurcharge: null,
        paymentMethod: "efectivo",
        installments: [{ amount: 1000 }],
        status: "pendiente",
      }),
    ]);

    expect(reactivateResult.status).toBe("fulfilled");

    if (saleResult.status === "fulfilled") {
      // La reactivación ganó el lock primero -> la venta, al tomar el lock después, ya vio
      // discontinued=false y pudo completarse normalmente.
      const [stockAfterSale] = await db.select().from(productStock).where(eq(productStock.productId, product.id));
      expect(stockAfterSale.unidades).toBe(9);
    } else {
      // La venta ganó el lock primero, todavía con discontinued=true -> rechazada
      // correctamente, aunque la reactivación (que perdió la carrera) haya tenido éxito
      // un instante después. Nunca una venta "colada" antes de que el producto estuviera
      // realmente disponible.
      expect((saleResult as PromiseRejectedResult).reason).toBeInstanceOf(SaleValidationError);
      expect((saleResult as PromiseRejectedResult).reason.message).toMatch(/discontinuado/i);
      const [stockUntouched] = await db.select().from(productStock).where(eq(productStock.productId, product.id));
      expect(stockUntouched.unidades).toBe(10);
    }

    // Sin importar el orden, la reactivación siempre termina aplicada (es la única operación
    // que toca ese campo en este test).
    const [finalStock] = await db.select().from(productStock).where(eq(productStock.productId, product.id));
    expect(finalStock.discontinued).toBe(false);
  });
});
