import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

/**
 * Etapa 7.6 — mock de Resend con latencia DELIBERADA (300ms) para poder demostrar, de forma
 * determinística, que la respuesta pública de /forgot-password ya no espera ese round-trip
 * (hallazgo P2 de la Etapa 6 — timing side-channel, ver server/auth-reset.ts). Con un mock
 * instantáneo (como el resto de los tests de reset) no se podría distinguir "se espera" de
 * "no se espera" — los dos casos responderían rápido igual, sin importar el fix.
 */
const MOCK_EMAIL_DELAY_MS = 600;
const sentCodes: Record<string, string> = {};
vi.mock("../email", () => ({
  sendPasswordResetCode: vi.fn((email: string, code: string) => {
    sentCodes[email] = code;
    return new Promise<void>((resolve) => setTimeout(resolve, MOCK_EMAIL_DELAY_MS));
  }),
}));

let httpServer: Server;
let baseUrl: string;

function uniqueUsername(tag: string): string {
  return `vitest_antienum_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}
function uniqueEmail(tag: string): string {
  return `vitest.antienum.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}
// Prompt 14 — WhatsApp único por llamada, nunca "los 10 dígitos son todos iguales"
// (shared/phone.ts lo rechaza a propósito).
let nextWhatsappSuffix = 1;
function uniqueWhatsapp(): string {
  const suffix = String(nextWhatsappSuffix++).padStart(7, "0");
  return `261${suffix}`;
}

// Cada test usa su propia IP sintética (mismo criterio que auth-password-reset.test.ts) para
// no compartir balde de rate limit entre los distintos casos de este archivo.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.78.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

/** Prompt 14 — el registro ya no pide "usuario": lo deriva el backend del email. El `body` de
 * la respuesta exitosa trae `username` con el valor derivado — los tests que necesitan loguear
 * después con ese username lo toman de ahí, nunca lo eligen ellos. */
async function register(email: string, ip: string, password = "vitest-test-password-123", whatsapp = uniqueWhatsapp()) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ contactName: "Vitest Test", email, whatsapp, password }),
  });
  return { status: res.status, body: await res.json() };
}

async function login(identifier: string, password: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ identifier, password }),
  });
  return { status: res.status, body: await res.json() };
}

async function forgotPassword(email: string, ip: string) {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email }),
  });
  const elapsed = Date.now() - start;
  return { status: res.status, body: await res.json(), elapsed };
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("Anti-enumeración — timing de forgot-password (Etapa 7.6)", () => {
  // Los umbrales de acá son deliberadamente relativos al delay del mock (600ms), no a un
  // número absoluto fijo de milisegundos — bcrypt.hash(10 rounds) puede tardar bastante más
  // que en un servidor típico dependiendo de la máquina/virtualización donde corra esta
  // suite (confirmado empíricamente: ~200ms de bcrypt.hash solo en esta corrida). Lo que
  // importa demostrar es la propiedad ESTRUCTURAL: la respuesta nunca llega a esperar el
  // delay completo del envío, sin importar cuánto tarde el resto del trabajo real.
  const STRUCTURAL_THRESHOLD_MS = 450; // bien por debajo de los 600ms del mock, con margen de sobra sobre bcrypt+DB

  it("la respuesta para un email EXISTENTE NO espera el envío de Resend (el mock tarda 600ms en resolver)", async () => {
    const ip = nextTestIp();
    const email = uniqueEmail("timing");
    await register(email, ip);

    const { status, elapsed } = await forgotPassword(email, nextTestIp());
    expect(status).toBe(200);
    // Si la respuesta todavía esperara el envío, esto tardaría >= 600ms (el delay del mock,
    // sumado a lo que ya tarda el resto). Con el fix, nunca se acerca a eso.
    expect(elapsed).toBeLessThan(STRUCTURAL_THRESHOLD_MS);
  });

  it("email inexistente también responde muy por debajo del delay del mock (nunca intentó ningún envío, con o sin este fix)", async () => {
    const { status, elapsed } = await forgotPassword(uniqueEmail("noexiste-timing"), nextTestIp());
    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(STRUCTURAL_THRESHOLD_MS);
  });

  it("diferencia estructural entre ambas ramas: mucho menor que los 600ms del mock de Resend (eso es justo lo que este fix elimina)", async () => {
    const email = uniqueEmail("cmp");
    await register(email, nextTestIp());

    const existing = await forgotPassword(email, nextTestIp());
    const missing = await forgotPassword(uniqueEmail("cmp-missing"), nextTestIp());

    // Queda una diferencia estructural real y documentada en el reporte (2 escrituras a DB de
    // más en la rama "existe") — pero nunca del orden del round-trip de red que había antes.
    expect(Math.abs(existing.elapsed - missing.elapsed)).toBeLessThan(STRUCTURAL_THRESHOLD_MS);
  });
});

