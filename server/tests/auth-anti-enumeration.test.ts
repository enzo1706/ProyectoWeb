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

// Cada test usa su propia IP sintética (mismo criterio que auth-password-reset.test.ts) para
// no compartir balde de rate limit entre los distintos casos de este archivo.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.78.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function register(username: string, email: string, ip: string, password = "vitest-test-password-123") {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ username, email, password }),
  });
  return { status: res.status, body: await res.json() };
}

async function login(username: string, password: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ username, password }),
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
    const username = uniqueUsername("timing");
    const email = uniqueEmail("timing");
    await register(username, email, ip);

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
    const username = uniqueUsername("cmp");
    const email = uniqueEmail("cmp");
    await register(username, email, nextTestIp());

    const existing = await forgotPassword(email, nextTestIp());
    const missing = await forgotPassword(uniqueEmail("cmp-missing"), nextTestIp());

    // Queda una diferencia estructural real y documentada en el reporte (2 escrituras a DB de
    // más en la rama "existe") — pero nunca del orden del round-trip de red que había antes.
    expect(Math.abs(existing.elapsed - missing.elapsed)).toBeLessThan(STRUCTURAL_THRESHOLD_MS);
  });
});

describe("Anti-enumeración — login (Etapa 7.6)", () => {
  it("1. usuario inexistente: 401 'Credenciales inválidas'", async () => {
    const { status, body } = await login(uniqueUsername("noexiste-login"), "cualquier-password", nextTestIp());
    expect(status).toBe(401);
    expect(body.error).toBe("Credenciales inválidas");
  });

  it("2. usuario existente + password incorrecta: MISMO status y MISMO mensaje que usuario inexistente", async () => {
    const username = uniqueUsername("wrongpass");
    const email = uniqueEmail("wrongpass");
    await register(username, email, nextTestIp());

    const wrongPass = await login(username, "password-incorrecta-123", nextTestIp());
    const noUser = await login(uniqueUsername("otronoexiste"), "password-incorrecta-123", nextTestIp());

    expect(wrongPass.status).toBe(noUser.status);
    expect(wrongPass.body.error).toBe(noUser.body.error);
    expect(wrongPass.body.error).toBe("Credenciales inválidas");
  });

  it("3. usuario existente + password correcta: login exitoso", async () => {
    const username = uniqueUsername("rightpass");
    const email = uniqueEmail("rightpass");
    const password = "vitest-correct-password-999";
    await register(username, email, nextTestIp(), password);

    const { status } = await login(username, password, nextTestIp());
    expect(status).toBe(200);
  });

  it("timing: usuario inexistente y password incorrecta responden en un orden de magnitud comparable (bcrypt.compare corre en las dos ramas)", async () => {
    const username = uniqueUsername("timinglogin");
    const email = uniqueEmail("timinglogin");
    await register(username, email, nextTestIp());

    const t1 = Date.now();
    await login(username, "password-incorrecta-abc", nextTestIp());
    const wrongPassElapsed = Date.now() - t1;

    const t2 = Date.now();
    await login(uniqueUsername("noexiste2"), "password-incorrecta-abc", nextTestIp());
    const noUserElapsed = Date.now() - t2;

    // Generoso a propósito (evitar flakiness por jitter de máquina) — lo que importa es que
    // no haya un salto estructural grande como el que había antes (usuario inexistente
    // devolvía casi al instante, sin ningún bcrypt de por medio).
    expect(Math.abs(wrongPassElapsed - noUserElapsed)).toBeLessThan(250);
  });
});

describe("Anti-enumeración — register (Etapa 7.6)", () => {
  it("1. email nuevo: éxito, 201", async () => {
    const { status } = await register(uniqueUsername("newemail"), uniqueEmail("newemail"), nextTestIp());
    expect(status).toBe(201);
  });

  it("2/3/4. email duplicado: 409, el mensaje ya NO confirma explícitamente 'ya existe una cuenta con ese email'", async () => {
    const email = uniqueEmail("dup");
    await register(uniqueUsername("dup1"), email, nextTestIp());

    const { status, body } = await register(uniqueUsername("dup2"), email, nextTestIp());
    expect(status).toBe(409);
    expect(body.error).not.toMatch(/ya existe una cuenta con ese email/i);
    expect(typeof body.error).toBe("string");
  });

  it("username duplicado: sigue con mensaje específico (dato público, no sensible — sin cambios de esta etapa)", async () => {
    const username = uniqueUsername("dupuser");
    await register(username, uniqueEmail("dupuser1"), nextTestIp());

    const { status, body } = await register(username, uniqueEmail("dupuser2"), nextTestIp());
    expect(status).toBe(409);
    expect(body.error).toMatch(/nombre de usuario ya está en uso/i);
  });

  it("5. la respuesta nunca filtra datos sensibles (password, hash bcrypt)", async () => {
    const { body } = await register(uniqueUsername("noleak"), uniqueEmail("noleak"), nextTestIp());
    expect(body.password).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/); // ningún hash bcrypt en la respuesta
  });

  it("6. la cuenta creada tiene su propio tenant (consultantId propio) — transacción completa, sin registros parciales", async () => {
    const username = uniqueUsername("tenant");
    const { status, body } = await register(username, uniqueEmail("tenant"), nextTestIp());
    expect(status).toBe(201);
    expect(typeof body.consultantId).toBe("number");

    const { storage } = await import("../storage");
    const user = await storage.getUserByUsername(username);
    expect(user).toBeDefined();
    expect(user!.consultantId).toBe(body.consultantId);
  });
});
