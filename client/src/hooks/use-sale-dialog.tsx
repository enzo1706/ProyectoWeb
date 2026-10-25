import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { useSaleCart } from "@/hooks/use-sale-cart";
import { useToast } from "@/hooks/use-toast";
import type { Product, Draft } from "@shared/schema";
import type { Client } from "@/components/ClientCard";
import type { SaleDetails } from "@/components/SaleCard";
import type { OrderLine } from "@/components/SaleOrderTable";

interface OpenCreateSaleOptions {
  preselectedClient?: Client | null;
  initialLines?: OrderLine[];
  draftToResume?: Draft | null;
  /**
   * Prompt 13 — antes de compartir una sola instancia del diálogo, solo Ventas.tsx estaba
   * conectada al carrito compartido (use-sale-cart): su botón "Nueva Venta", su auto-apertura
   * al llegar con el carrito armado desde Productos, y "Retomar" un borrador, vaciaban el
   * carrito al cerrar sin editar. Inicio y la ficha de la clienta NUNCA tocaban el carrito.
   * Este flag preserva esa distinción explícitamente en vez de inferirla.
   */
  clearCartOnClose?: boolean;
}

interface SaleDialogContextValue {
  /** El diálogo compartido persiste al cambiar de página (vive en AppShell) — una página que
   * se monta con el carrito armado debe chequear esto antes de abrir, para no pisar una
   * sesión de venta que ya estaba abierta desde otra pantalla. */
  isOpen: boolean;
  openCreateSale: (options?: OpenCreateSaleOptions) => void;
  openEditSale: (sale: SaleDetails) => void;
}

const SaleDialogContext = createContext<SaleDialogContextValue | null>(null);

interface SaleDialogProviderProps {
  children: ReactNode;
  /** false para admin: ni la consulta de productos ni el diálogo tienen sentido ahí — nadie llama a openCreateSale/openEditSale. */
  enabled?: boolean;
}

/** Única instancia compartida de NewSaleDialog, montada una sola vez en AppShell — ver Prompt 13, ajuste 3. */
export function SaleDialogProvider({ children, enabled = true }: SaleDialogProviderProps) {
  const cart = useSaleCart();
  const { toast } = useToast();
  const { data: products = [], isError: isProductsError } = useQuery<Product[]>({ queryKey: ["/api/products"], enabled });

  const [open, setOpen] = useState(false);
  const [existingSale, setExistingSale] = useState<SaleDetails | null>(null);
  const [preselectedClient, setPreselectedClient] = useState<Client | null>(null);
  const [initialLines, setInitialLines] = useState<OrderLine[] | undefined>(undefined);
  const [draftToResume, setDraftToResume] = useState<Draft | null>(null);
  const [clearCartOnClose, setClearCartOnClose] = useState(false);

  // Etapa I-B.8-E (F5): un fallo en "/api/products" antes dejaba el diálogo con el catálogo
  // vacío en silencio. Al compartir una sola instancia entre páginas, ya no hay garantía de
  // que la página actual tenga su propio aviso de error — se bloquea directo acá.
  const guardProductsError = () => {
    if (!isProductsError) return false;
    toast({
      title: "No pudimos cargar el catálogo",
      description: "Probá recargar la página antes de registrar una venta.",
      variant: "destructive",
    });
    return true;
  };

  const openCreateSale = (options: OpenCreateSaleOptions = {}) => {
    if (guardProductsError()) return;
    setExistingSale(null);
    setPreselectedClient(options.preselectedClient ?? null);
    setInitialLines(options.initialLines);
    setDraftToResume(options.draftToResume ?? null);
    setClearCartOnClose(options.clearCartOnClose ?? false);
    setOpen(true);
  };

  const openEditSale = (sale: SaleDetails) => {
    if (guardProductsError()) return;
    setPreselectedClient(null);
    setInitialLines(undefined);
    setDraftToResume(null);
    setClearCartOnClose(false);
    setExistingSale(sale);
    setOpen(true);
  };

  return (
    <SaleDialogContext.Provider value={{ isOpen: open, openCreateSale, openEditSale }}>
      {children}
      <NewSaleDialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setOpen(true);
            return;
          }
          const wasEditing = existingSale !== null;
          setOpen(false);
          setExistingSale(null);
          setPreselectedClient(null);
          setInitialLines(undefined);
          setDraftToResume(null);
          if (!wasEditing && clearCartOnClose) cart.clear();
          setClearCartOnClose(false);
        }}
        products={products}
        existingSale={existingSale}
        preselectedClient={preselectedClient}
        initialLines={initialLines}
        draftToResume={draftToResume}
      />
    </SaleDialogContext.Provider>
  );
}

export function useSaleDialog() {
  const ctx = useContext(SaleDialogContext);
  if (!ctx) {
    throw new Error("useSaleDialog debe usarse dentro de SaleDialogProvider");
  }
  return ctx;
}
