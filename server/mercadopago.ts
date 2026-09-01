import { MercadoPagoConfig, PreApproval, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago";
import { SUBSCRIPTION_PRICE_ARS, PLAN_NAME } from "./config/subscription";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set. Did you forget to set it in your environment variables?`);
  }
  return value;
}

let configInstance: MercadoPagoConfig | undefined;
/** Lazy: como storage.ts/db.ts — no falla al importar el módulo si falta la credencial, solo
 * al primer uso real (así el resto de la app arranca igual sin Mercado Pago configurado). */
function getConfig(): MercadoPagoConfig {
  configInstance ??= new MercadoPagoConfig({ accessToken: requireEnv("MERCADOPAGO_ACCESS_TOKEN") });
  return configInstance;
}

export interface CreateSubscriptionPreapprovalInput {
  externalReference: string;
  payerEmail: string;
  backUrl: string;
}

export interface CreatedPreapproval {
  id: string;
  initPoint: string;
  status: string;
}

/**
 * Crea un preapproval SIN card_token_id ni preapproval_plan_id — un único plan, precio desde
 * config, `status: "pending"` para que Mercado Pago devuelva `init_point` y sea SU checkout
 * hospedado el que le pide a la consultora que autorice/configure su medio de pago (nunca
 * nuestro backend ve ni toca datos de tarjeta).
 */
export async function createSubscriptionPreapproval(input: CreateSubscriptionPreapprovalInput): Promise<CreatedPreapproval> {
  const preApproval = new PreApproval(getConfig());
  const response = await preApproval.create({
    body: {
      reason: PLAN_NAME,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        // La API lo acepta sin esto y completa la fecha actual por su cuenta — pero el
        // checkout web (cow-payment_summary) parece necesitarlo explícito para poder armar
        // el texto de "subscription-description" y habilitar el botón "Confirmar" (evidencia:
        // Etapa D, ese span queda vacío y el botón deshabilitado cuando se omite este campo).
        // +60s de margen: Mercado Pago rechaza con 400 ("cannot be a past date") si para
        // cuando el request llega a sus servidores el instante exacto de `new Date()` ya
        // quedó en el pasado (confirmado con el error real en Etapa D).
        start_date: new Date(Date.now() + 60_000).toISOString(),
        // La referencia oficial de creación de preapproval indica que start_date solo se
        // reconoce si además se manda end_date. No reemplaza nuestra lógica de negocio: el
        // acceso real lo seguimos calculando nosotros (storage.applyApprovedPayment, 30 días
        // por pago aprobado) — esto es únicamente el límite que Mercado Pago exige para su
        // propio cobro recurrente automático del lado de ellos.
        end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        transaction_amount: SUBSCRIPTION_PRICE_ARS,
        currency_id: "ARS",
      },
    },
  });
  if (!response.id || !response.init_point) {
    throw new Error("Mercado Pago no devolvió id/init_point al crear el preapproval");
  }
  return { id: response.id, initPoint: response.init_point, status: response.status ?? "pending" };
}

/** Server-to-server: nunca se confía en el payload del webhook por sí solo, siempre se
 * reconsulta el recurso real contra la API de Mercado Pago con nuestro Access Token. */
export async function getSubscriptionPreapproval(id: string) {
  const preApproval = new PreApproval(getConfig());
  return preApproval.get({ id });
}

export async function getMercadoPagoPayment(id: string) {
  const payment = new Payment(getConfig());
  return payment.get({ id });
}

export interface WebhookSignatureInput {
  xSignature: string | string[] | undefined | null;
  xRequestId: string | string[] | undefined | null;
  dataId: string | string[] | undefined | null;
}

/**
 * Defensa de firma (HMAC-SHA256, `WebhookSignatureValidator` del SDK oficial) — NO es la
 * defensa principal, esa es siempre volver a consultar el recurso real (ver
 * getSubscriptionPreapproval/getMercadoPagoPayment). Riesgo conocido, sin confirmar todavía:
 * Railway podría reescribir `x-request-id` en tránsito, lo que rompería esta validación en
 * producción aunque el webhook sea legítimo — hay que probarlo empíricamente una vez
 * desplegado (ver informe de Etapa C). Si eso pasa, NO desactivar la validación como
 * workaround: la defensa server-to-server sigue siendo suficiente por sí sola.
 */
export function verifyWebhookSignature(input: WebhookSignatureInput): void {
  const secret = requireEnv("MERCADOPAGO_WEBHOOK_SECRET");
  WebhookSignatureValidator.validate({ ...input, secret, toleranceSeconds: 300 });
}

export { InvalidWebhookSignatureError };
