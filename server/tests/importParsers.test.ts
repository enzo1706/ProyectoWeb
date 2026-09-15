import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parsePdfImportRows,
  parseCsvImportRows,
  parseExcelImportRows,
  ImportParseError,
  rowsFromCells,
  findColumn,
  NAME_HEADER_ALIASES,
  QTY_HEADER_ALIASES,
} from "../importParsers";
import { matchImportedProducts, type ImportCatalogProduct } from "../../shared/importMatching";

/**
 * Etapa 5 — parsers puros (sin DB, sin sesión). El PDF usado en estos tests es el archivo
 * REAL provisto como referencia ("Stock_completo_diseño_original.pdf"), copiado tal cual a
 * server/tests/fixtures/ — no es un PDF artificial. Verificado manualmente antes de escribir
 * estos tests: 184 productos según su propio encabezado ("184 productos"), 5 páginas, 14
 * categorías, TODAS las filas con cantidad 0 (es un snapshot de "stock completo", no un
 * pedido con cantidades reales) — no se inventó ninguna cantidad positiva.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "stock-completo-original.pdf");

/**
 * Etapa 7.1 — cierra el P1 de la auditoría de Etapa 6: hasta acá `parseExcelImportRows`
 * nunca había corrido contra un archivo `.xlsx` binario real, solo contra arrays sintéticos
 * (ver "rowsFromCells / findColumn" más abajo). Estos DOS fixtures son archivos `.xlsx`
 * reales (formato "Microsoft Excel 2007+" confirmado, no un mock) generados una única vez
 * con `write-excel-file` (dependencia dev-only, instalada temporalmente con --no-save para
 * fabricarlos y desinstalada apenas terminaron — igual que uno redactaría el archivo a mano
 * en Excel/Sheets y lo subiría; no queda como dependencia del proyecto). El propio
 * `pedido-modelo.xlsx` trae una columna "Precio" ficticia que ningún test de acá abajo debe
 * usar — sirve para demostrar en el nivel HTTP (ver import-route.test.ts) que se ignora.
 */
const XLSX_MAIN_PATH = path.join(__dirname, "fixtures", "pedido-modelo.xlsx");
const XLSX_ALIAS_PATH = path.join(__dirname, "fixtures", "pedido-modelo-alias.xlsx");

/**
 * Etapa 7.3 — cierra el P2 de la auditoría de Etapa 6: un nombre de producto partido en más de
 * un fragmento de texto (mismo Y, misma fila) se sobreescribía en vez de concatenarse — el PDF
 * real de 184 productos NUNCA dispara este caso (confirmado empíricamente antes de esta etapa,
 * cero filas multi-fragmento), así que no sirve para reproducirlo. Este es un PDF REAL mínimo
 * (formato "PDF document, version 1.4" confirmado, no un mock de pdfjs) construido a mano
 * emitiendo operaciones `Tm ... Tj` separadas en las mismas coordenadas Y que usaría una fila
 * real de la tabla — exactamente la estructura que hace que pdf.js entregue múltiples
 * `TextItem` para un mismo nombre. No se agregó ninguna dependencia nueva para generarlo (a
 * diferencia de los fixtures .xlsx de la Etapa 7.1, un PDF simple sin compresión es texto
 * plano, escribible directamente).
 */
const PDF_FRAGMENTED_PATH = path.join(__dirname, "fixtures", "pedido-fragmentado.pdf");

describe("parseExcelImportRows — .xlsx real (Etapa 7.1)", () => {
  it("detecta 8 de las 9 filas de datos (nombre vacío y cantidad inválida se descartan, no rompen el resto)", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    expect(rows).toHaveLength(8);
  });

  it("columnas en orden Cantidad-luego-Producto (invertido) se detectan igual por encabezado, no por posición", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    const base = rows.find((r) => r.sourceName === "Base de Maquillaje At Play");
    expect(base).toBeDefined();
    expect(base!.quantity).toBe(3);
  });

  it("cantidad 0 se detecta igual (no se confunde con fila inválida)", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    const perfume = rows.find((r) => r.sourceName === "Perfume Belara");
    expect(perfume).toBeDefined();
    expect(perfume!.quantity).toBe(0);
  });

  it("nombre vacío se descarta silenciosamente, sin romper el resto del archivo", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "")).toBe(false);
  });

  it("cantidad no numérica ('N/D') descarta esa fila, sin romper el resto del archivo", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Producto Con Cantidad Invalida")).toBe(false);
  });

  it("'x 2' dentro del nombre nunca se confunde con la cantidad de la fila (viene de la columna Cantidad real)", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    const row = rows.find((r) => r.sourceName === "Cabezal del Cepillo Limpiador Facial Skinvigorate Sonic x 2");
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(2);
  });

  it("'147 ml' dentro del nombre nunca se confunde con la cantidad de la fila", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    const row = rows.find((r) => r.sourceName === "Spray Corporal - 147 ml");
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(4);
  });

  it("variantes '(N/S)', '(C/G)' y '(N/G)' se preservan literales, con la '/' intacta", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Crema Facial Hidratante (N/S)")).toBe(true);
    expect(rows.some((r) => r.sourceName === "Crema Facial Matificante (C/G)")).toBe(true);
    expect(rows.some((r) => r.sourceName === "Crema Facial Reafirmante (N/G)")).toBe(true);
  });

  it("un '/' fuera de paréntesis ('Crayón Iluminador/Contorno') también se preserva", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    expect(rows.some((r) => r.sourceName === "Crayón Iluminador/Contorno")).toBe(true);
  });

  it("la columna 'Precio' del archivo nunca aparece en el resultado — ImportedProductRow no tiene ese campo", async () => {
    const buffer = await readFile(XLSX_MAIN_PATH);
    const rows = await parseExcelImportRows(buffer);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["quantity", "sourceName"]);
    }
  });

  it("alias de encabezado distintos ('Descripcion'/'Cant.') y orden Producto-luego-Cantidad también se reconocen", async () => {
    const buffer = await readFile(XLSX_ALIAS_PATH);
    const rows = await parseExcelImportRows(buffer);
    expect(rows).toEqual([
      { sourceName: "Base de Maquillaje At Play", quantity: 5 },
      { sourceName: "Perfume Belara", quantity: 0 },
    ]);
  });

  it("archivo vacío/corrupto tira ImportParseError, nunca explota sin control", async () => {
    const garbage = Buffer.from("esto no es un .xlsx válido, solo texto plano");
    await expect(parseExcelImportRows(garbage)).rejects.toThrow(ImportParseError);
  });
});

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

