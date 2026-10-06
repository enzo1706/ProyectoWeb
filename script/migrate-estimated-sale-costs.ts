/**
 * Prompt 2 (Costos y ganancia) — chequeo/migración #2: ventas viejas cuyo `sale_items.cost_price`
 * quedó grabado igual al precio (el bug "ganancia $0" que este prompt corrige) se marcan como
 * estimadas y se corrigen con el descuento de compra habitual de cada consultora.
 *
 * Criterio (acordado explícitamente, no asumido): una línea califica si
 *   cost_price = price (el precio unitario de ESA línea)  O
 *   cost_price = el precio ACTUAL del producto en el catálogo
 * y todavía no fue migrada (`cost_is_estimated IS NULL`). El valor grabado en `cost_price` se
 * toma como el precio al público de ese momento (es justo lo que esas dos condiciones
 * garantizan), y el costo nuevo = ese valor × (1 − descuento habitual de la consultora). Las
 * líneas que no cumplan el criterio quedan con `cost_is_estimated = NULL` (se siguen tratando
 * como costo real, nunca se tocan).
 *
 * SOLO LECTURA por defecto (`findEstimatedSaleCostCandidates`). El UPDATE real
 * (`applyEstimatedSaleCostMigration`) es una función aparte que hay que llamar explícitamente —
 * no corre sola al ejecutar este archivo. El bloque main de abajo solo imprime el dry-run.
 */
import "dotenv/config";
import { eq, sql, and, or, isNull, isNotNull, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sales, saleItems, products, orderDiscountLog } from "../shared/schema";
import {
  computeWeightedDiscountPercent,
  computeHistoricalProductCost,
  computeSaleProfit,
  DEFAULT_HABITUAL_DISCOUNT_PERCENT,
  HABITUAL_DISCOUNT_WINDOW_MS,
} from "../shared/saleCalculations";
import type * as schema from "../shared/schema";

export interface EstimatedCostCandidateSummary {
  consultantId: number;
  linesToMark: number;
  salesAffected: number;
}

export interface EstimatedCostCandidateExample {
  saleItemId: number;
  saleId: number;
  consultantId: number;
  productName: string;
  unitPrice: number;
  currentCatalogPrice: number | null;
  recordedCost: number;
}

/** Candidata = cost_price != null, todavía no migrada, y (cost_price = price del renglón O
 * cost_price = precio actual del producto). */
function candidateWhereClause() {
  return and(
    isNotNull(saleItems.costPrice),
    isNull(saleItems.costIsEstimated),
    or(sql`${saleItems.costPrice} = ${saleItems.price}`, sql`${saleItems.costPrice} = ${products.precio}`),
  );
}

