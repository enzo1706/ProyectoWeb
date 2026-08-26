import {
  stripImageExtension,
  normalizeProductName,
  extractIdFromFilename,
  formatProductLabel as sharedFormatProductLabel,
} from "@shared/imageMatching";

/** Debe coincidir exactamente con ALLOWED_IMAGE_TYPES de server/routes.ts. */
export const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface CatalogProductRef {
  id: number;
  producto: string;
  variante: string;
  seccion: string;
  linea: string | null;
  imagen: string | null;
}

export type MatchMethod = "id" | "nombre" | "manual";
export type MatchStatus = "reconocida" | "sin_coincidencia" | "ambigua";

export interface MatchResult {
  status: MatchStatus;
  method: MatchMethod | null;
  productId: number | null;
  candidates: CatalogProductRef[];
}

// Reexportada tal cual para no romper el import existente en BulkImageUpload.tsx — la
// implementación real ahora vive en shared/imageMatching.ts (única fuente de verdad,
// reusada también por el matching de imágenes ya presentes en Storage).
export { extractIdFromFilename };

/** Respaldo: compara el nombre de archivo (sin extensión, normalizado) contra el nombre
 * normalizado de cada producto. 0 candidatos → sin coincidencia; 1 → asignación automática;
 * 2+ → ambigua (nunca se elige solo — así se comportan los 10 productos con nombre repetido
 * pero variante distinta). */
export function matchFileToProduct(filename: string, products: CatalogProductRef[]): MatchResult {
  const id = extractIdFromFilename(filename);
  if (id !== null) {
    const product = products.find((p) => p.id === id);
    if (product) {
      return { status: "reconocida", method: "id", productId: product.id, candidates: [product] };
    }
  }

  const normalized = normalizeProductName(stripImageExtension(filename));
  if (normalized.length === 0) {
    return { status: "sin_coincidencia", method: null, productId: null, candidates: [] };
  }

  const candidates = products.filter((p) => normalizeProductName(p.producto) === normalized);
  if (candidates.length === 1) {
    return { status: "reconocida", method: "nombre", productId: candidates[0].id, candidates };
  }
  if (candidates.length > 1) {
    return { status: "ambigua", method: null, productId: null, candidates };
  }
  return { status: "sin_coincidencia", method: null, productId: null, candidates: [] };
}

export function validateImageFile(file: File): { valid: true } | { valid: false; reason: string } {
  const mimeType = file.type || inferMimeFromExtension(file.name);
  if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES[mimeType]) {
    return { valid: false, reason: "Formato no permitido (solo JPG, PNG o WebP)" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { valid: false, reason: "Supera el límite de 5MB" };
  }
  return { valid: true };
}

function inferMimeFromExtension(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_MIME[ext] ?? null;
}

export function formatProductLabel(p: Pick<CatalogProductRef, "producto" | "variante">): string {
  return sharedFormatProductLabel(p);
}
