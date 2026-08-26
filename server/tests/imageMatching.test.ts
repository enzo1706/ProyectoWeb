import { describe, it, expect } from "vitest";
import {
  findProductImageMatches,
  type ProductForImageMatching,
  type StorageImageFile,
} from "@shared/imageMatching";

/**
 * findProductImageMatches es una función pura (sin DB, sin Storage real) — estos tests no
 * necesitan Postgres ni Supabase, solo verifican el algoritmo de matching en sí.
 */

function product(id: number, producto: string, opts: { variante?: string; imagen?: string | null } = {}): ProductForImageMatching {
  return { id, producto, variante: opts.variante ?? "Estándar", imagen: opts.imagen ?? null };
}

function file(name: string): StorageImageFile {
  return {
    path: `products/${name}`,
    name,
    url: `https://proyecto.supabase.co/storage/v1/object/public/product-images/products/${name}`,
  };
}

describe("findProductImageMatches", () => {
  it("1. coincidencia exacta -> segura, confianza exacta, 100%", () => {
    const result = findProductImageMatches(
      [product(1, "Labial Ultimate Matte")],
      [file("Labial Ultimate Matte.jpg")],
    );
    expect(result).toHaveLength(1);
    expect(result[0].bucket).toBe("segura");
    expect(result[0].candidates[0].confidence).toBe("exacta");
    expect(result[0].candidates[0].score).toBe(100);
  });

  it("2. coincidencia ignorando mayúsculas -> segura, confianza alta", () => {
    const result = findProductImageMatches(
      [product(1, "Labial Ultimate")],
      [file("LABIAL ULTIMATE.jpg")],
    );
    expect(result[0].bucket).toBe("segura");
    expect(result[0].candidates[0].confidence).toBe("alta");
  });

  it("3. coincidencia ignorando acentos -> segura", () => {
    const result = findProductImageMatches(
      [product(1, "Loción Facial Restauradora")],
      [file("Locion Facial Restauradora.jpg")],
    );
    expect(result[0].bucket).toBe("segura");
    expect(result[0].candidates[0].confidence).toBe("alta");
  });

  it("4. coincidencia con guiones (y guiones bajos) -> segura", () => {
    const result = findProductImageMatches(
      [product(1, "Crema Hidratante TimeWise")],
      [file("crema-hidratante-timewise.png"), ],
    );
    expect(result[0].bucket).toBe("segura");

    const result2 = findProductImageMatches(
      [product(2, "Crema Hidratante TimeWise")],
      [file("CREMA_HIDRATANTE_TIMEWISE.png")],
    );
    expect(result2[0].bucket).toBe("segura");
  });

  it("5. coincidencia con extensión diferente no afecta el resultado", () => {
    const jpg = findProductImageMatches([product(1, "Base CC")], [file("Base CC.jpg")]);
    const webp = findProductImageMatches([product(2, "Base CC")], [file("Base CC.webp")]);
    expect(jpg[0].candidates[0].score).toBe(webp[0].candidates[0].score);
    expect(jpg[0].bucket).toBe("segura");
    expect(webp[0].bucket).toBe("segura");
  });

  it("6. coincidencia parcial (Belara) -> revisar, nunca segura", () => {
    const result = findProductImageMatches(
      [product(1, "Perfume Belara")],
      [file("Belara.jpg")],
    );
    expect(result[0].bucket).toBe("revisar");
    expect(result[0].candidates[0].confidence).toBe("media");
    expect(result[0].reason).toBe("confianza_media");
  });

  it("6b. coincidencia dudosa (Base Cream vs Base CC Cream) nunca se asigna sola", () => {
    const result = findProductImageMatches(
      [product(1, "Base CC Cream")],
      [file("Base Cream.jpg")],
    );
    expect(result[0].bucket).not.toBe("segura");
  });

  it("7. dos imágenes candidatas para el mismo producto -> revisar (ambigua), nunca elige sola", () => {
    const result = findProductImageMatches(
      [product(1, "Perfume X")],
      [file("Perfume X.jpg"), file("Perfume X.png")],
    );
    expect(result[0].bucket).toBe("revisar");
    expect(result[0].reason).toBe("varias_candidatas");
    expect(result[0].candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("8. producto sin ninguna coincidencia -> sin_coincidencia", () => {
    const result = findProductImageMatches(
      [product(1, "Zzz Producto Único Que No Matchea Con Nada")],
      [file("Otra Cosa Totalmente Distinta.jpg")],
    );
    expect(result[0].bucket).toBe("sin_coincidencia");
    expect(result[0].candidates).toHaveLength(0);
  });

  it("9. producto que ya tiene imagen queda afuera del análisis", () => {
    const result = findProductImageMatches(
      [
        product(1, "Labial Ya Cargado", { imagen: "https://x.supabase.co/.../ya-cargado.jpg" }),
        product(2, "Labial Sin Cargar"),
      ],
      [file("Labial Sin Cargar.jpg")],
    );
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe(2);
  });

  it("10. una imagen que le sirve a dos productos distintos -> ambos a revisar, ninguno se asigna solo", () => {
    // Mismo `producto` en dos filas (dos tonos), sin sufijo de variante en el archivo: el
    // archivo coincide igual de bien con las dos -> conflicto, no se puede elegir sola.
    const result = findProductImageMatches(
      [
        product(1, "Base de Maquillaje TimeWise 3D", { variante: "Luminosa (N/S)" }),
        product(2, "Base de Maquillaje TimeWise 3D", { variante: "Mate (C/G)" }),
      ],
      [file("Base de Maquillaje TimeWise 3D.jpg")],
    );
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.bucket).toBe("revisar");
      expect(r.reason).toBe("archivo_en_disputa");
    }
  });
});
