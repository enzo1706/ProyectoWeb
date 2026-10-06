import { storage } from "./storage";
import {
  computeWeightedDiscountPercent,
  DEFAULT_HABITUAL_DISCOUNT_PERCENT,
  HABITUAL_DISCOUNT_WINDOW_MS,
} from "@shared/saleCalculations";

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
  const since = new Date(Date.now() - HABITUAL_DISCOUNT_WINDOW_MS);
  const recent = await storage.listOrderDiscountLogSince(consultantId, since);

  const weighted = computeWeightedDiscountPercent(recent);
  if (weighted !== null) return weighted;

  const latestEver = await storage.getLatestOrderDiscountLogEntry(consultantId);
  if (latestEver) return latestEver.discountPercent;

  return DEFAULT_HABITUAL_DISCOUNT_PERCENT;
}
