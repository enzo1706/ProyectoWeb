/**
 * Los montos se guardan como enteros (centavos) en toda la app; esto los formatea a moneda.
 * `currency` es la moneda de la consultora (configuración de negocio) — default ARS para no
 * romper ningún llamado existente que todavía no la pasa explícitamente.
 */
export function formatPrice(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
