import type { Product } from "@shared/schema";

/** Categorías reales del catálogo (deduplicadas y ordenadas) — misma fuente para el filtro
 * de Productos y el picker de NewSaleDialog, para no mantener dos veces la misma derivación. */
export function getProductCategories(products: Product[]): string[] {
  return Array.from(new Set(products.map((p) => p.seccion))).sort();
}

/** Clave de "familia" de producto: dos filas con la misma sección+línea+nombre se consideran
 * variantes (tonos) entre sí. Es una heurística de texto — no hay relación de schema real
 * entre variantes, ver plan de "Mejora de Productos". `linea` puede faltar (catálogos reales
 * sin segundo nivel de categoría) — se normaliza a "" para no romper el agrupamiento. */
export function toneFamilyKey(product: Product): string {
  return `${product.seccion} ${product.linea ?? ""} ${product.producto}`;
}

/** Para un producto dado, las demás filas que comparten su familia (incluido él mismo),
 * ordenadas por `variante`. Si el array tiene un solo elemento, el producto no tiene tonos. */
export function getToneSiblings(product: Product, allProducts: Product[]): Product[] {
  const key = toneFamilyKey(product);
  return allProducts
    .filter((p) => toneFamilyKey(p) === key)
    .sort((a, b) => a.variante.localeCompare(b.variante));
}
