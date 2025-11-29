import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, Package } from "lucide-react";

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface Sale {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  items: SaleItem[];
  total: number;
  profit: number;
  status: "pendiente" | "entregado" | "pagado";
}

interface SaleCardProps {
  sale: Sale;
  onClick?: (sale: Sale) => void;
}

const statusColors: Record<Sale["status"], string> = {
  pendiente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  entregado: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pagado: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusLabels: Record<Sale["status"], string> = {
  pendiente: "Pendiente",
  entregado: "Entregado",
  pagado: "Pagado",
};

export function SaleCard({ sale, onClick }: SaleCardProps) {
  const totalItems = sale.items.reduce((sum, item) => sum + item.quantity, 0);

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
                <span>{sale.date}</span>
              </div>
              <div className="flex items-center gap-1">
                <Package className="h-3 w-3" />
                <span>{totalItems} productos</span>
              </div>
            </div>
          </div>
          <Badge className={statusColors[sale.status]}>
            {statusLabels[sale.status]}
          </Badge>
        </div>
        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <div>
            <p className="text-lg font-bold tabular-nums">${sale.total.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              +${sale.profit.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">ganancia</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
