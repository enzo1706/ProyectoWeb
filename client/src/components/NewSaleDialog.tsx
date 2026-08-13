import { useEffect, useMemo, useState } from "react";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/currency";
import {
  computeSubtotal,
  computeSaleTotals,
  splitIntoInstallments,
  installmentsSumMatches,
  type OrderAdjustment,
} from "@shared/saleCalculations";
import { paymentMethods, type PaymentMethod, type InstallmentFrequency } from "@shared/schema";
import type { Product } from "@shared/schema";
import { SaleProductPicker } from "./SaleProductPicker";
import { SaleOrderTable, getLineFinalPrice, type OrderLine } from "./SaleOrderTable";
import { EditSaleItemDialog } from "./EditSaleItemDialog";
import { ClientCombobox } from "./ClientCombobox";
import { SaleInstallmentsEditor } from "./SaleInstallmentsEditor";
import type { Client } from "./ClientCard";
import type { SaleDetails } from "./SaleCard";

interface NewSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Si viene seteada, el diálogo entra en modo edición sobre esta venta en vez de crear una nueva. */
  existingSale?: SaleDetails | null;
  /** Clienta con la que arranca precargado el combobox al abrir una venta nueva (ej. desde su ficha). Sigue siendo editable. */
  preselectedClient?: Client | null;
  /** Líneas con las que arranca precargado el pedido (ej. viene del carrito armado en Productos). Solo aplica en modo creación. */
  initialLines?: OrderLine[];
}

