import { describe, it, expect } from "vitest";
import { matchImportedProducts, type ImportCatalogProduct } from "../../shared/importMatching";

/** Matching puro (sin DB) — ver server/tests/importParsers.test.ts para el parser del PDF real. */

function product(
  id: number,
  producto: string,
  opts: { variante?: string; precio?: number; puntos?: number } = {},
): ImportCatalogProduct {
  return {
    id,
    producto,
    variante: opts.variante ?? "Estándar",
    seccion: "Test",
    precio: opts.precio ?? 1000,
    puntos: opts.puntos ?? 5,
    imagen: null,
  };
}

describe("matchImportedProducts", () => {
  it("17. match exacto -> matched, precio/puntos vienen del catálogo (nunca del archivo)", () => {
    const catalog = [product(1, "Base de Maquillaje At Play", { precio: 27000, puntos: 12 })];
    const result = matchImportedProducts([{ sourceName: "Base de Maquillaje At Play", quantity: 3 }], catalog);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("matched");
    expect(result[0].product?.id).toBe(1);
    expect(result[0].product?.precio).toBe(27000); // del catálogo
    expect(result[0].product?.puntos).toBe(12); // del catálogo
    expect(result[0].quantity).toBe(3); // del archivo
  });

  it("18. match normalizado (mayúsculas/acentos/espacios distintos) -> matched igual", () => {
    const catalog = [product(1, "Loción Facial Restauradora")];
    const result = matchImportedProducts([{ sourceName: "LOCION   FACIAL RESTAURADORA", quantity: 1 }], catalog);
    expect(result[0].status).toBe("matched");
    expect(result[0].product?.id).toBe(1);
  });

  it("producto+variante combinados con espacio (formato real del PDF: 'Base ... 3D Luminosa (N/S)') matchea contra producto separado de variante en la DB", () => {
    const catalog = [
      product(1, "Base de Maquillaje TimeWise 3D", { variante: "Luminosa (N/S)" }),
      product(2, "Base de Maquillaje TimeWise 3D", { variante: "Mate (C/G)" }),
    ];
    const result = matchImportedProducts(
      [
        { sourceName: "Base de Maquillaje TimeWise 3D Luminosa (N/S)", quantity: 2 },
        { sourceName: "Base de Maquillaje TimeWise 3D Mate (C/G)", quantity: 1 },
      ],
      catalog,
    );
    expect(result[0].status).toBe("matched");
    expect(result[0].product?.id).toBe(1);
    expect(result[1].status).toBe("matched");
    expect(result[1].product?.id).toBe(2);
  });

  it("15/29. producto no encontrado -> not_found, sin inventar ningún candidato", () => {
    const catalog = [product(1, "Base de Maquillaje At Play")];
    const result = matchImportedProducts([{ sourceName: "Producto que no existe en catálogo", quantity: 5 }], catalog);
    expect(result[0].status).toBe("not_found");
    expect(result[0].product).toBeNull();
    expect(result[0].candidates).toEqual([]);
  });

  it("16/28. producto ambiguo (2+ candidatos con el mismo nombre normalizado) -> ambiguous, nunca se elige solo", () => {
    // Caso deliberado: dos productos DISTINTOS que, tal como vienen escritos en el archivo,
    // colapsan al mismo texto (ej. el archivo no trae el diferenciador que sí tiene la DB).
    const catalog = [
      product(1, "Perfume Belara", { variante: "Estándar" }),
      product(2, "Perfume Belara", { variante: "Estándar" }), // duplicado real de catálogo (caso límite)
    ];
    const result = matchImportedProducts([{ sourceName: "Perfume Belara", quantity: 1 }], catalog);
    expect(result[0].status).toBe("ambiguous");
    expect(result[0].product).toBeNull();
    expect(result[0].candidates).toHaveLength(2);
  });

  it("30. falso positivo evitado: coincidencia parcial NO matchea (a diferencia del matching de imágenes, acá es solo exacto)", () => {
    const catalog = [product(1, "Base de Maquillaje TimeWise 3D", { variante: "Luminosa (N/S)" })];
    const result = matchImportedProducts([{ sourceName: "Base de Maquillaje TimeWise 3D", quantity: 1 }], catalog);
    // El archivo solo trae el nombre base, sin la variante -> no matchea exacto (hay info
    // real que falta para saber CUÁL variante es) -> not_found, nunca un match a ciegas.
    expect(result[0].status).toBe("not_found");
  });

  it("11/12/13/14. '(N/S)' vs '(N-S)' vs '(N/G)' nunca colapsan entre sí (preserva '/', mismo criterio de la Etapa 2)", () => {
    const catalog = [
      product(1, "Crema Facial", { variante: "Hidratante (N/S)" }),
      product(2, "Crema Facial", { variante: "Hidratante (N-S)" }),
      product(3, "Crema Facial", { variante: "Hidratante (N/G)" }),
    ];
    const result = matchImportedProducts(
      [
        { sourceName: "Crema Facial Hidratante (N/S)", quantity: 1 },
        { sourceName: "Crema Facial Hidratante (N-S)", quantity: 1 },
        { sourceName: "Crema Facial Hidratante (N/G)", quantity: 1 },
      ],
      catalog,
    );
    expect(result[0].product?.id).toBe(1);
    expect(result[1].product?.id).toBe(2);
    expect(result[2].product?.id).toBe(3);
  });

  it("21/22. el precio y los puntos del archivo NUNCA se usan — ImportedProductRow ni siquiera tiene esos campos", () => {
    const catalog = [product(1, "Producto X", { precio: 999999, puntos: 999 })];
    const result = matchImportedProducts([{ sourceName: "Producto X", quantity: 1 }], catalog);
    // El único precio/puntos posible es el del catálogo — no hay forma de que el "archivo"
    // los sobrescriba porque el tipo de entrada (ImportedProductRow) no los transporta.
    expect(result[0].product?.precio).toBe(999999);
    expect(result[0].product?.puntos).toBe(999);
  });

  it("fila con cantidad 0 se matchea igual (el filtro de cantidad>0 es una decisión posterior, no de matching)", () => {
    const catalog = [product(1, "Producto X")];
    const result = matchImportedProducts([{ sourceName: "Producto X", quantity: 0 }], catalog);
    expect(result[0].status).toBe("matched");
    expect(result[0].quantity).toBe(0);
  });
});