describe("parsePdfImportRows — nombres fragmentados en múltiples TextItem (Etapa 7.3, hallazgo P2)", () => {
  it("1/2/3. nombre en 2 fragmentos, EMITIDOS FUERA de orden visual (Facial antes que Crema en el PDF) -> se reconstruye por posición X, no por orden de emisión", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.quantity === 3);
    expect(row).toBeDefined();
    expect(row!.sourceName).toBe("Crema Facial"); // nunca "Facial Crema" ni solo "Crema"
  });

  it("1/2/3. nombre en 3 fragmentos emitidos en orden -> se concatenan completos (caso literal de la sección 5 del pedido)", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.quantity === 5);
    expect(row).toBeDefined();
    expect(row!.sourceName).toBe("Crema Facial Antiedad"); // nunca "Antiedad" solo, nunca "Crema" solo
  });

  it("4. un nombre en UN solo fragmento (caso normal, sin fragmentación) sigue funcionando exactamente igual", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.quantity === 7);
    expect(row).toBeDefined();
    expect(row!.sourceName).toBe("ProductoUnico");
  });

  it("4. la concatenación usa exactamente un espacio entre fragmentos — nunca doble espacio ni espacio faltante", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.quantity === 5);
    expect(row!.sourceName).not.toMatch(/ {2,}/); // nunca doble espacio
    expect(row!.sourceName.split(" ")).toEqual(["Crema", "Facial", "Antiedad"]);
  });

  it("5. número propio dentro de un nombre fragmentado ('147') nunca se confunde con la cantidad real de la fila", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.sourceName === "Spray 147 ml");
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(2); // la cantidad real de la columna, nunca el "147" del nombre
  });

  it("6. 'x 1' fragmentado del resto del nombre nunca se confunde con la cantidad real de la fila", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.sourceName === "Cabezal Repuesto x 1");
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(6); // nunca el "1" de "x 1"
  });

  it("7. 'x 2' fragmentado del resto del nombre nunca se confunde con la cantidad real de la fila", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.sourceName === "Cabezal Repuesto Doble x 2");
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(8); // nunca el "2" de "x 2"
  });

  it("9/10/12. variante '(N/S)' en un fragmento separado se preserva completa, con paréntesis y '/' intactos, al concatenar", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    const row = rows.find((r) => r.quantity === 4);
    expect(row).toBeDefined();
    expect(row!.sourceName).toBe("Crema Facial Hidratante (N/S)");
  });

  it("13/14/15. cantidad, precio y subtotal (columnas separadas) nunca se mezclan con el nombre reconstruido", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    for (const row of rows) {
      // ImportedProductRow solo tiene sourceName/quantity — si precio/subtotal se hubieran
      // colado en el nombre reconstruido, estas dos aserciones lo detectarían.
      expect(row.sourceName).not.toMatch(/^\$/);
      expect(Object.keys(row).sort()).toEqual(["quantity", "sourceName"]);
    }
  });

  it("total de filas del fixture: exactamente 7, ninguna colapsada ni perdida por la reconstrucción", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);
    expect(rows).toHaveLength(7);
  });

  it("19. de punta a punta: PDF real -> sourceName reconstruido -> normalizeProductName -> matchImportedProducts encuentra el producto del catálogo", async () => {
    const buffer = await readFile(PDF_FRAGMENTED_PATH);
    const rows = await parsePdfImportRows(buffer);

    // Antes de esta etapa, "Crema Facial Antiedad" llegaba como "Antiedad" (el bug) y este
    // catálogo NUNCA hubiera matcheado — es exactamente el caso que describía la Etapa 6:
    // "sourceName incorrecto -> no encontrado" pasa a "sourceName correcto -> match correcto".
    const catalog: ImportCatalogProduct[] = [
      { id: 1, producto: "Crema Facial Antiedad", variante: "Estándar", seccion: "Test", precio: 25000, puntos: 10, imagen: null },
    ];
    const matches = matchImportedProducts(rows, catalog);

    const match = matches.find((m) => m.quantity === 5);
    expect(match).toBeDefined();
    expect(match!.status).toBe("matched");
    expect(match!.product?.id).toBe(1);
    expect(match!.product?.precio).toBe(25000); // del catálogo, nunca de ningún dato del PDF
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