export async function findEstimatedSaleCostCandidates(
  db: NodePgDatabase<typeof schema>,
): Promise<{ byConsultant: EstimatedCostCandidateSummary[]; examples: EstimatedCostCandidateExample[] }> {
  const byConsultant = await db
    .select({
      consultantId: sales.consultantId,
      linesToMark: sql<number>`count(*)`,
      salesAffected: sql<number>`count(distinct ${saleItems.saleId})`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .leftJoin(products, eq(products.id, saleItems.productId))
    .where(candidateWhereClause())
    .groupBy(sales.consultantId)
    .orderBy(sql`count(*) desc`);

  const examples = await db
    .select({
      saleItemId: saleItems.id,
      saleId: saleItems.saleId,
      consultantId: sales.consultantId,
      productName: saleItems.productName,
      unitPrice: saleItems.price,
      currentCatalogPrice: products.precio,
      recordedCost: saleItems.costPrice,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .leftJoin(products, eq(products.id, saleItems.productId))
    .where(candidateWhereClause())
    .limit(20);

  return {
    byConsultant: byConsultant.map((r) => ({ ...r, linesToMark: Number(r.linesToMark), salesAffected: Number(r.salesAffected) })),
    examples: examples.map((e) => ({ ...e, recordedCost: e.recordedCost! })),
  };
}

async function resolveHabitualDiscountPercent(db: NodePgDatabase<typeof schema>, consultantId: number): Promise<number> {
  const since = new Date(Date.now() - HABITUAL_DISCOUNT_WINDOW_MS);
  const recent = await db
    .select({ discountPercent: orderDiscountLog.discountPercent, publicValueArs: orderDiscountLog.publicValueArs })
    .from(orderDiscountLog)
    .where(and(eq(orderDiscountLog.consultantId, consultantId), sql`${orderDiscountLog.confirmedAt} >= ${since}`));
  const weighted = computeWeightedDiscountPercent(recent);
  if (weighted !== null) return weighted;

  const [latestEver] = await db
    .select({ discountPercent: orderDiscountLog.discountPercent })
    .from(orderDiscountLog)
    .where(eq(orderDiscountLog.consultantId, consultantId))
    .orderBy(sql`${orderDiscountLog.confirmedAt} desc`)
    .limit(1);
  if (latestEver) return latestEver.discountPercent;

  return DEFAULT_HABITUAL_DISCOUNT_PERCENT;
}

/** NO se llama automáticamente. Migra consultora por consultora (cada una con SU propio
 * descuento habitual), corrige las líneas candidatas y recalcula el `profit` cacheado de cada
 * venta afectada — mismo criterio que `DatabaseStorage.recalculateEstimatedSalesForProduct`. */
export async function applyEstimatedSaleCostMigration(db: NodePgDatabase<typeof schema>): Promise<{ linesUpdated: number; salesUpdated: number }> {
  const { byConsultant } = await findEstimatedSaleCostCandidates(db);
  let linesUpdated = 0;
  let salesUpdated = 0;

  for (const { consultantId } of byConsultant) {
    const habitualDiscountPercent = await resolveHabitualDiscountPercent(db, consultantId);

    const candidates = await db
      .select({ id: saleItems.id, saleId: saleItems.saleId, costPrice: saleItems.costPrice })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(and(eq(sales.consultantId, consultantId), candidateWhereClause()));

    for (const row of candidates) {
      const newCost = Math.round(row.costPrice! * (1 - habitualDiscountPercent / 100));
      await db.update(saleItems).set({ costPrice: newCost, costIsEstimated: true }).where(eq(saleItems.id, row.id));
      linesUpdated++;
    }

    const affectedSaleIds = Array.from(new Set(candidates.map((c) => c.saleId)));
    for (const saleId of affectedSaleIds) {
      const [sale] = await db.select().from(sales).where(eq(sales.id, saleId));
      if (!sale) continue;
      const items = await db.select({ quantity: saleItems.quantity, costPrice: saleItems.costPrice }).from(saleItems).where(eq(saleItems.saleId, saleId));
      const productCost = computeHistoricalProductCost(items);
      if (productCost === null) continue;
      const profit = computeSaleProfit({ total: sale.total, productCost, shippingCost: sale.shippingCost, ingresosBrutos: sale.ingresosBrutos });
      await db.update(sales).set({ profit }).where(eq(sales.id, saleId));
      salesUpdated++;
    }
  }

  return { linesUpdated, salesUpdated };
}

import { fileURLToPath } from "node:url";

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const { testDb, testPool } = await import("../server/test-db");
  console.log("Candidatas a 'ganancia estimada' (ventas viejas): corriendo contra la base de test (solo lectura)...");
  try {
    const { byConsultant, examples } = await findEstimatedSaleCostCandidates(testDb);
    if (byConsultant.length === 0) {
      console.log("Ninguna línea candidata encontrada. No hace falta migrar nada.");
    } else {
      console.log("Por consultora:");
      console.table(byConsultant);
      console.log("Ejemplos (hasta 20):");
      console.table(examples);
      console.log('\nPara aplicar, llamá a applyEstimatedSaleCostMigration(db) explícitamente desde otro script — esto NO corrió ningún UPDATE.');
    }
  } finally {
    await testPool.end();
  }
}
