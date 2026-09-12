import { describe, it, expect } from "vitest";
import { normalizeArgentinaWhatsAppNumber, buildWhatsAppLink } from "@shared/phone";

/**
 * normalizeArgentinaWhatsAppNumber/buildWhatsAppLink son funciones puras (sin DB, sin red) —
 * estos tests no necesitan Postgres ni ningún servidor, solo verifican el algoritmo en sí.
 */

describe("normalizeArgentinaWhatsAppNumber", () => {
  it("13. teléfono con +54 y 9 de móvil ya presente", () => {
    const result = normalizeArgentinaWhatsAppNumber("+54 9 261 1234567");
    expect(result).toEqual({ valid: true, e164: "5492611234567" });
  });

  it("13b. mismo número sin espacios ni +", () => {
    expect(normalizeArgentinaWhatsAppNumber("+5492611234567")).toEqual({ valid: true, e164: "5492611234567" });
    expect(normalizeArgentinaWhatsAppNumber("5492611234567")).toEqual({ valid: true, e164: "5492611234567" });
  });

  it("14. teléfono con espacios, guiones y paréntesis se normaliza igual que sin formato", () => {
    expect(normalizeArgentinaWhatsAppNumber("(0261) 123-4567")).toEqual({ valid: true, e164: "5492611234567" });
    expect(normalizeArgentinaWhatsAppNumber("+54 (9) 261 123-4567")).toEqual({ valid: true, e164: "5492611234567" });
  });

  it("15. teléfono local con prefijo 0 de larga distancia", () => {
    expect(normalizeArgentinaWhatsAppNumber("0261 1234567")).toEqual({ valid: true, e164: "5492611234567" });
  });

  it("15b. teléfono local ya en formato de 10 dígitos (área + abonado, sin prefijos)", () => {
    expect(normalizeArgentinaWhatsAppNumber("261 1234567")).toEqual({ valid: true, e164: "5492611234567" });
    expect(normalizeArgentinaWhatsAppNumber("2611234567")).toEqual({ valid: true, e164: "5492611234567" });
  });

  it("16. celular argentino (9 móvil) siempre resulta en el mismo formato E.164 final", () => {
    const result = normalizeArgentinaWhatsAppNumber("9 261 1234567".replace(/\s/g, ""));
    // "92611234567" (11 dígitos, empieza con 9) -> se interpreta como local+9 -> 2611234567
    expect(result).toEqual({ valid: true, e164: "5492611234567" });
  });

  it("17. teléfono inválido: sin área (el '15' local solo, ambiguo) se rechaza en vez de adivinar", () => {
    expect(normalizeArgentinaWhatsAppNumber("15 1234567")).toEqual({ valid: false });
  });

  it("17b. teléfono con muy pocos dígitos, o evidentemente inválido (todos los dígitos iguales)", () => {
    expect(normalizeArgentinaWhatsAppNumber("123")).toEqual({ valid: false });
    expect(normalizeArgentinaWhatsAppNumber("0000000000")).toEqual({ valid: false });
    expect(normalizeArgentinaWhatsAppNumber("1111111111")).toEqual({ valid: false });
  });

  it("17c. teléfono con longitud ambigua (ni 10 ni claramente prefijado) se rechaza, no se adivina", () => {
    expect(normalizeArgentinaWhatsAppNumber("26112345678")).toEqual({ valid: false }); // 11 dígitos sin 9/0 al inicio
  });

  it("18. número vacío, null o undefined se rechaza sin explotar", () => {
    expect(normalizeArgentinaWhatsAppNumber("")).toEqual({ valid: false });
    expect(normalizeArgentinaWhatsAppNumber(null)).toEqual({ valid: false });
    expect(normalizeArgentinaWhatsAppNumber(undefined)).toEqual({ valid: false });
    expect(normalizeArgentinaWhatsAppNumber("   ")).toEqual({ valid: false });
    expect(normalizeArgentinaWhatsAppNumber("abc")).toEqual({ valid: false });
  });
});

describe("buildWhatsAppLink", () => {
  it("19. genera el enlace wa.me correcto para un número válido", () => {
    expect(buildWhatsAppLink("2611234567")).toBe("https://wa.me/5492611234567");
    expect(buildWhatsAppLink("+54 9 261 1234567")).toBe("https://wa.me/5492611234567");
  });

  it("20. nunca genera un enlace para un número ambiguo o inválido", () => {
    expect(buildWhatsAppLink("15 1234567")).toBeNull();
    expect(buildWhatsAppLink("")).toBeNull();
    expect(buildWhatsAppLink(null)).toBeNull();
    expect(buildWhatsAppLink("0000000000")).toBeNull();
  });
});
