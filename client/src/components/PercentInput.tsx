import { useEffect, useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parsePercentInput } from "@shared/money";

export interface PercentInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
  className?: string;
}

/** Prompt 15, punto 5 (último ítem) — campo de porcentaje que acepta "," o "." como decimal
 * (a diferencia de `MoneyInput`, nunca hay separador de miles que desambiguar). */
export function PercentInput({ value, onChange, placeholder, disabled, id, className, ...rest }: PercentInputProps) {
  const [text, setText] = useState<string>(() => (value === null ? "" : String(value).replace(".", ",")));

  useEffect(() => {
    if (value === null) {
      setText("");
      return;
    }
    setText((current) => (parsePercentInput(current) === value ? current : String(value).replace(".", ",")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d.,]/g, "");
    setText(raw);
    onChange(raw.trim() === "" ? null : parsePercentInput(raw));
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        inputMode="decimal"
        className="pr-7"
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        {...rest}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
    </div>
  );
}
