import { randomUUID } from "crypto";
import { storage } from "./storage";
import { updatePreapprovalAmount } from "./mercadopago";
import { SUBSCRIPTION_PRICE_ARS } from "./config/subscription";
import type { Coupon, CouponDiscountType, CouponDuration, SubscriptionStatus } from "@shared/schema";

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

  // Mecanismo perezoso del Prompt U (precio/cupones) — ver reconcileSubscriptionPricing. Vive
  // acá porque este es el único punto por el que pasa CADA request de una consultora con
  // acceso activo; nunca puede tirar abajo el chequeo de acceso en sí.
  if (computed.status === "active") {
    await reconcileSubscriptionPricing(consultantId);
  }

  return computed;
}

export async function hasActiveAccess(consultantId: number): Promise<boolean> {
  return (await getConsultantAccessStatus(consultantId)).hasAccess;
}

// ---------------------------------------------------------------------------
// Prompt U — precio editable + cupones.
// ---------------------------------------------------------------------------

/** Precio vigente para UNA ALTA NUEVA ahora mismo — siempre la fila más reciente del
 * historial, sin importar `appliesTo` (eso solo decide si las YA suscriptas también lo
 * reciben). Si todavía no se cargó ningún cambio desde el admin, cae al valor de config —
 * así una base recién migrada no queda sin precio. */
export async function getCurrentSubscriptionPriceArs(): Promise<number> {
  const latest = await storage.getLatestSubscriptionPriceChange();
  return latest?.newPriceArs ?? SUBSCRIPTION_PRICE_ARS;
}

// Ventana en la que una reserva de cupón ("tocó Aplicar, está pagando") sigue contando para el
// límite de usos aunque todavía no se confirmó el pago. Pasado este tiempo, una reserva
// abandonada deja de contar sola — no hace falta ningún job que la "libere".
export const COUPON_RESERVATION_TTL_MS = 15 * 60 * 1000;

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Monto final en pesos, siempre entero y nunca negativo — ARS no tiene centavos en esta app. */
export function computeDiscountedPriceArs(originalPriceArs: number, discountType: CouponDiscountType, discountValue: number): number {
  const discounted =
    discountType === "percentage" ? Math.round(originalPriceArs * (1 - discountValue / 100)) : originalPriceArs - discountValue;
  return Math.max(0, discounted);
}

/** Hasta cuándo rige el descuento de una redención recién confirmada — null para "forever" (no
 * vence nunca) y para "first_payment" (se revierte apenas se confirma ese pago, ver
 * `reconcileSubscriptionPricing`, no necesita una fecha futura). */
export function computeDiscountEndsAt(duration: CouponDuration, durationMonths: number | null, confirmedAt: Date): Date | null {
  if (duration !== "months" || !durationMonths) return null;
  return new Date(confirmedAt.getTime() + durationMonths * 30 * DAY_MS);
}

export type CouponValidationResult =
  | { valid: true; coupon: Coupon; originalPriceArs: number; discountedPriceArs: number }
  | { valid: false; reason: "not_found" | "inactive" | "expired" | "limit_reached" | "already_used" };

export const COUPON_ERROR_MESSAGES: Record<Exclude<CouponValidationResult, { valid: true }>["reason"], string> = {
  not_found: "Ese cupón no existe",
  inactive: "Ese cupón no está activo",
  expired: "Ese cupón ya venció",
  limit_reached: "Ese cupón ya alcanzó el límite de usos",
  already_used: "Ya usaste este cupón",
};

/** Validación de SOLO LECTURA (preview) — no reserva nada. La reserva real, atómica contra la
 * condición de carrera de "varias pagando a la vez", pasa recién en `POST /subscription/start`
 * (ver storage.reserveCouponForConsultant). */
export async function validateCouponForConsultant(code: string, consultantId: number): Promise<CouponValidationResult> {
  const normalized = normalizeCouponCode(code);
  const coupon = await storage.getCouponByCode(normalized);
  if (!coupon) return { valid: false, reason: "not_found" };
  if (!coupon.active) return { valid: false, reason: "inactive" };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) return { valid: false, reason: "expired" };

  const alreadyUsed = await storage.getCouponRedemption(coupon.id, consultantId);
  if (alreadyUsed) return { valid: false, reason: "already_used" };

  if (coupon.maxUses !== null) {
    const activeUses = await storage.countActiveCouponUses(coupon.id, COUPON_RESERVATION_TTL_MS);
    if (activeUses >= coupon.maxUses) return { valid: false, reason: "limit_reached" };
  }

  const originalPriceArs = await getCurrentSubscriptionPriceArs();
  const discountedPriceArs = computeDiscountedPriceArs(originalPriceArs, coupon.discountType as CouponDiscountType, coupon.discountValue);
  return { valid: true, coupon, originalPriceArs, discountedPriceArs };
}

/**
 * Se llama desde `getConsultantAccessStatus` — mecanismo PEREZOSO (no hay scheduler en la
 * infraestructura): reconcilia el monto real cobrado por Mercado Pago contra lo que el admin o
 * un cupón vencido dicen que debería cobrarse, la próxima vez que se mira el acceso de esta
 * consultora. Nunca rompe el chequeo de acceso si falla (red, MP caído, etc.) — el acceso en sí
 * nunca depende de que este PUT salga bien.
 *
 * Dos casos, mutuamente independientes:
 * 1. Cambio de precio "a las actuales" (subscriptionPriceHistory.appliesTo === "all") con fecha
 *    ya cumplida y todavía no aplicado a ESTA consultora.
 * 2. Cupón con descuento vencido (duration "months", discountEndsAt ya pasó) sin revertir
 *    todavía — vuelve al precio vigente en ese momento (no necesariamente el mismo de cuando
 *    se suscribió, si hubo un cambio de precio general en el medio).
 */
export async function reconcileSubscriptionPricing(consultantId: number): Promise<void> {
  const sub = await storage.getSubscriptionByConsultantId(consultantId);
  if (!sub || !sub.mpPreapprovalId || sub.status !== "active") return;

  const now = new Date();

  try {
    const pendingPriceChange = await storage.getLatestDuePriceChange(now);
    if (pendingPriceChange && pendingPriceChange.id !== sub.priceHistoryAppliedId) {
      await updatePreapprovalAmount(sub.mpPreapprovalId, pendingPriceChange.newPriceArs);
      await storage.updateSubscription(consultantId, { priceHistoryAppliedId: pendingPriceChange.id });
    }
  } catch (error) {
    console.error(`No se pudo aplicar el cambio de precio general a la consultora ${consultantId}:`, error);
  }

  try {
    const redemption = await storage.getActiveExpiredCouponRedemption(consultantId, now);
    if (redemption) {
      const currentPriceArs = await getCurrentSubscriptionPriceArs();
      await updatePreapprovalAmount(sub.mpPreapprovalId, currentPriceArs);
      await storage.markCouponRedemptionReverted(redemption.id);
    }
  } catch (error) {
    console.error(`No se pudo revertir el descuento de cupón vencido de la consultora ${consultantId}:`, error);
  }
}
