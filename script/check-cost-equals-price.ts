/**
 * Prompt 2 (Costos y ganancia) — chequeo #1 del plan de migración: ¿hay filas en
 * `product_stock` donde `cost_price` quedó igual al `precio` de venta del producto? Esto no
 * debería pasar por el camino normal de la app (el flujo "Sin descuento" deja `cost_price` en
 * NULL, nunca igual al precio — confirmado leyendo el código antes de escribir este script),
 * pero podría existir por una importación vieja u otro camino que no se revisó.
 *
 * Esto es SOLO LECTURA. No modifica nada. Hay que correrlo primero y revisar el resultado antes
 * de decidir si hace falta el UPDATE de `applyCostEqualsPriceFix` (más abajo, no se ejecuta
 * automáticamente).
 */
import "dotenv/config";
import { eq, sql, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { productStock, products } from "../shared/schema";
import type * as schema from "../shared/schema";

export interface CostEqualsPriceRow {
  consultantId: number;
  productId: number;
  producto: string;
  precio: number;
  costPrice: number;
  unidades: number;
}

export async function findCostEqualsPriceRows(db: NodePgDatabase<typeof schema>): Promise<CostEqualsPriceRow[]> {
  const rows = await db
    .select({
      consultantId: productStock.consultantId,
      productId: productStock.productId,
      producto: products.producto,
      precio: products.precio,
      costPrice: productStock.costPrice,
      unidades: productStock.unidades,
    })
    .from(productStock)
    .innerJoin(products, eq(products.id, productStock.productId))
    .where(and(sql`${productStock.costPrice} = ${products.precio}`));
  return rows.map((r) => ({ ...r, costPrice: r.costPrice! }));
}

/** NO se llama automáticamente — solo si el dry-run de arriba encuentra filas y se decide
 * aplicar. Deja esas filas en "sin costo" (NULL), igual que el camino normal "Sin descuento":
 * no se pierde la fila ni el producto, solo el costo sospechoso, que a partir de ahí se vuelve
 * a estimar con el descuento habitual al vender (ver resolveLineCost). */
export async function applyCostEqualsPriceFix(db: NodePgDatabase<typeof schema>): Promise<number> {
  const updated = await db
    .update(productStock)
    .set({ costPrice: null, selectedDiscount: null })
    .where(sql`${productStock.costPrice} = (select precio from products where products.id = ${productStock.productId})`)
    .returning({ id: productStock.id });
  return updated.length;
}

import { fileURLToPath } from "node:url";

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  // Deliberadamente solo TEST_DATABASE_URL (el guard corre al importar ../server/test-db) —
  // correr esto contra producción es una decisión separada, explícita, del equipo humano.
  const { testDb, testPool } = await import("../server/test-db");
  console.log("Chequeo cost_price = precio: corriendo contra la base de test (solo lectura)...");
  try {
    const rows = await findCostEqualsPriceRows(testDb);
    if (rows.length === 0) {
      console.log("Ninguna fila encontrada. No hace falta ningún UPDATE.");
    } else {
      console.log(`${rows.length} fila(s) encontradas:`);
      console.table(rows);
    }
  } finally {
    await testPool.end();
  }
}
