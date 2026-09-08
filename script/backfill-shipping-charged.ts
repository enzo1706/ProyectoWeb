/**
 * Backfill de la Etapa I-B.7-D-C: mueve los valores históricos de `sales.shipping_cost`
 * (que antes de esta etapa siempre representó "importe de envío cobrado a la clienta") a la
 * columna nueva `sales.shipping_charged`, y deja `shipping_cost` en NULL para esas filas —
 * el costo REAL de envío de ventas anteriores a esta etapa nunca fue registrado por separado,
 * así que no existe forma de reconstruirlo: se deja explícitamente sin informar, nunca se
 * inventa un valor (ver informe de la Etapa I-B.7-D-C).
 *
 * No es un rename de columna: `shipping_cost` nunca cambia de nombre a nivel de schema (eso
 * hubiera requerido que `drizzle-kit push` resuelva una ambigüedad rename-vs-drop+create sin
 * una terminal interactiva que la conteste — riesgo real de pérdida de datos bajo `--force`).
 * En cambio, `shipping_charged` se agregó como columna nueva (aditiva, sin ambigüedad) y este
 * script mueve los valores mediante un UPDATE explícito, reversible en el sentido de que no
 * borra nada irrecuperable: los valores viejos quedan copiados en `shipping_charged` antes de
 * limpiar `shipping_cost`.
 *
 * Solo toca filas "pre-migración": `shipping_charged IS NULL AND shipping_cost IS NOT NULL`.
 * Una fila ya migrada (o una venta nueva creada después de esta etapa, que ya llega con
 * `shipping_charged` propio) nunca vuelve a tocarse — el backfill es idempotente, correrlo
 * dos veces no tiene efecto la segunda vez.
 */
import "dotenv/config";
import { sql, isNull, isNotNull, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sales } from "../shared/schema";
import type * as schema from "../shared/schema";

export async function backfillShippingCharged(db: NodePgDatabase<typeof schema>): Promise<number> {
  const migrated = await db
    .update(sales)
    .set({
      shippingCharged: sql`${sales.shippingCost}`,
      shippingCost: null,
    })
    .where(and(isNull(sales.shippingCharged), isNotNull(sales.shippingCost)))
    .returning({ id: sales.id });
  return migrated.length;
}

// CLI: `tsx script/backfill-shipping-charged.ts` — usa exclusivamente TEST_DATABASE_URL (el
// guard corre al importar `../server/test-db`, antes de que este script pueda tocar nada).
// Deliberadamente NO acepta ningún flag/env para apuntar a otra base — correrlo contra
// producción requeriría escribir una variante nueva, explícita, con su propia autorización.
//
// El bloque de abajo SOLO corre cuando este archivo se ejecuta directamente (`tsx
// script/backfill-shipping-charged.ts`) — nunca al importar `backfillShippingCharged` desde
// otro módulo (ej. los tests de migración), que no deben abrir un segundo pool ni cerrar el
// que ya está en uso.
import { fileURLToPath } from "node:url";

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const { testDb, testPool } = await import("../server/test-db");
  console.log("Backfill shipping_charged: corriendo contra la base de test (loopback, confirmado por el guard)...");
  try {
    const count = await backfillShippingCharged(testDb);
    console.log(`Backfill completo: ${count} venta(s) migrada(s) de shipping_cost a shipping_charged.`);
  } catch (err) {
    console.error("Backfill falló:", err);
    process.exitCode = 1;
  } finally {
    await testPool.end();
  }
}
