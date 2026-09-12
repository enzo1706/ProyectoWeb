import { readSheet } from "read-excel-file/node";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeProductName } from "@shared/imageMatching";
import type { ImportedProductRow } from "@shared/importMatching";

/**
 * Etapa 5 — parsers de "Excel/CSV/PDF -> ImportedProductRow[]". Cada uno extrae SOLO nombre +
 * cantidad — nunca precio, puntos, ni ningún otro dato del archivo externo (esos siempre
 * vienen del catálogo real, ver shared/importMatching.ts). Nunca tocan el importador
 * administrativo existente (ProductManagement.tsx / POST /api/admin/products/bulk) — es un
 * flujo completamente separado, con su propio propósito (carga de catálogo global vs. carga
 * de cantidades de un pedido/stock contra el catálogo ya existente).
 */

export class ImportParseError extends Error {}

// Exportadas para poder testear esta lógica directo con arrays sintéticos (ver
// server/tests/importParsers.test.ts) — es el código propio real; `readSheet` (la única parte
// no testeada acá con un binario .xlsx real) es de la librería `read-excel-file`, ya en uso
// y confiable en el importador admin existente. Evita agregar una dependencia nueva solo para
// fabricar un archivo .xlsx de prueba.
export const NAME_HEADER_ALIASES = ["producto", "productos", "nombre", "articulo", "descripcion"].map(normalizeProductName);
export const QTY_HEADER_ALIASES = ["cantidad", "cant", "unidades", "qty", "cant."].map(normalizeProductName);

export function findColumn(headerRow: unknown[], aliases: string[]): number {
  return headerRow.findIndex((cell) => aliases.includes(normalizeProductName(String(cell ?? ""))));
}

/** Filas de datos crudas (celdas) -> ImportedProductRow[], dado el índice de cada columna.
 * Compartido por Excel y CSV — ambos terminan en la misma forma de fila (array de celdas). */
export function rowsFromCells(dataRows: unknown[][], nameIdx: number, qtyIdx: number): ImportedProductRow[] {
  const rows: ImportedProductRow[] = [];
  for (const row of dataRows) {
    const nameRaw = String(row[nameIdx] ?? "").trim();
    if (!nameRaw) continue;
    const qtyRaw = String(row[qtyIdx] ?? "").trim();
    const qty = Number(qtyRaw.replace(",", "."));
    if (!Number.isFinite(qty)) continue;
    rows.push({ sourceName: nameRaw, quantity: Math.max(0, Math.trunc(qty)) });
  }
  return rows;
}

/** Excel real (.xlsx/.xls) — vía read-excel-file/node, mismo motor que ya usa el importador
 * admin (client-side), acá del lado del servidor porque este flujo entero corre server-side
 * (ver server/routes.ts). Detecta la columna de nombre y de cantidad por encabezado — no
 * asume un orden de columnas fijo. */
export async function parseExcelImportRows(buffer: Buffer): Promise<ImportedProductRow[]> {
  let sheet: unknown[][];
  try {
    sheet = (await readSheet(buffer)) as unknown[][];
  } catch (err) {
    throw new ImportParseError(err instanceof Error ? `No se pudo leer el archivo Excel: ${err.message}` : "No se pudo leer el archivo Excel.");
  }

  const [headerRow, ...dataRows] = sheet;
  if (!headerRow) throw new ImportParseError("El archivo está vacío.");

  const nameIdx = findColumn(headerRow, NAME_HEADER_ALIASES);
  const qtyIdx = findColumn(headerRow, QTY_HEADER_ALIASES);
  if (nameIdx === -1 || qtyIdx === -1) {
    throw new ImportParseError('No pudimos reconocer las columnas "Producto" y "Cantidad" en el archivo.');
  }

  return rowsFromCells(dataRows, nameIdx, qtyIdx);
}

/** CSV mínimo, dedicado — mismo criterio de detección de delimitador (`,` vs `;`) que el
 * importador admin, sin duplicar su parser privado (es un archivo distinto, con un propósito
 * distinto: acá solo hacen falta 2 columnas, no todo el schema de carga de catálogo). */
