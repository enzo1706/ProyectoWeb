import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Package, PackageOpen } from "lucide-react";
import type { Product } from "@shared/schema";

interface LowStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

export function LowStockDialog({ open, onOpenChange, products }: LowStockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-low-stock">
        <DialogHeader>
          <DialogTitle>Productos con bajo Stock</DialogTitle>
        </DialogHeader>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <PackageOpen className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No hay productos con stock bajo</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {products.map((product) => (
              <div
                key={product.id}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid={`row-low-stock-${product.id}`}
              >
                {product.imagen ? (
                  <img
                    src={product.imagen}
                    alt={product.producto}
                    className="h-10 w-10 rounded-md object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted shrink-0">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.producto}</p>
                  <p className="text-xs text-muted-foreground font-mono">{product.codigo}</p>
                  <p className="text-xs text-muted-foreground">{product.seccion}</p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant={product.unidades <= 0 ? "destructive" : "secondary"}>
                    {product.unidades} uds
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">mín. {product.stockMinimo}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
