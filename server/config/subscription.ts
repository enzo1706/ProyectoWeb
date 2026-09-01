/**
 * Configuración central de la suscripción — única fuente de verdad para precio y duraciones.
 * Nunca duplicar estos valores en otro archivo: el frontend nunca decide el precio, y
 * cualquier cálculo de trial/período debe importar estas constantes, no repetirlas.
 */
export const SUBSCRIPTION_PRICE_ARS = 20000;
export const TRIAL_DAYS = 10;
export const PERIOD_DAYS = 30;
export const PLAN_NAME = "Suscripción completa";
