/**
 * Etapa 3 (registro + recuperación de contraseña): única fuente de verdad de cómo se
 * normaliza un email para guardarlo y compararlo. Postgres nunca trata "Usuario@Mail.com" y
 * "usuario@mail.com" como iguales — sin esto, dos registros con el mismo email en mayúsculas
 * distintas crearían dos cuentas separadas, y la recuperación de contraseña fallaría si la
 * consultora escribe su email con una capitalización distinta a la que usó al registrarse.
 *
 * Se guarda SIEMPRE ya normalizado (ver storage.setConsultantEmail) — así comparar es un
 * simple `=`, sin falta de un índice funcional ni un `lower()` en cada query.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
