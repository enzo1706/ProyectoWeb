import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, ChevronLeft, Plus, Search, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  computeSubtotal,
  computeSaleTotals,
  splitIntoInstallments,
  installmentsSumMatches,
  type OrderAdjustment,
} from "@shared/saleCalculations";
import { paymentMethods, type PaymentMethod, type InstallmentFrequency } from "@shared/schema";
import type { Product } from "@shared/schema";
import { SaleOrderTable, getLineFinalPrice, type OrderLine } from "./SaleOrderTable";
import { SaleProductStep, type ProductSubView, type SaleProductStepHandle } from "./SaleProductStep";
import { EditSaleItemDialog } from "./EditSaleItemDialog";
import { ClientDialog } from "./ClientDialog";
import { SaleInstallmentsEditor } from "./SaleInstallmentsEditor";
import { WizardDots } from "./WizardDots";
import type { Client } from "./ClientCard";
import type { SaleDetails } from "./SaleCard";

interface NewSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Si viene seteada, el diálogo entra en modo edición sobre esta venta en vez de crear una nueva. */
  existingSale?: SaleDetails | null;
  /** Clienta con la que arranca precargado al abrir una venta nueva (ej. desde su ficha). Sigue siendo editable. */
  preselectedClient?: Client | null;
  /** Líneas con las que arranca precargado el pedido (ej. viene del carrito armado en Productos). Solo aplica en modo creación. */
  initialLines?: OrderLine[];
}

const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

const CREATE_STEPS = ["cliente", "productos", "ajustes", "pago", "confirmar"] as const;
const EDIT_STEPS = ["productos", "ajustes", "pago", "confirmar"] as const;
type StepId = (typeof CREATE_STEPS)[number];

