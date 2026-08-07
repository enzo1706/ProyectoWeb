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
import { User, Calendar, FileText, AlertTriangle, Pencil, Ban } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/currency";
import type { SaleDetails } from "./SaleCard";

interface SaleDetailDialogProps {
  saleId: number | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (sale: SaleDetails) => void;
}

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  entregado: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pagado: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelada: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  entregado: "Entregado",
  pagado: "Pagado",
  cancelada: "Cancelada",
};

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
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/top"] });
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

  const open = saleId !== null;
  const sale = saleQuery.data;
  const isCancelled = sale?.status === "cancelada";

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-sale-detail">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {sale ? (
                <>
                  <span>Venta #{sale.id}</span>
                  <Badge className={statusColors[sale.status] ?? statusColors.pendiente}>
                    {statusLabels[sale.status] ?? sale.status}
                  </Badge>
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
                          {item.quantity} x {formatPrice(item.price)}
                        </p>
                      </div>
                      <p className="font-medium tabular-nums shrink-0">{formatPrice(item.quantity * item.price)}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatPrice(sale.subtotal)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t">
                    <span>Total</span>
                    <span data-testid="text-detail-total">{formatPrice(sale.total)}</span>
                  </div>
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Ganancia</span>
                    <span>{formatPrice(sale.profit)}</span>
                  </div>
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
                          Cuota {inst.installmentNumber} · {formatPrice(inst.amount)}
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
                <Button variant="outline" onClick={() => onEdit(sale)} data-testid="button-edit-sale">
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </Button>
                <Button variant="destructive" onClick={() => setCancelConfirmOpen(true)} data-testid="button-cancel-sale">
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
