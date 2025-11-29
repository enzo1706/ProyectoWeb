import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { Product } from "./ProductCard";

interface StockAlertProps {
  products: Product[];
}

export function StockAlert({ products }: StockAlertProps) {
  const lowStockProducts = products.filter(p => p.stock <= p.minStock && p.stock > 0);
  const outOfStockProducts = products.filter(p => p.stock <= 0);

  if (lowStockProducts.length === 0 && outOfStockProducts.length === 0) {
    return null;
  }

  return (
    <Card className="border-destructive/50" data-testid="card-stock-alert">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Alertas de Stock
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {outOfStockProducts.map(product => (
          <div
            key={product.id}
            className="flex items-center justify-between py-1"
            data-testid={`alert-outofstock-${product.id}`}
          >
            <span className="text-sm truncate">{product.name}</span>
            <Badge variant="destructive">Agotado</Badge>
          </div>
        ))}
        {lowStockProducts.map(product => (
          <div
            key={product.id}
            className="flex items-center justify-between py-1"
            data-testid={`alert-lowstock-${product.id}`}
          >
            <span className="text-sm truncate">{product.name}</span>
            <Badge variant="secondary">{product.stock} uds</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
