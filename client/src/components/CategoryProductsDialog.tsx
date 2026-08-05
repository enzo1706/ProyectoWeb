import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Package, PackageOpen } from "lucide-react";
import { formatPrice } from "@/lib/currency";

export interface TopProductByCategory {
  productId: number | null;
  productName: string;
  category: string;
  imagen: string | null;
  quantitySold: number;
  totalSales: number;
}

interface CategoryProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: string | null;
  products: TopProductByCategory[];
}

export function CategoryProductsDialog({ open, onOpenChange, category, products }: CategoryProductsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-category-products">
        <DialogHeader>
          <DialogTitle>Más vendidos {category ? `— ${category}` : ""}</DialogTitle>
        </DialogHeader>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <PackageOpen className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Todavía no hay ventas registradas en esta categoría</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {products.map((product) => (
              <div
                key={product.productId ?? product.productName}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid={`row-category-product-${product.productId ?? product.productName}`}
              >
                {product.imagen ? (
                  <img
                    src={product.imagen}
                    alt={product.productName}
                    className="h-10 w-10 rounded-md object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted shrink-0">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.quantitySold} vendido{product.quantitySold !== 1 ? "s" : ""}
                  </p>
                </div>
                <p className="text-lg font-bold tabular-nums shrink-0">{formatPrice(product.totalSales)}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
