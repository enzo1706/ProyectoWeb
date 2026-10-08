/** Único lugar donde vive el filtro de listado de Clientas y la paginación — reusado por
 * client/src/pages/Clientas.tsx (opciones de UI) y por server/storage.ts (WHERE/HAVING real).
 * No duplicar estos valores ni la semántica en otro lado.
 *
 * Prompt 9, punto 2 — reemplaza los dos desplegables independientes de antes (balance/
 * antigüedad) por un solo filtro de selección única: "se usa una opción por vez". También
 * retira la opción de "más de 3 meses" (el prompt fija un único umbral, 2 meses) y agrega
 * "cumplen años este mes", que no existía. */

export type ClientListFilter = "todas" | "pendiente_pago" | "no_compran_hace" | "cumplen_anios";

export const CLIENT_LIST_FILTERS: ClientListFilter[] = ["todas", "pendiente_pago", "no_compran_hace", "cumplen_anios"];

export const CLIENT_LIST_FILTER_LABELS: Record<ClientListFilter, string> = {
  todas: "Todas",
  pendiente_pago: "Pendiente de pago",
  no_compran_hace: "Hace tiempo que no compran",
  cumplen_anios: "Cumplen años este mes",
};

/** "Hace tiempo que no compran" = al menos una compra Y la última hace más de 2 meses (60
 * días) — un único umbral fijo, ya no es elegible entre 2 y 3 meses. */
export const STALE_THRESHOLD_DAYS = 60;

export const DEFAULT_CLIENTS_PAGE_SIZE = 25;
export const MAX_CLIENTS_PAGE_SIZE = 100;

export function isClientListFilter(value: unknown): value is ClientListFilter {
  return typeof value === "string" && (CLIENT_LIST_FILTERS as string[]).includes(value);
}

/** "Nunca compró" (lastPurchase null) nunca matchea "hace tiempo que no compran" — hace falta
 * al menos una compra real para que la antigüedad tenga sentido. */
export function matchesStaleFilter(lastPurchase: string | null, cutoff: string): boolean {
  if (!lastPurchase) return false;
  return lastPurchase < cutoff;
}

export function matchesBalanceFilter(pendingBalance: number): boolean {
  return pendingBalance > 0;
}

/** Mes de un cumpleaños guardado ("YYYY-MM-DD", año real o sentinela — nunca importa cuál)
 * comparado contra el mes actual en hora de Argentina (Prompt 9, punto 6). */
export function matchesBirthdayMonth(birthday: string | null, currentMonth: number): boolean {
  if (!birthday) return false;
  const month = Number(birthday.split("-")[1]);
  return month === currentMonth;
}

/** Día del mes de un cumpleaños guardado — para ordenar "Cumplen años este mes" de forma
 * ascendente. */
export function birthdayDay(birthday: string): number {
  return Number(birthday.split("-")[2]);
}
