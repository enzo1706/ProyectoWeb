/**
 * Prompt 9, punto 6 — "todas las fechas en hora de Argentina". Argentina no usa horario de
 * verano desde 2009: es UTC-3 fijo todo el año, así que un offset constante alcanza (no hace
 * falta `Intl.DateTimeFormat` con `timeZone`, más lento y que no cambiaría el resultado acá).
 * Nada en este proyecto usaba la zona horaria del servidor hasta ahora (todo el resto de
 * `new Date()` del código asume la del proceso) — este archivo es el único lugar nuevo que
 * corrige eso, solo para lo que el Prompt 9 pide explícitamente (el filtro de "hace tiempo que
 * no compran" y "cumplen años este mes").
 */

const ARGENTINA_UTC_OFFSET_HOURS = 3;

/** Un Date cuyos getters `getUTC*` devuelven el reloj de pared de Argentina en este instante —
 * nunca usar los getters locales (`getDate()`, `getMonth()`, etc.) sobre este valor, dependen
 * de la zona del proceso, no de Argentina. */
export function getArgentinaNow(): Date {
  const utcNow = new Date();
  return new Date(utcNow.getTime() - ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" de hoy en Argentina — mismo formato que el resto de las fechas del proyecto. */
export function getArgentinaDateStr(): string {
  const d = getArgentinaNow();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Mes actual en Argentina, 1-12. */
export function getArgentinaMonth(): number {
  return getArgentinaNow().getUTCMonth() + 1;
}
