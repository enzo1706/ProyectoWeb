import { describe, it, expect } from "vitest";
import { matchesBalanceFilter, matchesStaleFilter, isBalanceFilter, isStaleFilter } from "../../shared/clientFilters";

/** Etapa 7.1 — predicados puros movidos de Clientas.tsx (client-side) a server/storage.ts.
 * Antes vivían sin tests propios (heredaban lo que probara la UI a mano); acá quedan
 * cubiertos directo, sin depender de DB ni HTTP. */

describe("matchesBalanceFilter", () => {
  it("'todas' siempre matchea, sin importar el saldo", () => {
    expect(matchesBalanceFilter(0, "todas")).toBe(true);
    expect(matchesBalanceFilter(1000, "todas")).toBe(true);
  });

  it("'con_saldo' solo matchea saldo estrictamente positivo", () => {
    expect(matchesBalanceFilter(1, "con_saldo")).toBe(true);
    expect(matchesBalanceFilter(0, "con_saldo")).toBe(false);
  });

  it("'sin_saldo' matchea saldo cero o negativo", () => {
    expect(matchesBalanceFilter(0, "sin_saldo")).toBe(true);
    expect(matchesBalanceFilter(-1, "sin_saldo")).toBe(true);
    expect(matchesBalanceFilter(1, "sin_saldo")).toBe(false);
  });
});

describe("matchesStaleFilter", () => {
  const cutoff = "2026-01-01";

  it("'todas' siempre matchea, incluso sin lastPurchase", () => {
    expect(matchesStaleFilter(null, "todas", cutoff)).toBe(true);
    expect(matchesStaleFilter("2026-06-01", "todas", cutoff)).toBe(true);
  });

  it("lastPurchase null NUNCA matchea un filtro de antigüedad activo ('nunca compró' no es 'compró hace tiempo')", () => {
    expect(matchesStaleFilter(null, "mas_2_meses", cutoff)).toBe(false);
    expect(matchesStaleFilter(null, "mas_3_meses", cutoff)).toBe(false);
  });

  it("lastPurchase anterior al cutoff matchea", () => {
    expect(matchesStaleFilter("2025-12-01", "mas_2_meses", cutoff)).toBe(true);
  });

  it("lastPurchase en o después del cutoff no matchea", () => {
    expect(matchesStaleFilter("2026-01-01", "mas_2_meses", cutoff)).toBe(false);
    expect(matchesStaleFilter("2026-02-01", "mas_2_meses", cutoff)).toBe(false);
  });
});

describe("isBalanceFilter / isStaleFilter — validación de query params", () => {
  it("acepta solo los valores conocidos", () => {
    expect(isBalanceFilter("con_saldo")).toBe(true);
    expect(isBalanceFilter("cualquier_cosa")).toBe(false);
    expect(isBalanceFilter(undefined)).toBe(false);
    expect(isStaleFilter("mas_3_meses")).toBe(true);
    expect(isStaleFilter("mas_5_meses")).toBe(false);
  });
});
