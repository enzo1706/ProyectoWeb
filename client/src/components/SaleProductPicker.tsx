import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, Plus } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { Product } from "@shared/schema";

interface SaleProductPickerProps {
  products: Product[];
  orderedQuantities: Map<number, number>;
  onAdd: (product: Product) => void;
}

export function SaleProductPicker({ products, orderedQuantities, onAdd }: SaleProductPickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.seccion))).sort(),
    [products],
  );

  useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0]);
    }
  }, [categories, selectedCategory]);

  const visibleProducts = products.filter((p) => p.seccion === selectedCategory);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        {categories.map((category) => {
          const active = selectedCategory === category;
          return (
            <Badge
              key={category}
              role="button"
              tabIndex={0}
              variant={active ? "default" : "outline"}
              onClick={() => setSelectedCategory(category)}
              className={cn("cursor-pointer select-none px-3.5 py-2 active-elevate-2", active ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-card")}
              data-testid={`sale-picker-category-${category}`}
            >
              {category}
            </Badge>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
        {visibleProducts.map((product) => {
          const ordered = orderedQuantities.get(product.id) ?? 0;
          const remaining = product.unidades - ordered;
          return (
            <div
              key={product.id}
              className="flex items-center gap-3 rounded-lg border p-2"
              data-testid={`sale-picker-product-${product.id}`}
            >
              {product.imagen ? (
                <img src={product.imagen} alt={product.producto} className="h-12 w-12 rounded-md object-cover shrink-0" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted shrink-0">
                  <Package className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{product.producto}</p>
                <p className="text-xs text-muted-foreground font-mono">{product.codigo}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-semibold text-primary">{formatPrice(product.precio)}</span>
                  <span className={cn("text-xs", remaining <= 0 ? "text-destructive" : "text-muted-foreground")}>
                    {remaining} disp.
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={remaining <= 0}
                onClick={() => onAdd(product)}
                data-testid={`button-add-product-${product.id}`}
              >
                <Plus className="h-4 w-4 mr-1" />
                1
              </Button>
            </div>
          );
        })}
        {visibleProducts.length === 0 && (
          <p className="col-span-full text-center text-sm text-muted-foreground py-6">
            No hay productos en esta categoría
          </p>
        )}
      </div>
    </div>
  );
}
