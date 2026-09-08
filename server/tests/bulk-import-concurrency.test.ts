import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { products } from "@shared/schema";
import { DatabaseStorage, ProductConflictError } from "../storage";

/**
 * Etapa I-B.8-D — el objetivo central de esta etapa: demostrar contra Postgres REAL (nunca
 * DATABASE_URL) que el TOCTOU de `bulkInsertProducts` (hallazgo F3, auditoría I-B.8-A) queda
 * cerrado por `products_global_codigo_unique_idx` (índice único parcial, `WHERE consultant_id
 * IS NULL`, ver shared/schema.ts). Todos los códigos usados acá llevan el prefijo
 * "vitest-concurrent-" para poder limpiarlos sin tocar nada real.
 */

const storage = new DatabaseStorage();
const PREFIX = "vitest-concurrent-";
const createdCodigos: string[] = [];

function bulkItem(codigo: string, producto = "Producto de concurrencia VITEST") {
  return { seccion: "VITEST", producto, precio: 1000, codigo, variante: "Estándar", puntos: 0, imagen: null, source: "import" as const };
}

afterAll(async () => {
  if (createdCodigos.length > 0) {
    await db.delete(products).where(and(isNull(products.consultantId), inArray(products.codigo, createdCodigos)));
  }
  await pool.end();
});

describe("bulkInsertProducts — concurrencia real contra Postgres (Etapa I-B.8-D)", () => {
  it("Test 5 — dos imports concurrentes con el MISMO código global: exactamente uno inserta, el otro recibe ProductConflictError, Postgres termina con UNA sola fila", async () => {
    const codigo = `${PREFIX}001-${Date.now()}`;
    createdCodigos.push(codigo);

    const results = await Promise.allSettled([
      storage.bulkInsertProducts([bulkItem(codigo, "Import A")]),
      storage.bulkInsertProducts([bulkItem(codigo, "Import B")]),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // No aceptamos "una dio error" sin más — la invariante real está en la base, no en el
    // resultado de la promesa: se verifica leyendo Postgres después.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ProductConflictError);

    const rows = await db.select().from(products).where(and(isNull(products.consultantId), eq(products.codigo, codigo)));
    expect(rows).toHaveLength(1); // nunca dos — esta es la comprobación que realmente importa
  });

  it("Test 6 — lotes con códigos superpuestos: el import que pierde la carrera revierte COMPLETO (no deja códigos sueltos), nunca se viola la unicidad", async () => {
    const suffix = Date.now();
    const codeA = `${PREFIX}A-${suffix}`;
    const codeB = `${PREFIX}B-${suffix}`;
    const codeC = `${PREFIX}C-${suffix}`; // compartido entre los dos lotes -> el punto de choque
    const codeD = `${PREFIX}D-${suffix}`;
    const codeE = `${PREFIX}E-${suffix}`;
    createdCodigos.push(codeA, codeB, codeC, codeD, codeE);

    const [resultLote1, resultLote2] = await Promise.allSettled([
      storage.bulkInsertProducts([bulkItem(codeA), bulkItem(codeB), bulkItem(codeC, "Lote 1 - C")]),
      storage.bulkInsertProducts([bulkItem(codeC, "Lote 2 - C"), bulkItem(codeD), bulkItem(codeE)]),
    ]);

    const lote1Won = resultLote1.status === "fulfilled";
    const lote2Won = resultLote2.status === "fulfilled";
    // Nunca los dos a la vez (violaría la unicidad de C) y nunca ninguno (uno de los dos no
    // tenía ningún motivo real para fallar si ganaba el lock del código compartido primero).
    expect(lote1Won !== lote2Won).toBe(true);

    const allRows = await db
      .select({ codigo: products.codigo })
      .from(products)
      .where(and(isNull(products.consultantId), inArray(products.codigo, [codeA, codeB, codeC, codeD, codeE])));
    const codigosPresentes = new Set(allRows.map((r) => r.codigo));

    if (lote1Won) {
      // Atomicidad real: si ganó el lote 1, están A/B/C y NINGUNO de D/E — el lote 2 no dejó
      // ningún resto suelto pese a que D y E no tenían ningún conflicto propio.
      expect(codigosPresentes).toEqual(new Set([codeA, codeB, codeC]));
      expect((resultLote2 as PromiseRejectedResult).reason).toBeInstanceOf(ProductConflictError);
    } else {
      expect(codigosPresentes).toEqual(new Set([codeC, codeD, codeE]));
      expect((resultLote1 as PromiseRejectedResult).reason).toBeInstanceOf(ProductConflictError);
    }
    expect(allRows).toHaveLength(3); // nunca 5, nunca 6 con C duplicado
    // Esto ES el Test 8 (rollback) del pedido: D y E, que no tenían ningún conflicto propio,
    // nunca quedan huérfanos cuando su lote pierde — la transacción completa se revierte, no
    // solo el item que chocó. No se agrega un test aparte para esto: forzar un rollback real
    // requiere la violación de la constraint, que solo ocurre bajo concurrencia real, y esa
    // concurrencia ya es exactamente lo que este test ejercita.
  });
});