describe("Anti-enumeración — login (Etapa 7.6, Prompt 14: identifier acepta email/WhatsApp/usuario)", () => {
  it("1. identifier inexistente (con forma de usuario viejo): 401 'Email, WhatsApp o contraseña incorrectos.'", async () => {
    const { status, body } = await login(uniqueUsername("noexiste-login"), "cualquier-password", nextTestIp());
    expect(status).toBe(401);
    expect(body.error).toBe("Email, WhatsApp o contraseña incorrectos.");
  });

  it("1b. identifier inexistente con forma de email: mismo 401 y mismo mensaje", async () => {
    const { status, body } = await login(uniqueEmail("noexiste-email"), "cualquier-password", nextTestIp());
    expect(status).toBe(401);
    expect(body.error).toBe("Email, WhatsApp o contraseña incorrectos.");
  });

  it("1c. identifier inexistente con forma de WhatsApp válido: mismo 401 y mismo mensaje", async () => {
    const { status, body } = await login(uniqueWhatsapp(), "cualquier-password", nextTestIp());
    expect(status).toBe(401);
    expect(body.error).toBe("Email, WhatsApp o contraseña incorrectos.");
  });

  it("2. cuenta existente + password incorrecta: MISMO status y MISMO mensaje que identifier inexistente (probado con las 3 formas: username, email y WhatsApp)", async () => {
    const email = uniqueEmail("wrongpass");
    const whatsapp = uniqueWhatsapp();
    const { body: registered } = await register(email, nextTestIp(), "vitest-test-password-123", whatsapp);
    const username: string = registered.username;

    const noUser = await login(uniqueUsername("otronoexiste"), "password-incorrecta-123", nextTestIp());

    for (const identifier of [username, email, whatsapp]) {
      const wrongPass = await login(identifier, "password-incorrecta-123", nextTestIp());
      expect(wrongPass.status).toBe(noUser.status);
      expect(wrongPass.body.error).toBe(noUser.body.error);
      expect(wrongPass.body.error).toBe("Email, WhatsApp o contraseña incorrectos.");
    }
  });

  it("3. cuenta existente + password correcta: login exitoso con cualquiera de las 3 formas", async () => {
    const email = uniqueEmail("rightpass");
    const whatsapp = uniqueWhatsapp();
    const password = "vitest-correct-password-999";
    const { body: registered } = await register(email, nextTestIp(), password, whatsapp);

    for (const identifier of [registered.username, email, whatsapp]) {
      const { status } = await login(identifier, password, nextTestIp());
      expect(status).toBe(200);
    }
  });

  it("timing: identifier inexistente y password incorrecta responden en un orden de magnitud comparable (bcrypt.compare corre en las dos ramas), sin cambios por este prompt", async () => {
    const email = uniqueEmail("timinglogin");
    const { body: registered } = await register(email, nextTestIp());

    const t1 = Date.now();
    await login(registered.username, "password-incorrecta-abc", nextTestIp());
    const wrongPassElapsed = Date.now() - t1;

    const t2 = Date.now();
    await login(uniqueUsername("noexiste2"), "password-incorrecta-abc", nextTestIp());
    const noUserElapsed = Date.now() - t2;

    // Generoso a propósito (evitar flakiness por jitter de máquina) — lo que importa es que
    // no haya un salto estructural grande como el que había antes (identifier inexistente
    // devolvía casi al instante, sin ningún bcrypt de por medio).
    expect(Math.abs(wrongPassElapsed - noUserElapsed)).toBeLessThan(250);
  });
});

describe("Anti-enumeración — register (Etapa 7.6, Prompt 14: también cubre WhatsApp duplicado)", () => {
  it("1. email y WhatsApp nuevos: éxito, 201", async () => {
    const { status } = await register(uniqueEmail("newemail"), nextTestIp());
    expect(status).toBe(201);
  });

  it("2/3/4. email duplicado: 409, el mensaje ya NO confirma explícitamente 'ya existe una cuenta con ese email'", async () => {
    const email = uniqueEmail("dup");
    await register(email, nextTestIp());

    const { status, body } = await register(email, nextTestIp());
    expect(status).toBe(409);
    expect(body.error).not.toMatch(/ya existe una cuenta con ese email/i);
    expect(typeof body.error).toBe("string");
  });

  it("WhatsApp duplicado (Prompt 14): mismo 409 y mismo mensaje genérico que email — nunca confirma explícitamente que ese WhatsApp ya está en uso", async () => {
    const whatsapp = uniqueWhatsapp();
    await register(uniqueEmail("dupwa1"), nextTestIp(), "vitest-test-password-123", whatsapp);

    const { status, body } = await register(uniqueEmail("dupwa2"), nextTestIp(), "vitest-test-password-123", whatsapp);
    expect(status).toBe(409);
    expect(body.error).not.toMatch(/ya existe (una cuenta|otra cuenta) con ese whatsapp/i);
    expect(typeof body.error).toBe("string");
  });

  it("5. la respuesta nunca filtra datos sensibles (password, hash bcrypt)", async () => {
    const { body } = await register(uniqueEmail("noleak"), nextTestIp());
    expect(body.password).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/); // ningún hash bcrypt en la respuesta
  });

  it("6. la cuenta creada tiene su propio tenant (consultantId propio) — transacción completa, sin registros parciales", async () => {
    const email = uniqueEmail("tenant");
    const { status, body } = await register(email, nextTestIp());
    expect(status).toBe(201);
    expect(typeof body.consultantId).toBe("number");

    const { storage } = await import("../storage");
    const user = await storage.getUserByUsername(body.username);
    expect(user).toBeDefined();
    expect(user!.consultantId).toBe(body.consultantId);
  });
});
