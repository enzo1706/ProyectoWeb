/**
 * Prompt 8, Parte 4 — todo lo que necesita el botón "Activar avisos en este celular" de
 * Configuración: detectar la plataforma, pedir permiso, registrar el service worker
 * (client/public/sw.js, solo se registra recién acá — nunca antes, no hay motivo si todavía no
 * se va a usar), suscribirse y mandar la suscripción al servidor.
 */
import { apiRequest } from "./queryClient";

export function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Safari en iOS solo permite Web Push dentro de una PWA agregada a la pantalla de inicio
 * (iOS 16.4 o más nuevo) — `navigator.standalone` es la forma clásica de Safari de decirlo;
 * `display-mode: standalone` es el estándar que ya cubre Android/desktop. */
export function isRunningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

/** `true` solo si hace falta mostrar los pasos de "Agregá a inicio" en vez del botón. */
export function needsIosHomeScreenInstall(): boolean {
  return isIosDevice() && !isRunningStandalone();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** El endpoint de la suscripción activa de ESTE navegador, si hay alguna — `null` si nunca se
 * activaron los avisos acá (o el service worker ni se registró todavía). */
export async function getCurrentSubscriptionEndpoint(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

export type ActivatePushResult =
  | { status: "activado" }
  | { status: "permiso-denegado" }
  | { status: "no-soportado" }
  | { status: "error"; message: string };

/** El flujo completo del botón: registra el service worker, pide permiso (nunca antes de que
 * la consultora lo pida a propósito tocando el botón), se suscribe y manda la suscripción al
 * servidor. */
export async function activatePushNotifications(): Promise<ActivatePushResult> {
  if (!isPushSupported()) return { status: "no-soportado" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { status: "permiso-denegado" };
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const { publicKey } = await (await apiRequest("GET", "/api/push/vapid-public-key")).json();

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const subscriptionJson = subscription.toJSON();
    await apiRequest("POST", "/api/push/subscribe", {
      endpoint: subscriptionJson.endpoint,
      keys: subscriptionJson.keys,
    });

    return { status: "activado" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Error desconocido" };
  }
}

/** Botón "Probar aviso" — manda un push real a ESTE dispositivo (nunca a los demás de la
 * consultora, aunque tenga varios activados). */
export async function sendTestPush(): Promise<{ ok: true } | { ok: false; message: string }> {
  const endpoint = await getCurrentSubscriptionEndpoint();
  if (!endpoint) {
    return { ok: false, message: "Activá los avisos en este dispositivo primero." };
  }
  try {
    await apiRequest("POST", "/api/push/test", { endpoint });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo mandar el aviso de prueba." };
  }
}

/** Al cerrar sesión: borra la suscripción de ESTE dispositivo del servidor, así no le siguen
 * llegando avisos de esta consultora en un celular compartido. Nunca tira — si falla, el
 * logout tiene que seguir andando igual (ver client/src/hooks/useAuth.tsx). */
export async function unsubscribeCurrentDevice(): Promise<void> {
  try {
    const endpoint = await getCurrentSubscriptionEndpoint();
    if (!endpoint) return;
    await apiRequest("POST", "/api/push/unsubscribe", { endpoint });
  } catch {
    // Best-effort — el logout no depende de esto.
  }
}
