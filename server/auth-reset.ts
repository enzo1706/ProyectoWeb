import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { normalizeEmail } from "@shared/email";
import { sendPasswordResetCode } from "./email";
import { invalidateUserSessions } from "./session";

/**
 * Etapa 3 — lógica de negocio de "olvidé mi contraseña", separada de routes.ts (mismo
 * criterio que server/subscription.ts) para poder testear el flujo sin pasar siempre por
 * HTTP. Único lugar donde se decide qué es un código válido — routes.ts solo llama a estas
 * funciones y traduce el resultado a status HTTP, nunca reimplementa la regla.
 */

// 10 minutos: suficiente para que la consultora revise su email sin apuro (evita el reclamo
// típico de "llegó tarde y ya no sirve"), corto para que una filtración del código tenga una
// ventana chica de uso real. Dentro del rango 10-15' que pidió el pedido.
export const RESET_CODE_EXPIRY_MINUTES = 10;
// Con un código de 6 dígitos (1 en un millón) y 5 intentos, la probabilidad de acertarlo a
// ciegas es ~0.0005% — cualquier valor más alto no suma seguridad real, uno más bajo ya
// empieza a golpear a consultoras reales que se equivocan tipeando.
export const MAX_RESET_ATTEMPTS = 5;
// Mismo costo que el hashing de contraseñas (bcrypt ya es una dependencia existente, no se
// suma ninguna nueva ni se inventa un hashing casero) — 10 rounds, igual que BCRYPT_SALT_ROUNDS
// en storage.ts.
const RESET_CODE_HASH_ROUNDS = 10;

function generateResetCode(): string {
  // crypto.randomInt (Node nativo) es criptográficamente seguro — a diferencia de
  // Math.random(), no es predecible. Sin agregar ninguna dependencia nueva.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Paso 1: solicitar recuperación. La respuesta pública (ver POST /api/auth/forgot-password en
 * routes.ts) es SIEMPRE la misma exista o no la cuenta — acá adentro es donde de verdad se
 * decide si hay algo para hacer, nunca se filtra hacia afuera si el email existe.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const user = await storage.getUserByConsultantEmail(email);

  if (!user) {
    // Mismo costo computacional que la rama real (bcrypt.hash es lo caro de esa rama, no la
    // consulta a storage) — para que el tiempo de respuesta no delate si el email existe.
    await bcrypt.hash(email, RESET_CODE_HASH_ROUNDS);
    return;
  }

  const code = generateResetCode();
  const codeHash = await bcrypt.hash(code, RESET_CODE_HASH_ROUNDS);
  const expiresAt = new Date(Date.now() + RESET_CODE_EXPIRY_MINUTES * 60 * 1000);

  // Cualquier código anterior sin usar de este usuario queda invalidado acá — nunca hay dos
  // códigos "vivos" al mismo tiempo, una solicitud nueva siempre pisa a la anterior.
  await storage.invalidateActivePasswordResetCodes(user.id);
  const record = await storage.createPasswordResetCode(user.id, codeHash, expiresAt);

  try {
    // El código real SOLO viaja por acá — nunca en la respuesta HTTP, nunca en un log fuera
    // del adapter de desarrollo de server/email.ts (que a su vez nunca lo imprime en producción).
    await sendPasswordResetCode(email, code, RESET_CODE_EXPIRY_MINUTES);
  } catch (err) {
    // Etapa 3.1: si el proveedor de email falla, el código YA existe en DB pero la consultora
    // nunca lo recibió — no lo dejamos "vivo" (nadie podría usarlo igual, pero tampoco tiene
    // sentido dejar un código quemado ocupando el lugar del único activo). Se marca usado y la
    // consultora simplemente puede volver a pedirlo — el rate limiter de forgot-password sigue
    // aplicando igual, así que esto no abre una puerta a reintentos ilimitados.
    await storage.markPasswordResetCodeUsed(record.id);
    console.error(
      `No se pudo enviar el código de recuperación (código invalidado, no queda utilizable): ${err instanceof Error ? err.message : "error desconocido"}`,
    );
    // Nunca se propaga hacia el endpoint — la respuesta pública sigue siendo la genérica
    // (ver POST /api/auth/forgot-password en routes.ts), nunca revela que el envío falló.
  }
}

interface ResetCodeCheckOk {
  valid: true;
  userId: number;
  codeId: number;
}
interface ResetCodeCheckFail {
  valid: false;
  // Nunca se expone tal cual al cliente (ver routes.ts) — solo para logs/debug internos.
  reason: "no_account" | "no_active_code" | "expired" | "too_many_attempts" | "wrong_code";
}
export type ResetCodeCheckResult = ResetCodeCheckOk | ResetCodeCheckFail;

/**
 * Núcleo compartido por "verificar código" y "confirmar reset" — el contador de intentos es
 * el MISMO para los dos pasos (no hay forma de esquivarlo probando primero en un endpoint y
 * después en el otro, porque ambos llaman acá y ambos incrementan el mismo `attempts`).
 */
export async function checkResetCode(rawEmail: string, code: string): Promise<ResetCodeCheckResult> {
  const email = normalizeEmail(rawEmail);
  const user = await storage.getUserByConsultantEmail(email);
  if (!user) return { valid: false, reason: "no_account" };

  const record = await storage.getLatestPasswordResetCode(user.id);
  if (!record || record.usedAt !== null) return { valid: false, reason: "no_active_code" };
  if (record.expiresAt.getTime() < Date.now()) return { valid: false, reason: "expired" };
  if (record.attempts >= MAX_RESET_ATTEMPTS) return { valid: false, reason: "too_many_attempts" };

  const matches = await bcrypt.compare(code, record.codeHash);
  if (!matches) {
    await storage.incrementPasswordResetCodeAttempts(record.id);
    return { valid: false, reason: "wrong_code" };
  }

  return { valid: true, userId: user.id, codeId: record.id };
}

export async function verifyResetCode(email: string, code: string): Promise<boolean> {
  const result = await checkResetCode(email, code);
  return result.valid;
}

export type ResetPasswordOutcome = "ok" | "invalid";

/**
 * Paso final: valida el código (mismo chequeo que verify), y si es válido —transaccional a
 * nivel de efectos, en este orden fijo— marca el código usado, cambia la contraseña, e
 * invalida las sesiones anteriores. El código se marca usado ANTES de tocar la contraseña
 * para que un fallo a mitad de camino nunca deje un código reutilizable.
 */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<ResetPasswordOutcome> {
  const result = await checkResetCode(email, code);
  if (!result.valid) return "invalid";

  await storage.markPasswordResetCodeUsed(result.codeId);

  const newHash = await bcrypt.hash(newPassword, RESET_CODE_HASH_ROUNDS);
  await storage.updateUserPassword(result.userId, newHash);

  await invalidateUserSessions(result.userId);

  return "ok";
}
