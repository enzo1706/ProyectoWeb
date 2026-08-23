/** Formatea una fecha local como "YYYY-MM-DD", el formato que usa toda la app para columnas de fecha. */
export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Parsea un "YYYY-MM-DD" como fecha local (evita el corrimiento de zona horaria de `new Date(string)`). */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Días entre dos "YYYY-MM-DD" (positivo si dateStr es posterior a today). */
export function daysBetween(today: string, dateStr: string): number {
  const a = new Date(today + "T00:00:00");
  const b = new Date(dateStr + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
