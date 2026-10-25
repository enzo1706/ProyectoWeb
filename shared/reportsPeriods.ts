/**
 * Prompt 11 — cómo se calcula el período de comparación de Reportes ("▲ 12% vs. ..."). Vive
 * separado de `argentinaTime.ts` a propósito: ese archivo sabe QUÉ hora es en Argentina, este
 * sabe CÓMO se compara un período con el anterior — son cálculos de calendario puros (reciben
 * "hoy" como string, nunca llaman a `new Date()` directo), así que se pueden probar con
 * cualquier fecha sin mockear nada.
 *
 * Reglas (decisión del usuario, Prompt 11):
 * - Períodos EN CURSO ("Este mes", "Esta semana"): se comparan con los MISMOS DÍAS del
 *   período anterior equivalente. Si el período anterior es más corto (31 de marzo contra
 *   febrero), se toma hasta su último día real.
 * - Períodos CERRADOS ("El mes pasado", "Últimos 3 meses", "Personalizado"): se comparan con
 *   el período anterior completo, de la misma duración.
 */

export const REPORT_PERIOD_KINDS = ["this_month", "this_week", "last_month", "last_3_months", "custom"] as const;
export type ReportPeriodKind = (typeof REPORT_PERIOD_KINDS)[number];

export function isReportPeriodKind(value: unknown): value is ReportPeriodKind {
  return typeof value === "string" && (REPORT_PERIOD_KINDS as readonly string[]).includes(value);
}

export interface ComparisonPeriod {
  /** "YYYY-MM-DD", inclusive. */
  start: string;
  /** "YYYY-MM-DD", exclusivo — mismo criterio que el resto de los rangos de fecha del proyecto. */
  end: string;
  /** true si el período anterior real era más corto que el actual y se lo tomó completo
   * (ej. comparar el 1-31 de marzo contra un febrero de 28 días). */
  truncated: boolean;
}

function parseDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * `todayStr` es "hoy" ya resuelto por quien llama (en producción, `getArgentinaDateStr()` —
 * nunca el reloj del proceso, que en Railway es UTC) — mantiene esta función pura y fácil de
 * probar con cualquier fecha.
 */
export function getComparisonPeriod(kind: ReportPeriodKind, start: string, end: string, todayStr: string): ComparisonPeriod {
  const startDate = parseDateStr(start);

  if (kind === "this_month" || kind === "this_week") {
    const today = parseDateStr(todayStr);
    // Días transcurridos del período actual, incluido hoy (ej. del 1 al 8 → 8 días).
    const elapsedDays = diffDays(startDate, today) + 1;
    const previousUnitStart = kind === "this_month" ? addMonths(startDate, -1) : addDays(startDate, -7);
    const previousUnitEnd = startDate; // el inicio del período actual es el fin (exclusivo) del anterior
    const candidateEnd = addDays(previousUnitStart, elapsedDays);
    const truncated = candidateEnd.getTime() > previousUnitEnd.getTime();
    const comparisonEnd = truncated ? previousUnitEnd : candidateEnd;
    return { start: formatDateStr(previousUnitStart), end: formatDateStr(comparisonEnd), truncated };
  }

  if (kind === "last_month") {
    return { start: formatDateStr(addMonths(startDate, -1)), end: formatDateStr(startDate), truncated: false };
  }

  if (kind === "last_3_months") {
    return { start: formatDateStr(addMonths(startDate, -3)), end: formatDateStr(startDate), truncated: false };
  }

  // "custom": sin alineación de calendario — el período anterior es la misma cantidad de días,
  // inmediatamente antes.
  const endDate = parseDateStr(end);
  const dayCount = diffDays(startDate, endDate);
  return { start: formatDateStr(addDays(startDate, -dayCount)), end: formatDateStr(startDate), truncated: false };
}
