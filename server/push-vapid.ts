/**
 * Prompt 8, Parte 4 — configuración de Web Push (VAPID) y el envío en sí, en un solo lugar
 * para que server/push-scheduler.ts y las rutas de prueba usen siempre el mismo camino.
 *
 * Las claves son por entorno (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT), nunca
 * compartidas entre staging y producción — mismo criterio que las credenciales de Mercado
 * Pago. Se generan una sola vez por entorno con `npx web-push generate-vapid-keys`.
 *
 * La configuración es perezosa (recién al mandar el primer push) para que importar este
 * módulo nunca rompa nada en un entorno que todavía no tiene las variables puestas (dev local
 * sin avisos, o los tests) — el error real aparece solo cuando alguien intenta usarlo de
 * verdad, con un mensaje que dice exactamente qué falta.
 */
import webpush from "web-push";

let configured = false;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable ${name} (ver docs/staging.md) — no se puede mandar ni configurar Web Push sin ella.`);
  }
  return value;
}

function ensureConfigured(): void {
  if (configured) return;
  const subject = requireEnv("VAPID_SUBJECT");
  const publicKey = requireEnv("VAPID_PUBLIC_KEY");
  const privateKey = requireEnv("VAPID_PRIVATE_KEY");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/** La pública no es secreta — el frontend la necesita para suscribirse (GET /api/push/vapid-public-key). */
export function getVapidPublicKey(): string {
  return requireEnv("VAPID_PUBLIC_KEY");
}

export interface WebPushSubscriptionLike {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendWebPushResult {
  success: boolean;
  /** Código HTTP que informó el servicio de push al rechazar el envío — 404/410 significa
   * suscripción vencida (hay que borrarla), cualquier otro valor (o ausente, ej. error de red)
   * se trata como transitorio (hay que reintentar). */
  statusCode?: number;
}

/** Nunca tira: devuelve siempre un resultado para que el que llama decida qué hacer (borrar la
 * suscripción, reintentar, o nada) sin un try/catch propio en cada lugar que manda un push. */
export async function sendWebPush(subscription: WebPushSubscriptionLike, payload: unknown): Promise<SendWebPushResult> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
    );
    return { success: true };
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number" ? (error as { statusCode: number }).statusCode : undefined;
    return { success: false, statusCode };
  }
}

/** 404/410 = el navegador o el servicio de push informa que esa suscripción ya no vale —
 * cualquier otro código (o ninguno, ej. timeout de red) es un error transitorio: no implica
 * que el dispositivo esté mal, solo que ESTE intento no llegó. */
export function isExpiredSubscriptionStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
