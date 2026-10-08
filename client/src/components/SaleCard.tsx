import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Calendar, Package } from "lucide-react";
import { useHideMoney } from "@/hooks/use-hide-money";
import { onActivationKeyDown } from "@/lib/utils";
import type { Sale as BaseSale, SaleItem, SaleInstallment } from "@shared/schema";

export type { SaleItem, SaleInstallment };

export interface Sale extends BaseSale {
  itemCount: number;
  // Prompt 2: true si alguna línea de esta venta tiene costo estimado — se muestra con "≈".
  hasEstimatedCost: boolean;
  // Prompt 6: derivados de sale_installments en el servidor (ver storage.getAllSales) — nunca
  // se recalculan acá, para no duplicar la lógica de qué es "cobrada".
  paymentStatus: "cobrada" | "te_debe";
  pendingAmount: number;
  nextDueDate: string | null;
}

/** Venta con el detalle completo (ítems + cuotas), tal como la devuelve GET /api/sales/:id. */
export interface SaleDetails extends BaseSale {
  items: SaleItem[];
  installments: SaleInstallment[];
}

interface SaleCardProps {
  sale: Sale;
  onClick?: (sale: Sale) => void;
  // Prompt 6, punto 1 — solo tiene efecto visible cuando `sale.clientId` es `null` ("Sin
  // clienta", venta creada con "Completar después").
  onAssignClient?: (sale: Sale) => void;
}

// Prompt 6: dos etiquetas separadas (pago/entrega) en vez de un único "status" que mezclaba
// las dos cosas — "cancelada" sigue siendo la única excepción que pisa a las demás.
const paymentColors: Record<"cobrada" | "te_debe", string> = {
  cobrada: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  te_debe: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

const cancelledColor = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";

function formatSaleDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function SaleCard({ sale, onClick, onAssignClient }: SaleCardProps) {
  const { format } = useHideMoney();
  const isCancelled = sale.status === "cancelada";
  const isPendingDelivery = !isCancelled && sale.deliveryStatus === "pendiente_entrega";
  const hasNoClient = sale.clientId === null;
  return (
    <Card
      className={`hover-elevate cursor-pointer ${isCancelled ? "opacity-60" : ""}`}
      onClick={() => onClick?.(sale)}
      role="button"
      tabIndex={0}
      onKeyDown={onActivationKeyDown(() => onClick?.(sale))}
      data-testid={`card-sale-${sale.id}`}
    >
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{sale.clientName}</span>
              {hasNoClient && !isCancelled && onAssignClient && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-xs underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssignClient(sale);
                  }}
                  data-testid={`button-assign-client-${sale.id}`}
                >
                  Asignar clienta
                </Button>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span>{formatSaleDate(sale.date)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Package className="h-3 w-3" />
                <span>{sale.itemCount} producto{sale.itemCount !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isCancelled ? (
              <Badge className={cancelledColor}>Cancelada</Badge>
            ) : (
              <Badge className={paymentColors[sale.paymentStatus]}>
                {sale.paymentStatus === "cobrada" ? "Cobrada" : `Te debe ${format(sale.pendingAmount)}`}
              </Badge>
            )}
            {isPendingDelivery && (
              <Badge variant="outline" className="text-xs">
                Pendiente de entrega
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <div>
            <p className="text-lg font-bold tabular-nums">{format(sale.total)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              +{sale.hasEstimatedCost ? "≈ " : ""}{format(sale.profit)}
            </p>
            <p className="text-xs text-muted-foreground">ganancia</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
