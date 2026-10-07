import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHideMoney } from "@/hooks/use-hide-money";
import { cn } from "@/lib/utils";
import { installmentsSumMatches } from "@shared/saleCalculations";
import { installmentOptions } from "@shared/schema";

interface SaleInstallmentsEditorProps {
  total: number;
  count: number;
  onCountChange: (count: number) => void;
  amounts: number[];
  onAmountChange: (index: number, amountInCents: number) => void;
  // Prompt 6: con tarjeta el backend siempre cobra todo en una sola cuota real — el desglose
  // por cuota deja de tener sentido ahí, se oculta (la cantidad elegida queda solo como dato).
  hideAmounts?: boolean;
}

export function SaleInstallmentsEditor({
  total,
  count,
  onCountChange,
  amounts,
  onAmountChange,
  hideAmounts = false,
}: SaleInstallmentsEditorProps) {
  const { format } = useHideMoney();
  const sum = amounts.reduce((s, a) => s + a, 0);
  const matches = installmentsSumMatches(amounts, total);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>¿En cuántos pagos?</Label>
        <Select value={String(count)} onValueChange={(v) => onCountChange(Number(v))}>
          <SelectTrigger data-testid="select-installments-count">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {installmentOptions.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n === 1 ? "Pago único" : `${n} pagos`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {count > 1 && !hideAmounts && (
        <div className="space-y-2">
          {amounts.map((amount, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-16 shrink-0">Cuota {index + 1}</span>
              <Input
                type="number"
                min={0}
                value={amount / 100}
                onChange={(e) => onAmountChange(index, Math.round((Number(e.target.value) || 0) * 100))}
                data-testid={`input-installment-${index}`}
              />
            </div>
          ))}
          <div className={cn("flex justify-between text-sm pt-1", matches ? "text-muted-foreground" : "text-destructive font-medium")}>
            <span>Suma de cuotas</span>
            <span>
              {format(sum)} / {format(total)}
            </span>
          </div>
          {!matches && (
            <p className="text-xs text-destructive" data-testid="error-installments-mismatch">
              La suma de las cuotas debe ser exactamente igual al total de la venta
            </p>
          )}
        </div>
      )}
    </div>
  );
}
