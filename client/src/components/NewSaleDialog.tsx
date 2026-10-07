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
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CalendarIcon, ChevronDown, ChevronLeft, Plus, Search, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { cn } from "@/lib/utils";
import {
  computeSubtotal,
  computeSaleTotals,
  splitIntoInstallments,
  installmentsSumMatches,
  addDays,
  type OrderAdjustment,
} from "@shared/saleCalculations";
import { paymentMethods, type PaymentMethod } from "@shared/schema";
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

// Prompt 6, punto 3: "Ajustes del total" deja de ser un paso propio — pasa a ser un bloque
// plegable dentro de "Pago" (ver más abajo). Los pasos quedan: Clienta → Productos → Pago →
// Revisá y confirmá (creación); Productos → Pago → Revisá y confirmá (edición, la clienta no
// se edita por esta vía).
const CREATE_STEPS = ["cliente", "productos", "pago", "confirmar"] as const;
const EDIT_STEPS = ["productos", "pago", "confirmar"] as const;
type StepId = (typeof CREATE_STEPS)[number];

const stepLabels: Record<StepId, string> = {
  cliente: "¿A quién le vendés?",
  productos: "Productos",
  pago: "¿Cómo paga?",
  confirmar: "Revisá y confirmá",
};

// Prompt 6, punto 4 — atajos de vencimiento para "¿Cuándo te paga?" / "¿Cuándo vence la
// primera cuota?". "custom" abre un selector de fecha puntual.
const DUE_DATE_PRESETS = [
  { value: "7", label: "En 7 días" },
  { value: "15", label: "En 15 días" },
  { value: "30", label: "En 30 días" },
  { value: "custom", label: "Elegir fecha" },
] as const;
type DueDatePreset = (typeof DUE_DATE_PRESETS)[number]["value"];

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
  const { format } = useHideMoney();
  const isEditMode = !!existingSale;
  const steps = isEditMode ? EDIT_STEPS : CREATE_STEPS;

  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = steps[stepIndex] as StepId;

  const [lines, setLines] = useState<OrderLine[]>([]);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  // Prompt 6, punto 1 — "Completar después": distingue "todavía no elegí" (bloquea avanzar)
  // de "elegí a propósito no elegir clienta ahora" (deja avanzar, el backend/la confirmación
  // exigen clienta solo si la venta queda con algo pendiente de cobro).
  const [clientSkipped, setClientSkipped] = useState(false);
  const [date, setDate] = useState<Date>(new Date());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [installmentsCount, setInstallmentsCount] = useState(1);
  const [installmentAmounts, setInstallmentAmounts] = useState<number[]>([]);
  // Prompt 6, punto 4 — "La clienta paga en el momento". 1 pago: viene tildada; 2+: destildada.
  const [paidNow, setPaidNow] = useState(true);
  const [dueDatePreset, setDueDatePreset] = useState<DueDatePreset>("7");
  const [customDueDate, setCustomDueDate] = useState<Date | null>(null);
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState(false);
  // Prompt 6, punto 3 — arranca cerrado; si en edición ya había algún ajuste cargado, se abre
  // solo (ver el useEffect de precarga más abajo).
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [orderDiscountPct, setOrderDiscountPct] = useState("");
  const [orderSurchargePct, setOrderSurchargePct] = useState("");
  // Etapa I-B.7-D-C: dos conceptos separados — lo que se le cobra a la clienta por el envío
  // (afecta el total y suma a la ganancia) y lo que le cuesta realmente el envío a la
  // consultora (resta de la ganancia; puede quedar sin informar, `null`).
  const [shippingCharged, setShippingCharged] = useState<number | null>(null);
  const [shippingCostReal, setShippingCostReal] = useState<number | null>(null);
  // Prompt 2: Ingresos Brutos dejó de ser un campo manual acá — se calcula solo en el backend
  // a partir del % cargado en Configuración (ver shared/saleCalculations.ts).
  const [notes, setNotes] = useState("");

  const [productSubView, setProductSubView] = useState<ProductSubView>("category");
  const productStepRef = useRef<SaleProductStepHandle>(null);

  // Clave de idempotencia de este intento de venta (Etapa I-B.6): un solo UUID por intento
  // lógico, generado recién al primer submit (no al abrir el diálogo, para no gastar uno si
  // la consultora abre el wizard y lo cierra sin llegar a confirmar). Si el submit falla o la
  // respuesta se pierde, `resetAndClose` NO corre (el diálogo queda abierto, ver
  // `saveSaleMutation.onError` más abajo) — el mismo ref sigue vivo y el reintento reutiliza
  // el mismo UUID. Recién se limpia en `resetAndClose`, que corre tanto al confirmar con éxito
  // como al cerrar/cancelar el diálogo — ahí sí es un intento nuevo la próxima vez que se abra.
  const clientRequestIdRef = useRef<string | null>(null);
  const getOrCreateClientRequestId = () => {
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
    }
    return clientRequestIdRef.current;
  };

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
      // Prompt 6 — "edición inteligente": las cuotas YA COBRADAS se preservan intactas en el
      // servidor (nunca se reconstruyen desde este formulario) — lo que se edita acá es
      // únicamente el SALDO PENDIENTE. Si no queda nada pendiente (venta ya cobrada entera),
      // no hay nada para repartir: un solo "pago" de $0 (el servidor lo interpreta como "sin
      // cuota nueva que crear", ver buildInstallmentPlans).
      const pendingExisting = existingSale.installments.filter((i) => i.status === "pendiente");
      setInstallmentsCount(pendingExisting.length > 0 ? pendingExisting.length : 1);
      setInstallmentAmounts(pendingExisting.length > 0 ? pendingExisting.map((i) => i.amount) : [0]);
      setPaidNow(false);
      setDueDatePreset("7");
      setCustomDueDate(null);
      const hasAdjustments = Boolean(
        (existingSale.orderDiscountType === "percent" && existingSale.orderDiscountValue) ||
          (existingSale.orderSurchargeType === "percent" && existingSale.orderSurchargeValue) ||
          existingSale.shippingCharged ||
          existingSale.shippingCost,
      );
      setAdjustmentsOpen(hasAdjustments);
      setOrderDiscountPct(
        existingSale.orderDiscountType === "percent" && existingSale.orderDiscountValue ? String(existingSale.orderDiscountValue) : "",
      );
      setOrderSurchargePct(
        existingSale.orderSurchargeType === "percent" && existingSale.orderSurchargeValue ? String(existingSale.orderSurchargeValue) : "",
      );
      setShippingCharged(existingSale.shippingCharged ?? null);
      setShippingCostReal(existingSale.shippingCost ?? null);
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
      setClientSkipped(false);
      setPaidNow(true);
      setDueDatePreset("7");
      setCustomDueDate(null);
      setAdjustmentsOpen(false);
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
    // Prompt 6: también habilitada en "confirmar" cuando hace falta elegir clienta ahí mismo
    // (venta que quedaría pendiente de cobro sin una) — ver el aviso inline de ese paso.
    enabled: open && !isEditMode && (currentStep === "cliente" || currentStep === "confirmar"),
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
  const totals = computeSaleTotals({ subtotal, orderDiscount, orderSurcharge, shippingCharged });

  // Prompt 6 — "edición inteligente": lo que se reparte en cuotas acá es el SALDO PENDIENTE
  // (total nuevo menos lo ya cobrado), no el total — en creación no hay nada ya cobrado, así
  // que coincide con el total de siempre.
  const alreadyPaidAmount = existingSale ? existingSale.installments.filter((i) => i.status === "pagado").reduce((sum, i) => sum + i.amount, 0) : 0;
  const remainingTotal = Math.max(totals.total - alreadyPaidAmount, 0);
  const remainingTotalIsNegative = totals.total - alreadyPaidAmount < 0;
  const effectiveInstallments = installmentsCount === 1 ? [remainingTotal] : installmentAmounts;
  const installmentsValid = installmentsSumMatches(effectiveInstallments, remainingTotal);

  // Prompt 6, punto 4 — fecha real de la primera cuota pendiente cuando no se paga en el
  // momento: mismos atajos "en 7/15/30 días" que el backend ya sabe espaciar desde ahí.
  const saleDateStr = toDateInputValue(date);
  const resolvedFirstDueDate =
    dueDatePreset === "custom"
      ? (customDueDate ? toDateInputValue(customDueDate) : null)
      : addDays(saleDateStr, Number(dueDatePreset));
  // Con tarjeta siempre queda cobrada entera (el backend ignora paidNow/firstDueDate en ese
  // caso) — nunca hace falta elegir vencimiento ahí.
  const needsFirstDueDate = paymentMethod !== "tarjeta" && !paidNow;
  // Prompt 6, punto 1 — una venta pendiente de cobro (con tarjeta nunca lo está) necesita
  // clienta. "Pendiente" acá significa lo mismo que en buildInstallmentPlans: tarjeta nunca;
  // sin pagar en el momento, siempre; pagando en el momento, solo si hay más de 1 cuota
  // (la primera queda cobrada, el resto pendiente).
  const hasAnyPendingInstallment = paymentMethod !== "tarjeta" && (!paidNow || installmentsCount > 1);
  // Prompt 6, punto 5 — "Pagó en el momento" o "Te debe $X — vence el [fecha]", para el
  // resumen de "Revisá y confirmá". Con varias cuotas y "paga en el momento" tildado, lo que
  // queda pendiente es el resto después de la primera (ya cobrada).
  const pendingDisplayAmount = !hasAnyPendingInstallment
    ? 0
    : paidNow
      ? remainingTotal - (effectiveInstallments[0] ?? 0)
      : remainingTotal;
  const pendingDisplayDate = !hasAnyPendingInstallment ? null : paidNow ? addDays(saleDateStr, 30) : resolvedFirstDueDate;

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
    setInstallmentAmounts(splitIntoInstallments(remainingTotal, count));
    // Prompt 6, punto 4: 1 pago viene tildada, 2+ viene destildada — default que la
    // consultora puede cambiar después con la casilla.
    setPaidNow(count === 1);
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
    setClientSkipped(false);
    setDate(new Date());
    setPaymentMethod("efectivo");
    setInstallmentsCount(1);
    setInstallmentAmounts([]);
    setPaidNow(true);
    setDueDatePreset("7");
    setCustomDueDate(null);
    setAdjustmentsOpen(false);
    setOrderDiscountPct("");
    setOrderSurchargePct("");
    setShippingCharged(null);
    setShippingCostReal(null);
    setNotes("");
    setStepIndex(0);
    setProductSubView("category");
    setClientSearch("");
    clientRequestIdRef.current = null;
    onOpenChange(false);
  };

  const invalidateAfterSave = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales/top-products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
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
          shippingCharged: shippingCharged ?? undefined,
          shippingCost: shippingCostReal ?? undefined,
          paymentMethod,
          installments: effectiveInstallments.map((amount) => ({ amount })),
          paidNow,
          firstDueDate: needsFirstDueDate ? resolvedFirstDueDate ?? undefined : undefined,
          notes: notes.trim() ? notes.trim() : undefined,
        };
        const res = await apiRequest("PATCH", `/api/sales/${existingSale.id}`, payload);
        return res.json();
      }

      const payload = {
        // Prompt 6, punto 1 — "Completar después": sin clienta, la venta se guarda como "Sin
        // clienta" (el servidor rechaza si además queda pendiente de cobro sin una).
        clientId: client ? client.id : undefined,
        date: toDateInputValue(date),
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: getLineFinalPrice(l) })),
        orderDiscount,
        orderSurcharge,
        shippingCharged: shippingCharged ?? undefined,
        shippingCost: shippingCostReal ?? undefined,
        paymentMethod,
        installments: effectiveInstallments.map((amount) => ({ amount })),
        paidNow,
        firstDueDate: needsFirstDueDate ? resolvedFirstDueDate ?? undefined : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        clientRequestId: getOrCreateClientRequestId(),
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

  const paymentStepValid = installmentsValid && !remainingTotalIsNegative && (!needsFirstDueDate || resolvedFirstDueDate !== null);
  // Prompt 6, punto 1: una venta pendiente de cobro necesita clienta — en edición no hay
  // paso "cliente" (no es editable), así que esto solo puede pasar si la venta YA se creó sin
  // clienta y la edición la deja con algo pendiente de nuevo.
  const needsClientForPending = hasAnyPendingInstallment && (isEditMode ? existingSale?.clientId == null : client === null);

  const goBack = () => {
    if (currentStep === "productos" && productStepRef.current?.goBack()) return;
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    if (currentStep === "cliente" && client === null && !clientSkipped) return;
    if (currentStep === "productos" && (productSubView !== "cart" || lines.length === 0)) return;
    if (currentStep === "pago" && !paymentStepValid) return;
    if (currentStep === "confirmar") {
      if (needsClientForPending) return;
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
    (currentStep === "cliente" && client === null && !clientSkipped) ||
    (currentStep === "productos" && (productSubView !== "cart" || lines.length === 0)) ||
    (currentStep === "pago" && !paymentStepValid) ||
    (currentStep === "confirmar" && needsClientForPending) ||
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
              <Button
                type="button"
                variant="ghost"
                className="h-12 w-full text-muted-foreground"
                onClick={() => {
                  setClient(null);
                  setClientSkipped(true);
                  // No usa goNext(): su guardia todavía vería `clientSkipped` viejo en este
                  // mismo tick (el setState de arriba recién se aplica en el próximo render).
                  setStepIndex((i) => {
                    const next = Math.min(steps.length - 1, i + 1);
                    if (steps[next] === "productos") {
                      setProductSubView(lines.length > 0 ? "cart" : "category");
                    }
                    return next;
                  });
                }}
                data-testid="button-skip-client"
              >
                Completar después
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

              {/* Prompt 6, punto 3: "Ajustes del total" ya no es un paso propio — queda
                 plegado acá, con un resumen en el botón cuando ya hay algo cargado. */}
              <Collapsible open={adjustmentsOpen} onOpenChange={setAdjustmentsOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-between py-3 text-left"
                    data-testid="button-toggle-adjustments"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {!adjustmentsOpen && (orderDiscountPct || orderSurchargePct || shippingCharged || shippingCostReal) ? (
                        <span className="truncate text-sm font-normal">
                          {[
                            orderDiscountPct && `Descuento ${orderDiscountPct}%`,
                            orderSurchargePct && `Recargo ${orderSurchargePct}%`,
                            shippingCharged && `Envío ${format(shippingCharged)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          {" — Editar"}
                        </span>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 shrink-0" />
                          <span>Agregar descuento, recargo o envío</span>
                        </>
                      )}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", adjustmentsOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 pt-2">
                  <div className="flex items-center justify-between border-b py-3">
                    <Label htmlFor="wizard-discount">Descuento (%)</Label>
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
                    <Label htmlFor="wizard-surcharge">Recargo (%)</Label>
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
                  <div className="flex items-center justify-between border-b py-3">
                    <Label htmlFor="wizard-shipping-charged">Envío que le cobrás ($)</Label>
                    <div className="relative w-28">
                      <Input
                        id="wizard-shipping-charged"
                        type="number"
                        min={0}
                        placeholder="0"
                        className="pr-7 text-right"
                        value={shippingCharged !== null ? shippingCharged / 100 : ""}
                        onChange={(e) => setShippingCharged(e.target.value ? Math.round(Number(e.target.value) * 100) : null)}
                        data-testid="input-shipping-charged"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    </div>
                  </div>
                  <div className="py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="wizard-shipping-cost">Envío que pagás vos ($)</Label>
                      <div className="relative w-28">
                        <Input
                          id="wizard-shipping-cost"
                          type="number"
                          min={0}
                          placeholder="Sin informar"
                          className="pr-7 text-right"
                          value={shippingCostReal !== null ? shippingCostReal / 100 : ""}
                          onChange={(e) => setShippingCostReal(e.target.value ? Math.round(Number(e.target.value) * 100) : null)}
                          data-testid="input-shipping-cost-real"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Lo que te cuesta a vos el envío. No se le suma a la clienta.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="space-y-1.5 rounded-xl bg-muted/60 p-4">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Precio original</span>
                  <span>{format(subtotal)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>Descuento ({orderDiscountPct}%)</span>
                    <span>− {format(totals.discountAmount)}</span>
                  </div>
                )}
                {totals.surchargeAmount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                    <span>Recargo ({orderSurchargePct}%)</span>
                    <span>+ {format(totals.surchargeAmount)}</span>
                  </div>
                )}
                {totals.shippingCharged > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                    <span>Envío</span>
                    <span>+ {format(totals.shippingCharged)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <span>Total a cobrar</span>
                  <span data-testid="text-sale-total">{format(totals.total)}</span>
                </div>
                {isEditMode && alreadyPaidAmount > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Ya cobraste {format(alreadyPaidAmount)} de esta venta. Falta: {format(remainingTotal)}.
                  </p>
                )}
              </div>

              {isEditMode && remainingTotal === 0 ? (
                <p className="rounded-lg bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  Esta venta ya está cobrada completa — no queda saldo pendiente para repartir en cuotas.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <SaleInstallmentsEditor
                      total={remainingTotal}
                      count={installmentsCount}
                      onCountChange={handleInstallmentsCountChange}
                      amounts={effectiveInstallments}
                      onAmountChange={handleInstallmentAmountChange}
                      hideAmounts={paymentMethod === "tarjeta"}
                    />
                  </div>

                  {/* Prompt 6, punto 4 */}
                  {paymentMethod === "tarjeta" ? (
                    <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground" data-testid="text-card-always-paid">
                      Con tarjeta, la venta queda cobrada.
                    </p>
                  ) : (
                    <div className="space-y-3 rounded-lg border p-3">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="wizard-paid-now"
                          checked={paidNow}
                          onCheckedChange={(v) => setPaidNow(v === true)}
                          className="mt-0.5"
                          data-testid="checkbox-paid-now"
                        />
                        <Label htmlFor="wizard-paid-now" className="cursor-pointer font-normal">
                          <span className="block font-medium text-foreground">La clienta paga en el momento</span>
                          <span className="block text-xs text-muted-foreground">Destildala si te queda debiendo.</span>
                        </Label>
                      </div>

                      {needsFirstDueDate && (
                        <div className="space-y-1.5 pt-1">
                          <Label>{installmentsCount === 1 ? "¿Cuándo te paga?" : "¿Cuándo vence la primera cuota?"}</Label>
                          <div className="grid grid-cols-2 gap-2">
                            {DUE_DATE_PRESETS.map((p) => (
                              <button
                                key={p.value}
                                type="button"
                                onClick={() => setDueDatePreset(p.value)}
                                className={cn(
                                  "rounded-lg border px-3 py-2 text-sm font-medium hover-elevate active-elevate-2",
                                  dueDatePreset === p.value ? "border-primary bg-primary/10 text-primary" : "bg-muted/40",
                                )}
                                data-testid={`button-due-date-preset-${p.value}`}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          {dueDatePreset === "custom" && (
                            <Popover open={dueDatePopoverOpen} onOpenChange={setDueDatePopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button type="button" variant="outline" className="w-full justify-start font-normal" data-testid="button-custom-due-date">
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {customDueDate
                                    ? customDueDate.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
                                    : "Elegir una fecha"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={customDueDate ?? undefined}
                                  onSelect={(d) => {
                                    if (d) {
                                      setCustomDueDate(d);
                                      setDueDatePopoverOpen(false);
                                    }
                                  }}
                                />
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {!isEditMode && (
                <div className="space-y-1.5">
                  <Label>Fecha de la venta</Label>
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
            <div className="space-y-3">
              {needsClientForPending && (
                <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" data-testid="warning-needs-client">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Para dejar una venta pendiente de cobro tenés que elegir la clienta
                  </p>
                  {!isEditMode ? (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          className="pl-9 bg-background"
                          placeholder="Buscar por nombre, teléfono o email..."
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          data-testid="input-client-search-confirm"
                        />
                      </div>
                      {debouncedClientSearch && (
                        <div className="space-y-1.5">
                          {isFetchingClients ? (
                            <p className="py-2 text-center text-sm text-muted-foreground">Buscando...</p>
                          ) : clientResults.length === 0 ? (
                            <p className="py-2 text-center text-sm text-muted-foreground">No se encontraron clientas</p>
                          ) : (
                            clientResults.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setClient(c);
                                  setClientSkipped(false);
                                }}
                                className="flex w-full items-center gap-3 rounded-xl border bg-background p-2.5 text-left hover-elevate active-elevate-2"
                                data-testid={`client-option-confirm-${c.id}`}
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                  <User className="h-3.5 w-3.5" />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{c.name?.trim() || c.phone}</p>
                                  <p className="text-xs text-muted-foreground">{c.phone}</p>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full border-dashed bg-background"
                        onClick={() => setCreateClientOpen(true)}
                        data-testid="button-new-client-confirm"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Nueva clienta
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Esta venta no tiene clienta asignada todavía. Por ahora, asignale una desde el detalle de la venta
                      antes de dejarla pendiente de cobro.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-3 rounded-xl bg-muted/60 p-4">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Clienta</span>
                  <span className="text-right font-medium">
                    {isEditMode
                      ? existingSale!.clientName
                      : client
                        ? client.name?.trim() || client.phone
                        : "Sin clienta — la cargás después"}
                  </span>
                </div>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="shrink-0 text-muted-foreground">Productos</span>
                  <span className="text-right font-medium">{productsLine}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Precio original</span>
                  <span className="font-medium">{format(subtotal)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Descuento</span>
                    <span className="font-medium">-{orderDiscountPct}% ({format(totals.discountAmount)})</span>
                  </div>
                )}
                {totals.surchargeAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Recargo</span>
                    <span className="font-medium">+{orderSurchargePct}% ({format(totals.surchargeAmount)})</span>
                  </div>
                )}
                {totals.shippingCharged > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Envío</span>
                    <span className="font-medium">{format(totals.shippingCharged)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pago</span>
                  <span className="text-right font-medium" data-testid="text-confirm-payment-status">
                    {!hasAnyPendingInstallment
                      ? "Pagó en el momento"
                      : `Te debe ${format(pendingDisplayAmount)}${pendingDisplayDate ? ` — vence el ${parseLocalDate(pendingDisplayDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : ""}`}
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
                  <span data-testid="text-confirm-total">{format(totals.total)}</span>
                </div>
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
