import { normalizeProductName } from "./imageMatching";

/**
 * Etapa 5 — matching de "producto detectado en un archivo externo" contra el catálogo real
 * (global + propio) de la consultora. Reutiliza `normalizeProductName` de shared/imageMatching.ts
 * — la MISMA normalización ya corregida en la Etapa 2 para preservar "/" literal (ver
 * "(N/S)"/"(C/G)"/"(N/G)") — a propósito, para no crear una segunda lógica incompatible.
 *
 * Deliberadamente CONSERVADOR: solo hay un tier de matching automático (exacto tras
 * normalizar). A diferencia de `findProductImageMatches` (que sí hace scoring aproximado,
 * porque compara contra NOMBRES DE ARCHIVO típicamente abreviados), acá el archivo de origen
 * trae el nombre comercial completo del producto — no hay razón para arriesgar un falso
 * positivo con matching parcial cuando lo que está en juego es qué producto exactamente se
 * carga. Ver informe de la Etapa 5: "la prioridad es evitar falsos positivos".
 */

/** Fila cruda extraída de un archivo (Excel/CSV/PDF) — solo lo que de verdad importa importar. */
export interface ImportedProductRow {
  /** Texto tal cual apareció en el archivo — nunca se persiste, solo se usa para matching y
   * para mostrárselo a la consultora si hace falta resolución manual. */
  sourceName: string;
  quantity: number;
}

/** Forma mínima de un producto del catálogo (global o propio) necesaria para matchear y para
 * completar precio/puntos desde nuestra DB — nunca desde el archivo externo. */
export interface ImportCatalogProduct {
  id: number;
  producto: string;
  variante: string;
  seccion: string;
  precio: number;
  puntos: number;
  imagen: string | null;
}

export type ImportMatchStatus = "matched" | "ambiguous" | "not_found";

export interface ImportMatchResult {
  sourceName: string;
  quantity: number;
  status: ImportMatchStatus;
  /** El producto asignado — solo si status === "matched" (automático) o si la consultora ya
   * lo resolvió manualmente (ver client: la UI puede "promover" un ambiguous/not_found a
   * matched asignando este campo a mano, mismo patrón que BulkImageUpload). */
  product: ImportCatalogProduct | null;
  /** Candidatos entre los que la consultora tiene que elegir — solo con contenido si
   * status === "ambiguous". Nunca se auto-elige el primero. */
  candidates: ImportCatalogProduct[];
}

/** Mismo criterio que `formatProductLabel` (shared/imageMatching.ts) pero SIN el separador
 * " — " (em dash): los archivos de origen (Excel/PDF reales de catálogo) escriben el nombre
 * completo con un espacio simple, ej. "Base de Maquillaje TimeWise 3D Luminosa (N/S)" — nunca
 * "Base de Maquillaje TimeWise 3D — Luminosa (N/S)". Separado de formatProductLabel a
 * propósito: ese es para DISPLAY en la UI, este es para COMPARAR contra texto externo. */
function catalogMatchLabel(p: Pick<ImportCatalogProduct, "producto" | "variante">): string {
  return p.variante && p.variante !== "Estándar" ? `${p.producto} ${p.variante}` : p.producto;
}

/**
 * Matchea cada fila importada contra el catálogo dado (ya filtrado por el caller a lo que esa
 * consultora puede usar — global + propio, ver server/routes.ts). Pura, sin I/O — testeable
 * directo. Un solo tier automático: exacto tras normalizar. 0 candidatos -> not_found, 1 ->
 * matched, 2+ -> ambiguous (nunca se elige solo).
 */
export function matchImportedProducts(
  rows: ImportedProductRow[],
  catalog: ImportCatalogProduct[],
): ImportMatchResult[] {
  const byNormalizedLabel = new Map<string, ImportCatalogProduct[]>();
  for (const p of catalog) {
    const key = normalizeProductName(catalogMatchLabel(p));
    const list = byNormalizedLabel.get(key) ?? [];
    list.push(p);
    byNormalizedLabel.set(key, list);
  }

  return rows.map((row) => {
    const key = normalizeProductName(row.sourceName);
    const candidates = key.length > 0 ? (byNormalizedLabel.get(key) ?? []) : [];

    if (candidates.length === 1) {
      return { sourceName: row.sourceName, quantity: row.quantity, status: "matched", product: candidates[0], candidates: [] };
    }
    if (candidates.length > 1) {
      return { sourceName: row.sourceName, quantity: row.quantity, status: "ambiguous", product: null, candidates };
    }
    return { sourceName: row.sourceName, quantity: row.quantity, status: "not_found", product: null, candidates: [] };
  });
}
