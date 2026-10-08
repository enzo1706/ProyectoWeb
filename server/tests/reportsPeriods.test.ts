import { describe, it, expect } from "vitest";
import { getComparisonPeriod } from "../../shared/reportsPeriods";

/** Prompt 11 — reglas de comparación con el período anterior (función pura, sin mockear
 * ningún reloj: "hoy" siempre se la pasa quien llama). */

describe("getComparisonPeriod — períodos en curso (mismos días)", () => {
  it("'Este mes', hoy 8 de octubre → 1-8 de octubre contra 1-8 de septiembre", () => {
    const result = getComparisonPeriod("this_month", "2026-10-01", "2026-11-01", "2026-10-08");
    expect(result).toEqual({ start: "2026-09-01", end: "2026-09-09", truncated: false });
  });

  it("31 de marzo contra un febrero más corto: se toma hasta el último día real de febrero", () => {
    const result = getComparisonPeriod("this_month", "2026-03-01", "2026-04-01", "2026-03-31");
    // 2026 no es bisiesto: febrero tiene 28 días — el mes completo, truncado.
    expect(result).toEqual({ start: "2026-02-01", end: "2026-03-01", truncated: true });
  });

  it("29 de febrero (bisiesto) contra enero: no hace falta truncar (enero tiene más días)", () => {
    // 2028 sí es bisiesto.
    const result = getComparisonPeriod("this_month", "2028-02-01", "2028-03-01", "2028-02-29");
    expect(result).toEqual({ start: "2028-01-01", end: "2028-01-30", truncated: false });
  });

  it("'Esta semana', hoy miércoles → lunes a miércoles de esta semana contra la anterior", () => {
    // 2026-10-07 es un miércoles.
    const result = getComparisonPeriod("this_week", "2026-10-05", "2026-10-12", "2026-10-07");
    expect(result).toEqual({ start: "2026-09-28", end: "2026-10-01", truncated: false });
  });

  it("'Esta semana' nunca se trunca (las dos semanas siempre tienen 7 días)", () => {
    const result = getComparisonPeriod("this_week", "2026-10-05", "2026-10-12", "2026-10-11");
    expect(result.truncated).toBe(false);
  });
});

describe("getComparisonPeriod — períodos cerrados (completos, misma duración)", () => {
  it("'El mes pasado' (septiembre) se compara con agosto completo", () => {
    const result = getComparisonPeriod("last_month", "2026-09-01", "2026-10-01", "2026-10-08");
    expect(result).toEqual({ start: "2026-08-01", end: "2026-09-01", truncated: false });
  });

  it("'Últimos 3 meses' (jul-sep) se compara con abr-jun completo", () => {
    const result = getComparisonPeriod("last_3_months", "2026-07-01", "2026-10-01", "2026-10-08");
    expect(result).toEqual({ start: "2026-04-01", end: "2026-07-01", truncated: false });
  });

  it("'Personalizado' (7 días) se compara con los 7 días inmediatamente anteriores", () => {
    const result = getComparisonPeriod("custom", "2026-09-15", "2026-09-22", "2026-10-08");
    expect(result).toEqual({ start: "2026-09-08", end: "2026-09-15", truncated: false });
  });

  it("'Personalizado' con el mismo rango que 'Esta semana' se trata como cerrado (día por día, no por mes)", () => {
    const result = getComparisonPeriod("custom", "2026-10-05", "2026-10-12", "2026-10-08");
    expect(result).toEqual({ start: "2026-09-28", end: "2026-10-05", truncated: false });
  });
});