const stepLabels: Record<StepId, string> = {
  cliente: "¿A quién le vendés?",
  productos: "Productos",
  ajustes: "Ajustes del total",
  pago: "¿Cómo paga?",
  confirmar: "Revisá y confirmá",
};

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function NewSaleDialog({ open, onOpenChange, products, existingSale, preselectedClient, initialLines }: NewSaleDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!existingSale;
  const steps = isEditMode ? EDIT_STEPS : CREATE_STEPS;

  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = steps[stepIndex] as StepId;

  const [lines, setLines] = useState<OrderLine[]>([]);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [date, setDate] = useState<Date>(new Date());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [installmentsCount, setInstallmentsCount] = useState(1);
  const [installmentAmounts, setInstallmentAmounts] = useState<number[]>([]);
  const [installmentFrequency, setInstallmentFrequency] = useState<InstallmentFrequency | null>(null);
  const [orderDiscountPct, setOrderDiscountPct] = useState("");
  const [orderSurchargePct, setOrderSurchargePct] = useState("");
  const [shippingCost, setShippingCost] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const [productSubView, setProductSubView] = useState<ProductSubView>("category");
  const productStepRef = useRef<SaleProductStepHandle>(null);

  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [createClientOpen, setCreateClientOpen] = useState(false);

  // En modo edición, el stock real ya tiene descontado lo que esta venta reservó — para poder
  // elegir las mismas cantidades (o más) hay que sumárselo de vuelta antes de mostrarlo.
  const effectiveProducts = useMemo(() => {
    if (!existingSale) return products;
    const reserved = new Map(
      existingSale.items.filter((i) => i.productId !== null).map((i) => [i.productId as number, i.quantity]),
    );
    if (reserved.size === 0) return products;
    return products.map((p) => (reserved.has(p.id) ? { ...p, unidades: p.unidades + (reserved.get(p.id) as number) } : p));
  }, [products, existingSale]);

  useEffect(() => {
    if (open && existingSale) {
      setStepIndex(0);
      setProductSubView("cart");
      setLines(
        existingSale.items
          .filter((i) => i.productId !== null)
          .map((i) => {
            const product = effectiveProducts.find((p) => p.id === i.productId);
            const adjusted = i.price !== i.originalPrice;
            return {
              productId: i.productId as number,
              productName: i.productName,
              category: i.category,
              imagen: product?.imagen ?? null,
              originalPrice: i.originalPrice,
              quantity: i.quantity,
              maxQuantity: product?.unidades ?? i.quantity,
              mode: adjusted ? "manualPrice" : "none",
              adjustmentValue: adjusted ? i.price : null,
            };
          }),
      );
      setPaymentMethod(existingSale.paymentMethod as PaymentMethod);
      setInstallmentsCount(existingSale.installments.length);
      setInstallmentAmounts(existingSale.installments.map((i) => i.amount));
      setInstallmentFrequency((existingSale.installmentFrequency as InstallmentFrequency | null) ?? null);
      setOrderDiscountPct(
        existingSale.orderDiscountType === "percent" && existingSale.orderDiscountValue ? String(existingSale.orderDiscountValue) : "",
      );
      setOrderSurchargePct(
        existingSale.orderSurchargeType === "percent" && existingSale.orderSurchargeValue ? String(existingSale.orderSurchargeValue) : "",
      );
      setShippingCost(existingSale.shippingCost ?? null);
      setNotes(existingSale.notes ?? "");
      setDate(parseLocalDate(existingSale.date));
    } else if (open && !existingSale) {
      setStepIndex(0);
      const hasInitialLines = !!initialLines && initialLines.length > 0;
      setProductSubView(hasInitialLines ? "cart" : "category");
      if (hasInitialLines) {
        setLines(initialLines!);
      }
      if (preselectedClient) {
        setClient(preselectedClient);
      }
    }
  }, [open, existingSale, preselectedClient, initialLines, effectiveProducts]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedClientSearch(clientSearch), 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  const { data: clientResults = [], isFetching: isFetchingClients } = useQuery<Client[]>({
    queryKey: ["/api/clients", debouncedClientSearch, "wizard"],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "8" });
      if (debouncedClientSearch) params.set("search", debouncedClientSearch);
      const res = await apiRequest("GET", `/api/clients?${params.toString()}`);
      return res.json();
    },
    enabled: open && !isEditMode && currentStep === "cliente",
  });

  const createClientMutation = useGuardedMutation({
    mutationFn: async (data: Omit<Client, "id" | "totalPurchases" | "lastPurchase" | "consultantId">) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json() as Promise<Client>;
    },
    onSuccess: (created: Client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setClient(created);
      setCreateClientOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo crear la clienta", description: err.message, variant: "destructive" });
    },
  });

  const orderDiscount: OrderAdjustment | null = orderDiscountPct ? { type: "percent", value: Number(orderDiscountPct) } : null;
  const orderSurcharge: OrderAdjustment | null = orderSurchargePct ? { type: "percent", value: Number(orderSurchargePct) } : null;

  const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: getLineFinalPrice(l) })));
  const totals = computeSaleTotals({ subtotal, orderDiscount, orderSurcharge, shippingCost });
  const effectiveInstallments = installmentsCount === 1 ? [totals.total] : installmentAmounts;
  const installmentsValid = installmentsSumMatches(effectiveInstallments, totals.total);

  const orderedQuantities = useMemo(() => new Map(lines.map((l) => [l.productId, l.quantity])), [lines]);
  const editingLine = lines.find((l) => l.productId === editingProductId) ?? null;

  const addLine = (line: OrderLine) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === line.productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === line.productId ? { ...l, quantity: Math.min(l.maxQuantity, l.quantity + line.quantity) } : l,
        );
      }
      return [...prev, line];
    });
  };

  const removeLine = (productId: number) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  };

  const updateLine = (updated: OrderLine) => {
    setLines((prev) => prev.map((l) => (l.productId === updated.productId ? updated : l)));
  };

  const handleInstallmentsCountChange = (count: number) => {
    setInstallmentsCount(count);
    setInstallmentAmounts(splitIntoInstallments(totals.total, count));
    if (count === 1) setInstallmentFrequency(null);
  };

  const handleInstallmentAmountChange = (index: number, amountInCents: number) => {
    setInstallmentAmounts((prev) => {
      const next = [...prev];
      next[index] = amountInCents;
      return next;
    });
  };

  const resetAndClose = () => {
    setLines([]);
    setEditingProductId(null);
    setClient(null);
    setDate(new Date());
    setPaymentMethod("efectivo");
    setInstallmentsCount(1);
    setInstallmentAmounts([]);
    setInstallmentFrequency(null);
    setOrderDiscountPct("");
    setOrderSurchargePct("");
    setShippingCost(null);
    setNotes("");
    setStepIndex(0);
    setProductSubView("category");
    setClientSearch("");
    onOpenChange(false);
  };

  const invalidateAfterSave = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales/top-products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/top"] });
    queryClient.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/reports"),
    });
    if (existingSale) {
      queryClient.invalidateQueries({ queryKey: ["/api/sales", existingSale.id] });
    }
  };

  const saveSaleMutation = useGuardedMutation({
    mutationFn: async () => {
      if (isEditMode && existingSale) {
        const payload = {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: getLineFinalPrice(l) })),
          orderDiscount,
          orderSurcharge,
          shippingCost: shippingCost ?? undefined,
          paymentMethod,
          installments: effectiveInstallments.map((amount) => ({ amount })),
          installmentFrequency: installmentsCount > 1 ? installmentFrequency ?? undefined : undefined,
          notes: notes.trim() ? notes.trim() : undefined,
        };
        const res = await apiRequest("PATCH", `/api/sales/${existingSale.id}`, payload);
        return res.json();
      }

      const payload = {
        clientId: client!.id,
        date: toDateInputValue(date),
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: getLineFinalPrice(l) })),
        orderDiscount,
        orderSurcharge,
        shippingCost: shippingCost ?? undefined,
        paymentMethod,
        installments: effectiveInstallments.map((amount) => ({ amount })),
        installmentFrequency: installmentsCount > 1 ? installmentFrequency ?? undefined : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        status: "pendiente",
      };
      const res = await apiRequest("POST", "/api/sales", payload);
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterSave();
      toast({ title: isEditMode ? "Venta actualizada correctamente" : "Venta registrada correctamente" });
      resetAndClose();
    },
    onError: (err: Error) => {
      toast({
        title: isEditMode ? "No se pudo actualizar la venta" : "No se pudo registrar la venta",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const paymentStepValid = installmentsValid && (installmentsCount === 1 || installmentFrequency !== null);

  const goBack = () => {
    if (currentStep === "productos" && productStepRef.current?.goBack()) return;
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    if (currentStep === "cliente" && client === null) return;
    if (currentStep === "productos" && (productSubView !== "cart" || lines.length === 0)) return;
    if (currentStep === "pago" && !paymentStepValid) return;
    if (currentStep === "confirmar") {
      saveSaleMutation.mutate();
      return;
    }
    setStepIndex((i) => {
      const next = Math.min(steps.length - 1, i + 1);
      if (steps[next] === "productos") {
        setProductSubView(lines.length > 0 ? "cart" : "category");
      }
      return next;
    });
  };

  const productStepHasInternalBack =
    currentStep === "productos" &&
    ((productSubView !== "category" && productSubView !== "cart") || (productSubView === "category" && lines.length > 0));
  const hideBackButton = stepIndex === 0 && !productStepHasInternalBack;
  const showNextButton = !(currentStep === "productos" && productSubView !== "cart");
  const nextDisabled =
    (currentStep === "cliente" && client === null) ||
    (currentStep === "productos" && (productSubView !== "cart" || lines.length === 0)) ||
    (currentStep === "pago" && !paymentStepValid) ||
    saveSaleMutation.isPending;
  const nextLabel =
    currentStep === "confirmar"
      ? saveSaleMutation.isPending
        ? "Guardando..."
        : isEditMode
          ? "Guardar cambios"
          : "Confirmar venta"
      : "Siguiente";

  const productsLine = lines.map((l) => `${l.productName}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join(", ");

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : resetAndClose())}>
      <DialogContent className="flex max-w-lg flex-col gap-3" data-testid="dialog-new-sale">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Editar venta" : "Nueva venta"}</DialogTitle>
        </DialogHeader>

        <WizardDots total={steps.length} current={stepIndex} />

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-1 -mx-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground" data-testid="text-step-label">
            Paso {stepIndex + 1} de {steps.length}
          </p>
          <h3 className="mb-3 text-lg font-bold text-foreground" data-testid="text-step-title">
            {stepLabels[currentStep]}
          </h3>

          {/* Paso: Clienta (solo en creación) */}
          {currentStep === "cliente" && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nombre, teléfono o email..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  data-testid="input-client-search"
                />
              </div>
              <div className="space-y-2">
                {isFetchingClients ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Buscando...</p>
                ) : clientResults.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground" data-testid="text-no-clients-found">
                    No se encontraron clientas
                  </p>
                ) : (
                  clientResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClient(c)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border p-3 text-left hover-elevate active-elevate-2",
                        client?.id === c.id ? "border-primary bg-primary/5" : "bg-muted/40",
                      )}
                      data-testid={`client-option-${c.id}`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <User className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name?.trim() || c.phone}</p>
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full border-dashed"
                onClick={() => setCreateClientOpen(true)}
                data-testid="button-new-client-inline"
              >
                <Plus className="mr-2 h-4 w-4" />
                Nueva clienta
              </Button>
            </div>
          )}

          {/* Paso: Productos */}
          {currentStep === "productos" && (
            <SaleProductStep
              ref={productStepRef}
              products={effectiveProducts}
              lines={lines}
              orderedQuantities={orderedQuantities}
              onAddLine={addLine}
              onEditLine={setEditingProductId}
              onRemoveLine={removeLine}
              subView={productSubView}
              onSubViewChange={setProductSubView}
            />
          )}

          {/* Paso: Ajustes del total */}
          {currentStep === "ajustes" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b py-3">
                <Label htmlFor="wizard-discount">Descuento</Label>
                <div className="relative w-28">
                  <Input
                    id="wizard-discount"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    className="pr-7 text-right"
                    value={orderDiscountPct}
                    onChange={(e) => setOrderDiscountPct(e.target.value)}
                    data-testid="input-order-discount-value"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between border-b py-3">
                <Label htmlFor="wizard-surcharge">Recargo</Label>
                <div className="relative w-28">
                  <Input
                    id="wizard-surcharge"
                    type="number"
                    min={0}
                    placeholder="0"
                    className="pr-7 text-right"
                    value={orderSurchargePct}
                    onChange={(e) => setOrderSurchargePct(e.target.value)}
                    data-testid="input-order-surcharge-value"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <Label htmlFor="wizard-shipping">Costo de envío</Label>
                <div className="relative w-28">
                  <Input
                    id="wizard-shipping"
                    type="number"
                    min={0}
                    placeholder="0"
                    className="pr-7 text-right"
                    value={shippingCost !== null ? shippingCost / 100 : ""}
                    onChange={(e) => setShippingCost(e.target.value ? Math.round(Number(e.target.value) * 100) : null)}
                    data-testid="input-shipping-cost"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl bg-muted/60 p-4">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Precio original</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>Descuento ({orderDiscountPct}%)</span>
                    <span>− {formatPrice(totals.discountAmount)}</span>
                  </div>
                )}
                {totals.surchargeAmount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                    <span>Recargo ({orderSurchargePct}%)</span>
                    <span>+ {formatPrice(totals.surchargeAmount)}</span>
                  </div>
                )}
                {totals.shippingCost > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                    <span>Envío</span>
                    <span>+ {formatPrice(totals.shippingCost)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <span>Total a cobrar</span>
                  <span data-testid="text-sale-total">{formatPrice(totals.total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Paso: Pago */}
          {currentStep === "pago" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Método de pago</Label>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-sm font-medium hover-elevate active-elevate-2",
                        paymentMethod === m ? "border-primary bg-primary/10 text-primary" : "bg-muted/40",
                      )}
                      data-testid={`button-payment-method-${m}`}
                    >
                      {paymentMethodLabels[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Cuotas</Label>
                <SaleInstallmentsEditor
                  total={totals.total}
                  count={installmentsCount}
                  onCountChange={handleInstallmentsCountChange}
                  amounts={effectiveInstallments}
                  onAmountChange={handleInstallmentAmountChange}
                  frequency={installmentFrequency}
                  onFrequencyChange={setInstallmentFrequency}
                />
              </div>

              {!isEditMode && (
                <div className="space-y-1.5">
                  <Label>Fecha</Label>
                  <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="w-full justify-start font-normal" data-testid="button-sale-date">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={(d) => {
                          if (d) {
                            setDate(d);
                            setDatePopoverOpen(false);
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          )}

          {/* Paso: Confirmar */}
          {currentStep === "confirmar" && (
            <div className="space-y-3 rounded-xl bg-muted/60 p-4">
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Clienta</span>
                <span className="text-right font-medium">
                  {isEditMode ? existingSale!.clientName : (client?.name?.trim() || client?.phone || "—")}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-sm">
                <span className="shrink-0 text-muted-foreground">Productos</span>
                <span className="text-right font-medium">{productsLine}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Precio original</span>
                <span className="font-medium">{formatPrice(subtotal)}</span>
              </div>
              {totals.discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Descuento</span>
                  <span className="font-medium">-{orderDiscountPct}% ({formatPrice(totals.discountAmount)})</span>
                </div>
              )}
              {totals.surchargeAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Recargo</span>
                  <span className="font-medium">+{orderSurchargePct}% ({formatPrice(totals.surchargeAmount)})</span>
                </div>
              )}
              {totals.shippingCost > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Envío</span>
                  <span className="font-medium">{formatPrice(totals.shippingCost)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pago</span>
                <span className="font-medium">
                  {paymentMethodLabels[paymentMethod]} · {installmentsCount === 1 ? "Pago único" : `${installmentsCount} cuotas`}
                </span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sale-notes">Observaciones (opcional)</Label>
                <Textarea
                  id="sale-notes"
                  placeholder="Notas internas sobre esta venta"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  data-testid="input-sale-notes"
                />
              </div>
              <div className="flex justify-between border-t pt-3 text-base font-bold">
                <span>Total</span>
                <span data-testid="text-confirm-total">{formatPrice(totals.total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t pt-3">
          {!hideBackButton && (
            <Button type="button" variant="outline" className="h-12 shrink-0 px-4" onClick={goBack} data-testid="button-wizard-back">
              <ChevronLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Atrás</span>
            </Button>
          )}
          {showNextButton && (
            <Button type="button" className="h-12 flex-1" onClick={goNext} disabled={nextDisabled} data-testid="button-wizard-next">
              {nextLabel}
            </Button>
          )}
        </div>

        <EditSaleItemDialog
          open={editingProductId !== null}
          onOpenChange={(o) => {
            if (!o) setEditingProductId(null);
          }}
          line={editingLine}
          onSave={updateLine}
        />
        <ClientDialog
          open={createClientOpen}
          onOpenChange={setCreateClientOpen}
          client={null}
          onSave={(data) => createClientMutation.mutate(data)}
          isSaving={createClientMutation.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
