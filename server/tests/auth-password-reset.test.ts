import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

// Intercepta el "envío" de email en el límite del módulo (mismo patrón que
// subscription-routes.test.ts mockea ../mercadopago) — nunca se manda nada real, y así el
// test puede leer el código sin parsear logs ni tocar ningún proveedor.
const sentCodes: Record<string, string> = {};
vi.mock("../email", () => ({
  sendPasswordResetCode: vi.fn((email: string, code: string) => {
    sentCodes[email] = code;
    return Promise.resolve();
  }),
}));

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

const PASSWORD = "vitest-test-password-123";
const NEW_PASSWORD = "vitest-new-password-456";

function uniqueUsername(tag: string): string {
  return `vitest_reset_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}
function uniqueEmail(tag: string): string {
  return `vitest.reset.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

// Cada test usa su propia IP sintética (X-Forwarded-For, trust proxy en 1 hop — ver app.ts)
// para no compartir balde de rate limit con los demás tests de este archivo. El único test
// que deliberadamente NO hace esto es el de rate limiting en sí (reusa la misma IP a propósito).
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.79.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function register(username: string, email: string, ip: string, password = PASSWORD) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ username, email, password }),
  });
  return res.json();
}

async function forgotPassword(email: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, body: await res.json() };
}

async function verifyCode(email: string, code: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/verify-reset-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email, code }),
  });
  return { status: res.status, body: await res.json() };
}

async function resetPassword(email: string, code: string, newPassword: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email, code, newPassword }),
  });
  return { status: res.status, body: await res.json() };
}

async function login(username: string, password: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ username, password }),
  });
  return res.status;
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  ({ storage } = await import("../storage"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Recuperación de contraseña", () => {
  it("12. email existente genera y envía un código de 6 dígitos", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("gen");
    const email = uniqueEmail("gen");
    await register(username, email, ip);

    const { status, body } = await forgotPassword(email, ip);
    expect(status).toBe(200);
    expect(typeof body.message).toBe("string");
    expect(sentCodes[email]).toMatch(/^\d{6}$/);
  });

  it("13. email inexistente devuelve la MISMA respuesta genérica (sin revelar si existe)", async () => {
    const ip = nextTestIp();
    const existingEmail = uniqueEmail("existegen");
    await register(uniqueUsername("existegen"), existingEmail, ip);
    const forExisting = await forgotPassword(existingEmail, ip);

    const forMissing = await forgotPassword(uniqueEmail("noexiste"), ip);

    expect(forMissing.status).toBe(forExisting.status);
    expect(forMissing.body.message).toBe(forExisting.body.message);
  });

  it("14. código correcto permite verificar y resetear", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("ok");
    const email = uniqueEmail("ok");
    await register(username, email, ip);
    await forgotPassword(email, ip);
    const code = sentCodes[email];

    const verify = await verifyCode(email, code, ip);
    expect(verify.status).toBe(200);
    expect(verify.body.valid).toBe(true);

    const reset = await resetPassword(email, code, NEW_PASSWORD, ip);
    expect(reset.status).toBe(200);
  });

  it("15. código incorrecto falla, con mensaje genérico", async () => {
    const ip = nextTestIp();
    const email = uniqueEmail("wrong");
    await register(uniqueUsername("wrong"), email, ip);
    await forgotPassword(email, ip);

    const verify = await verifyCode(email, "000000", ip);
    expect(verify.status).toBe(400);
    expect(verify.body.error).not.toMatch(/no existe|inexistente/i); // nunca delata existencia
  });

  it("16. código expirado falla", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("exp");
    const email = uniqueEmail("exp");
    await register(username, email, ip);
    await forgotPassword(email, ip);
    const code = sentCodes[email];

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000); // 11 minutos > 10 de expiración

    const verify = await verifyCode(email, code, ip);
    expect(verify.status).toBe(400);
    vi.useRealTimers();
  });

  it("17. un código ya usado no puede reutilizarse", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("used");
    const email = uniqueEmail("used");
    await register(username, email, ip);
    await forgotPassword(email, ip);
    const code = sentCodes[email];

    const first = await resetPassword(email, code, NEW_PASSWORD, ip);
    expect(first.status).toBe(200);

    const second = await resetPassword(email, code, "otra-contraseña-mas-789", ip);
    expect(second.status).toBe(400);
  });

  it("18. demasiados intentos fallidos bloquean incluso el código correcto", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("attempts");
    const email = uniqueEmail("attempts");
    await register(username, email, ip);
    await forgotPassword(email, ip);
    const code = sentCodes[email];

    // MAX_RESET_ATTEMPTS = 5 (server/auth-reset.ts) — 5 intentos fallidos consecutivos.
    for (let i = 0; i < 5; i++) {
      const attempt = await verifyCode(email, "111111", ip);
      expect(attempt.status).toBe(400);
    }

    // El código real, ahora, ya no sirve — se quemó por intentos, no por vencimiento.
    const finalAttempt = await verifyCode(email, code, ip);
    expect(finalAttempt.status).toBe(400);
  });

  it("19+20. la contraseña nueva permite login y la anterior deja de funcionar", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("switch");
    const email = uniqueEmail("switch");
    await register(username, email, ip, PASSWORD);
    await forgotPassword(email, ip);
    const code = sentCodes[email];
    await resetPassword(email, code, NEW_PASSWORD, ip);

    expect(await login(username, NEW_PASSWORD, ip)).toBe(200);
    expect(await login(username, PASSWORD, ip)).toBe(401);
  });

  it("21. una solicitud repetida invalida el código anterior — solo el más nuevo sirve", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("repeat");
    const email = uniqueEmail("repeat");
    await register(username, email, ip);

    await forgotPassword(email, ip);
    const firstCode = sentCodes[email];
    await forgotPassword(email, ip);
    const secondCode = sentCodes[email];
    expect(secondCode).not.toBe(firstCode);

    const withOldCode = await verifyCode(email, firstCode, ip);
    expect(withOldCode.status).toBe(400);

    const withNewCode = await verifyCode(email, secondCode, ip);
    expect(withNewCode.status).toBe(200);
  });

  it("22+23. el código nunca aparece en ninguna respuesta de la API, y nunca se guarda en texto plano", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("noleak");
    const email = uniqueEmail("noleak");
    await register(username, email, ip);
    const forgot = await forgotPassword(email, ip);
    const code = sentCodes[email];

    expect(JSON.stringify(forgot.body)).not.toContain(code);

    const verify = await verifyCode(email, code, ip);
    expect(JSON.stringify(verify.body)).not.toContain(code);

    const user = await storage.getUserByUsername(username);
    const record = await storage.getLatestPasswordResetCode(user!.id);
    expect(record).toBeDefined();
    expect(record!.codeHash).not.toBe(code);
    expect(record!.codeHash.startsWith("$2")).toBe(true); // prefijo estándar de un hash bcrypt

    const reset = await resetPassword(email, code, NEW_PASSWORD, ip);
    expect(JSON.stringify(reset.body)).not.toContain(code);
  });
});

describe("Seguridad — rate limiting de recuperación", () => {
  it("25. más de 5 solicitudes de recuperación desde la MISMA IP en la ventana responden 429", async () => {
    const ip = nextTestIp(); // una sola IP fija a propósito para las 6 llamadas de este test
    const email = uniqueEmail("ratelimit");
    let lastStatus = 200;
    for (let i = 0; i < 6; i++) {
      lastStatus = (await forgotPassword(email, ip)).status;
    }
    expect(lastStatus).toBe(429);
  });
});
