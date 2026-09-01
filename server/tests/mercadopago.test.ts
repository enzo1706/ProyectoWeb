import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-fake-access-token-not-real";
process.env.MERCADOPAGO_WEBHOOK_SECRET = "fake-webhook-secret-not-real";

const createMock = vi.fn();

vi.mock("mercadopago", () => {
  class MercadoPagoConfig {
    accessToken: string;
    constructor(config: { accessToken: string }) {
      this.accessToken = config.accessToken;
    }
  }
  class PreApproval {
    create(input: unknown) {
      return createMock(input);
    }
  }
  class Payment {}
  class WebhookSignatureValidator {
    static validate = vi.fn();
  }
  class InvalidWebhookSignatureError extends Error {}
  return { MercadoPagoConfig, PreApproval, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError };
});

import { createSubscriptionPreapproval, verifyWebhookSignature } from "../mercadopago";
import { SUBSCRIPTION_PRICE_ARS, PLAN_NAME } from "../config/subscription";
import { WebhookSignatureValidator } from "mercadopago";

beforeEach(() => {
  createMock.mockReset();
  vi.mocked(WebhookSignatureValidator.validate).mockReset();
});

describe("createSubscriptionPreapproval", () => {
  it("3. el precio y el plan siempre salen de server/config/subscription.ts, nunca de un parámetro", async () => {
    createMock.mockResolvedValue({ id: "PA-123", init_point: "https://mp.example/checkout/PA-123", status: "pending" });

    await createSubscriptionPreapproval({
      externalReference: "sub-1-abc",
      payerEmail: "consultora@example.com",
      backUrl: "https://app.example.com/subscription/success",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const body = createMock.mock.calls[0][0].body;
    expect(body.auto_recurring.transaction_amount).toBe(SUBSCRIPTION_PRICE_ARS);
    expect(body.auto_recurring.currency_id).toBe("ARS");
    expect(body.auto_recurring.frequency).toBe(1);
    expect(body.auto_recurring.frequency_type).toBe("months");
    expect(body.reason).toBe(PLAN_NAME);
    // La función no tiene ningún parámetro de precio/monto — no hay forma de que un caller
    // (incluida la ruta HTTP) le pase un precio distinto al de la config.
    expect(Object.keys(body)).not.toContain("card_token_id");
    expect(body.status).toBe("pending");
  });

  it("no manda card_token_id: Mercado Pago hostea la autorización del medio de pago, nunca nosotros", async () => {
    createMock.mockResolvedValue({ id: "PA-456", init_point: "https://mp.example/checkout/PA-456", status: "pending" });
    await createSubscriptionPreapproval({
      externalReference: "sub-2-abc",
      payerEmail: "otra@example.com",
      backUrl: "https://app.example.com/subscription/success",
    });
    const body = createMock.mock.calls[0][0].body;
    expect(body.card_token_id).toBeUndefined();
  });

  it("propaga el externalReference y payerEmail tal cual se le pasan", async () => {
    createMock.mockResolvedValue({ id: "PA-789", init_point: "https://mp.example/checkout/PA-789", status: "pending" });
    await createSubscriptionPreapproval({
      externalReference: "sub-42-xyz",
      payerEmail: "consultora42@example.com",
      backUrl: "https://app.example.com/subscription/success",
    });
    const body = createMock.mock.calls[0][0].body;
    expect(body.external_reference).toBe("sub-42-xyz");
    expect(body.payer_email).toBe("consultora42@example.com");
  });

  it("tira un error claro si Mercado Pago no devuelve id/init_point", async () => {
    createMock.mockResolvedValue({ status: "pending" });
    await expect(
      createSubscriptionPreapproval({ externalReference: "sub-1-abc", payerEmail: "x@example.com", backUrl: "https://x" }),
    ).rejects.toThrow();
  });
});

describe("verifyWebhookSignature", () => {
  it("delega en WebhookSignatureValidator.validate del SDK oficial con el secret de env", () => {
    verifyWebhookSignature({ xSignature: "ts=123,v1=abc", xRequestId: "req-1", dataId: "PAY-1" });
    expect(WebhookSignatureValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ xSignature: "ts=123,v1=abc", xRequestId: "req-1", dataId: "PAY-1", secret: "fake-webhook-secret-not-real" }),
    );
  });

  it("propaga el error si la validación del SDK rechaza la firma", () => {
    vi.mocked(WebhookSignatureValidator.validate).mockImplementation(() => {
      throw new Error("firma inválida");
    });
    expect(() => verifyWebhookSignature({ xSignature: "bad", xRequestId: "req-2", dataId: "PAY-2" })).toThrow();
  });
});