const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function OrderAdjustmentField({
  label,
  adjustment,
  onChange,
  testIdPrefix,
}: {
  label: string;
  adjustment: OrderAdjustment | null;
  onChange: (adjustment: OrderAdjustment | null) => void;
  testIdPrefix: string;
}) {
  const [type, setType] = useState<"percent" | "fixed">(adjustment?.type ?? "percent");
  const [inputValue, setInputValue] = useState<string>(
    adjustment ? String(adjustment.type === "fixed" ? adjustment.value / 100 : adjustment.value) : "",
  );

  useEffect(() => {
    if (!adjustment) setInputValue("");
  }, [adjustment]);

  const commit = (nextType: "percent" | "fixed", nextInput: string) => {
    setType(nextType);
    setInputValue(nextInput);
    if (!nextInput) {
      onChange(null);
      return;
    }
    const numeric = Number(nextInput);
    if (isNaN(numeric)) return;
    onChange({ type: nextType, value: nextType === "fixed" ? Math.round(numeric * 100) : numeric });
  };

  const handleClear = () => {
    setType("percent");
    setInputValue("");
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Select value={type} onValueChange={(v) => commit(v as "percent" | "fixed", inputValue)}>
          <SelectTrigger className="w-20 shrink-0" data-testid={`select-${testIdPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">%</SelectItem>
            <SelectItem value="fixed">$</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          placeholder="0"
          value={inputValue}
          onChange={(e) => commit(type, e.target.value)}
          data-testid={`input-${testIdPrefix}-value`}
        />
        {adjustment && (
          <Button type="button" variant="ghost" size="icon" onClick={handleClear} data-testid={`button-clear-${testIdPrefix}`}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function NewSaleDialog({ open, onOpenChange, products, existingSale, preselectedClient, initialLines }: NewSaleDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!existingSale;

  const [lines, setLines] = useState<OrderLine[]>([]);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [date, setDate] = useState<Date>(new Date());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [installmentsCount, setInstallmentsCount] = useState(1);
  const [installmentAmounts, setInstallmentAmounts] = useState<number[]>([]);
  const [installmentFrequency, setInstallmentFrequency] = useState<InstallmentFrequency | null>(null);
  const [orderDiscount, setOrderDiscount] = useState<OrderAdjustment | null>(null);
  const [orderSurcharge, setOrderSurcharge] = useState<OrderAdjustment | null>(null);
  const [shippingCost, setShippingCost] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [adjustProductId, setAdjustProductId] = useState<string>("");

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
      setOrderDiscount(
        existingSale.orderDiscountType
          ? { type: existingSale.orderDiscountType as "percent" | "fixed", value: existingSale.orderDiscountValue ?? 0 }
          : null,
      );
      setOrderSurcharge(
        existingSale.orderSurchargeType
          ? { type: existingSale.orderSurchargeType as "percent" | "fixed", value: existingSale.orderSurchargeValue ?? 0 }
          : null,
      );
      setShippingCost(existingSale.shippingCost ?? null);
      setNotes(existingSale.notes ?? "");
      setDate(parseLocalDate(existingSale.date));
    } else if (open && !existingSale) {
      if (initialLines && initialLines.length > 0) {
        setLines(initialLines);
      }
      if (preselectedClient) {
        setClient(preselectedClient);
      }
    }
  }, [open, existingSale, preselectedClient, initialLines, effectiveProducts]);

  const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: getLineFinalPrice(l) })));
  const totals = computeSaleTotals({ subtotal, orderDiscount, orderSurcharge, shippingCost });
  const effectiveInstallments = installmentsCount === 1 ? [totals.total] : installmentAmounts;
  const installmentsValid = installmentsSumMatches(effectiveInstallments, totals.total);

  const orderedQuantities = useMemo(() => new Map(lines.map((l) => [l.productId, l.quantity])), [lines]);
  const editingLine = lines.find((l) => l.productId === editingProductId) ?? null;

  const addProduct = (product: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        if (existing.quantity >= existing.maxQuantity) {
          toast({ title: "No hay más stock disponible para este producto", variant: "destructive" });
          return prev;
        }
        return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.producto,
          category: product.seccion,
          imagen: product.imagen,
          originalPrice: product.precio,
          quantity: 1,
          maxQuantity: product.unidades,
          mode: "none",
          adjustmentValue: null,
        },
      ];
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
    setOrderDiscount(null);
    setOrderSurcharge(null);
    setShippingCost(null);
    setNotes("");
    setAdjustProductId("");
    onOpenChange(false);
  };

  const invalidateAfterSave = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
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

  const canSubmit =
    lines.length > 0 &&
    (isEditMode || client !== null) &&
    installmentsValid &&
    (installmentsCount === 1 || installmentFrequency !== null) &&
    !saveSaleMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : resetAndClose())}>
      <DialogContent className="max-w-4xl" data-testid="dialog-new-sale">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Editar Venta" : "Nueva Venta"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-6 px-1 -mx-1">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">1. Elegí los productos</h3>
            <SaleProductPicker products={effectiveProducts} orderedQuantities={orderedQuantities} onAdd={addProduct} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">2. Detalle de la orden</h3>
            <SaleOrderTable lines={lines} onEdit={setEditingProductId} onRemove={removeLine} />
          </section>

          {lines.length > 0 && (
            <>
              <section className="rounded-lg border bg-muted p-4 space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Opciones generales</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <OrderAdjustmentField label="Descuento sobre el total" adjustment={orderDiscount} onChange={setOrderDiscount} testIdPrefix="order-discount" />
                  <OrderAdjustmentField label="Recargo sobre el total" adjustment={orderSurcharge} onChange={setOrderSurcharge} testIdPrefix="order-surcharge" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Ajustar precio de un producto</Label>
                    <Select
                      value={adjustProductId}
                      onValueChange={(v) => {
                        setAdjustProductId(v);
                        setEditingProductId(Number(v));
                      }}
                    >
                      <SelectTrigger data-testid="select-adjust-product">
                        <SelectValue placeholder="Elegir producto" />
                      </SelectTrigger>
                      <SelectContent>
                        {lines.map((l) => (
                          <SelectItem key={l.productId} value={String(l.productId)}>
                            {l.productName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Costo de envío</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={shippingCost !== null ? shippingCost / 100 : ""}
                        onChange={(e) => setShippingCost(e.target.value ? Math.round(Number(e.target.value) * 100) : null)}
                        data-testid="input-shipping-cost"
                      />
                      {shippingCost !== null && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => setShippingCost(null)} data-testid="button-remove-shipping">
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border p-4 space-y-1.5">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>Descuento</span>
                    <span>-{formatPrice(totals.discountAmount)}</span>
                  </div>
                )}
                {totals.surchargeAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Recargo</span>
                    <span>+{formatPrice(totals.surchargeAmount)}</span>
                  </div>
                )}
                {totals.shippingCost > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Envío</span>
                    <span>+{formatPrice(totals.shippingCost)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>TOTAL</span>
                  <span data-testid="text-sale-total">{formatPrice(totals.total)}</span>
                </div>
              </section>

              <section className="space-y-1.5">
                <Label>Clienta</Label>
                {isEditMode ? (
                  <p className="text-sm rounded-md border bg-muted px-3 py-2" data-testid="text-edit-client-name">
                    {existingSale!.clientName} <span className="text-muted-foreground">(no editable)</span>
                  </p>
                ) : (
                  <ClientCombobox value={client} onSelect={setClient} />
                )}
              </section>

              <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Fecha</Label>
                  {isEditMode ? (
                    <p className="text-sm rounded-md border bg-muted px-3 py-2 flex items-center gap-2" data-testid="text-edit-date">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      {date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  ) : (
                    <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-start font-normal" data-testid="button-sale-date">
                          <CalendarIcon className="h-4 w-4 mr-2" />
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
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Método de pago</Label>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                    <SelectTrigger data-testid="select-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentMethods.map((m) => (
                        <SelectItem key={m} value={m}>
                          {paymentMethodLabels[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2">
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
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="sale-notes">Observaciones</Label>
                <Textarea
                  id="sale-notes"
                  placeholder="Notas internas sobre esta venta (opcional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  data-testid="input-sale-notes"
                />
              </section>
            </>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button type="button" variant="outline" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => saveSaleMutation.mutate()}
            disabled={!canSubmit}
            data-testid="button-confirm-sale"
          >
            {saveSaleMutation.isPending ? "Guardando..." : isEditMode ? "Guardar Cambios" : "Registrar Venta"}
          </Button>
        </DialogFooter>

        <EditSaleItemDialog
          open={editingProductId !== null}
          onOpenChange={(o) => {
            if (!o) {
              setEditingProductId(null);
              setAdjustProductId("");
            }
          }}
          line={editingLine}
          onSave={updateLine}
        />
      </DialogContent>
    </Dialog>
  );
}
