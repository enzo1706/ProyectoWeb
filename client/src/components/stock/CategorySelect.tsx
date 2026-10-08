import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEW_CATEGORY_OPTION = "__new_category";

/** Selector de categoría: las que ya existen en el catálogo + "+ Nueva categoría" (Prompt 4,
 * punto 6) — reemplaza el Input de texto libre que dejaba crear una categoría nueva "de
 * casualidad" con cualquier typo. Si `value` no está en `categories` (ej. al editar un
 * producto cuya categoría no tiene ningún otro producto), arranca directo en modo "nueva" con
 * ese valor ya cargado, para no perderlo. */
export function CategorySelect({
  categories,
  value,
  onChange,
  testIdPrefix,
}: {
  categories: string[];
  value: string;
  onChange: (value: string) => void;
  testIdPrefix: string;
}) {
  const [creatingNew, setCreatingNew] = useState(() => value !== "" && !categories.includes(value));

  if (creatingNew) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Nombre de la categoría"
        autoFocus
        data-testid={`input-${testIdPrefix}-new`}
      />
    );
  }

  return (
    <Select
      value={categories.includes(value) ? value : undefined}
      onValueChange={(v) => {
        if (v === NEW_CATEGORY_OPTION) {
          setCreatingNew(true);
          onChange("");
          return;
        }
        onChange(v);
      }}
    >
      <SelectTrigger data-testid={`select-${testIdPrefix}`}>
        <SelectValue placeholder="Elegí una categoría" />
      </SelectTrigger>
      <SelectContent>
        {categories.map((c) => (
          <SelectItem key={c} value={c} data-testid={`option-${testIdPrefix}-${c}`}>
            {c}
          </SelectItem>
        ))}
        <SelectItem value={NEW_CATEGORY_OPTION} data-testid={`option-${testIdPrefix}-new`}>
          + Nueva categoría
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
