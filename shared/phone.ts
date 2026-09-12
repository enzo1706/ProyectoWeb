/**
 * Etapa 4 — normalización de teléfonos argentinos para WhatsApp. Auditoría previa: no existía
 * ninguna utilidad de teléfono en el proyecto — solo `PHONE_REGEX` (shared/schema.ts), que
 * exige exactamente 10 dígitos al cargar una clienta (área + abonado, sin "0" ni "15" ni "+54").
 * Esta función es más permisiva a propósito: tiene que poder normalizar también números
 * pegados/pasteados con formatos previos a esa validación, o tipeados a mano en otros lugares.
 *
 * No adivina números incompletos ni ambiguos — ver el caso "15 1234567" (sin área) en los
 * tests: se rechaza en vez de inventar una zona.
 */

export type NormalizedWhatsAppNumber = { valid: true; e164: string } | { valid: false };

/**
 * Normaliza un teléfono argentino a formato E.164 para WhatsApp (sin el "+", como exige
 * `https://wa.me/<numero>`). Reglas, en este orden:
 * 1. Se descartan todos los caracteres que no sean dígitos (espacios, guiones, paréntesis, +).
 * 2. Si empieza con "54" (código de país), se saca.
 * 3. Si lo que queda tiene 11 dígitos y empieza con "9" (indicador de móvil ya presente), se saca.
 * 4. Si lo que queda tiene 11 dígitos y empieza con "0" (prefijo de larga distancia local), se saca.
 * 5. Lo que quede tiene que ser EXACTAMENTE el número local de 10 dígitos (área + abonado, el
 *    mismo formato que ya exige `PHONE_REGEX`) — si no calza justo, es ambiguo o incompleto
 *    (ej. un "15" suelto sin área) y se rechaza en vez de adivinar.
 * 6. Se descartan números evidentemente inválidos (los 10 dígitos todos iguales, ej. "0000000000").
 */
export function normalizeArgentinaWhatsAppNumber(raw: string | null | undefined): NormalizedWhatsAppNumber {
  if (!raw) return { valid: false };

  let digits = raw.replace(/\D/g, "");
  if (!digits) return { valid: false };

  if (digits.startsWith("54")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("9")) {
    digits = digits.slice(1);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!/^\d{10}$/.test(digits)) {
    return { valid: false };
  }

  if (/^(\d)\1{9}$/.test(digits)) {
    return { valid: false };
  }

  // E.164 real para celulares argentinos vía WhatsApp: 54 (país) + 9 (móvil) + área + abonado.
  return { valid: true, e164: `549${digits}` };
}

/** Único lugar que arma la URL de WhatsApp — nunca hardcodear `wa.me` en un componente. Sin
 * mensaje prellenado a propósito (preferencia explícita de la Etapa 4: abrir el chat vacío).
 * `null` si el teléfono no se puede normalizar de forma segura — nunca un link a medias. */
export function buildWhatsAppLink(phone: string | null | undefined): string | null {
  const result = normalizeArgentinaWhatsAppNumber(phone);
  return result.valid ? `https://wa.me/${result.e164}` : null;
}
