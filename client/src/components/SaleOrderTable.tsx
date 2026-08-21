import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Package, Pencil, X } from "lucide-react";
import { useHideMoney } from "@/hooks/use-hide-money";
import { computeItemFinalPrice, type ItemAdjustmentMode } from "@shared/saleCalculations";

export interface OrderLine {
  productId: number;
  productName: string;
  category: string;
  imagen: string | null;
  originalPrice: number;
  quantity: number;
  maxQuantity: number;
  mode: ItemAdjustmentMode;
  adjustmentValue: number | null;
}

export function getLineFinalPrice(line: OrderLine): number {
  return computeItemFinalPrice(line.originalPrice, line.mode, line.adjustmentValue);
}

interface SaleOrderTableProps {
  lines: OrderLine[];
  onEdit: (productId: number) => void;
  onRemove: (productId: number) => void;
}

export function SaleOrderTable({ lines, onEdit, onRemove }: SaleOrderTableProps) {
  const { format } = useHideMoney();
  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="empty-order">
        Agregá productos desde el catálogo de arriba
      </div>
    );
  }

  return (
    <>
      {/* Desktop/tablet: real table */}
      <div className="hidden sm:block rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14"></TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="text-center">Cantidad</TableHead>
              <TableHead className="text-right">Precio unitario</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const finalPrice = getLineFinalPrice(line);
              const adjusted = finalPrice !== line.originalPrice;
              return (
                <TableRow key={line.productId} data-testid={`order-row-${line.productId}`}>
                  <TableCell>
                    {line.imagen ? (
                      <img src={line.imagen} alt={line.productName} className="h-10 w-10 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{line.productName}</TableCell>
                  <TableCell className="text-center tabular-nums">{line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {adjusted ? (
                      <div>
                        <span className="line-through text-muted-foreground text-xs mr-1">{format(line.originalPrice)}</span>
                        <span>{format(finalPrice)}</span>
                      </div>
                    ) : (
                      format(finalPrice)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums" data-testid={`text-order-subtotal-${line.productId}`}>
                    {format(finalPrice * line.quantity)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(line.productId)}
                        title={`Editar ${line.productName}`}
                        aria-label={`Editar ${line.productName}`}
                        data-testid={`button-edit-order-item-${line.productId}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(line.productId)}
                        title={`Quitar ${line.productName}`}
                        aria-label={`Quitar ${line.productName}`}
                        data-testid={`button-remove-order-item-${line.productId}`}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards, avoids nesting a horizontal scroll inside the dialog's vertical scroll */}
      <div className="sm:hidden space-y-2">
        {lines.map((line) => {
          const finalPrice = getLineFinalPrice(line);
          const adjusted = finalPrice !== line.originalPrice;
          return (
            <div
              key={line.productId}
              className="rounded-lg border p-3 flex gap-3"
              data-testid={`order-row-mobile-${line.productId}`}
            >
              {line.imagen ? (
                <img src={line.imagen} alt={line.productName} className="h-14 w-14 rounded-md object-cover shrink-0" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-md bg-muted shrink-0">
                  <Package className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium truncate">{line.productName}</p>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Cant. {line.quantity}</span>
                  {adjusted ? (
                    <span>
                      <span className="line-through text-xs mr-1">{format(line.originalPrice)}</span>
                      {format(finalPrice)}
                    </span>
                  ) : (
                    <span>{format(finalPrice)}</span>
                  )}
                </div>
                <p className="font-semibold tabular-nums" data-testid={`text-order-subtotal-mobile-${line.productId}`}>
                  {format(finalPrice * line.quantity)}
                </p>
              </div>
              <div className="flex flex-col items-center justify-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(line.productId)}
                  title={`Editar ${line.productName}`}
                  aria-label={`Editar ${line.productName}`}
                  data-testid={`button-edit-order-item-mobile-${line.productId}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(line.productId)}
                  title={`Quitar ${line.productName}`}
                  aria-label={`Quitar ${line.productName}`}
                  data-testid={`button-remove-order-item-mobile-${line.productId}`}
                >
                  <X className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
