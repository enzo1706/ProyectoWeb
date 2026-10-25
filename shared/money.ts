/**
 * Prompt 15 — formato y parseo de montos en es-AR, compartido entre cliente (campo de monto,
 * `client/src/lib/currency.ts` lo reexporta) y servidor (mensajes de error que muestran un
 * monto, ej. `server/storage.ts`). Nunca asume centavos ni pesos enteros por su cuenta — ESO
 * lo decide quien llama (ver `MoneyInput`'s prop `unit`), acá solo se formatea/parsea el
 * número que se ve en pantalla.
 */

/** "$ 20.100" si es entero, "$ 1.250,50" si tiene centavos — nunca "1.250,5" (Intl por sí solo
 * usa el mínimo de dígitos que representa el valor exacto, no una cantidad fija) por eso la
 * cantidad de decimales es 0 o 2, nunca 1: una moneda real no se muestra con medio centavo. */
export function formatMoney(value: number, currency = "ARS"): string {
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(value);
}

/** Igual que `formatMoney`, sin el símbolo "$" ni el estilo moneda — para mostrar/editar un
 * número adentro de un input, donde el "$" ya se muestra aparte como prefijo fijo. */
export function formatMoneyPlain(value: number, locale = "es-AR"): string {
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(value);
}

/**
 * Reformatea en vivo lo que la consultora va tipeando en un `MoneyInput`, insertando los
 * puntos de miles a medida que escribe. A propósito más simple que `parseMoneyInput`: en un
 * campo que la consultora tipea a mano, el "." nunca lo escribe ella (lo inserta este
 * formateador solo), así que no hace falta resolver la ambigüedad "." decimal vs. miles —
 * cualquier "." que llegue (ej. pegado desde otro lado) se descarta sin más, y "," sigue
 * siendo el único separador decimal posible. Pegar un monto ya formateado con "." como
 * decimal corto (ej. "20.5") se maneja aparte, en el `onPaste` del componente, con
 * `parseMoneyInput`.
 */
export function liveFormatMoneyText(raw: string): string {
  const cleaned = raw.replace(/[^\d,]/g, "");
  const firstComma = cleaned.indexOf(",");
  const integerRaw = firstComma === -1 ? cleaned : cleaned.slice(0, firstComma);
  const decimalPart = firstComma === -1 ? null : cleaned.slice(firstComma + 1).replace(/,/g, "").slice(0, 2);

  const integerDigits = integerRaw.replace(/^0+(?=\d)/, "");
  const withThousands = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  if (decimalPart === null) return withThousands;
  return `${withThousands || "0"},${decimalPart}`;
}

/**
 * Parsea un monto tipeado en formato es-AR al número que representa.
 *
 * Reglas (ajuste del usuario sobre el prompt original, para que nunca se guarde mal):
 * - "," es SIEMPRE el separador decimal, sin ambigüedad — "1.250,50" → 1250.5.
 * - "." es separador de miles SOLO si el grupo final tiene exactamente 3 dígitos —
 *   "20.100" → 20100. Si el grupo final tiene 1 o 2 dígitos, "." es decimal — "20.5" → 20.5,
 *   nunca 205 (si no, alguien que tipea con punto decimal terminaría guardando mil veces más).
 */
export function parseMoneyInput(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;

  if (cleaned.includes(",")) {
    const withoutThousands = cleaned.replace(/\./g, "");
    const value = Number(withoutThousands.replace(",", "."));
    return Number.isFinite(value) ? value : 0;
  }

  if (cleaned.includes(".")) {
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1];
    if (last.length === 3) {
      const value = Number(parts.join(""));
      return Number.isFinite(value) ? value : 0;
    }
    const integerPart = parts.slice(0, -1).join("");
    const value = Number(`${integerPart}.${last}`);
    return Number.isFinite(value) ? value : 0;
  }

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** Parsea un porcentaje tipeado con "," o "." como decimal — sin separador de miles, los
 * porcentajes de esta app nunca llegan a 1000. */
export function parsePercentInput(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(",", ".");
  const firstDot = cleaned.indexOf(".");
  const normalized =
    firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}
