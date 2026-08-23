export interface EventTypeDef {
  value: string;
  label: string;
  colorClass: string;
}

/** Tipos ofrecidos para citas nuevas, en el orden pedido. "entrega" y "demostracion" reusan
 * el mismo valor que ya se guardaba en la base antes de este cambio (solo cambia la etiqueta
 * visible de "Entrega" a "Entrega de productos"), así los registros históricos con esos valores
 * no necesitan ninguna migración de datos. */
export const FIXED_EVENT_TYPES: EventTypeDef[] = [
  { value: "sesion_belleza", label: "Sesión de belleza", colorClass: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200" },
  { value: "capacitacion", label: "Capacitación", colorClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
  { value: "entrega", label: "Entrega de productos", colorClass: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "visita", label: "Visita", colorClass: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" },
  { value: "demostracion", label: "Demostración", colorClass: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
];

/** Valores que existían antes de este cambio y ya no se ofrecen para citas nuevas (no están en
 * la lista pedida), pero se siguen reconociendo y mostrando bien en registros ya creados. */
export const LEGACY_EVENT_TYPES: EventTypeDef[] = [
  { value: "seguimiento", label: "Seguimiento", colorClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "venta", label: "Venta", colorClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
];

export const KNOWN_EVENT_TYPES: EventTypeDef[] = [...FIXED_EVENT_TYPES, ...LEGACY_EVENT_TYPES];

export const CUSTOM_EVENT_TYPE_MAX_LENGTH = 40;

/** Paleta para tipos personalizados, distinta de los colores ya usados por los tipos fijos/legacy. */
const CUSTOM_COLOR_PALETTE = [
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Color determinístico por nombre: el mismo tipo personalizado siempre cae en el mismo color,
 * sin tener que guardar un color elegido en ningún lado. */
export function getCustomEventColorClass(typeValue: string): string {
  return CUSTOM_COLOR_PALETTE[hashString(typeValue) % CUSTOM_COLOR_PALETTE.length];
}

export function getEventTypeLabel(typeValue: string): string {
  return KNOWN_EVENT_TYPES.find((t) => t.value === typeValue)?.label ?? typeValue;
}

export function getEventTypeColorClass(typeValue: string): string {
  return KNOWN_EVENT_TYPES.find((t) => t.value === typeValue)?.colorClass ?? getCustomEventColorClass(typeValue);
}

export function isKnownEventType(typeValue: string): boolean {
  return KNOWN_EVENT_TYPES.some((t) => t.value === typeValue);
}

/** Compara sin importar mayúsculas/minúsculas contra las etiquetas de los tipos fijos/legacy y
 * contra los tipos personalizados que la consultora ya tiene creados, para no crear un tipo
 * casi-duplicado por una diferencia de casing (ej. "Photoshoot" vs "photoshoot"). Si encuentra
 * coincidencia devuelve el valor ya existente tal cual está guardado; si no, devuelve el nombre
 * recortado tal cual lo escribió la consultora (ese pasa a ser el nuevo tipo personalizado). */
export function normalizeCustomEventTypeName(rawName: string, existingCustomTypes: string[]): string {
  const trimmed = rawName.trim();
  const lower = trimmed.toLocaleLowerCase();

  // Si coincide con la etiqueta de un tipo fijo/legacy, se reusa el slug canónico (no la
  // etiqueta) — si no, un "Demostración" escrito a mano quedaría como un tipo nuevo suelto
  // en vez de juntarse con las citas que ya usan "demostracion".
  const knownMatch = KNOWN_EVENT_TYPES.find((t) => t.label.toLocaleLowerCase() === lower);
  if (knownMatch) return knownMatch.value;

  const customMatch = existingCustomTypes.find((t) => t.toLocaleLowerCase() === lower);
  return customMatch ?? trimmed;
}
