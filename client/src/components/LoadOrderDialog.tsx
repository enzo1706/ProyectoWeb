import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { WizardDots } from "./WizardDots";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { cn, onActivationKeyDown } from "@/lib/utils";
import { getProductCategories, toneFamilyKey } from "@/lib/productCategories";
import { computeDiscountedCost } from "@shared/saleCalculations";
import { discountOptions, orderDraftPayloadSchema, type Product, type Draft, type OrderDraftPayload, type OrderDraftDiscountState } from "@shared/schema";
import { ChevronDown, Minus, Package, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { ImportProductsDialog, type ImportedOrderLine } from "./ImportProductsDialog";
import { UnsavedDraftAlert } from "./UnsavedDraftAlert";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";

interface LoadOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Prompt 7 — borrador a retomar (desde "Pedidos sin terminar"). */
  draftToResume?: Draft | null;
}

interface OrderLine {
  productId: number;
  productName: string;
  variante: string;
  category: string;
  precio: number;
  quantity: number;
}

type PedidoStep = "descuento" | "catalogo" | "confirmar";
const STEPS: PedidoStep[] = ["descuento", "catalogo", "confirmar"];
const stepLabels: Record<PedidoStep, string> = {
  descuento: "¿Qué descuento te dieron en este pedido?",
  catalogo: "Elegí los productos del pedido",
  confirmar: "Revisá tu pedido",
};

/** Precio tachado al público + precio con descuento destacado (Prompt 5) — o solo el precio
 * al público si todavía no se eligió el descuento ("Elegir después"). SIEMPRE sobre
 * `product.precio` (el del catálogo): el descuento de la empresa se aplica sobre ese precio,
 * nunca sobre `priceOverride` (el precio propio de la consultora, que es para vender, no para
 * lo que paga ella por el pedido — ver Prompt 4). */
function OrderPrice({ precio, discount, format }: { precio: number; discount: number | null | undefined; format: (n: number) => string }) {
  if (typeof discount === "number") {
    return (
      <span className="flex shrink-0 flex-col items-end leading-tight">
        <span className="text-xs text-muted-foreground line-through">{format(precio)}</span>
        <span className="text-sm font-semibold">{format(computeDiscountedCost(precio, discount))}</span>
      </span>
    );
  }
  return <span className="shrink-0 text-xs text-muted-foreground">{format(precio)}</span>;
}

