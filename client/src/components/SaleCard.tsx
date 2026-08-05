import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, Package } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import type { Sale as BaseSale, SaleItem } from "@shared/schema";

export type { SaleItem };

export interface Sale extends BaseSale {
  itemCount: number;
}

interface SaleCardProps {
  sale: Sale;
  onClick?: (sale: Sale) => void;
}

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  entregado: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pagado: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  entregado: "Entregado",
  pagado: "Pagado",
};

function formatSaleDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function SaleCard({ sale, onClick }: SaleCardProps) {
  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => onClick?.(sale)}
      data-testid={`card-sale-${sale.id}`}
    >
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium truncate">{sale.clientName}</span>
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
          <Badge className={statusColors[sale.status] ?? statusColors.pendiente}>
            {statusLabels[sale.status] ?? sale.status}
          </Badge>
        </div>
        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <div>
            <p className="text-lg font-bold tabular-nums">{formatPrice(sale.total)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              +{formatPrice(sale.profit)}
            </p>
            <p className="text-xs text-muted-foreground">ganancia</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
