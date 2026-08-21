import { createContext, useContext, useState, type ReactNode } from "react";
import { formatPrice } from "@/lib/currency";

const STORAGE_KEY = "hideMoney";

interface HideMoneyContextValue {
  hidden: boolean;
  toggle: () => void;
  /** Formatea un monto en centavos — devuelve "••••" en vez del número si el modo "ocultar
   * dinero" está activo. Mismo uso que `formatPrice`, solo que reactivo a la preferencia. */
  format: (cents: number, currency?: string) => string;
}

const HideMoneyContext = createContext<HideMoneyContextValue | null>(null);

function readInitialHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function HideMoneyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readInitialHidden);

  const toggle = () => {
    setHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage puede no estar disponible (modo privado, etc.) — la preferencia
        // simplemente no persiste entre sesiones, no es un error bloqueante.
      }
      return next;
    });
  };

  const format = (cents: number, currency?: string) => (hidden ? "••••" : formatPrice(cents, currency));

  return <HideMoneyContext.Provider value={{ hidden, toggle, format }}>{children}</HideMoneyContext.Provider>;
}

export function useHideMoney(): HideMoneyContextValue {
  const ctx = useContext(HideMoneyContext);
  if (!ctx) throw new Error("useHideMoney debe usarse dentro de HideMoneyProvider");
  return ctx;
}
