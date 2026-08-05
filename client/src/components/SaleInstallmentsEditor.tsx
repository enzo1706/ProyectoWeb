import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { installmentsSumMatches } from "@shared/saleCalculations";
import { installmentOptions, installmentFrequencies, type InstallmentFrequency } from "@shared/schema";

const frequencyLabels: Record<InstallmentFrequency, string> = {
  semanal: "Semanal",
  mensual: "Mensual",
};

interface SaleInstallmentsEditorProps {
  total: number;
  count: number;
  onCountChange: (count: number) => void;
  amounts: number[];
  onAmountChange: (index: number, amountInCents: number) => void;
  frequency: InstallmentFrequency | null;
  onFrequencyChange: (frequency: InstallmentFrequency) => void;
}

export function SaleInstallmentsEditor({
  total,
  count,
  onCountChange,
  amounts,
  onAmountChange,
  frequency,
  onFrequencyChange,
}: SaleInstallmentsEditorProps) {
  const sum = amounts.reduce((s, a) => s + a, 0);
  const matches = installmentsSumMatches(amounts, total);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Cantidad de pagos</Label>
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
        {count > 1 && (
          <div className="space-y-1.5">
            <Label>Frecuencia</Label>
            <Select value={frequency ?? undefined} onValueChange={(v) => onFrequencyChange(v as InstallmentFrequency)}>
              <SelectTrigger data-testid="select-installments-frequency">
                <SelectValue placeholder="Elegir" />
              </SelectTrigger>
              <SelectContent>
                {installmentFrequencies.map((f) => (
                  <SelectItem key={f} value={f}>
                    {frequencyLabels[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {count > 1 && (
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
              {formatPrice(sum)} / {formatPrice(total)}
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
