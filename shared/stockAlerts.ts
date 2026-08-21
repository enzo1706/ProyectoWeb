/** Único lugar donde vive la regla de "cuándo alertar por stock bajo" — reusado por
 * server/storage.ts (para filtrar /api/products/low-stock) y por el frontend (para mostrar
 * el umbral efectivo en Productos/Inicio). No duplicar esta cascada en otro lado. */

export const DEFAULT_LOW_STOCK_THRESHOLD = 2;

/** Umbral propio del producto (si la consultora lo configuró) → default de su perfil
 * (Configuración) → 2 unidades, si ninguno de los dos existe. */
export function resolveLowStockThreshold(
  productThreshold: number | null | undefined,
  consultantDefaultThreshold: number | null | undefined,
): number {
  return productThreshold ?? consultantDefaultThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

/** Alerta cuando el stock es MENOR al umbral (stock == umbral no alerta todavía). */
export function isLowStock(unidades: number, effectiveThreshold: number): boolean {
  return unidades < effectiveThreshold;
}

/** Un recordatorio de compra pospone la alerta hasta la fecha elegida (YYYY-MM-DD). Sin
 * recordatorio, o con la fecha ya cumplida/pasada, la alerta vuelve a mostrarse. */
export function isReminderActive(remindAt: string | null | undefined, today: string): boolean {
  return !!remindAt && remindAt > today;
}
