import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Package } from "lucide-react";

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
}

interface ProductCardProps {
  product: Product;
  onEdit?: (product: Product) => void;
}

export function ProductCard({ product, onEdit }: ProductCardProps) {
  const stockStatus = product.stock <= 0 
    ? "agotado" 
    : product.stock <= product.minStock 
      ? "bajo" 
      : "normal";

  const stockBadgeVariant = stockStatus === "agotado" 
    ? "destructive" 
    : stockStatus === "bajo" 
      ? "secondary" 
      : "default";

  return (
    <Card className="hover-elevate" data-testid={`card-product-${product.id}`}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground font-mono">{product.sku}</span>
            </div>
            <h3 className="font-medium truncate" data-testid={`text-product-name-${product.id}`}>
              {product.name}
            </h3>
            <p className="text-sm text-muted-foreground">{product.category}</p>
          </div>
          <Badge variant={stockBadgeVariant} className="shrink-0" data-testid={`badge-stock-${product.id}`}>
            {product.stock} uds
          </Badge>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold tabular-nums">${product.price.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Costo: ${product.cost.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              +${(product.price - product.cost).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">ganancia</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => onEdit?.(product)}
          data-testid={`button-edit-product-${product.id}`}
        >
          <Edit className="h-3 w-3 mr-1" />
          Editar
        </Button>
      </CardFooter>
    </Card>
  );
}
