/** Formatea una fecha local como "YYYY-MM-DD", el formato que usa toda la app para columnas de fecha. */
export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Parsea un "YYYY-MM-DD" como fecha local (evita el corrimiento de zona horaria de `new Date(string)`). */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}
