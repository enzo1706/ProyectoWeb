import { useEffect, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoneyPlain, liveFormatMoneyText, parseMoneyInput } from "@shared/money";

export interface MoneyInputProps {
  /** Valor guardado, en la unidad que indica `unit` — nunca texto. `null` = campo vacío. */
  value: number | null;
  onChange: (value: number | null) => void;
  /**
   * Obligatorio a propósito (Prompt 15): la mayoría de los montos de la app se guardan en
   * CENTAVOS (precio, costo, envío, objetivo, pagos), pero el precio y los cupones de
   * suscripción del admin se guardan en PESOS ENTEROS — unidad distinta de verdad, no un
   * descuido. Mezclar las dos fue un bug real que encontramos (dos formateadores locales en
   * el admin, uno con el mismo nombre que `formatPrice` pero sin dividir por 100). Este prop
   * hace que la unidad de cada campo quede explícita en el código, para que no se repita.
   */
  unit: "cents" | "pesos";
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
  className?: string;
}

function toDisplayPesos(value: number | null, unit: "cents" | "pesos"): number | null {
  if (value === null) return null;
  return unit === "cents" ? value / 100 : value;
}

function toStorageUnits(pesos: number, unit: "cents" | "pesos"): number {
  return unit === "cents" ? Math.round(pesos * 100) : Math.round(pesos);
}

/** Prompt 15, punto 5 — "$ 20.100" mientras se escribe, guarda el número. El "$" es un
 * prefijo fijo fuera del texto editable (nunca se puede borrar ni rompe el cursor). Tipear
 * nunca usa "." (lo inserta este componente solo); pegar un monto con "." sí se interpreta
 * bien vía `parseMoneyInput` (ver `onPaste`), incluido el caso "20.5" = 20,5 decimal. */
export function MoneyInput({ value, onChange, unit, placeholder, disabled, id, className, ...rest }: MoneyInputProps) {
  const [text, setText] = useState<string>(() => {
    const pesos = toDisplayPesos(value, unit);
    return pesos === null ? "" : formatMoneyPlain(pesos);
  });

  useEffect(() => {
    const pesos = toDisplayPesos(value, unit);
    if (pesos === null) {
      setText("");
      return;
    }
    // No resincroniza si el texto ya representa este mismo valor — evita pisar lo que la
    // consultora está tipeando (ej. "1.250," todavía sin los centavos, que ya vale 1250).
    setText((current) => (parseMoneyInput(current) === pesos ? current : formatMoneyPlain(pesos)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit]);

  const applyText = (nextText: string) => {
    setText(nextText);
    if (nextText.trim() === "") {
      onChange(null);
      return;
    }
    onChange(toStorageUnits(parseMoneyInput(nextText), unit));
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyText(liveFormatMoneyText(e.target.value));
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.trim()) return;
    e.preventDefault();
    applyText(formatMoneyPlain(parseMoneyInput(pasted)));
  };

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
      <Input
        id={id}
        inputMode="decimal"
        className="pl-7"
        value={text}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder={placeholder}
        disabled={disabled}
        {...rest}
      />
    </div>
  );
}
