import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parsePdfImportRows,
  parseCsvImportRows,
  ImportParseError,
  rowsFromCells,
  findColumn,
  NAME_HEADER_ALIASES,
  QTY_HEADER_ALIASES,
} from "../importParsers";

/**
 * Etapa 5 — parsers puros (sin DB, sin sesión). El PDF usado en estos tests es el archivo
 * REAL provisto como referencia ("Stock_completo_diseño_original.pdf"), copiado tal cual a
 * server/tests/fixtures/ — no es un PDF artificial. Verificado manualmente antes de escribir
 * estos tests: 184 productos según su propio encabezado ("184 productos"), 5 páginas, 14
 * categorías, TODAS las filas con cantidad 0 (es un snapshot de "stock completo", no un
 * pedido con cantidades reales) — no se inventó ninguna cantidad positiva.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "stock-completo-original.pdf");

describe("parsePdfImportRows — PDF real de referencia", () => {
  it("1. detecta exactamente 184 productos (coincide con el encabezado del propio PDF: '184 productos')", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows).toHaveLength(184);
  });

  it("2. TODAS las cantidades son 0 en este PDF de referencia — reportado, no inventado", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows.every((r) => r.quantity === 0)).toBe(true);
    expect(rows.some((r) => r.quantity > 0)).toBe(false);
  });

  it("4. las categorías (At Play, Color, TimeWise, etc.) nunca aparecen como filas de producto", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    const categories = [
      "At Play",
      "Brochas y aplicadores",
      "Clinical Solutions",
      "Color",
      "Cuidado del cuerpo",
      "Discontinuos",
      "Fragancias femeninas",
      "Fragancias masculinas",
      "Nueva línea",
      "Suplementarios",
      "TimeWise",
      "TimeWise Repair",
    ];
    for (const cat of categories) {
      expect(rows.some((r) => r.sourceName === cat)).toBe(false);
    }
  });

  it("5. el encabezado de columnas ('Producto', 'Cant.', 'Precio', 'Subtotal') nunca aparece como fila de producto", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Producto")).toBe(false);
    expect(rows.some((r) => /^Cant\.?$/.test(r.sourceName))).toBe(false);
    expect(rows.some((r) => r.sourceName === "Precio")).toBe(false);
    expect(rows.some((r) => r.sourceName === "Subtotal")).toBe(false);
    // Tampoco el título ni la línea de fecha/total.
    expect(rows.some((r) => r.sourceName === "Stock completo")).toBe(false);
    expect(rows.some((r) => /Generado el/.test(r.sourceName))).toBe(false);
  });

  it("6/7. precio y subtotal del PDF nunca terminan en el nombre ni en la cantidad extraída (ImportedProductRow no tiene esos campos)", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["quantity", "sourceName"]);
      expect(r.sourceName).not.toMatch(/^\$/); // nunca confunde un precio con un nombre
    }
  });

  it("8. producto con número propio en el nombre ('Spray Corporal - 147 ml') se detecta con el nombre completo, cantidad separada", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.sourceName === "Spray Corporal - 147 ml");
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(0); // la cantidad real de esta fila en el PDF, no el "147"
  });

  it("9/10. 'x 1' y 'x 2' dentro del nombre nunca se confunden con la cantidad de la fila", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    const uno = rows.find((r) => r.sourceName === "Cabezal de Masaje Facial Skinvigorate Sonic x 1");
    const dos = rows.find((r) => r.sourceName === "Cabezal del Cepillo Limpiador Facial Skinvigorate Sonic x 2");
    const esponja = rows.find((r) => r.sourceName === "Esponja Cosmética x 2");
    expect(uno).toBeDefined();
    expect(dos).toBeDefined();
    expect(esponja).toBeDefined();
    // Las tres cantidades reales de esas filas son 0 en este PDF — el "1"/"2" del nombre
    // nunca se lee como si fuera la cantidad de la columna.
    expect(uno!.quantity).toBe(0);
    expect(dos!.quantity).toBe(0);
    expect(esponja!.quantity).toBe(0);
  });

  it("11/14. '(N/S)' se preserva literal, con la '/' intacta", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Base de Maquillaje TimeWise 3D Luminosa (N/S)")).toBe(true);
    expect(rows.some((r) => r.sourceName === "Crema Facial Hidratante (N/S)")).toBe(true);
  });

  it("12/14. '(C/G)' se preserva literal, con la '/' intacta", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Base de Maquillaje TimeWise 3D Mate (C/G)")).toBe(true);
    expect(rows.some((r) => r.sourceName === "Crema Facial Matificante (C/G)")).toBe(true);
  });

  it("13/14. un '/' fuera de paréntesis ('Crayón Iluminador/Contorno', 'Mate At Play / Mágico') también se preserva", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Crayón Iluminador/Contorno")).toBe(true);
    expect(rows.some((r) => r.sourceName.includes("/"))).toBe(true);
  });

  it("24. PDF corrupto/malformado tira ImportParseError, nunca explota sin control", async () => {
    const garbage = Buffer.from("esto no es un PDF válido, solo texto plano");
    await expect(parsePdfImportRows(garbage)).rejects.toThrow(ImportParseError);
  });

  it("23. archivo vacío tira ImportParseError", async () => {
    await expect(parsePdfImportRows(Buffer.alloc(0))).rejects.toThrow(ImportParseError);
  });
});

describe("rowsFromCells / findColumn — lógica compartida por Excel y CSV", () => {
  it("detecta las columnas Producto/Cantidad por encabezado, sin importar el orden", () => {
    const header = ["Cantidad", "Producto"];
    expect(findColumn(header, NAME_HEADER_ALIASES)).toBe(1);
    expect(findColumn(header, QTY_HEADER_ALIASES)).toBe(0);
  });

  it("reconoce alias razonables de encabezado (mayúsculas, acentos, 'Cant.')", () => {
    const header = ["PRODUCTO", "Cant."];
    expect(findColumn(header, NAME_HEADER_ALIASES)).toBe(0);
    expect(findColumn(header, QTY_HEADER_ALIASES)).toBe(1);
  });

  it("ignora filas con nombre vacío", () => {
    const rows = rowsFromCells([["", "3"], ["Producto real", "2"]], 0, 1);
    expect(rows).toEqual([{ sourceName: "Producto real", quantity: 2 }]);
  });

  it("ignora filas con cantidad no numérica en vez de romper", () => {
    const rows = rowsFromCells([["Producto A", "N/D"], ["Producto B", "5"]], 0, 1);
    expect(rows).toEqual([{ sourceName: "Producto B", quantity: 5 }]);
  });

  it("trunca decimales y nunca genera cantidades negativas", () => {
    const rows = rowsFromCells([["Producto A", "3.7"], ["Producto B", "-2"]], 0, 1);
    expect(rows[0].quantity).toBe(3);
    expect(rows[1].quantity).toBe(0);
  });
});

describe("parseCsvImportRows", () => {
  it("17/18. match exacto vía CSV con ';' como delimitador (formato es-AR típico)", () => {
    const csv = "Producto;Cantidad\nBase de Maquillaje At Play;3\nLabial Liquido Mate At Play;2\n";
    const rows = parseCsvImportRows(Buffer.from(csv, "utf8"));
    expect(rows).toEqual([
      { sourceName: "Base de Maquillaje At Play", quantity: 3 },
      { sourceName: "Labial Liquido Mate At Play", quantity: 2 },
    ]);
  });

  it("funciona igual con ',' como delimitador", () => {
    const csv = "Producto,Cantidad\nGel de Ducha,4\n";
    const rows = parseCsvImportRows(Buffer.from(csv, "utf8"));
    expect(rows).toEqual([{ sourceName: "Gel de Ducha", quantity: 4 }]);
  });

  it("31. no rompe con columnas extra (precio/subtotal) — solo toma nombre y cantidad", () => {
    const csv = "Producto;Cantidad;Precio;Subtotal\nBase de Maquillaje At Play;3;27000;81000\n";
    const rows = parseCsvImportRows(Buffer.from(csv, "utf8"));
    expect(rows).toEqual([{ sourceName: "Base de Maquillaje At Play", quantity: 3 }]);
  });

  it("23. archivo vacío tira ImportParseError", () => {
    expect(() => parseCsvImportRows(Buffer.from(""))).toThrow(ImportParseError);
  });

  it("23. sin columnas reconocibles tira ImportParseError en vez de importar datos incorrectos", () => {
    const csv = "Columna A;Columna B\nvalor;valor\n";
    expect(() => parseCsvImportRows(Buffer.from(csv, "utf8"))).toThrow(ImportParseError);
  });
});
