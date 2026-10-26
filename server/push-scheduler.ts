/**
 * Prompt 8, Parte 4 — la "tarea programada" en sí: un proceso DENTRO de este mismo servidor
 * (ver docs/migracion-deploy-4.md para por qué, no un cron de Railway), sin ninguna tarea
 * externa que armar en Railway.
 *
 * `runPushSchedulerTick` es la revisión de una vez — se llama sola cada `TICK_INTERVAL_MS`
 * (ver `startPushScheduler`, invocado solo desde server/index.ts, nunca desde los tests) y
 * queda exportada aparte para poder probarla directo, con el reloj simulado, sin esperar
 * ningún intervalo real.
 *
 * Por qué revisar cada pocos minutos en vez de un disparo único a las 9:00:
 * - Si el servidor se reinició justo a las 9:00, la próxima revisión (minutos después) manda
 *   igual — no hace falta ninguna lógica de reintento aparte, es la consecuencia natural de
 *   revisar seguido.
 * - Si el servidor estuvo caído a las 9:00 y vuelve más tarde (dentro de la ventana), la
 *   primera revisión después de levantar manda el aviso de HOY — nunca retroactivo a días
 *   anteriores (la cuenta del día de pedido ya es por fecha de hoy, ver
 *   shared/orderReminderSchedule.ts).
 * - Si Railway corre más de una instancia, la base de datos decide quién manda (ver
 *   `claimPushNotification`, un `INSERT ... ON CONFLICT DO NOTHING`) — nunca el código.
 */
import { storage } from "./storage";
import { getArgentinaDateStr, getArgentinaTimeStr } from "@shared/argentinaTime";
import { sendWebPush, isExpiredSubscriptionStatus, type WebPushSubscriptionLike } from "./push-vapid";
import { log } from "./app";

export const ORDER_DAY_NOTICE_TYPE = "dia_pedido";

// Ventana [09:00, 21:00) hora de Argentina — nunca antes de que la consultora arranque el día,
// nunca de noche. Comparación de texto porque getArgentinaTimeStr() siempre devuelve "HH:MM"
// con cero a la izquierda, así que el orden alfabético coincide con el orden horario real.
const WINDOW_START = "09:00";
const WINDOW_END = "21:00";

const TICK_INTERVAL_MS = 5 * 60 * 1000;

function isWithinSendWindow(): boolean {
  const timeStr = getArgentinaTimeStr();
  return timeStr >= WINDOW_START && timeStr < WINDOW_END;
}

/** Una consultora, un intento. Nunca tira — cualquier error de un dispositivo puntual no debe
 * frenar la revisión de las demás consultoras de este mismo tick. */
async function checkAndSendOrderDayPush(consultantId: number): Promise<void> {
  // Misma función que ya usa Inicio/Agenda (Prompt 8, Parte 3) — genera el recordatorio si
  // hace falta, y el número de productos sale de la MISMA cuenta que vería la consultora si
  // abriera la app en este instante. Si no hay recordatorio hoy, o la lista queda vacía, no se
  // manda nada (el aviso en Inicio sigue estando igual, independiente de esto).
  const result = await storage.getOrderReminder(consultantId);
  if (!result || result.items.length === 0) return;

  const sentFor = getArgentinaDateStr();
  const claimed = await storage.claimPushNotification(consultantId, ORDER_DAY_NOTICE_TYPE, sentFor);
  if (!claimed) return; // ya se mandó (o ya se intentó y no hay nada más que reintentar) hoy.

  const subscriptions = await storage.getPushSubscriptionsForConsultant(consultantId);
  const payload = {
    title: "Hoy es tu día de pedido",
    body: `Tenés ${result.items.length} productos para pedir. Tocá para verlos.`,
    url: "/",
  };

  let anySuccess = false;
  let anyTransientFailure = false;

  for (const subscription of subscriptions) {
    const sendResult = await sendWebPush(subscription as WebPushSubscriptionLike, payload);
    if (sendResult.success) {
      anySuccess = true;
    } else if (isExpiredSubscriptionStatus(sendResult.statusCode)) {
      await storage.deletePushSubscriptionByEndpoint(subscription.endpoint);
    } else {
      anyTransientFailure = true;
    }
  }

  if (anySuccess) {
    return; // llegó a al menos un dispositivo — queda como enviado, no se reintenta.
  }
  if (anyTransientFailure) {
    // Ningún envío llegó, y al menos uno falló por algo transitorio (no por estar vencida) —
    // libera la reserva para que la próxima revisión, todavía dentro de la ventana, reintente.
    await storage.releasePushNotificationClaim(consultantId, ORDER_DAY_NOTICE_TYPE, sentFor);
  }
  // Ni éxito ni falla transitoria: todas las suscripciones que había resultaron vencidas (ya se
  // borraron arriba) o no había ninguna — no queda nada a lo que reintentarle, se deja la
  // reserva puesta.
}

export async function runPushSchedulerTick(): Promise<void> {
  if (!isWithinSendWindow()) return;

  const consultantIds = await storage.getConsultantIdsWithPushSubscriptions();
  for (const consultantId of consultantIds) {
    try {
      await checkAndSendOrderDayPush(consultantId);
    } catch (error) {
      console.error(`Revisión de avisos push: error con la consultora ${consultantId}:`, error);
    }
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Llamar una sola vez, desde server/index.ts — nunca desde server/app.ts (lo usan los tests
 * para levantar la app sin arrancar ningún timer de fondo). */
export function startPushScheduler(): NodeJS.Timeout {
  if (intervalHandle) return intervalHandle;
  log("Avisos push: revisión cada 5 minutos, activa (ventana 09:00–21:00 hora de Argentina).");
  intervalHandle = setInterval(() => {
    runPushSchedulerTick().catch((error) => {
      console.error("Revisión de avisos push: error en el tick completo:", error);
    });
  }, TICK_INTERVAL_MS);
  return intervalHandle;
}

export function stopPushScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
