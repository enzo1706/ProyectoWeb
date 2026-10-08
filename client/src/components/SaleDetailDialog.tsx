import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Calendar, FileText, AlertTriangle, Pencil, Ban, Truck, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { computeAdjustmentAmount, computeHistoricalProductCost, type OrderAdjustment } from "@shared/saleCalculations";
import type { SaleDetails } from "./SaleCard";

interface SaleDetailDialogProps {
  saleId: number | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (sale: SaleDetails) => void;
}

// Prompt 6: dos etiquetas separadas (pago/entrega) en vez de un único "status".
const paymentColors: Record<"cobrada" | "te_debe", string> = {
  cobrada: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  te_debe: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};
const cancelledColor = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";

const installmentStatusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
};

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function SaleDetailDialog({ saleId, onOpenChange, onEdit }: SaleDetailDialogProps) {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const saleQuery = useQuery<SaleDetails>({
    queryKey: ["/api/sales", saleId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sales/${saleId}`);
      return res.json();
    },
    enabled: saleId !== null,
  });

  const invalidateAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales", saleId] });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/reports"),
    });
  };

  const cancelMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales/${saleId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast({ title: "Venta cancelada", description: "El stock de los productos fue devuelto." });
      setCancelConfirmOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo cancelar la venta", description: err.message, variant: "destructive" });
    },
  });

  const installmentMutation = useGuardedMutation({
    mutationFn: async ({ installmentId, status }: { installmentId: number; status: "pendiente" | "pagado" }) => {
      const res = await apiRequest("PATCH", `/api/sales/${saleId}/installments/${installmentId}`, { status });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterChange();
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar la cuota", description: err.message, variant: "destructive" });
    },
  });

  // Prompt 6, punto 6 — cambiar a mano entre "Entregada" y "Pendiente de entrega".
  const deliveryMutation = useGuardedMutation({
    mutationFn: async (deliveryStatus: "entregada" | "pendiente_entrega") => {
      const res = await apiRequest("PATCH", `/api/sales/${saleId}/delivery-status`, { deliveryStatus });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterChange();
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar la entrega", description: err.message, variant: "destructive" });
    },
  });

  const open = saleId !== null;
  const sale = saleQuery.data;
  const isCancelled = sale?.status === "cancelada";
  // Prompt 6: el estado de pago ya no vive en `sale.status` (quedó reducido a
  // "pendiente"/"cancelada") — se deriva de las cuotas, ya presentes en la respuesta de
  // GET /api/sales/:id, igual criterio que storage.getAllSales.
  const pendingInstallments = sale?.installments.filter((i) => i.status === "pendiente") ?? [];
  const pendingAmount = pendingInstallments.reduce((sum, i) => sum + i.amount, 0);
  const paymentStatus: "cobrada" | "te_debe" = pendingAmount > 0 ? "te_debe" : "cobrada";
  const isPendingDelivery = !isCancelled && sale?.deliveryStatus === "pendiente_entrega";

  // Etapa 7.7 — descuento/recargo de la orden no se guardan como monto ($) en `sales`, solo
  // como tipo+valor (`orderDiscountType`/`orderDiscountValue`) — se resuelven acá con el mismo
  // helper (`computeAdjustmentAmount`) que ya usa NewSaleDialog para la preview, nunca una
  // fórmula nueva.
  const orderDiscount: OrderAdjustment | null = sale?.orderDiscountType
    ? { type: sale.orderDiscountType as "percent" | "fixed", value: sale.orderDiscountValue ?? 0 }
    : null;
  const orderSurcharge: OrderAdjustment | null = sale?.orderSurchargeType
    ? { type: sale.orderSurchargeType as "percent" | "fixed", value: sale.orderSurchargeValue ?? 0 }
    : null;
  const discountAmount = sale ? computeAdjustmentAmount(sale.subtotal, orderDiscount) : 0;
  const surchargeAmount = sale ? computeAdjustmentAmount(sale.subtotal, orderSurcharge) : 0;

  // Etapa 7.7 — COGS histórico: sale_items.costPrice es el snapshot al momento de la venta
  // (nunca el costo actual del producto/productStock). Ver computeHistoricalProductCost para
  // el criterio de "no disponible" cuando falta el snapshot de algún ítem.
  const productCost = sale ? computeHistoricalProductCost(sale.items) : null;
  // Prompt 2: "≈" cuando el costo de algún producto se estimó con el descuento habitual (no
  // hay costo real cargado) — la ganancia mostrada no es exacta hasta que se cargue ese costo.
  const hasEstimatedCost = sale ? sale.items.some((item) => item.costIsEstimated) : false;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-sale-detail">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {sale ? (
                <>
                  <span>Venta #{sale.id}</span>
                  {isCancelled ? (
                    <Badge className={cancelledColor}>Cancelada</Badge>
                  ) : (
                    <Badge className={paymentColors[paymentStatus]} data-testid="badge-payment-status">
                      {paymentStatus === "cobrada" ? "Cobrada" : `Te debe ${format(pendingAmount)}`}
                    </Badge>
                  )}
                  {!isCancelled && (
                    <Badge variant="outline" data-testid="badge-delivery-status">
                      {isPendingDelivery ? "Pendiente de entrega" : "Entregada"}
                    </Badge>
                  )}
                </>
              ) : (
                "Detalle de venta"
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
            {saleQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-md" />
                ))}
              </div>
            ) : saleQuery.isError ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-sm text-destructive">No se pudo cargar la venta.</p>
              </div>
            ) : sale ? (
              <>
                {isCancelled && (
                  <div
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                    data-testid="banner-sale-cancelled"
                  >
                    Esta venta está cancelada. El stock de sus productos ya fue devuelto y no puede editarse.
                  </div>
                )}

                {!isCancelled && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{isPendingDelivery ? "Pendiente de entrega" : "Entregada"}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deliveryMutation.isPending}
                      onClick={() => deliveryMutation.mutate(isPendingDelivery ? "entregada" : "pendiente_entrega")}
                      data-testid="button-toggle-delivery-status"
                    >
                      {isPendingDelivery ? "Marcar como entregada" : "Marcar pendiente de entrega"}
                    </Button>
                  </div>
                )}

                {!isCancelled && pendingInstallments.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" data-testid="section-pending-installments">
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Cuotas pendientes</p>
                    {pendingInstallments.map((inst) => (
                      <div key={inst.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`row-pending-installment-${inst.id}`}>
                        <span>
                          Cuota {inst.installmentNumber} · {format(inst.amount)} · vence{" "}
                          {parseLocalDate(inst.dueDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={installmentMutation.isPending}
                          onClick={() => installmentMutation.mutate({ installmentId: inst.id, status: "pagado" })}
                          data-testid={`button-mark-paid-${inst.id}`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                          Marcar como pagada
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3 text-sm">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{sale.clientName}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>
                    {parseLocalDate(sale.date).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                </div>

                <div className="rounded-lg border divide-y">
                  {sale.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 p-3 text-sm"
                      data-testid={`row-sale-item-${item.id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} x {format(item.price)}
                        </p>
                        <p className="text-xs text-muted-foreground" data-testid={`text-item-cost-${item.id}`}>
                          Costo{item.costIsEstimated ? " (estimado)" : ""}:{" "}
                          {item.costPrice !== null
                            ? `${item.quantity} x ${format(item.costPrice)} = ${format(item.quantity * item.costPrice)}`
                            : "No disponible"}
                        </p>
                      </div>
                      <p className="font-medium tabular-nums shrink-0">{format(item.quantity * item.price)}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{format(sale.subtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-destructive">
                      <span>Descuento</span>
                      <span>− {format(discountAmount)}</span>
                    </div>
                  )}
                  {surchargeAmount > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                      <span>Recargo</span>
                      <span>+ {format(surchargeAmount)}</span>
                    </div>
                  )}
                  {!!sale.shippingCharged && sale.shippingCharged > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Envío cobrado</span>
                      <span>{format(sale.shippingCharged)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-1 border-t">
                    <span>Total</span>
                    <span data-testid="text-detail-total">{format(sale.total)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Costo de mercadería</span>
                    <span data-testid="text-detail-product-cost">
                      {productCost !== null ? format(productCost) : "No disponible"}
                    </span>
                  </div>
                  {sale.shippingCost !== null && sale.shippingCost !== undefined && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Costo real de envío</span>
                      <span>{format(sale.shippingCost)}</span>
                    </div>
                  )}
                  {sale.ingresosBrutos !== null && sale.ingresosBrutos !== undefined && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Ingresos Brutos</span>
                      <span>{format(sale.ingresosBrutos)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Ganancia</span>
                    <span>{hasEstimatedCost ? "≈ " : ""}{format(sale.profit)}</span>
                  </div>
                  {hasEstimatedCost && (
                    <p className="text-xs text-muted-foreground -mt-1">
                      Ganancia estimada: falta el costo de algún producto.
                    </p>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>Método de pago</span>
                    <span className="capitalize">{sale.paymentMethod}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-muted-foreground">Cuotas</p>
                  {sale.installments.map((inst) => (
                    <div
                      key={inst.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                      data-testid={`row-installment-${inst.id}`}
                    >
                      <div>
                        <p className="font-medium">
                          Cuota {inst.installmentNumber} · {format(inst.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Vence {parseLocalDate(inst.dueDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={inst.status === "pagado" ? "default" : "outline"}>
                          {installmentStatusLabels[inst.status] ?? inst.status}
                        </Badge>
                        {!isCancelled && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={installmentMutation.isPending}
                            onClick={() =>
                              installmentMutation.mutate({
                                installmentId: inst.id,
                                status: inst.status === "pagado" ? "pendiente" : "pagado",
                              })
                            }
                            data-testid={`button-toggle-installment-${inst.id}`}
                          >
                            {inst.status === "pagado" ? "Marcar pendiente" : "Marcar pagada"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {sale.notes && (
                  <div className="flex items-start gap-3 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{sale.notes}</span>
                  </div>
                )}
              </>
            ) : null}
          </div>

          <DialogFooter className="border-t pt-4 flex-wrap gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-sale-detail">
              Cerrar
            </Button>
            {sale && !isCancelled && (
              <>
                {/* Prompt 6: "edición inteligente" ya permite editar con cuotas pagadas (las
                   preserva intactas) — el botón ya no se oculta por eso. */}
                <Button variant="outline" onClick={() => onEdit(sale)} data-testid="button-edit-sale">
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </Button>
                {/* Menos peso visual que antes (borde + texto rojo, no un bloque rojo lleno). */}
                <Button
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setCancelConfirmOpen(true)}
                  data-testid="button-cancel-sale"
                >
                  <Ban className="h-4 w-4 mr-2" />
                  Cancelar Venta
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-cancel-sale">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta venta?</AlertDialogTitle>
            <AlertDialogDescription>
              El stock de todos los productos se devuelve automáticamente. La venta no se elimina: queda guardada con
              estado "Cancelada" para historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel-no">No, volver</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                cancelMutation.mutate();
              }}
              disabled={cancelMutation.isPending}
              data-testid="button-confirm-cancel-yes"
            >
              {cancelMutation.isPending ? "Cancelando..." : "Sí, cancelar venta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