function QtyStepper({ productId, qty, onAdjust }: { productId: number; qty: number; onAdjust: (productId: number, delta: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={qty <= 0}
        onClick={(e) => {
          e.stopPropagation();
          onAdjust(productId, -1);
        }}
        aria-label="Disminuir cantidad"
        data-testid={`button-order-qty-minus-${productId}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className={cn("w-5 text-center text-sm tabular-nums", qty > 0 && "font-bold text-primary")} data-testid={`text-order-qty-${productId}`}>
        {qty}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={(e) => {
          e.stopPropagation();
          onAdjust(productId, 1);
        }}
        aria-label="Aumentar cantidad"
        data-testid={`button-order-qty-plus-${productId}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** Una fila de un tono puntual (producto sin tonos, o un tono dentro de una familia
 * desplegada) — se destaca con fondo rosado suave y el número en negrita apenas tiene
 * cantidad elegida (Prompt 5, punto 2), para que se note a simple vista qué se eligió. */
function ToneRow({
  product,
  discount,
  qty,
  onAdjust,
  format,
  compact = false,
}: {
  product: Product;
  discount: number | null | undefined;
  qty: number;
  onAdjust: (productId: number, delta: number) => void;
  format: (n: number) => string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-2.5",
        qty > 0 ? "border-primary/30 bg-primary/10" : "bg-muted/40",
        compact && "ml-4",
      )}
      data-testid={`order-catalog-row-${product.id}`}
    >
      {!compact && (
        product.imagen ? (
          <img src={product.imagen} alt={product.producto} className="h-9 w-9 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
        )
      )}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">
        {compact ? product.variante : product.producto}
        {!compact && product.variante !== "Estándar" && <span className="font-normal text-muted-foreground"> {product.variante}</span>}
      </p>
      <OrderPrice precio={product.precio} discount={discount} format={format} />
      <QtyStepper productId={product.id} qty={qty} onAdjust={onAdjust} />
    </div>
  );
}

/** Una familia (sección+línea+nombre) con un solo tono se muestra como una fila común, sin
 * desplegar (Prompt 3/5). Con más de un tono, se agrupa en una fila desplegable que muestra
 * cuántos tonos tiene y, si ya se eligió alguna cantidad, "N unidades elegidas" — destacada
 * aunque esté plegada, para no tener que abrirla para saber que ya hay algo elegido ahí. */
function FamilyRow({
  members,
  discount,
  getQty,
  onAdjust,
  forceExpanded,
  expanded,
  onToggleExpand,
  format,
}: {
  members: Product[];
  discount: number | null | undefined;
  getQty: (productId: number) => number;
  onAdjust: (productId: number, delta: number) => void;
  forceExpanded: boolean;
  expanded: boolean;
  onToggleExpand: (key: string) => void;
  format: (n: number) => string;
}) {
  if (members.length === 1) {
    const product = members[0];
    return <ToneRow product={product} discount={discount} qty={getQty(product.id)} onAdjust={onAdjust} format={format} />;
  }

  const primary = members[0];
  const key = toneFamilyKey(primary);
  const totalQty = members.reduce((sum, m) => sum + getQty(m.id), 0);
  const isExpanded = forceExpanded || expanded;

  return (
    <div data-testid={`order-family-${primary.id}`}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border p-2.5 hover-elevate cursor-pointer",
          totalQty > 0 ? "border-primary/30 bg-primary/10" : "bg-muted/40",
        )}
        onClick={() => onToggleExpand(key)}
        role="button"
        tabIndex={0}
        onKeyDown={onActivationKeyDown(() => onToggleExpand(key))}
        data-testid={`button-order-toggle-family-${primary.id}`}
      >
        {primary.imagen ? (
          <img src={primary.imagen} alt={primary.producto} className="h-9 w-9 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{primary.producto}</p>
          <p className={cn("text-xs", totalQty > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>
            {members.length} tonos
            {totalQty > 0 && ` · ${totalQty} unidad${totalQty !== 1 ? "es" : ""} elegida${totalQty !== 1 ? "s" : ""}`}
          </p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isExpanded && "rotate-180")} />
      </div>
      {isExpanded && (
        <div className="mt-1.5 space-y-1.5" data-testid={`order-family-tones-${primary.id}`}>
          {members.map((m) => (
            <ToneRow key={m.id} product={m} discount={discount} qty={getQty(m.id)} onAdjust={onAdjust} format={format} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function discountToDraftState(discount: number | null | undefined): OrderDraftDiscountState {
  if (discount === undefined) return { kind: "unset" };
  if (discount === null) return { kind: "later" };
  return { kind: "chosen", value: discount };
}

function draftStateToDiscount(state: OrderDraftDiscountState): number | null | undefined {
  if (state.kind === "unset") return undefined;
  if (state.kind === "later") return null;
  return state.value;
}

export function LoadOrderDialog({ open, onOpenChange, products, draftToResume }: LoadOrderDialogProps) {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = STEPS[stepIndex];

  // undefined = todavía sin elegir (bloquea avanzar del paso 1); null = "elegir después"
  // (bloquea confirmar hasta resolverse); número = descuento ya elegido.
  const [discount, setDiscount] = useState<number | null | undefined>(undefined);
  // Prompt 5: una sola fuente de verdad para las cantidades — arranca en 0 en todos los
  // productos. Las líneas del pedido (para el contador, el resumen y "Revisá tu pedido") se
  // derivan de este mapa filtrando qty > 0, en vez de mantener una lista aparte que había que
  // confirmar producto por producto con un botón "Agregar" (eliminado en esta tarea).
  const [qtyByProduct, setQtyByProduct] = useState<Record<number, number>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [editingQtyProductId, setEditingQtyProductId] = useState<number | null>(null);
  const [editQtyDraft, setEditQtyDraft] = useState(1);
  const [removingProductId, setRemovingProductId] = useState<number | null>(null);

  // Prompt 7 — borradores: aviso de 3 botones al cerrar con algo cargado, y "este borrador no
  // se pudo retomar" (formato viejo/incompatible).
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [resumeFormatError, setResumeFormatError] = useState(false);

  const categories = useMemo(() => getProductCategories(products), [products]);

  useEffect(() => {
    if (open && !draftToResume) {
      setStepIndex(0);
      setDiscount(undefined);
      setQtyByProduct({});
      setSearch("");
      setCategoryFilter("Todas");
      setExpandedFamilies(new Set());
      setImportDialogOpen(false);
      setSummaryOpen(false);
      setEditingQtyProductId(null);
      setRemovingProductId(null);
    }
  }, [open, draftToResume]);

  const getQty = (productId: number) => qtyByProduct[productId] ?? 0;

  const setQty = (productId: number, qty: number) => {
    setQtyByProduct((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const adjustQty = (productId: number, delta: number) => setQty(productId, Math.max(0, getQty(productId) + delta));

  const toggleExpand = (key: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Prompt 3/5 — familias de tono (misma heurística que Stock, toneFamilyKey/getToneSiblings)
  // armadas sobre TODO el catálogo, para que un tono expandido no cambie de familia al tipear
  // en el buscador. El filtro de categoría y de búsqueda se aplican después, a nivel familia.
  const families = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const key = toneFamilyKey(p);
      const existing = map.get(key);
      if (existing) existing.push(p);
      else map.set(key, [p]);
    }
    Array.from(map.values()).forEach((members) => {
      members.sort((a, b) => a.variante.localeCompare(b.variante));
    });
    return map;
  }, [products]);

  const term = search.trim().toLowerCase();

  const filteredFamilies = useMemo(() => {
    const result: { key: string; members: Product[] }[] = [];
    for (const [key, members] of Array.from(families.entries())) {
      const primary = members[0];
      if (categoryFilter !== "Todas" && primary.seccion !== categoryFilter) continue;
      // Prompt 5, punto 2: el buscador matchea por nombre del producto O por nombre de
      // cualquier tono de la familia — si matchea, la familia entera se muestra ya desplegada
      // (ver `forceExpanded` en FamilyRow), no solo el tono que matcheó.
      const matchesSearch =
        !term ||
        members.some(
          (m) =>
            m.producto.toLowerCase().includes(term) ||
            m.variante.toLowerCase().includes(term) ||
            m.codigo.toLowerCase().includes(term) ||
            m.seccion.toLowerCase().includes(term),
        );
      if (!matchesSearch) continue;
      result.push({ key, members });
    }
    return result;
  }, [families, categoryFilter, term]);

  // Líneas derivadas del mapa de cantidades — nunca al revés. `variante` viaja en la línea
  // para poder mostrar "nombre (con tono)" en el resumen y en "Revisá tu pedido" sin tener que
  // volver a buscar el producto por id ahí.
  const lines: OrderLine[] = useMemo(() => {
    return products
      .filter((p) => getQty(p.id) > 0)
      .map((p) => ({
        productId: p.id,
        productName: p.producto,
        variante: p.variante,
        category: p.seccion,
        precio: p.precio,
        quantity: getQty(p.id),
      }));
  }, [products, qtyByProduct]);

  // Prompt 7 — borradores: "algo cargado" para un pedido es al menos un producto/cantidad
  // elegido (el descuento solo no alcanza — no es "un producto ni una cantidad").
  const hasDraftContent = lines.length > 0;
  const orderDraftPayload: OrderDraftPayload = useMemo(
    () => ({
      formatVersion: 1,
      step: currentStep,
      discountState: discountToDraftState(discount),
      lines: lines.map((l) => ({ productId: l.productId, productName: l.productName, quantity: l.quantity })),
    }),
    [currentStep, discount, lines],
  );
  const draftAutosave = useDraftAutosave({ type: "order", enabled: open && hasDraftContent, payload: orderDraftPayload, step: currentStep });

  // Prompt 7, punto 4 — "Retomar" un pedido: abre en el paso donde quedó; un producto que ya
  // no existe se saca con un aviso. A diferencia de una venta, el pedido SIEMPRE usa el precio
  // actual del catálogo (por eso ni se guarda precio en el borrador) — no hay nada que
  // "preservar" más allá de qué productos y cuántas unidades.
  useEffect(() => {
    if (!open || !draftToResume) return;

    const parsed = orderDraftPayloadSchema.safeParse(draftToResume.payload);
    if (!parsed.success) {
      setResumeFormatError(true);
      return;
    }
    setResumeFormatError(false);
    const payload = parsed.data;

    const nextQtyByProduct: Record<number, number> = {};
    for (const line of payload.lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) {
        toast({ title: `Quitamos ${line.productName} porque ya no está disponible.` });
        continue;
      }
      nextQtyByProduct[line.productId] = line.quantity;
    }

    const stepIndexInSteps = STEPS.indexOf(payload.step);
    setStepIndex(stepIndexInSteps >= 0 ? stepIndexInSteps : 0);
    setDiscount(draftStateToDiscount(payload.discountState));
    setQtyByProduct(nextQtyByProduct);
    draftAutosave.resumeFrom({ id: draftToResume.id, clientDraftId: draftToResume.clientDraftId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftToResume]);

  const totalUnidades = lines.reduce((sum, l) => sum + l.quantity, 0);
  const unitPriceOf = (precio: number) => (typeof discount === "number" ? computeDiscountedCost(precio, discount) : precio);
  const subtotal = lines.reduce((sum, l) => sum + l.precio * l.quantity, 0);
  const discountAmount = typeof discount === "number" ? Math.round(subtotal * (discount / 100)) : 0;
  const total = subtotal - discountAmount;

  const lineLabel = (l: { productName: string; variante: string }) => (l.variante !== "Estándar" ? `${l.productName} ${l.variante}` : l.productName);

  /** Etapa 5 — mismo criterio de merge que antes: una importación suma cantidad a lo que ya
   * había (a mano o de una importación previa), nunca lo reemplaza. Ahora el destino es el
   * mapa de cantidades, no una lista de líneas aparte. Etapa 7.2: una línea con cantidad 0
   * (posible si la consultora tildó a mano una fila "sin stock en el archivo" en
   * ImportProductsDialog) nunca se agrega. */
  const handleImport = (imported: ImportedOrderLine[]) => {
    setQtyByProduct((prev) => {
      const next = { ...prev };
      for (const line of imported) {
        if (line.quantity <= 0) continue;
        next[line.productId] = (next[line.productId] ?? 0) + line.quantity;
      }
      return next;
    });
  };

  const resetAndClose = () => {
    setStepIndex(0);
    setDiscount(undefined);
    setQtyByProduct({});
    setImportDialogOpen(false);
    setResumeFormatError(false);
    setCloseConfirmOpen(false);
    draftAutosave.reset();
    onOpenChange(false);
  };

  const confirmMutation = useGuardedMutation({
    mutationFn: async () => {
      if (discount === null || discount === undefined) {
        throw new Error("Falta elegir el descuento del pedido");
      }
      const chosenDiscount = discount;

      // Etapa 7.2, extendido en el Prompt 2 — UNA sola llamada atómica para stock Y costo: todo
      // o nada. `discountPercent` hace que el backend calcule el costo promedio ponderado por
      // unidades de cada línea en la MISMA sentencia que suma el stock (nunca una llamada
      // separada por producto, que ya no sabría cuántas unidades había ANTES de este pedido).
      // Prompt 7, punto 2: si viene de un borrador retomado, draftId lo borra en la misma
      // transacción que aplica el stock.
      await apiRequest("PATCH", "/api/products/stock/increment-batch", {
        lines: lines.map((l) => ({ productId: l.productId, delta: l.quantity })),
        discountPercent: chosenDiscount,
        draftId: draftAutosave.draftId ?? undefined,
      });

      // Prompt 1/2 — registro del pedido para el "descuento de compra habitual" (Configuración).
      // `subtotal` ya es el valor al público ANTES del descuento, justo lo que pide el log. Best
      // effort: el pedido ya quedó cargado (stock y costo actualizados), que esto falle nunca
      // debe mostrarse como un error del pedido en sí.
      try {
        await apiRequest("POST", "/api/products/order-discount-log", { discountPercent: chosenDiscount, publicValueArs: subtotal });
      } catch {
        // silencioso a propósito — ver comentario de arriba.
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      // Prompt 7, punto 2: el servidor ya borró el borrador (si había uno) en la misma
      // transacción — esto solo refresca "Pedidos sin terminar".
      queryClient.invalidateQueries({ queryKey: ["/api/drafts", "order"] });
      toast({ title: "Pedido cargado", description: "El stock se actualizó correctamente." });
      resetAndClose();
    },
    onError: (err: Error) => {
      // Acá SOLO se llega si la operación de stock (atómica) falló entera — el backend no
      // aplicó ninguna línea, así que no hace falta "reflejar un estado parcial": no lo hay.
      // El diálogo queda abierto a propósito para poder reintentar.
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Hubo un problema al cargar el pedido", description: err.message, variant: "destructive" });
    },
  });

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = () => {
    if (currentStep === "descuento" && discount === undefined) return;
    if (currentStep === "catalogo" && lines.length === 0) return;
    if (currentStep === "confirmar") {
      confirmMutation.mutate();
      return;
    }
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  };

  const nextDisabled =
    (currentStep === "descuento" && discount === undefined) ||
    (currentStep === "catalogo" && lines.length === 0) ||
    confirmMutation.isPending;
  const nextLabel =
    currentStep === "descuento" ? "Siguiente" : currentStep === "catalogo" ? "Continuar" : confirmMutation.isPending ? "Confirmando..." : "Confirmar pedido";
  const showNextButton = currentStep !== "confirmar" || discount !== null;

  const editingLine = lines.find((l) => l.productId === editingQtyProductId) ?? null;
  const removingLine = lines.find((l) => l.productId === removingProductId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(next);
          return;
        }
        if (hasDraftContent) {
          setCloseConfirmOpen(true);
          return;
        }
        resetAndClose();
      }}
    >
      <DialogContent
        className="top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-3 rounded-none border-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-none"
        data-testid="dialog-load-order"
      >
        <DialogHeader>
          <DialogTitle>Cargar pedido</DialogTitle>
        </DialogHeader>

        {resumeFormatError ? (
          <div className="space-y-4 py-6 text-center" data-testid="text-resume-format-error">
            <p className="text-sm text-muted-foreground">No pudimos retomar este pedido sin terminar.</p>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (draftToResume) {
                  await apiRequest("DELETE", `/api/drafts/${draftToResume.id}`);
                  queryClient.invalidateQueries({ queryKey: ["/api/drafts", "order"] });
                }
                resetAndClose();
              }}
              data-testid="button-discard-broken-draft"
            >
              Descartar
            </Button>
          </div>
        ) : (
        <>
        <WizardDots total={STEPS.length} current={stepIndex} />

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-1 -mx-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Paso {stepIndex + 1} de {STEPS.length}
          </p>
          <h3 className="mb-1 text-lg font-bold text-foreground">{stepLabels[currentStep]}</h3>

          {currentStep === "descuento" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Elegilo ahora, o marcá "Elegir después" y lo definís antes de confirmar el pedido.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {discountOptions.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setDiscount(pct)}
                    className={cn(
                      "rounded-2xl border-2 py-6 text-center text-2xl font-bold hover-elevate active-elevate-2",
                      discount === pct ? "border-primary bg-primary/10 text-primary" : "border-transparent bg-muted/50",
                    )}
                    data-testid={`button-order-discount-${pct}`}
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDiscount(null)}
                  className={cn(
                    "col-span-2 rounded-2xl border-2 border-dashed py-3.5 text-center text-sm font-semibold hover-elevate active-elevate-2",
                    discount === null ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background",
                  )}
                  data-testid="button-order-discount-later"
                >
                  Elegir después
                </button>
              </div>
            </div>
          )}

          {currentStep === "catalogo" && (
            <div className="space-y-3">
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
                  typeof discount === "number" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
                data-testid="text-order-discount-badge"
              >
                <span>
                  {typeof discount === "number" ? `Descuento aplicado: ${discount}%` : "Elegí el descuento para ver cuánto te cuesta cada producto"}
                </span>
                <button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => setStepIndex(0)}>
                  {typeof discount === "number" ? "Cambiar" : "Elegir ahora"}
                </button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nombre, código o categoría..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-order-search"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => setImportDialogOpen(true)}
                data-testid="button-open-import-products"
              >
                <Upload className="mr-2 h-4 w-4" />
                Importar desde Excel, CSV o PDF
              </Button>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {["Todas", ...categories].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium",
                      categoryFilter === cat ? "border-primary bg-primary text-primary-foreground" : "bg-muted/50",
                    )}
                    data-testid={`chip-order-category-${cat}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {filteredFamilies.map(({ key, members }) => (
                  <FamilyRow
                    key={key}
                    members={members}
                    discount={discount}
                    getQty={getQty}
                    onAdjust={adjustQty}
                    forceExpanded={term !== ""}
                    expanded={expandedFamilies.has(key)}
                    onToggleExpand={toggleExpand}
                    format={format}
                  />
                ))}
                {filteredFamilies.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No hay productos con esos criterios</p>
                )}
              </div>
            </div>
          )}

          {currentStep === "confirmar" && discount === null && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Marcaste "Elegir después" — hace falta este dato para cerrar el pedido.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {discountOptions.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setDiscount(pct)}
                    className="rounded-2xl border-2 border-transparent bg-muted/50 py-6 text-center text-2xl font-bold hover-elevate active-elevate-2"
                    data-testid={`button-order-discount-forced-${pct}`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentStep === "confirmar" && discount !== null && lines.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center" data-testid="text-order-empty">
              <p className="text-sm text-muted-foreground">Tu pedido está vacío</p>
              <Button type="button" variant="outline" onClick={() => setStepIndex(1)} data-testid="button-order-go-pick-products">
                Elegir productos
              </Button>
            </div>
          )}

          {currentStep === "confirmar" && discount !== null && lines.length > 0 && (
            <div className="space-y-1.5 rounded-xl bg-muted/60 p-4" data-testid="order-summary">
              {lines.map((line) => (
                <div key={line.productId} className="flex items-center justify-between gap-2 text-sm" data-testid={`order-line-${line.productId}`}>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {lineLabel(line)} x{line.quantity}
                  </span>
                  <span className="shrink-0 font-medium">{format(unitPriceOf(line.precio) * line.quantity)}</span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingQtyProductId(line.productId);
                        setEditQtyDraft(line.quantity);
                      }}
                      aria-label={`Cambiar cantidad de ${lineLabel(line)}`}
                      data-testid={`button-order-edit-qty-${line.productId}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setRemovingProductId(line.productId)}
                      aria-label={`Quitar ${lineLabel(line)} del pedido`}
                      data-testid={`button-order-remove-${line.productId}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{format(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Descuento ({discount}%)</span>
                <span className="font-medium">− {format(discountAmount)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <span>Total a pagar</span>
                <span data-testid="text-order-total">{format(total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {currentStep === "catalogo" && (
            <Button
              type="button"
              variant={lines.length > 0 ? "default" : "outline"}
              className="h-12 w-full justify-between"
              disabled={lines.length === 0}
              onClick={() => setSummaryOpen(true)}
              data-testid="button-order-counter"
            >
              {lines.length === 0 ? (
                <span className="w-full text-center text-sm text-muted-foreground">Todavía no elegiste productos</span>
              ) : (
                <>
                  <span>
                    {lines.length} producto{lines.length !== 1 ? "s" : ""} · {totalUnidades} unidad{totalUnidades !== 1 ? "es" : ""}
                  </span>
                  <span className="font-bold">{format(total)}</span>
                </>
              )}
            </Button>
          )}
          <div className="flex gap-2 border-t pt-3">
            {stepIndex > 0 && (
              <Button type="button" variant="outline" className="h-12 shrink-0 px-4" onClick={goBack} data-testid="button-order-back">
                Atrás
              </Button>
            )}
            {showNextButton && (
              <Button type="button" className="h-12 flex-1" onClick={goNext} disabled={nextDisabled} data-testid="button-order-next">
                {nextLabel}
              </Button>
            )}
          </div>
        </div>
        </>
        )}
      </DialogContent>

      <ImportProductsDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} products={products} onImport={handleImport} />

      <UnsavedDraftAlert
        open={closeConfirmOpen}
        onKeepEditing={() => setCloseConfirmOpen(false)}
        onSaveDraft={async () => {
          setCloseConfirmOpen(false);
          await draftAutosave.saveNow();
          resetAndClose();
        }}
        onDiscard={async () => {
          setCloseConfirmOpen(false);
          await draftAutosave.discardDraft();
          resetAndClose();
        }}
      />

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-order-summary">
          <DialogHeader>
            <DialogTitle>Tu pedido hasta ahora</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {lines.map((l) => (
              <div key={l.productId} className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm" data-testid={`order-summary-row-${l.productId}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{lineLabel(l)}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.quantity} x {format(unitPriceOf(l.precio))}
                  </p>
                </div>
                <span className="shrink-0 font-semibold">{format(unitPriceOf(l.precio) * l.quantity)}</span>
              </div>
            ))}
            {lines.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Todavía no elegiste productos</p>}
          </div>
          <DialogFooter>
            <Button type="button" className="w-full" onClick={() => setSummaryOpen(false)} data-testid="button-order-summary-close">
              Seguir eligiendo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingQtyProductId !== null} onOpenChange={(v) => !v && setEditingQtyProductId(null)}>
        <DialogContent className="max-w-sm" data-testid="dialog-order-edit-qty">
          <DialogHeader>
            <DialogTitle>Cambiar cantidad</DialogTitle>
          </DialogHeader>
          {editingLine && (
            <div className="space-y-4">
              <p className="text-center text-sm font-medium">{lineLabel(editingLine)}</p>
              <div className="flex items-center justify-center gap-4">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={editQtyDraft <= 1}
                  onClick={() => setEditQtyDraft((q) => Math.max(1, q - 1))}
                  aria-label="Disminuir cantidad"
                  data-testid="button-edit-qty-minus"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-10 text-center text-lg font-semibold tabular-nums" data-testid="text-edit-qty-value">
                  {editQtyDraft}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setEditQtyDraft((q) => q + 1)}
                  aria-label="Aumentar cantidad"
                  data-testid="button-edit-qty-plus"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingQtyProductId(null)} data-testid="button-edit-qty-cancel">
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (editingQtyProductId !== null) setQty(editingQtyProductId, editQtyDraft);
                setEditingQtyProductId(null);
              }}
              data-testid="button-edit-qty-save"
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removingProductId !== null} onOpenChange={(v) => !v && setRemovingProductId(null)}>
        <AlertDialogContent data-testid="dialog-order-confirm-remove">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Querés quitar {removingLine ? lineLabel(removingLine) : "este producto"} de tu pedido?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-order-remove-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removingProductId !== null) setQty(removingProductId, 0);
                setRemovingProductId(null);
              }}
              data-testid="button-order-remove-confirm"
            >
              Sí, quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
