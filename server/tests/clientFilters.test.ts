import { describe, it, expect } from "vitest";
import { matchesBalanceFilter, matchesStaleFilter, matchesBirthdayMonth, birthdayDay, isClientListFilter } from "../../shared/clientFilters";

/** Etapa 7.1 — predicados puros movidos de Clientas.tsx (client-side) a server/storage.ts.
 * Prompt 9, punto 2 — reescrito para el filtro único (reemplaza balanceFilter/staleFilter
 * independientes) y los dos predicados nuevos (cumpleaños del mes, orden por día). */

describe("matchesBalanceFilter", () => {
  it("matchea solo saldo estrictamente positivo", () => {
    expect(matchesBalanceFilter(1)).toBe(true);
    expect(matchesBalanceFilter(0)).toBe(false);
    expect(matchesBalanceFilter(-1)).toBe(false);
  });
});

describe("matchesStaleFilter", () => {
  const cutoff = "2026-01-01";

  it("lastPurchase null NUNCA matchea ('nunca compró' no es 'compró hace tiempo')", () => {
    expect(matchesStaleFilter(null, cutoff)).toBe(false);
  });

  it("lastPurchase anterior al cutoff matchea", () => {
    expect(matchesStaleFilter("2025-12-01", cutoff)).toBe(true);
  });

  it("lastPurchase en o después del cutoff no matchea", () => {
    expect(matchesStaleFilter("2026-01-01", cutoff)).toBe(false);
    expect(matchesStaleFilter("2026-02-01", cutoff)).toBe(false);
  });
});

describe("matchesBirthdayMonth", () => {
  it("matchea por mes, sin importar el año guardado (real o sentinela)", () => {
    expect(matchesBirthdayMonth("2000-03-15", 3)).toBe(true);
    expect(matchesBirthdayMonth("1985-03-02", 3)).toBe(true);
    expect(matchesBirthdayMonth("2000-04-01", 3)).toBe(false);
  });

  it("sin cumpleaños cargado, nunca matchea", () => {
    expect(matchesBirthdayMonth(null, 3)).toBe(false);
  });
});

describe("birthdayDay", () => {
  it("extrae el día para ordenar 'Cumplen años este mes'", () => {
    expect(birthdayDay("2000-03-05")).toBe(5);
    expect(birthdayDay("2000-03-31")).toBe(31);
  });
});

describe("isClientListFilter — validación de query params", () => {
  it("acepta solo los 4 valores conocidos", () => {
    expect(isClientListFilter("todas")).toBe(true);
    expect(isClientListFilter("pendiente_pago")).toBe(true);
    expect(isClientListFilter("no_compran_hace")).toBe(true);
    expect(isClientListFilter("cumplen_anios")).toBe(true);
    expect(isClientListFilter("mas_3_meses")).toBe(false);
    expect(isClientListFilter("cualquier_cosa")).toBe(false);
    expect(isClientListFilter(undefined)).toBe(false);
  });
});
