import { useEffect, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useHideMoney } from "@/hooks/use-hide-money";
import { computeItemFinalPrice, type ItemAdjustmentMode } from "@shared/saleCalculations";
import type { OrderLine } from "./SaleOrderTable";

interface EditSaleItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: OrderLine | null;
  onSave: (updated: OrderLine) => void;
}

export function EditSaleItemDialog({ open, onOpenChange, line, onSave }: EditSaleItemDialogProps) {
  const { format } = useHideMoney();
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState<ItemAdjustmentMode>("none");
  const [adjustmentInput, setAdjustmentInput] = useState("");

  useEffect(() => {
    if (line) {
      setQuantity(line.quantity);
      setMode(line.mode);
      setAdjustmentInput(line.adjustmentValue !== null ? String(line.adjustmentValue) : "");
    }
  }, [line]);

  if (!line) return null;

  const adjustmentValue = adjustmentInput ? Number(adjustmentInput) : null;
  const finalPrice = computeItemFinalPrice(line.originalPrice, mode, adjustmentValue);
  const subtotal = finalPrice * quantity;

  const handleSave = () => {
    onSave({
      ...line,
      quantity,
      mode,
      adjustmentValue: mode === "none" ? null : adjustmentValue,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-edit-sale-item">
        <DialogHeader>
          <DialogTitle>{line.productName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-item-quantity">Cantidad</Label>
            <Input
              id="edit-item-quantity"
              type="number"
              min={1}
              max={line.maxQuantity}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(line.maxQuantity, Number(e.target.value) || 1)))}
              data-testid="input-edit-item-quantity"
            />
          </div>

          <div className="space-y-2">
            <Label>Ajuste de precio</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as ItemAdjustmentMode)}>
              <div className="flex items-center gap-2 min-h-11">
                <RadioGroupItem value="none" id="mode-none" />
                <Label htmlFor="mode-none" className="flex-1 py-2 cursor-pointer font-normal">Sin ajuste</Label>
              </div>
              <div className="flex items-center gap-2 min-h-11">
                <RadioGroupItem value="discountPercent" id="mode-discount" />
                <Label htmlFor="mode-discount" className="flex-1 py-2 cursor-pointer font-normal">Descuento %</Label>
              </div>
              <div className="flex items-center gap-2 min-h-11">
                <RadioGroupItem value="surchargePercent" id="mode-surcharge" />
                <Label htmlFor="mode-surcharge" className="flex-1 py-2 cursor-pointer font-normal">Recargo %</Label>
              </div>
              <div className="flex items-center gap-2 min-h-11">
                <RadioGroupItem value="manualPrice" id="mode-manual" />
                <Label htmlFor="mode-manual" className="flex-1 py-2 cursor-pointer font-normal">Precio manual</Label>
              </div>
            </RadioGroup>
            {mode !== "none" && (
              <Input
                type="number"
                min={0}
                placeholder={mode === "manualPrice" ? "Precio final" : "Porcentaje"}
                value={adjustmentInput}
                onChange={(e) => setAdjustmentInput(e.target.value)}
                data-testid="input-edit-item-adjustment"
              />
            )}
          </div>

          <div className="rounded-lg border bg-muted p-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Precio original</span>
              <span>{format(line.originalPrice)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Precio final</span>
              <span data-testid="text-edit-item-final-price">{format(finalPrice)}</span>
            </div>
            <div className="flex justify-between font-bold pt-1 border-t">
              <span>Subtotal</span>
              <span data-testid="text-edit-item-subtotal">{format(subtotal)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} data-testid="button-save-edit-item">
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
