import { storage } from "./storage";

/** El más bajo de los descuentos reales (discountOptions = [35, 40, 45] en shared/schema.ts) —
 * deliberado: sin ningún pedido registrado, conviene subestimar la ganancia antes que
 * exagerarla. Duplicado acá como literal (no se importa discountOptions[0]) porque es una
 * decisión de negocio fija, no "el menor de la lista actual" si ese array cambiara algún día. */
const DEFAULT_HABITUAL_DISCOUNT_PERCENT = 35;
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * "Descuento de compra habitual" (Configuración, Prompt 1) — promedio ponderado por monto de
 * los pedidos confirmados de los últimos 3 meses (ver order_discount_log en shared/schema.ts).
 * Fórmula: (valor al público − lo que pagó) ÷ valor al público, sumado sobre todos los pedidos
 * del período — no un promedio simple de porcentajes, para que un pedido grande pese más que
 * uno chico.
 *
 * Sin pedidos en los últimos 3 meses: se usa el descuento de su último pedido (sin importar
 * cuán viejo sea). Sin ningún pedido jamás: 35%, el más bajo — ver DEFAULT_HABITUAL_DISCOUNT_PERCENT.
 *
 * Se muestra sin decimales en pantalla, pero el cálculo interno usa el valor exacto (lo
 * devuelve este mismo número, sin redondear — quien lo muestre redondea para mostrar).
 */
export async function computeHabitualDiscountPercent(consultantId: number): Promise<number> {
  const since = new Date(Date.now() - THREE_MONTHS_MS);
  const recent = await storage.listOrderDiscountLogSince(consultantId, since);

  if (recent.length > 0) {
    let totalPublic = 0;
    let totalPaid = 0;
    for (const entry of recent) {
      totalPublic += entry.publicValueArs;
      totalPaid += entry.publicValueArs * (1 - entry.discountPercent / 100);
    }
    if (totalPublic > 0) {
      return ((totalPublic - totalPaid) / totalPublic) * 100;
    }
  }

  const latestEver = await storage.getLatestOrderDiscountLogEntry(consultantId);
  if (latestEver) return latestEver.discountPercent;

  return DEFAULT_HABITUAL_DISCOUNT_PERCENT;
}
