/**
 * Configuración central de la suscripción — única fuente de verdad para precio y duraciones.
 * Nunca duplicar estos valores en otro archivo: el frontend nunca decide el precio, y
 * cualquier cálculo de trial/período debe importar estas constantes, no repetirlas.
 */
export const SUBSCRIPTION_PRICE_ARS = 20000;
// Prompt 14 (P30): ya NO vence nada por días — una cuenta que nunca pagó queda en "trial"
// (plan gratis) para siempre, el límite real es FREE_PLAN_PRODUCT_LIMIT. Esta constante sigue
// existiendo solo para seguir poblando `subscriptions.trialStartAt`/`trialEndAt` al crear una
// cuenta (son NOT NULL en el schema) — ningún código la usa para bloquear acceso.
export const TRIAL_DAYS = 10;
export const PERIOD_DAYS = 30;
export const PLAN_NAME = "Suscripción completa";
// Prompt 14 — único lugar donde vive el número "10 productos" del plan gratis. Lo usan el
// chequeo del servidor (storage.ts), Stock, Suscripción y el panel de admin.
export const FREE_PLAN_PRODUCT_LIMIT = 10;
