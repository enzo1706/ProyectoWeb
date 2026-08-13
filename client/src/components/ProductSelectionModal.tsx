import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Minus, Plus, Package } from "lucide-react";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/currency";
import { computeDiscountedCost } from "@shared/saleCalculations";
import { getToneSiblings } from "@/lib/productCategories";
import type { Product } from "@shared/schema";
import type { OrderLine } from "./SaleOrderTable";

interface ProductSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  allProducts: Product[];
  globalDiscount: number | null;
  onAdd: (line: OrderLine) => void;
}

export function ProductSelectionModal({
  open,
  onOpenChange,
  product,
  allProducts,
  globalDiscount,
  onAdd,
}: ProductSelectionModalProps) {
  const { toast } = useToast();
  const [activeProductId, setActiveProductId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [priceInput, setPriceInput] = useState("");

  const toneSiblings = useMemo(
    () => (product ? getToneSiblings(product, allProducts) : []),
    [product, allProducts],
  );
  const hasTones = toneSiblings.length > 1;
  const activeProduct = toneSiblings.find((p) => p.id === activeProductId) ?? product;

  useEffect(() => {
    if (open && product) {
      setActiveProductId(product.id);
      setQuantity(1);
      const cost = globalDiscount !== null ? computeDiscountedCost(product.precio, globalDiscount) : product.precio;
      setPriceInput(String(cost / 100));
    }
  }, [open, product, globalDiscount]);

  const discountMutation = useGuardedMutation({
    mutationFn: async ({ productId, discountPercent }: { productId: number; discountPercent: number }) => {
      const res = await apiRequest("PATCH", `/api/products/${productId}/discount`, { discountPercent });
      return res.json() as Promise<Product>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (err: Error) => {
      toast({
        title: "No se pudo guardar el descuento de compra",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (!activeProduct) return null;

  const maxQty = Math.max(activeProduct.unidades, 0);
  const outOfStock = maxQty === 0;
  const priceCents = priceInput ? Math.round(Number(priceInput) * 100) : 0;
  const subtotal = priceCents * quantity;
  const exceedsStock = quantity > maxQty;

  const adjust = (delta: number) => {
    setQuantity((q) => {
      const next = q + delta;
      if (next < 1) return 1;
      if (maxQty > 0 && next > maxQty) return maxQty;
      return next;
    });
  };

  const handleToneChange = (id: string) => {
    const next = toneSiblings.find((p) => p.id === Number(id));
    if (!next) return;
    setActiveProductId(next.id);
    setQuantity(1);
    const cost = globalDiscount !== null ? computeDiscountedCost(next.precio, globalDiscount) : next.precio;
    setPriceInput(String(cost / 100));
  };

  const handleAdd = () => {
    if (outOfStock || exceedsStock || priceCents < 0 || quantity < 1) return;

    if (globalDiscount !== null) {
      discountMutation.mutate({ productId: activeProduct.id, discountPercent: globalDiscount });
    }

    onAdd({
      productId: activeProduct.id,
      productName: activeProduct.producto,
      category: activeProduct.seccion,
      imagen: activeProduct.imagen,
      originalPrice: activeProduct.precio,
      quantity,
      maxQuantity: activeProduct.unidades,
      mode: "manualPrice",
      adjustmentValue: priceCents,
    });

    toast({ title: "Producto agregado a la venta" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-product-selection">
        <DialogHeader>
          <DialogTitle>{activeProduct.producto}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
          <div className="flex items-center gap-2">
            {activeProduct.imagen ? (
              <img src={activeProduct.imagen} alt={activeProduct.producto} className="h-14 w-14 rounded-md object-cover shrink-0" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-md bg-muted shrink-0">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-mono truncate">{activeProduct.codigo}</p>
              {activeProduct.puntos > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-xs mt-1">
                  {activeProduct.puntos} pts
                </Badge>
              )}
            </div>
          </div>

          {hasTones && (
            <div className="space-y-1.5">
              <Label>Tono</Label>
              <Select value={String(activeProduct.id)} onValueChange={handleToneChange}>
                <SelectTrigger data-testid="select-product-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {toneSiblings.map((sibling) => (
                    <SelectItem key={sibling.id} value={String(sibling.id)}>
                      {sibling.variante}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Cantidad</Label>
            <div className="flex w-full items-center justify-between rounded-lg border bg-muted p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => adjust(-1)}
                disabled={quantity <= 1 || outOfStock}
                aria-label="Disminuir cantidad"
                data-testid="button-modal-qty-minus"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="min-w-[2rem] text-center font-semibold tabular-nums" data-testid="text-modal-qty">
                {quantity}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => adjust(1)}
                disabled={outOfStock || quantity >= maxQty}
                aria-label="Aumentar cantidad"
                data-testid="button-modal-qty-plus"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {outOfStock ? (
              <p className="text-sm text-destructive">Sin stock disponible.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Stock disponible: {maxQty}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="modal-product-price">Precio</Label>
            <Input
              id="modal-product-price"
              type="number"
              min={0}
              step="0.01"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              data-testid="input-modal-price"
            />
          </div>

          <div className="rounded-lg border bg-muted p-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Precio público</span>
              <span data-testid="text-modal-pvp">{formatPrice(activeProduct.precio)}</span>
            </div>
            {globalDiscount !== null && (
              <div className="flex justify-between text-muted-foreground">
                <span>Descuento aplicado</span>
                <span>{globalDiscount}%</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-1 border-t">
              <span>Subtotal</span>
              <span data-testid="text-modal-subtotal">{formatPrice(subtotal)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock || exceedsStock || priceCents < 0}
            data-testid="button-modal-add"
          >
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
