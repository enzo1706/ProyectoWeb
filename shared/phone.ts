/**
 * Etapa 4 / Prompt 9 — normalización de teléfonos argentinos. Único lugar donde vive esta
 * lógica (la reusan ClientDialog, el registro de consultoras del Prompt 14, y WhatsApp) — no
 * se duplica en ningún otro lado.
 */

export type NormalizedArgentinaPhone = { valid: true; digits: string } | { valid: false };

/**
 * Núcleo de la normalización: reduce cualquier entrada razonable a los 10 dígitos locales
 * (área + abonado, código de área incluido, sin "0", sin "15" y sin "+54") — o inválido. Reglas,
 * en este orden:
 * 1. Se descartan todos los caracteres que no sean dígitos (espacios, guiones, paréntesis, +).
 * 2. Si empieza con "54" (código de país), se saca.
 * 3. Si lo que queda tiene 11 dígitos y empieza con "9" (indicador de móvil ya presente), se saca.
 * 4. Si lo que queda tiene 11 dígitos y empieza con "0" (prefijo de larga distancia local), se saca.
 * 5. Lo que quede tiene que ser EXACTAMENTE 10 dígitos — si no calza justo, es ambiguo o
 *    incompleto (ej. un "15" suelto sin área) y se rechaza en vez de adivinar.
 * 6. Se descartan números evidentemente inválidos (los 10 dígitos todos iguales).
 */
export function normalizeArgentinaPhoneDigits(raw: string | null | undefined): NormalizedArgentinaPhone {
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

  return { valid: true, digits };
}

/** Para guardar en `clients.phone` (o el registro de consultoras del Prompt 14): los 10
 * dígitos locales normalizados, o `null` si no se puede normalizar de forma segura. */
export function normalizeArgentinaPhoneForStorage(raw: string | null | undefined): string | null {
  const result = normalizeArgentinaPhoneDigits(raw);
  return result.valid ? result.digits : null;
}

/** Para mostrar: "261 555 1234" sobre un valor YA guardado (10 dígitos). Agrupa de a 3-3-4 a
 * propósito simple (es el formato del ejemplo pedido) — no detecta el código de área real, no
 * existe ninguna tabla de áreas en este proyecto. Un valor legacy que no calce 10 dígitos se
 * muestra tal cual, nunca rompe. */
export function formatArgentinaPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (!/^\d{10}$/.test(phone)) return phone;
  return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
}

export type NormalizedWhatsAppNumber = { valid: true; e164: string } | { valid: false };

/** Normaliza un teléfono argentino a formato E.164 para WhatsApp (sin el "+", como exige
 * `https://wa.me/<numero>`) — mismo núcleo que `normalizeArgentinaPhoneDigits`, con el
 * indicador de móvil ("549") agregado adelante. */
export function normalizeArgentinaWhatsAppNumber(raw: string | null | undefined): NormalizedWhatsAppNumber {
  const result = normalizeArgentinaPhoneDigits(raw);
  return result.valid ? { valid: true, e164: `549${result.digits}` } : { valid: false };
}

/** Único lugar que arma la URL de WhatsApp — nunca hardcodear `wa.me` en un componente. Sin
 * mensaje prellenado a propósito (preferencia explícita de la Etapa 4: abrir el chat vacío).
 * `null` si el teléfono no se puede normalizar de forma segura — nunca un link a medias. */
export function buildWhatsAppLink(phone: string | null | undefined): string | null {
  const result = normalizeArgentinaWhatsAppNumber(phone);
  return result.valid ? `https://wa.me/${result.e164}` : null;
}
