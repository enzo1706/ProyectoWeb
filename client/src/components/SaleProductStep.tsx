import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, Plus, Minus, ImagePlus } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { getProductCategories, getToneSiblings } from "@/lib/productCategories";
import { SaleOrderTable, type OrderLine } from "./SaleOrderTable";
import type { Product } from "@shared/schema";

export type ProductSubView = "cart" | "category" | "product" | "tone" | "qty";

export interface SaleProductStepHandle {
  /** Navega un paso hacia atrás DENTRO de esta sección (categoría → producto → tono → cantidad).
   * Devuelve `false` cuando ya no hay a dónde volver acá adentro — el wizard debe entonces
   * retroceder al paso anterior. */
  goBack: () => boolean;
}

interface SaleProductStepProps {
  products: Product[];
  lines: OrderLine[];
  orderedQuantities: Map<number, number>;
  onAddLine: (line: OrderLine) => void;
  onEditLine: (productId: number) => void;
  onRemoveLine: (productId: number) => void;
  subView: ProductSubView;
  onSubViewChange: (view: ProductSubView) => void;
}

export const SaleProductStep = forwardRef<SaleProductStepHandle, SaleProductStepProps>(function SaleProductStep(
  { products, lines, orderedQuantities, onAddLine, onEditLine, onRemoveLine, subView, onSubViewChange },
  ref,
) {
  const categories = useMemo(() => getProductCategories(products), [products]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedTone, setSelectedTone] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [priceInput, setPriceInput] = useState("");

  const toneSiblings = useMemo(
    () => (selectedProduct ? getToneSiblings(selectedProduct, products) : []),
    [selectedProduct, products],
  );
  const hasTones = toneSiblings.length > 1;
  const activeProduct = selectedTone ?? selectedProduct;

  useImperativeHandle(ref, () => ({
    goBack() {
      if (subView === "qty") {
        onSubViewChange(hasTones ? "tone" : "product");
        return true;
      }
      if (subView === "tone") {
        onSubViewChange("product");
        return true;
      }
      if (subView === "product") {
        onSubViewChange("category");
        return true;
      }
      if (subView === "category") {
        if (lines.length > 0) {
          onSubViewChange("cart");
          return true;
        }
        return false;
      }
      return false;
    },
  }));

  const openCategory = (category: string) => {
    setSelectedCategory(category);
    onSubViewChange("product");
  };

  const openProduct = (product: Product) => {
    setSelectedProduct(product);
    setSelectedTone(null);
    setQuantity(1);
    setPriceInput(String(product.precio / 100));
    const siblings = getToneSiblings(product, products);
    onSubViewChange(siblings.length > 1 ? "tone" : "qty");
  };

  const openTone = (tone: Product) => {
    setSelectedTone(tone);
    setQuantity(1);
    setPriceInput(String(tone.precio / 100));
    onSubViewChange("qty");
  };

  const remainingFor = (product: Product) => {
    const ordered = orderedQuantities.get(product.id) ?? 0;
    return product.unidades - ordered;
  };

  const handleAddToCart = () => {
    if (!activeProduct) return;
    const priceCents = priceInput ? Math.round(Number(priceInput) * 100) : activeProduct.precio;
    onAddLine({
      productId: activeProduct.id,
      productName: activeProduct.producto,
      category: activeProduct.seccion,
      imagen: activeProduct.imagen,
      originalPrice: activeProduct.precio,
      quantity,
      maxQuantity: activeProduct.unidades,
      mode: priceCents === activeProduct.precio ? "none" : "manualPrice",
      adjustmentValue: priceCents === activeProduct.precio ? null : priceCents,
    });
    setSelectedProduct(null);
    setSelectedTone(null);
    onSubViewChange("cart");
  };

  if (subView === "cart") {
    return (
      <div className="space-y-3">
        <SaleOrderTable lines={lines} onEdit={onEditLine} onRemove={onRemoveLine} />
        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed h-12"
          onClick={() => onSubViewChange("category")}
          data-testid="button-add-more-products"
        >
          <ImagePlus className="h-4 w-4 mr-2" />
          Agregar producto
        </Button>
      </div>
    );
  }

  if (subView === "category") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Elegí una categoría</p>
        <div className="grid grid-cols-2 gap-3">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => openCategory(category)}
              className="flex flex-col items-start gap-2 rounded-xl border bg-muted/40 p-4 text-left hover-elevate active-elevate-2"
              data-testid={`sale-picker-category-${category}`}
            >
              <span className="h-3.5 w-3.5 rounded-full bg-primary" />
              <span className="text-sm font-semibold">{category}</span>
            </button>
          ))}
        </div>
        {categories.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay productos en el catálogo</p>
        )}
      </div>
    );
  }

  if (subView === "product") {
    const visibleProducts = products.filter((p) => p.seccion === selectedCategory);
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{selectedCategory}</p>
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {visibleProducts.map((product) => {
            const remaining = remainingFor(product);
            return (
              <button
                key={product.id}
                type="button"
                disabled={remaining <= 0}
                onClick={() => openProduct(product)}
                className="flex w-full items-center gap-3 rounded-xl border bg-muted/40 p-3 text-left hover-elevate active-elevate-2 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`sale-picker-product-${product.id}`}
              >
                {product.imagen ? (
                  <img src={product.imagen} alt={product.producto} className="h-10 w-10 rounded-md object-cover shrink-0" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted shrink-0">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{product.producto}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(product.precio)} · {remaining <= 0 ? "sin stock" : `${remaining} disp.`}
                  </p>
                </div>
              </button>
            );
          })}
          {visibleProducts.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay productos en esta categoría</p>
          )}
        </div>
      </div>
    );
  }

  if (subView === "tone" && selectedProduct) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Elegí el tono</p>
        <div className="flex flex-wrap gap-3">
          {toneSiblings.map((sibling) => (
            <button
              key={sibling.id}
              type="button"
              disabled={remainingFor(sibling) <= 0}
              onClick={() => openTone(sibling)}
              className="flex flex-col items-center gap-1.5 disabled:opacity-40"
              data-testid={`sale-picker-tone-${sibling.id}`}
            >
              <span
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full border-2",
                  selectedTone?.id === sibling.id ? "border-primary" : "border-transparent bg-muted",
                )}
              >
                {sibling.imagen ? (
                  <img src={sibling.imagen} alt={sibling.variante} className="h-full w-full rounded-full object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
              <span className="text-xs text-muted-foreground">{sibling.variante}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (subView === "qty" && activeProduct) {
    const maxQty = Math.max(remainingFor(activeProduct), 0);
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-foreground">
          {activeProduct.producto}
          {selectedTone ? ` — ${selectedTone.variante}` : ""}
        </p>
        <div className="flex items-center justify-between rounded-xl border bg-muted/40 p-3">
          <span className="text-sm">Cantidad</span>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="Disminuir cantidad"
              data-testid="button-step-qty-minus"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-[1.5rem] text-center font-semibold tabular-nums" data-testid="text-step-qty">
              {quantity}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setQuantity((q) => Math.min(Math.max(maxQty, 1), q + 1))}
              disabled={quantity >= maxQty}
              aria-label="Aumentar cantidad"
              data-testid="button-step-qty-plus"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {maxQty <= 0 ? (
          <p className="text-sm text-destructive">Sin stock disponible para este producto.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Stock disponible: {maxQty}</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="step-price">Precio de venta</Label>
          <Input
            id="step-price"
            type="number"
            min={0}
            step="0.01"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            data-testid="input-step-price"
          />
        </div>
        <Button
          type="button"
          className="h-12 w-full"
          onClick={handleAddToCart}
          disabled={maxQty <= 0 || quantity > maxQty}
          data-testid="button-step-add-to-cart"
        >
          Agregar al carrito
        </Button>
      </div>
    );
  }

  return null;
});
