/** Único lugar donde viven los filtros de listado de Clientas (saldo pendiente / antigüedad de
 * compra) y la paginación — reusado por client/src/pages/Clientas.tsx (opciones de UI) y por
 * server/storage.ts (WHERE/HAVING real). No duplicar estos valores ni la semántica en otro lado. */

export type BalanceFilter = "todas" | "con_saldo" | "sin_saldo";
export type StaleFilter = "todas" | "mas_2_meses" | "mas_3_meses";

export const BALANCE_FILTERS: BalanceFilter[] = ["todas", "con_saldo", "sin_saldo"];
export const STALE_FILTERS: StaleFilter[] = ["todas", "mas_2_meses", "mas_3_meses"];

export const STALE_THRESHOLDS: Record<Exclude<StaleFilter, "todas">, number> = {
  mas_2_meses: 60,
  mas_3_meses: 90,
};

export const DEFAULT_CLIENTS_PAGE_SIZE = 25;
export const MAX_CLIENTS_PAGE_SIZE = 100;

/** "Nunca compró" (lastPurchase null) nunca matchea un filtro de antigüedad — solo se
 * distingue de "compró hace tiempo" cuando el filtro está en "Todas". Mismo criterio desde
 * que el filtro vivía en el frontend (Etapa 6); ahora es la fuente única, server y cliente. */
export function matchesStaleFilter(lastPurchase: string | null, filter: StaleFilter, cutoff: string): boolean {
  if (filter === "todas") return true;
  if (!lastPurchase) return false;
  return lastPurchase < cutoff;
}

export function matchesBalanceFilter(pendingBalance: number, filter: BalanceFilter): boolean {
  if (filter === "todas") return true;
  return filter === "con_saldo" ? pendingBalance > 0 : pendingBalance <= 0;
}

export function isBalanceFilter(value: unknown): value is BalanceFilter {
  return typeof value === "string" && (BALANCE_FILTERS as string[]).includes(value);
}

export function isStaleFilter(value: unknown): value is StaleFilter {
  return typeof value === "string" && (STALE_FILTERS as string[]).includes(value);
}
