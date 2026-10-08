import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHideMoney } from "@/hooks/use-hide-money";
import { isLowStock, isReminderActive } from "@shared/stockAlerts";
import { toDateStr } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Package, Pencil, AlertTriangle, ChevronDown } from "lucide-react";
import type { Product } from "@shared/schema";

function LowStockAlert({ productId }: { productId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 text-amber-600 dark:text-amber-400"
          aria-label="Stock bajo"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          data-testid={`button-low-stock-alert-${productId}`}
        >
          <AlertTriangle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto px-2.5 py-1.5 text-xs" data-testid={`popover-low-stock-${productId}`}>
        Stock bajo
      </PopoverContent>
    </Popover>
  );
}

/** Fila de un producto puntual (sin tonos, o un tono dentro de un grupo expandido). Prompt 4:
 * solo foto, nombre, precio/costo, unidades, puntos, alerta de poco stock y el lápiz — nada
 * más se toca ni abre nada (la venta rápida desde Stock se saca, se piensa más adelante). */
export function ProductRow({
  product,
  onEdit,
  showPrice,
  compact = false,
}: {
  product: Product;
  onEdit: (product: Product) => void;
  showPrice: boolean;
  compact?: boolean;
}) {
  const { format } = useHideMoney();
  // Mismo criterio que ya existía: un recordatorio de compra activo suprime el ícono de poco
  // stock (ya se avisó, no hace falta insistir en la fila).
  const lowStock =
    isLowStock(product.unidades, product.effectiveStockMinimo) &&
    !isReminderActive(product.remindStockAt, toDateStr(new Date()));
  const amount = showPrice ? product.effectivePrecio : (product.costPrice ?? 0);
  const isEstimatedCost = !showPrice && product.costPrice === null;

  return (
    <div
      className={cn("flex items-center gap-3 px-3 py-2.5", compact && "pl-4")}
      data-testid={`row-product-${product.id}`}
    >
      {!compact && (
        product.imagen ? (
          <img
            src={product.imagen}
            alt={product.producto}
            className="h-11 w-11 rounded-md object-cover shrink-0"
            data-testid={`image-product-${product.id}`}
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted shrink-0">
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
        )
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm whitespace-normal break-words" data-testid={`text-name-${product.id}`}>
          {compact ? product.variante : product.producto}
        </p>
        {!compact && (
          <p className="text-xs text-muted-foreground truncate">
            {product.linea ? `${product.seccion} · ${product.linea}` : product.seccion}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-right">
        <div className="flex items-center gap-1.5">
          {product.puntos > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-[10px] px-1.5 py-0">
              {product.puntos} pts
            </Badge>
          )}
          <span className="text-sm font-semibold" data-testid={`text-amount-${product.id}`}>
            {isEstimatedCost ? "≈ " : ""}
            {format(amount)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {lowStock && <LowStockAlert productId={product.id} />}
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap" data-testid={`text-units-${product.id}`}>
            {product.unidades} {product.unidades === 1 ? "unidad" : "unidades"}
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        title="Editar producto"
        aria-label="Editar producto"
        onClick={() => onEdit(product)}
        data-testid={`button-edit-${product.id}`}
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Un producto sin tonos se renderiza directo como ProductRow. Un producto con tonos se
 * agrupa en una sola fila expandible con el stock total y, al desplegar, una fila por tono. */
export function ProductGroup({
  members,
  onEdit,
  showPrice,
}: {
  members: Product[];
  onEdit: (product: Product) => void;
  showPrice: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (members.length === 1) {
    return <ProductRow product={members[0]} onEdit={onEdit} showPrice={showPrice} />;
  }

  const primary = members[0];
  const totalUnidades = members.reduce((sum, m) => sum + m.unidades, 0);
  const today = toDateStr(new Date());
  const anyLowStock = members.some((m) => isLowStock(m.unidades, m.effectiveStockMinimo) && !isReminderActive(m.remindStockAt, today));

  return (
    <div data-testid={`group-product-${primary.id}`}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 hover-elevate cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        data-testid={`row-group-${primary.id}`}
      >
        {primary.imagen ? (
          <img
            src={primary.imagen}
            alt={primary.producto}
            className="h-11 w-11 rounded-md object-cover shrink-0"
            data-testid={`image-product-${primary.id}`}
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted shrink-0">
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm whitespace-normal break-words">{primary.producto}</p>
          <p className="text-xs text-muted-foreground truncate">
            {primary.linea ? `${primary.seccion} · ${primary.linea}` : primary.seccion}
            {" · "}
            {members.length} tonos
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {anyLowStock && <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          <span className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
            {totalUnidades} {totalUnidades === 1 ? "unidad" : "unidades"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={expanded ? "Ocultar tonos" : "Ver tonos"}
            aria-label={expanded ? "Ocultar tonos" : "Ver tonos"}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            data-testid={`button-toggle-tones-${primary.id}`}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="divide-y border-t bg-muted/20" data-testid={`tones-${primary.id}`}>
          {members.map((m) => (
            <ProductRow key={m.id} product={m} onEdit={onEdit} showPrice={showPrice} compact />
          ))}
        </div>
      )}
    </div>
  );
}
