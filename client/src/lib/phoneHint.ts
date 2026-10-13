import { normalizeArgentinaPhoneDigits } from "@shared/phone";

/** Mismo texto que CONSULTANT_WHATSAPP_ERROR_MESSAGE (shared/schema.ts) — una sola fuente de
 * verdad hubiera significado importar el backend al frontend solo por un string, así que se
 * repite a mano acá (ambos lados se tocan siempre juntos, nunca por separado). */
export const WHATSAPP_FORMAT_HINT = "Escribí tu WhatsApp sin el 0 y sin el 15. Por ejemplo: 261 555 1234.";

/**
 * Prompt 14, ajuste 4 — en el ingreso (campo único email/WhatsApp/usuario), si lo que se
 * tipeó tiene FORMA de teléfono (solo números, espacios, guiones o +) pero no es un WhatsApp
 * argentino válido tras normalizar, hay que avisar el formato ANTES de enviar — si no, se
 * busca como usuario, no existe, y la consultora recibe "Credenciales inválidas" sin saber
 * que el problema era el "0"/"15" de su WhatsApp. Depende SOLO del formato de lo tipeado,
 * nunca de si la cuenta existe — no rompe la anti-enumeración.
 */
export function looksLikeInvalidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@")) return false;
  if (!/^[\d\s\-+]+$/.test(trimmed)) return false;
  return !normalizeArgentinaPhoneDigits(trimmed).valid;
}
