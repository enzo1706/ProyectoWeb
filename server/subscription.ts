import { randomUUID } from "crypto";
import { storage } from "./storage";
import type { SubscriptionStatus } from "@shared/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `sub-{consultantId}-{uuid}` — el consultantId queda legible adentro para depurar a ojo,
 * pero NUNCA se usa como fuente de autorización por sí solo (ver parseConsultantIdFromExternalReference). */
export function generateExternalReference(consultantId: number): string {
  return `sub-${consultantId}-${randomUUID()}`;
}

const EXTERNAL_REFERENCE_PATTERN = /^sub-(\d+)-[0-9a-f-]+$/i;

/** Extrae el consultantId de un externalReference con el formato esperado, o null si no
 * matchea — el caller SIEMPRE debe además confirmar que esa fila realmente le pertenece a
 * esa consultora (ver el uso en el webhook), nunca confiar en el string solo. */
export function parseConsultantIdFromExternalReference(externalReference: string | null | undefined): number | null {
  if (!externalReference) return null;
  const match = EXTERNAL_REFERENCE_PATTERN.exec(externalReference);
  if (!match) return null;
  const consultantId = Number(match[1]);
  return Number.isInteger(consultantId) && consultantId > 0 ? consultantId : null;
}

/**
 * Días restantes hasta `target`, redondeados "para arriba" (ceil) y nunca negativos.
 * Ceil en vez de floor: al instante de crear un trial de 10 días, `target - now` es
 * "10 días menos unos milisegundos" (lo que tarda en ejecutarse el request) — con floor
 * eso mostraría 9, regalando un día de menos desde el primer segundo. Con ceil, el último
 * tramo antes de vencer nunca cae a 0 mientras todavía hay acceso (hasAccess se decide
 * aparte, por la fecha exacta) — recién es 0 una vez que el período ya venció.
 */
function daysRemaining(now: Date, target: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS));
}

export interface ConsultantAccessStatus {
  status: SubscriptionStatus;
  hasAccess: boolean;
  trialEndAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  daysRemaining: number;
}

interface SubscriptionDates {
  status: SubscriptionStatus;
  trialEndAt: Date;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/** Calcula el acceso a partir de las fechas — nunca de `status` (ver `getConsultantAccessStatus`). */
function computeAccess(sub: SubscriptionDates, now: Date): ConsultantAccessStatus {
  if (sub.status === "canceled") {
    return {
      status: "canceled",
      hasAccess: false,
      trialEndAt: sub.trialEndAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysRemaining: 0,
    };
  }

  // Una vez que existe un período pago, manda ese campo para siempre — no se vuelve a mirar
  // trialEndAt (una fecha de trial vieja nunca puede "revivir" después del primer pago).
  if (sub.currentPeriodEnd) {
    const active = now.getTime() <= sub.currentPeriodEnd.getTime();
    return {
      status: active ? "active" : "expired",
      hasAccess: active,
      trialEndAt: sub.trialEndAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysRemaining: active ? daysRemaining(now, sub.currentPeriodEnd) : 0,
    };
  }

  const inTrial = now.getTime() <= sub.trialEndAt.getTime();
  return {
    status: inTrial ? "trial" : "expired",
    hasAccess: inTrial,
    trialEndAt: sub.trialEndAt,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    daysRemaining: inTrial ? daysRemaining(now, sub.trialEndAt) : 0,
  };
}

/**
 * Única fuente de verdad del acceso de una consultora. El acceso SIEMPRE se calcula al vuelo
 * a partir de las fechas — `subscriptions.status` es solo caché de lectura para el admin, y
 * esta función la autocorrige a "expired" cuando detecta que venció (nunca al revés: activar
 * una suscripción es exclusivamente responsabilidad del webhook de pago, no de una lectura).
 */
export async function getConsultantAccessStatus(consultantId: number): Promise<ConsultantAccessStatus> {
  const sub = await storage.getSubscriptionByConsultantId(consultantId);
  const now = new Date();

  if (!sub) {
    // No debería pasar en uso normal (toda consultora nace con su subscription) — sin fila,
    // no hay acceso posible, nunca se inventa un trial fantasma para taparlo.
    return { status: "expired", hasAccess: false, trialEndAt: null, currentPeriodStart: null, currentPeriodEnd: null, daysRemaining: 0 };
  }

  const computed = computeAccess({ ...sub, status: sub.status as SubscriptionStatus }, now);

  if (computed.status !== sub.status && sub.status !== "canceled") {
    await storage.updateSubscription(consultantId, { status: computed.status });
  }

  return computed;
}

export async function hasActiveAccess(consultantId: number): Promise<boolean> {
  return (await getConsultantAccessStatus(consultantId)).hasAccess;
}