function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvText(text: string, delimiter: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseCsvImportRows(buffer: Buffer): ImportedProductRow[] {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const delimiter = detectDelimiter(text);
  const rows = parseCsvText(text, delimiter);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new ImportParseError("El archivo está vacío.");

  const nameIdx = findColumn(headerRow, NAME_HEADER_ALIASES);
  const qtyIdx = findColumn(headerRow, QTY_HEADER_ALIASES);
  if (nameIdx === -1 || qtyIdx === -1) {
    throw new ImportParseError('No pudimos reconocer las columnas "Producto" y "Cantidad" en el archivo.');
  }

  return rowsFromCells(dataRows, nameIdx, qtyIdx);
}

// ---------------------------------------------------------------------------
// PDF — parser posicional (pdfjs-dist), validado contra un PDF real de catálogo Mary Kay
// (184 productos, 5 páginas, tabla real con columnas Producto/Cant./Precio/Subtotal).
// ---------------------------------------------------------------------------

/**
 * Posiciones X (en puntos PDF) de las 4 columnas de la tabla de referencia. Un documento
 * distinto podría tener otras posiciones exactas — por eso NO se usa como límite estricto,
 * sino como "ancla" para clasificar cada fragmento de texto por cercanía (ver
 * classifyColumn). Mientras el documento mantenga 4 columnas en ese orden aproximado
 * (nombre a la izquierda, cantidad, precio y subtotal más a la derecha, con separación
 * clara entre cada una), el mismo criterio sigue funcionando sin ajustar nada.
 */
const COLUMN_ANCHORS = { name: 43, qty: 415, precio: 462, subtotal: 548 } as const;

function classifyColumn(x: number): keyof typeof COLUMN_ANCHORS {
  let best: keyof typeof COLUMN_ANCHORS = "name";
  let bestDist = Infinity;
  for (const col of Object.keys(COLUMN_ANCHORS) as (keyof typeof COLUMN_ANCHORS)[]) {
    const d = Math.abs(x - COLUMN_ANCHORS[col]);
    if (d < bestDist) {
      bestDist = d;
      best = col;
    }
  }
  return best;
}

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Por qué por POSICIÓN y no por regex sobre el texto plano: un nombre real puede traer
 * números propios ("Esponja Cosmética x 2", "Spray Corporal - 147 ml") que un regex
 * "texto + número + precio + subtotal" confundiría con la cantidad. Acá la cantidad nunca se
 * lee del NOMBRE — se lee de un fragmento de texto totalmente separado, ubicado en su propia
 * columna X, sin importar cuán largo sea el nombre de al lado (los nombres largos extienden
 * su ANCHO visual pero nunca corren su punto de INICIO, que es lo que se clasifica acá).
 *
 * Categorías ("At Play", "Color", etc.) y la fila de encabezado ("Producto"/"Cant."/"Precio"/
 * "Subtotal") se descartan solas: una categoría no tiene ningún fragmento en la columna de
 * cantidad; el encabezado sí tiene un fragmento ahí ("Cant."), pero no es un número — se
 * descarta por el chequeo `/^\d+$/` sobre esa celda, sin necesitar una lista de palabras
 * prohibidas.
 *
 * Limitación conocida: asume una tabla de una sola columna de nombre por fila (no soporta
 * nombres partidos en dos líneas) y un PDF con texto seleccionable real — no hace OCR, un PDF
 * escaneado como imagen no produce ningún resultado (falla con ImportParseError, nunca
 * silenciosamente vacío sin avisar).
 */
export async function parsePdfImportRows(buffer: Buffer): Promise<ImportedProductRow[]> {
  let doc;
  try {
    const data = new Uint8Array(buffer);
    doc = await getDocument({ data, useSystemFonts: true }).promise;
  } catch (err) {
    throw new ImportParseError(err instanceof Error ? `No se pudo leer el PDF: ${err.message}` : "No se pudo leer el PDF.");
  }

  if (doc.numPages === 0) {
    throw new ImportParseError("El PDF no tiene páginas.");
  }

  const rows: ImportedProductRow[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = content.items
      .map((it) => {
        const textItem = it as { str?: string; transform?: number[] };
        return { str: (textItem.str ?? "").trim(), x: textItem.transform?.[4] ?? 0, y: textItem.transform?.[5] ?? 0 };
      })
      .filter((it) => it.str !== "");

    const byY = new Map<string, PdfTextItem[]>();
    for (const item of items) {
      const key = item.y.toFixed(1);
      const list = byY.get(key) ?? [];
      list.push(item);
      byY.set(key, list);
    }

    for (const rowItems of Array.from(byY.values())) {
      const cols: Partial<Record<keyof typeof COLUMN_ANCHORS, string>> = {};
      for (const item of rowItems) {
        cols[classifyColumn(item.x)] = item.str;
      }
      if (!cols.name || !cols.qty) continue;
      const qtyDigits = cols.qty.replace(/\D/g, "");
      if (!/^\d+$/.test(qtyDigits)) continue;
      rows.push({ sourceName: cols.name, quantity: Number(qtyDigits) });
    }
  }

  if (rows.length === 0) {
    throw new ImportParseError(
      "No pudimos detectar ningún producto en el PDF — puede ser un PDF escaneado (imagen, sin texto seleccionable) o no seguir el formato esperado.",
    );
  }

  return rows;
}
