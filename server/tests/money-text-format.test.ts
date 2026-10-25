import { describe, it, expect } from "vitest";
import { formatMoney, liveFormatMoneyText, parseMoneyInput, parsePercentInput } from "@shared/money";
import { pluralize } from "@shared/text";
import { formatDateDisplay, formatDateList, toDateStr } from "../../client/src/lib/date";

describe("Prompt 15 — parseMoneyInput", () => {
  it("un punto con 3 dígitos después es separador de miles, nunca decimal", () => {
    expect(parseMoneyInput("$ 20.100")).toBe(20100);
    expect(parseMoneyInput("20.100")).toBe(20100);
  });

  it("una coma es siempre el separador decimal", () => {
    expect(parseMoneyInput("1.250,50")).toBe(1250.5);
  });

  it("ajuste del usuario: un punto con 1 o 2 dígitos después es decimal, no de miles", () => {
    expect(parseMoneyInput("20.5")).toBe(20.5);
    expect(parseMoneyInput("1250.50")).toBe(1250.5);
  });

  it("varios puntos de miles seguidos (sin coma) se interpretan todos como miles", () => {
    expect(parseMoneyInput("1.234.567")).toBe(1234567);
  });

  it("puntos de miles junto con un punto decimal final (sin coma)", () => {
    expect(parseMoneyInput("1.234.5")).toBe(1234.5);
  });

  it("sin separadores, un número entero tal cual", () => {
    expect(parseMoneyInput("100")).toBe(100);
  });

  it("ignora el símbolo de pesos y los espacios", () => {
    expect(parseMoneyInput("$ 1.250,50")).toBe(1250.5);
    expect(parseMoneyInput(" $20.100 ")).toBe(20100);
  });

  it("campo vacío o sin dígitos da 0, nunca NaN", () => {
    expect(parseMoneyInput("")).toBe(0);
    expect(parseMoneyInput("$")).toBe(0);
  });

  it("un punto final sin dígitos después no rompe el parseo", () => {
    expect(parseMoneyInput("20.")).toBe(20);
  });
});

describe("Prompt 15 — liveFormatMoneyText (mientras se escribe en MoneyInput)", () => {
  it("inserta puntos de miles a medida que se escriben dígitos", () => {
    expect(liveFormatMoneyText("20100")).toBe("20.100");
    expect(liveFormatMoneyText("1234567")).toBe("1.234.567");
  });

  it("mantiene la coma final mientras todavía no se escribieron los centavos", () => {
    expect(liveFormatMoneyText("1250,")).toBe("1.250,");
  });

  it("formatea los centavos a medida que se escriben, truncados a 2 dígitos", () => {
    expect(liveFormatMoneyText("1250,5")).toBe("1.250,5");
    expect(liveFormatMoneyText("1250,50")).toBe("1.250,50");
    expect(liveFormatMoneyText("1250,500")).toBe("1.250,50");
  });

  it("descarta cualquier punto que llegue (la consultora nunca lo tipea, lo inserta el formateador)", () => {
    expect(liveFormatMoneyText("20.100")).toBe("20.100");
  });
});

describe("Prompt 15 — parsePercentInput", () => {
  it("acepta coma decimal", () => {
    expect(parsePercentInput("3,5")).toBe(3.5);
  });

  it("acepta punto decimal (sin el criterio de miles de los montos — nunca aplica a %)", () => {
    expect(parsePercentInput("3.5")).toBe(3.5);
  });

  it("entero sin separador", () => {
    expect(parsePercentInput("21")).toBe(21);
  });

  it("campo vacío da 0", () => {
    expect(parsePercentInput("")).toBe(0);
  });
});

describe("Prompt 15 — formatMoney (sin decimales salvo que el monto los tenga)", () => {
  // Intl.NumberFormat con style:"currency" en es-AR separa el símbolo del número con un
  // espacio NO separable (U+00A0) — se ve igual que un espacio normal en cualquier UI, pero
  // hay que comparar contra el carácter real o el test rompe por una diferencia invisible.
  const NBSP = " ";

  it("un monto entero no muestra decimales", () => {
    expect(formatMoney(20100)).toBe(`$${NBSP}20.100`);
  });

  it("un monto con centavos muestra siempre 2 decimales, nunca 1 ni 0 de más", () => {
    expect(formatMoney(1250.5)).toBe(`$${NBSP}1.250,50`);
  });
});

describe("Prompt 15 — pluralize", () => {
  it("usa el singular con 1", () => {
    expect(pluralize(1, "venta", "ventas")).toBe("1 venta");
  });

  it("usa el plural con cualquier otro número, incluido 0", () => {
    expect(pluralize(0, "venta", "ventas")).toBe("0 ventas");
    expect(pluralize(2, "venta", "ventas")).toBe("2 ventas");
  });

  it("soporta plurales irregulares (no simplemente agregar una 's')", () => {
    expect(pluralize(1, "mes", "meses")).toBe("1 mes");
    expect(pluralize(3, "mes", "meses")).toBe("3 meses");
  });
});

describe("Prompt 15 — formatDateDisplay (detalle)", () => {
  it("formato largo en es-AR, con año", () => {
    expect(formatDateDisplay("2026-10-03")).toBe("3 de octubre de 2026");
  });
});

describe("Prompt 15 — formatDateList (lista), decisión 1 del usuario", () => {
  const today = "2026-10-15";

  it("hoy", () => {
    expect(formatDateList("2026-10-15", today)).toBe("hoy");
  });

  it("ayer", () => {
    expect(formatDateList("2026-10-14", today)).toBe("ayer");
  });

  it("hace N días, hasta 7", () => {
    expect(formatDateList("2026-10-12", today)).toBe("hace 3 días");
    expect(formatDateList("2026-10-08", today)).toBe("hace 7 días");
  });

  it("más de 7 días en el pasado cae a fecha corta, sin año", () => {
    expect(formatDateList("2026-10-07", today)).toBe("7 de oct.");
  });

  it("mañana", () => {
    expect(formatDateList("2026-10-16", today)).toBe("mañana");
  });

  it("en N días, hasta 7 (simétrico al pasado)", () => {
    expect(formatDateList("2026-10-18", today)).toBe("en 3 días");
    expect(formatDateList("2026-10-22", today)).toBe("en 7 días");
  });

  it("más de 7 días en el futuro cae a fecha corta, sin año", () => {
    expect(formatDateList("2026-10-23", today)).toBe("23 de oct.");
  });

  it("usa 'hoy' real (sin segundo argumento) si no se pasa todayStr", () => {
    expect(formatDateList(toDateStr(new Date()))).toBe("hoy");
  });
});
