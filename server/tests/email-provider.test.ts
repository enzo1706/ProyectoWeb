import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Etapa 3.1 — tests del proveedor de email en sí (no del flujo completo de recuperación, eso
 * ya está cubierto en auth-password-reset.test.ts). Nunca hace un request real a Resend — el
 * SDK se mockea a nivel de módulo (vi.doMock) para poder probar sin salir del proceso.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.doUnmock("resend");
  vi.restoreAllMocks();
});

describe("buildPasswordResetEmailContent — contenido del email, sin mockear nada", () => {
  it("contiene el código de 6 dígitos, en HTML y en texto plano", async () => {
    const { buildPasswordResetEmailContent } = await import("../email");
    const { html, text } = buildPasswordResetEmailContent("482913", 10);
    expect(html).toContain("482913");
    expect(text).toContain("482913");
  });

  it("contiene la expiración en minutos", async () => {
    const { buildPasswordResetEmailContent } = await import("../email");
    const { html, text } = buildPasswordResetEmailContent("482913", 10);
    expect(html).toMatch(/10 minutos/);
    expect(text).toMatch(/10 minutos/);
  });

  it("advierte no compartir el código y avisa si la persona no lo solicitó", async () => {
    const { buildPasswordResetEmailContent } = await import("../email");
    const { html, text } = buildPasswordResetEmailContent("482913", 10);
    expect(html.toLowerCase()).toContain("nunca compart");
    expect(text.toLowerCase()).toContain("nunca compart");
    expect(html.toLowerCase()).toMatch(/no pediste|no solicitaste/);
    expect(text.toLowerCase()).toMatch(/no pediste|no solicitaste/);
  });

  it("no incluye ningún dato interno (password, hash, userId, consultantId, prefijo bcrypt)", async () => {
    const { buildPasswordResetEmailContent } = await import("../email");
    const { html, text } = buildPasswordResetEmailContent("482913", 10);
    const combined = `${html} ${text}`.toLowerCase();
    for (const forbidden of ["password", "\"hash\"", "userid", "consultantid", "$2a$", "$2b$"]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});

describe("getEmailProvider — selección de adapter según configuración", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sin RESEND_API_KEY, en desarrollo, usa ConsoleEmailProvider e imprime el código", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "development";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { sendPasswordResetCode } = await import("../email");
    await sendPasswordResetCode("a@b.com", "111111", 10);

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("111111"))).toBe(true);
  });

  it("sin RESEND_API_KEY, en producción, falla fuerte y NUNCA imprime el código en ningún log", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendPasswordResetCode } = await import("../email");
    await expect(sendPasswordResetCode("a@b.com", "222222", 10)).rejects.toThrow();

    expect(logSpy).not.toHaveBeenCalled();
    const errorOutput = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).not.toContain("222222");
  });

  it("con RESEND_API_KEY pero sin EMAIL_FROM, falla con un mensaje claro (no se manda nada a medio configurar)", async () => {
    process.env.RESEND_API_KEY = "re_fake_test_key";
    delete process.env.EMAIL_FROM;

    const { sendPasswordResetCode } = await import("../email");
    await expect(sendPasswordResetCode("a@b.com", "333333", 10)).rejects.toThrow(/EMAIL_FROM/);
  });

  it("con RESEND_API_KEY + EMAIL_FROM, arma la configuración y llama al SDK con los datos correctos", async () => {
    const sendMock = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null });
    vi.doMock("resend", () => ({
      // function normal, no arrow — el SDK real usa `new Resend(...)`, y una arrow function
      // no puede invocarse con `new` (vitest lo marca explícitamente como error).
      Resend: vi.fn().mockImplementation(function MockResend() {
        return { emails: { send: sendMock } };
      }),
    }));
    process.env.RESEND_API_KEY = "re_fake_test_key";
    process.env.EMAIL_FROM = "MaryKayManager <noreply@example.com>";

    const { sendPasswordResetCode } = await import("../email");
    await sendPasswordResetCode("consultora@example.com", "654321", 10);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const callArgs = sendMock.mock.calls[0][0];
    expect(callArgs.to).toBe("consultora@example.com");
    expect(callArgs.from).toBe("MaryKayManager <noreply@example.com>");
    expect(callArgs.html).toContain("654321");
    expect(callArgs.text).toContain("654321");
  });

  it("si Resend devuelve error, falla con mensaje genérico — nunca expone el detalle del proveedor ni la API key en ningún log", async () => {
    const sendMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Invalid API key", statusCode: 401, name: "invalid_api_key" },
    });
    vi.doMock("resend", () => ({
      // function normal, no arrow — el SDK real usa `new Resend(...)`, y una arrow function
      // no puede invocarse con `new` (vitest lo marca explícitamente como error).
      Resend: vi.fn().mockImplementation(function MockResend() {
        return { emails: { send: sendMock } };
      }),
    }));
    const FAKE_KEY = "re_fake_test_key_should_never_leak_anywhere";
    process.env.RESEND_API_KEY = FAKE_KEY;
    process.env.EMAIL_FROM = "MaryKayManager <noreply@example.com>";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendPasswordResetCode } = await import("../email");
    await expect(sendPasswordResetCode("a@b.com", "444444", 10)).rejects.toThrow(
      "No se pudo enviar el email de recuperación. Probá de nuevo más tarde.",
    );

    const errorOutput = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).not.toContain(FAKE_KEY);
    expect(errorOutput).not.toContain("444444"); // tampoco se loguea el código en este camino
  });
});
