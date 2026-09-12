import { Resend } from "resend";

/**
 * Abstracción del envío de email — Etapa 3 (registro + recuperación de contraseña), proveedor
 * real agregado en la Etapa 3.1.
 *
 * El resto del backend (server/auth-reset.ts) llama únicamente a `sendPasswordResetCode`, sin
 * saber nada del proveedor concreto — cambiar de proveedor el día de mañana es escribir OTRO
 * adapter acá, sin tocar nada de la lógica de negocio.
 *
 * Proveedor elegido: Resend (ver informe de la Etapa 3.1 para la comparación completa contra
 * SMTP genérico vía nodemailer). Motivo resumido: un solo secreto (API key, vs. host+user+
 * password de SMTP), SDK oficial TypeScript minimalista, diseñado específicamente para email
 * transaccional (mejor deliverability por defecto que SMTP genérico), volumen gratuito más que
 * suficiente para códigos de recuperación de contraseña. El "lock-in" real es bajo porque la
 * abstracción EmailProvider ya aísla el costo de cambiar: migrar a otro proveedor es escribir
 * un adapter nuevo, no tocar auth-reset.ts ni las rutas.
 */
export interface SendPasswordResetCodeInput {
  email: string;
  code: string;
  expiryMinutes: number;
}

export interface EmailProvider {
  sendPasswordResetCode(input: SendPasswordResetCodeInput): Promise<void>;
}

export interface PasswordResetEmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Contenido del email — separado de "cómo se envía" a propósito: cualquier adapter (Resend,
 * SMTP, el que sea en el futuro) lo reutiliza tal cual, y se puede testear sin mockear ningún
 * proveedor ni hacer ningún request real. Nunca incluye password, hash, consultantId, userId
 * ni ningún dato interno — solo lo que la consultora necesita para completar el reset.
 */
export function buildPasswordResetEmailContent(code: string, expiryMinutes: number): PasswordResetEmailContent {
  const subject = "Código para restablecer tu contraseña — MaryKayManager";

  const text =
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta de MaryKayManager.\n\n` +
    `Tu código de verificación es: ${code}\n\n` +
    `Este código vence en ${expiryMinutes} minutos y solo se puede usar una vez.\n\n` +
    `Nunca compartas este código con nadie, ni siquiera con alguien que diga ser del equipo de MaryKayManager.\n\n` +
    `Si vos no pediste este cambio, podés ignorar este email — tu contraseña actual sigue funcionando sin cambios.`;

  const html = `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a; line-height: 1.5;">
  <h2 style="color: #b8336a; margin-bottom: 4px;">MaryKayManager</h2>
  <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; margin: 24px 0; background: #f5f5f5; border-radius: 8px;">${code}</p>
  <p>Este código vence en <strong>${expiryMinutes} minutos</strong> y solo se puede usar <strong>una vez</strong>.</p>
  <p style="color: #b91c1c;"><strong>Nunca compartas este código con nadie</strong>, ni siquiera con alguien que diga ser del equipo de MaryKayManager.</p>
  <p style="color: #666; font-size: 13px; margin-top: 24px;">Si vos no pediste este cambio, podés ignorar este email — tu contraseña actual sigue funcionando sin cambios.</p>
</div>
`.trim();

  return { subject, html, text };
}

/**
 * Adapter de desarrollo/test: nunca sale de este proceso, nunca golpea una red real. Solo
 * imprime el código en la consola del servidor — y únicamente fuera de producción. Regla
 * explícita de la Etapa 3: el código real de recuperación no debe poder aparecer en logs de
 * producción, así que en producción este adapter se niega a "enviar" en silencio — falla
 * fuerte en cambio, para que el problema (falta RESEND_API_KEY configurada) sea visible de
 * inmediato y no un código de recuperación que la consultora nunca recibió.
 */
class ConsoleEmailProvider implements EmailProvider {
  async sendPasswordResetCode({ email, code, expiryMinutes }: SendPasswordResetCodeInput): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error(
        `No hay un proveedor de email real configurado (falta RESEND_API_KEY) — no se pudo ` +
          `enviar el código de recuperación a ${email}. El código nunca se imprime en producción.`,
      );
      throw new Error("No se pudo enviar el email de recuperación. Probá de nuevo más tarde.");
    }

    console.log(
      `\n[dev] Código de recuperación de contraseña para ${email}: ${code} ` +
        `(vence en ${expiryMinutes} minutos)\n` +
        "(Este código solo se imprime en desarrollo — nunca en producción.)\n",
    );
  }
}

/**
 * Adapter real — Etapa 3.1. Solo se activa si RESEND_API_KEY está configurada (ver
 * getEmailProvider); si falta, cae en ConsoleEmailProvider, que en producción falla fuerte en
 * vez de fingir que envió algo.
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async sendPasswordResetCode({ email, code, expiryMinutes }: SendPasswordResetCodeInput): Promise<void> {
    const { subject, html, text } = buildPasswordResetEmailContent(code, expiryMinutes);

    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject,
      html,
      text,
    });

    if (error) {
      // Nunca se loguea el objeto completo del error del SDK (podría traer detalle de la
      // request) ni la API key — solo el mensaje del proveedor. El email del destinatario sí
      // se loguea: mismo nivel de logging que el resto de la app (ver server/routes.ts), no
      // es un dato secreto en sí mismo.
      console.error(`Resend no pudo enviar el código de recuperación a ${email}: ${error.message}`);
      throw new Error("No se pudo enviar el email de recuperación. Probá de nuevo más tarde.");
    }
  }
}

let provider: EmailProvider | null = null;

/**
 * Único punto de decisión de qué adapter usar. RESEND_API_KEY presente → Resend real (necesita
 * también EMAIL_FROM, o falla con un mensaje claro). Sin ella → ConsoleEmailProvider (dev
 * imprime, producción sin configurar falla fuerte). No depende de NODE_ENV directamente — así
 * queda posible, por ejemplo, probar el adapter real desde un entorno de staging si algún día
 * existe, con solo setear la variable.
 */
export function getEmailProvider(): EmailProvider {
  if (provider) return provider;

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.EMAIL_FROM;
    if (!from) {
      throw new Error("Falta EMAIL_FROM — es obligatoria cuando RESEND_API_KEY está configurada.");
    }
    provider = new ResendEmailProvider(apiKey, from);
  } else {
    provider = new ConsoleEmailProvider();
  }
  return provider;
}

/** Único punto de entrada para el resto del backend — ver server/auth-reset.ts. */
export async function sendPasswordResetCode(email: string, code: string, expiryMinutes: number): Promise<void> {
  await getEmailProvider().sendPasswordResetCode({ email, code, expiryMinutes });
}
