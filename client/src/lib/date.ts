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

/** Prompt 15, punto 6 — fecha en "detalles": "3 de octubre de 2026". Siempre es-AR (reemplaza
 * los `.toLocaleDateString("es-MX", ...)` sueltos que había por toda la app). */
export function formatDateDisplay(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

/** "3 de oct." — sin año, sin texto relativo. Para fechas de vencimiento puntuales (cuotas,
 * pedidos) que no son ni un detalle completo ni una fecha de lista con "hoy"/"hace N días".
 * Mismo armado manual que usa el fallback de `formatDateList` (Intl "es-AR" con
 * { month: "short" } no agrega "de" ni el punto final por su cuenta). */
export function formatDateShort(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  const month = date.toLocaleDateString("es-AR", { month: "short" }).replace(/\.$/, "");
  return `${date.getDate()} de ${month}.`;
}

/** Prompt 15, punto 6 + decisión 1 del usuario — fecha en "listas": "hoy"/"ayer"/
 * "hace 3 días" (pasado, hasta 7 días) y "mañana"/"en 3 días" (futuro, hasta 7 días,
 * simétrico al pasado aunque el texto original del prompt solo daba ejemplos de pasado),
 * después de esa ventana cae a "3 de oct." (sin año — es la fecha de una lista, no un
 * detalle). `todayStr` es opcional para que sea testeable con una fecha fija. */
export function formatDateList(dateStr: string, todayStr: string = toDateStr(new Date())): string {
  const diff = daysBetween(todayStr, dateStr);
  if (diff === 0) return "hoy";
  if (diff === -1) return "ayer";
  if (diff === 1) return "mañana";
  if (diff >= 2 && diff <= 7) return `en ${diff} días`;
  if (diff <= -2 && diff >= -7) return `hace ${Math.abs(diff)} días`;
  return formatDateShort(dateStr);
}
