import { slugify } from "./slug";

/** Saca la extensión de un nombre de archivo ("Labial Ultimate.jpg" -> "Labial Ultimate"). */
export function stripImageExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

/** Normalización reutilizable para comparar un nombre de producto contra un nombre de
 * archivo: minúsculas, sin acentos (slugify), y cualquier separador (espacio, guión, guión
 * bajo, punto, paréntesis, símbolos) colapsado a un solo "-". No saca palabras del nombre
 * del producto — solo homogeneiza separadores y mayúsculas/acentos. */
export function normalizeProductName(value: string): string {
  return slugify(value)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Método principal de la carga masiva ya existente: exige el formato exacto `<id>.<ext>`. */
export function extractIdFromFilename(filename: string): number | null {
  const base = stripImageExtension(filename);
  if (!/^[1-9]\d*$/.test(base)) return null;
  return Number(base);
}

export function formatProductLabel(p: { producto: string; variante: string }): string {
  return p.variante && p.variante !== "Estándar" ? `${p.producto} — ${p.variante}` : p.producto;
}

// ---------------------------------------------------------------------------
// Matching de imágenes ya presentes en Storage contra productos sin imagen.
// ---------------------------------------------------------------------------

export type StorageMatchConfidence = "exacta" | "alta" | "media";

/** Por debajo de este porcentaje de cobertura del nombre del producto, ni se considera un
 * candidato "media" — se descarta directamente (sin_coincidencia). Ajustable si al probar
 * con datos reales resulta demasiado laxo o demasiado estricto. */
const MEDIUM_MIN_RATIO = 0.4;

interface RawScore {
  confidence: StorageMatchConfidence;
  score: number;
}

function tokenize(normalized: string): string[] {
  return normalized.split("-").filter(Boolean);
}

/** Compara UN nombre candidato de producto (tal cual, sin normalizar) contra el nombre de
 * archivo (sin extensión, sin normalizar) y devuelve la mejor coincidencia posible entre
 * ambos, o null si no hay ninguna relación reconocible.
 *
 * - Igual literal (antes de normalizar) -> "exacta" 100%.
 * - Igual después de normalizar (mayúsculas/acentos/separadores) -> "alta" ~97%.
 * - Coincidencia parcial: todas las palabras del ARCHIVO aparecen entre las palabras del
 *   PRODUCTO (nunca al revés — un archivo con palabras que el producto no tiene no es un
 *   parcial suyo), y cubren al menos MEDIUM_MIN_RATIO del producto -> "media", score =
 *   % del producto cubierto. Ejemplo: archivo "Belara" contra producto "Perfume Belara"
 *   cubre 1 de 2 palabras -> media, 50%.
 */
function scoreOne(productLabel: string, fileNameNoExt: string): RawScore | null {
  if (productLabel === fileNameNoExt) {
    return { confidence: "exacta", score: 100 };
  }

  const productNorm = normalizeProductName(productLabel);
  const fileNorm = normalizeProductName(fileNameNoExt);
  if (productNorm.length === 0 || fileNorm.length === 0) return null;

  if (productNorm === fileNorm) {
    return { confidence: "alta", score: 97 };
  }

  const productTokens = tokenize(productNorm);
  const fileTokens = tokenize(fileNorm);
  if (productTokens.length === 0 || fileTokens.length === 0) return null;

  const productTokenSet = new Set(productTokens);
  const coveredFileTokens = fileTokens.filter((t) => productTokenSet.has(t)).length;
  if (coveredFileTokens < fileTokens.length) return null; // el archivo menciona algo que el producto no tiene

  const ratio = coveredFileTokens / productTokens.length;
  if (ratio < MEDIUM_MIN_RATIO) return null;

  return { confidence: "media", score: Math.round(ratio * 100) };
}

export interface StorageImageFile {
  /** Path completo dentro del bucket, ej. "products/labial-ultimate.jpg". */
  path: string;
  /** Solo el nombre de archivo, ej. "labial-ultimate.jpg". */
  name: string;
  /** URL pública, lista para usar como `imagen` del producto si se asigna. */
  url: string;
}

export interface ProductForImageMatching {
  id: number;
  producto: string;
  variante: string;
  imagen: string | null;
}

export interface StorageFileCandidate {
  filePath: string;
  fileName: string;
  fileUrl: string;
  confidence: StorageMatchConfidence;
  score: number;
}

export type ProductMatchBucket = "segura" | "revisar" | "sin_coincidencia";

export interface ProductImageMatch {
  productId: number;
  productLabel: string;
  /** Ordenados de mayor a menor score. Vacío si bucket === "sin_coincidencia". */
  candidates: StorageFileCandidate[];
  bucket: ProductMatchBucket;
  /** Motivo legible de por qué no es "segura" cuando hay candidatos — para mostrar en la UI. */
  reason: "unica_alta_confianza" | "varias_candidatas" | "archivo_en_disputa" | "confianza_media" | "sin_archivos" | null;
}

/**
 * Empareja productos sin imagen contra archivos de Storage sin asignar. Un producto solo
 * puede terminar en "segura" si: (a) su mejor candidato es de confianza exacta/alta, (b) es
 * único para ese producto (no hay otro archivo empatado en el primer puesto), y (c) ningún
 * OTRO producto también lo tiene como su mejor candidato de confianza exacta/alta — si dos
 * productos "quieren" el mismo archivo, ambos quedan para revisión manual (sección 7).
 */
export function findProductImageMatches(
  products: ProductForImageMatching[],
  files: StorageImageFile[],
): ProductImageMatch[] {
  const eligibleProducts = products.filter((p) => !p.imagen);

  const raw = eligibleProducts.map((product) => {
    const labels = Array.from(new Set([formatProductLabel(product), product.producto]));
    const candidates: StorageFileCandidate[] = [];

    for (const file of files) {
      const fileNameNoExt = stripImageExtension(file.name);
      let best: RawScore | null = null;
      for (const label of labels) {
        const result = scoreOne(label, fileNameNoExt);
        if (result && (!best || result.score > best.score)) best = result;
      }
      if (best) {
        candidates.push({ filePath: file.path, fileName: file.name, fileUrl: file.url, ...best });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return { product, candidates };
  });

  // Para el chequeo de "archivo en disputa": qué productos reclaman cada archivo como su
  // mejor candidato de confianza exacta/alta (empate en el primer puesto incluido).
  const safeClaimsByFile = new Map<string, number[]>();
  for (const { product, candidates } of raw) {
    if (candidates.length === 0) continue;
    const top = candidates[0];
    if (top.confidence === "media") continue;
    const tiedAtTop = candidates.filter((c) => c.score === top.score);
    if (tiedAtTop.length > 1) continue; // ya ambigua por sí sola, no reclama nada en disputa
    const list = safeClaimsByFile.get(top.filePath) ?? [];
    list.push(product.id);
    safeClaimsByFile.set(top.filePath, list);
  }

  return raw.map(({ product, candidates }): ProductImageMatch => {
    const productLabel = formatProductLabel(product);
    if (candidates.length === 0) {
      return { productId: product.id, productLabel, candidates, bucket: "sin_coincidencia", reason: "sin_archivos" };
    }

    const top = candidates[0];
    const tiedAtTop = candidates.filter((c) => c.score === top.score);

    if (top.confidence === "media") {
      return { productId: product.id, productLabel, candidates, bucket: "revisar", reason: "confianza_media" };
    }
    if (tiedAtTop.length > 1) {
      return { productId: product.id, productLabel, candidates, bucket: "revisar", reason: "varias_candidatas" };
    }
    const claimants = safeClaimsByFile.get(top.filePath) ?? [];
    if (claimants.length > 1) {
      return { productId: product.id, productLabel, candidates, bucket: "revisar", reason: "archivo_en_disputa" };
    }
    return { productId: product.id, productLabel, candidates, bucket: "segura", reason: "unica_alta_confianza" };
  });
}
