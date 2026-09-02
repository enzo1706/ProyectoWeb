import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WizardDots } from "./WizardDots";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { cn } from "@/lib/utils";
import { getProductCategories } from "@/lib/productCategories";
import { discountOptions, type Product } from "@shared/schema";
import { Minus, Package, Plus, Search, X } from "lucide-react";

interface LoadOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

interface OrderLine {
  productId: number;
  productName: string;
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

export function LoadOrderDialog({ open, onOpenChange, products }: LoadOrderDialogProps) {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = STEPS[stepIndex];

  // undefined = todavía sin elegir (bloquea avanzar del paso 1); null = "elegir después"
  // (bloquea confirmar hasta resolverse); número = descuento ya elegido.
  const [discount, setDiscount] = useState<number | null | undefined>(undefined);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [qtyByProduct, setQtyByProduct] = useState<Record<number, number>>({});

  const categories = useMemo(() => getProductCategories(products), [products]);

  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setDiscount(undefined);
      setLines([]);
      setSearch("");
      setCategoryFilter("Todas");
      setQtyByProduct({});
    }
  }, [open]);

  const filteredCatalog = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !term || p.producto.toLowerCase().includes(term) || p.codigo.toLowerCase().includes(term) || p.seccion.toLowerCase().includes(term);
      const matchesCategory = categoryFilter === "Todas" || p.seccion === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  const subtotal = lines.reduce((sum, l) => sum + l.precio * l.quantity, 0);
  const discountAmount = typeof discount === "number" ? Math.round(subtotal * (discount / 100)) : 0;
  const total = subtotal - discountAmount;

  const addLine = (product: Product) => {
    const qty = qtyByProduct[product.id] ?? 1;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + qty } : l));
      }
      return [...prev, { productId: product.id, productName: product.producto, category: product.seccion, precio: product.precio, quantity: qty }];
    });
    setQtyByProduct((prev) => ({ ...prev, [product.id]: 1 }));
  };

  const removeLine = (productId: number) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  };

  const resetAndClose = () => {
    setStepIndex(0);
    setDiscount(undefined);
    setLines([]);
    onOpenChange(false);
  };

  const confirmMutation = useGuardedMutation({
    mutationFn: async () => {
      if (discount === null || discount === undefined) {
        throw new Error("Falta elegir el descuento del pedido");
      }
      const chosenDiscount = discount;
      // Traemos el catálogo más fresco posible justo antes de aplicar los cambios — la app no
      // tiene un endpoint atómico de "sumar stock", así que minimizamos la ventana de carrera
      // usando el dato más reciente disponible en vez del que se cacheó al abrir el diálogo.
      const freshProducts = await queryClient.fetchQuery<Product[]>({ queryKey: ["/api/products"] });
      const freshById = new Map(freshProducts.map((p) => [p.id, p]));
      const failed: string[] = [];

      for (const line of lines) {
        const currentUnidades = freshById.get(line.productId)?.unidades ?? 0;
        try {
          await apiRequest("PATCH", `/api/products/${line.productId}/stock`, { unidades: currentUnidades + line.quantity });
          await apiRequest("PATCH", `/api/products/${line.productId}/discount`, { discountPercent: chosenDiscount });
        } catch {
          failed.push(line.productName);
        }
      }
      if (failed.length > 0) {
        throw new Error(`No se pudo actualizar: ${failed.join(", ")}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      toast({ title: "Pedido cargado", description: "El stock se actualizó correctamente." });
      resetAndClose();
    },
    onError: (err: Error) => {
      // Puede haber quedado una actualización parcial aplicada — reflejamos el estado real.
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

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : resetAndClose())}>
      <DialogContent className="flex max-w-lg flex-col gap-3" data-testid="dialog-load-order">
        <DialogHeader>
          <DialogTitle>Cargar pedido</DialogTitle>
        </DialogHeader>

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
                  "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium",
                  typeof discount === "number" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
                data-testid="text-order-discount-badge"
              >
                <span>{typeof discount === "number" ? `Descuento aplicado: ${discount}%` : "⚠ Descuento: pendiente de elegir"}</span>
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setStepIndex(0)}>
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
                {filteredCatalog.map((product) => {
                  const qty = qtyByProduct[product.id] ?? 1;
                  return (
                    <div key={product.id} className="flex items-center gap-3 rounded-xl border bg-muted/40 p-2.5" data-testid={`order-catalog-row-${product.id}`}>
                      {product.imagen ? (
                        <img src={product.imagen} alt={product.producto} className="h-9 w-9 shrink-0 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{product.producto}</p>
                        <p className="text-xs text-muted-foreground">{format(product.precio)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setQtyByProduct((p) => ({ ...p, [product.id]: Math.max(1, qty - 1) }))} aria-label="Disminuir cantidad" data-testid={`button-order-qty-minus-${product.id}`}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-4 text-center text-sm tabular-nums" data-testid={`text-order-qty-${product.id}`}>{qty}</span>
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setQtyByProduct((p) => ({ ...p, [product.id]: qty + 1 }))} aria-label="Aumentar cantidad" data-testid={`button-order-qty-plus-${product.id}`}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="sm" className="h-7 px-2.5 text-xs" onClick={() => addLine(product)} data-testid={`button-order-add-${product.id}`}>
                          Agregar
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {filteredCatalog.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No hay productos con esos criterios</p>
                )}
              </div>

              {lines.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ya agregaste a este pedido</p>
                  {lines.map((line) => (
                    <div key={line.productId} className="flex items-center gap-3 rounded-xl border bg-background p-2.5" data-testid={`order-line-${line.productId}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{line.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.quantity} unidad{line.quantity !== 1 ? "es" : ""} · {format(line.precio * line.quantity)}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeLine(line.productId)} aria-label={`Quitar ${line.productName} del pedido`} data-testid={`button-order-remove-${line.productId}`}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground" data-testid="text-order-count">
                  {lines.length} producto{lines.length !== 1 ? "s" : ""} agregado{lines.length !== 1 ? "s" : ""}
                </span>
                <span className="text-lg font-bold" data-testid="text-order-subtotal">{format(subtotal)}</span>
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

          {currentStep === "confirmar" && discount !== null && (
            <div className="space-y-1.5 rounded-xl bg-muted/60 p-4" data-testid="order-summary">
              {lines.map((line) => (
                <div key={line.productId} className="flex justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{line.productName} x{line.quantity}</span>
                  <span className="font-medium">{format(line.precio * line.quantity)}</span>
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
      </DialogContent>
    </Dialog>
  );
}
