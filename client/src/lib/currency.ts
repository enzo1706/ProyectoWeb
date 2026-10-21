import { formatMoney, parseMoneyInput, parsePercentInput } from "@shared/money";

export { parseMoneyInput, parsePercentInput };

/**
 * Los montos de precio/costo/envío/objetivo/pago se guardan como enteros (centavos) en toda
 * la app; esto los formatea a moneda. `currency` es la moneda de la consultora (configuración
 * de negocio) — default ARS para no romper ningún llamado existente que todavía no la pasa
 * explícitamente. Prompt 15: sin decimales salvo que el monto realmente tenga centavos.
 */
export function formatPrice(cents: number, currency = "ARS") {
  return formatMoney(cents / 100, currency);
}

/** Prompt 15 — para los montos del admin que se guardan en PESOS ENTEROS, no en centavos
 * (precio y cupones de suscripción: `newPriceArs`, `SUBSCRIPTION_PRICE_ARS`, etc. — unidad
 * distinta a propósito, confirmada contra `server/config/subscription.ts`). Nunca se divide
 * por 100 — mezclar esto con `formatPrice` fue justamente el bug que encontramos en
 * `SubscriptionPricing.tsx`/`SubscriptionManagement.tsx` (cada uno con su propio formateador
 * ad-hoc, uno de ellos incluso con el mismo nombre `formatPrice` que éste pero sin dividir). */
export function formatPesos(pesos: number, currency = "ARS") {
  return formatMoney(pesos, currency);
}
