import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";

export interface OrderReminderItemRow {
  productId: number;
  productName: string;
  soldInPeriod: number;
  pendingFromBefore: number;
  currentStock: number;
  suggestedQuantity: number;
}

/**
 * Prompt 8 (Inicio) + Prompt 12 (Agenda) — la tarjeta rica del día de pedido, compartida para
 * que los dos lugares muestren exactamente lo mismo. `onDismiss` ausente (vista previa del
 * PRÓXIMO día de pedido sin recordatorio abierto todavía, Prompt 12 ajuste 2) oculta "Listo, ya
 * lo pedí" — no hay ninguna fila que cerrar, es una proyección en vivo, no un recordatorio real.
 */
export function OrderReminderCard({
  title,
  subtitle = "Estos productos que vendiste tienen poco stock",
  items,
  onBuildOrder,
  onDismiss,
  isDismissing = false,
  testId = "card-order-reminder",
}: {
  title: string;
  subtitle?: string;
  items: OrderReminderItemRow[];
  onBuildOrder: () => void;
  onDismiss?: () => void;
  isDismissing?: boolean;
  testId?: string;
}) {
  const [showAll, setShowAll] = useState(false);

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <div className="space-y-1.5">
          {(showAll ? items : items.slice(0, 5)).map((item) => (
            <div key={item.productId} className="flex items-center justify-between text-sm" data-testid={`row-order-reminder-${item.productId}`}>
              <span className="break-words">{item.productName}</span>
              <Badge variant="outline">Sugerido: {item.suggestedQuantity}</Badge>
            </div>
          ))}
        </div>
        {!showAll && items.length > 5 && (
          <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setShowAll(true)} data-testid="button-order-reminder-view-all">
            Ver todos
          </button>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" onClick={onBuildOrder} data-testid="button-order-reminder-build">
            Armar pedido con estos productos
          </Button>
          {onDismiss && (
            <Button type="button" variant="outline" disabled={isDismissing} onClick={onDismiss} data-testid="button-order-reminder-dismiss">
              Listo, ya lo pedí
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
