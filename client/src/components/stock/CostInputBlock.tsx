import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form";
import { discountOptions } from "@shared/schema";
import { computeDiscountedCost } from "@shared/saleCalculations";
import { useHideMoney } from "@/hooks/use-hide-money";
import { cn } from "@/lib/utils";

export type CostInputMode = "none" | "percent" | "direct";

export interface CostInputValue {
  mode: CostInputMode;
  percent: number | null;
  direct: string;
}

export const EMPTY_COST_INPUT: CostInputValue = { mode: "none", percent: null, direct: "" };

/** Resuelve qué llamada hacer al guardar: un % (POST/PATCH .../discount) o un costo directo en
 * pesos ya convertido a centavos (PATCH .../cost) — o `null` si no se completó ninguno de los
 * dos (el caller decide qué hacer: el formulario manual muestra el aviso de "sin costo", Editar
 * producto simplemente no toca el costo existente). */
export function resolveCostInputForSubmit(value: CostInputValue): { discountPercent: number } | { costPrice: number } | null {
  if (value.mode === "percent" && value.percent !== null) {
    return { discountPercent: value.percent };
  }
  if (value.mode === "direct" && value.direct.trim() !== "") {
    const centavos = Math.round(Number(value.direct) * 100);
    if (!Number.isFinite(centavos) || centavos <= 0) return null;
    return { costPrice: centavos };
  }
  return null;
}

/** "¿Cuánto te costó?" — bloque reusado tal cual en "Cargar producto manualmente" y en
 * "Editar producto" (Prompt 4, punto 6): elegir uno de los 3 descuentos fijos, o escribir el
 * costo directo en pesos. Elegir uno desactiva al otro — nunca se mandan los dos juntos. */
export function CostInputBlock({
  precioCentavos,
  value,
  onChange,
}: {
  /** Precio de venta, en la misma unidad que guarda la base (centavos) — para mostrar
   * "Te costó $X" al elegir un %. */
  precioCentavos: number;
  value: CostInputValue;
  onChange: (value: CostInputValue) => void;
}) {
  const { format } = useHideMoney();

  return (
    <div className="space-y-3">
      <FormLabel className="text-sm font-medium">¿Cuánto te costó?</FormLabel>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Elegí el descuento que te dieron</p>
        <div className="flex gap-2">
          {discountOptions.map((pct) => (
            <Button
              key={pct}
              type="button"
              variant={value.mode === "percent" && value.percent === pct ? "default" : "outline"}
              size="sm"
              className={cn("flex-1")}
              onClick={() => onChange({ mode: "percent", percent: pct, direct: "" })}
              data-testid={`button-cost-percent-${pct}`}
            >
              {pct}%
            </Button>
          ))}
        </div>
        {value.mode === "percent" && value.percent !== null && precioCentavos > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-cost-percent-preview">
            Te costó {format(computeDiscountedCost(precioCentavos, value.percent))}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">O escribí el costo en pesos</p>
        <Input
          type="number"
          min={0}
          step="0.01"
          placeholder="$"
          value={value.mode === "direct" ? value.direct : ""}
          onChange={(e) => onChange({ mode: "direct", percent: null, direct: e.target.value })}
          data-testid="input-cost-direct"
        />
      </div>
    </div>
  );
}
