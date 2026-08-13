import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OrderLine } from "@/components/SaleOrderTable";

interface SaleCartContextValue {
  lines: OrderLine[];
  addLine: (line: OrderLine) => void;
  updateLine: (line: OrderLine) => void;
  removeLine: (productId: number) => void;
  clear: () => void;
}

const SaleCartContext = createContext<SaleCartContextValue | null>(null);

/** Carrito compartido entre Productos y Ventas: arrancar la selección desde el catálogo y
 * terminarla en NewSaleDialog sin crear un segundo sistema de ventas. Solo estado de cliente,
 * no persiste a través de un F5 (igual que el resto del estado en memoria de esta app). */
export function SaleCartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<OrderLine[]>([]);

  const addLine = useCallback((line: OrderLine) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === line.productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === line.productId ? { ...line, quantity: existing.quantity + line.quantity } : l,
        );
      }
      return [...prev, line];
    });
  }, []);

  const updateLine = useCallback((line: OrderLine) => {
    setLines((prev) => prev.map((l) => (l.productId === line.productId ? line : l)));
  }, []);

  const removeLine = useCallback((productId: number) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(
    () => ({ lines, addLine, updateLine, removeLine, clear }),
    [lines, addLine, updateLine, removeLine, clear],
  );

  return <SaleCartContext.Provider value={value}>{children}</SaleCartContext.Provider>;
}

export function useSaleCart(): SaleCartContextValue {
  const ctx = useContext(SaleCartContext);
  if (!ctx) throw new Error("useSaleCart debe usarse dentro de SaleCartProvider");
  return ctx;
}
