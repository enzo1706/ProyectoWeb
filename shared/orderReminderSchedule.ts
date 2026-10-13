/**
 * Prompt 8, Parte 3 — calcula el ciclo del recordatorio del día de pedido a partir de los días
 * configurados (nunca de la última fila guardada en `order_reminders`: un mes con la lista
 * vacía no genera fila, y el período del siguiente ciclo tiene que seguir saliendo bien).
 */
import { resolveOrderDayForMonth } from "./argentinaTime";

interface YMD {
  year: number;
  month: number; // 1-12
  day: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymdToStr(ymd: YMD): string {
  return `${ymd.year}-${pad(ymd.month)}-${pad(ymd.day)}`;
}

export function strToYmd(dateStr: string): YMD {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

/** Comparable: mayor número = fecha más reciente. */
function ymdValue(ymd: YMD): number {
  return Date.UTC(ymd.year, ymd.month - 1, ymd.day);
}

function resolveOccurrence(day: number, year: number, month: number): YMD {
  return { year, month, day: resolveOrderDayForMonth(day, year, month) };
}

function monthsBefore(ymd: { year: number; month: number }, count: number): { year: number; month: number } {
  const totalMonths = ymd.year * 12 + (ymd.month - 1) - count;
  return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
}

/** Las ocurrencias más recientes de este día configurado, mirando hasta 3 meses atrás — más
 * que suficiente margen: si `periodEnd` termina cayendo en un mes anterior a este (porque hoy
 * todavía no llegó a la ocurrencia de este mes), `periodStart` sigue teniendo de dónde salir. */
function candidatesForDay(day: number, today: YMD): YMD[] {
  return [0, 1, 2, 3].map((monthsBack) => {
    const { year, month } = monthsBack === 0 ? today : monthsBefore(today, monthsBack);
    return resolveOccurrence(day, year, month);
  });
}

export interface OrderReminderPeriod {
  periodEnd: string;
  periodStart: string;
}

/**
 * `day1`/`day2` son los días configurados (1-31, `day2` opcional). `todayStr` y
 * `configuredSinceStr` van en "YYYY-MM-DD" (hora Argentina — ver shared/argentinaTime.ts).
 * Devuelve `null` si no hay ninguna ocurrencia válida (sin días configurados, o la más
 * reciente es anterior a `configuredSinceStr`: no se generan recordatorios de antes de que la
 * consultora configurara sus días de pedido).
 */
export function resolveOrderReminderPeriod(
  day1: number | null,
  day2: number | null,
  todayStr: string,
  configuredSinceStr: string | null,
): OrderReminderPeriod | null {
  if (day1 == null) return null;
  const today = strToYmd(todayStr);
  const todayValue = ymdValue(today);

  const allCandidates = [...candidatesForDay(day1, today), ...(day2 != null ? candidatesForDay(day2, today) : [])]
    .filter((ymd) => ymdValue(ymd) <= todayValue)
    .sort((a, b) => ymdValue(b) - ymdValue(a));

  const periodEnd = allCandidates[0];
  if (!periodEnd) return null;

  if (configuredSinceStr) {
    const floorValue = ymdValue(strToYmd(configuredSinceStr));
    if (ymdValue(periodEnd) < floorValue) return null;
  }

  const periodEndValue = ymdValue(periodEnd);
  const periodStart = allCandidates.find((ymd) => ymdValue(ymd) < periodEndValue) ?? periodEnd;

  return { periodEnd: ymdToStr(periodEnd), periodStart: ymdToStr(periodStart) };
}

/**
 * Prompt 8, Parte 1 — "Se pide el [próximo día de pedido]" en una venta que quedó pendiente de
 * entrega. A diferencia de `resolveOrderReminderPeriod` (que mira hacia atrás), esta mira hacia
 * ADELANTE: la primera ocurrencia configurada que sea hoy o futura. `null` sin días configurados.
 */
export function resolveNextOrderDate(day1: number | null, day2: number | null, todayStr: string): string | null {
  if (day1 == null) return null;
  const today = strToYmd(todayStr);
  const todayValue = ymdValue(today);

  const candidatesFor = (day: number): YMD[] =>
    [0, 1, 2].map((monthsAhead) => {
      const totalMonths = today.year * 12 + (today.month - 1) + monthsAhead;
      const year = Math.floor(totalMonths / 12);
      const month = (totalMonths % 12) + 1;
      return resolveOccurrence(day, year, month);
    });

  const allCandidates = [...candidatesFor(day1), ...(day2 != null ? candidatesFor(day2) : [])]
    .filter((ymd) => ymdValue(ymd) >= todayValue)
    .sort((a, b) => ymdValue(a) - ymdValue(b));

  return allCandidates[0] ? ymdToStr(allCandidates[0]) : null;
}
