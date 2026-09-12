import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { registerConsultantSchema } from "@shared/schema";

// Modo memoria, sin tocar Postgres/Supabase real — mismo criterio que admin-users.test.ts.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

const PASSWORD = "vitest-test-password-123";

function uniqueUsername(tag: string): string {
  return `vitest_reg_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}
function uniqueEmail(tag: string): string {
  return `vitest.reg.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

// registerRateLimiter/loginRateLimiter cuentan por IP (Express respeta X-Forwarded-For acá
// porque app.ts tiene "trust proxy" en 1 hop) — cada test usa su PROPIA IP sintética para no
// compartir balde con los demás tests de este archivo. No es un workaround: así también se
// comportaría en producción tráfico real de dos IPs distintas.
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.77.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function register(body: unknown, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function login(username: string, password: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] };
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

describe("registerConsultantSchema (validación pura, sin HTTP)", () => {
  it("rechaza email con formato inválido", () => {
    expect(registerConsultantSchema.safeParse({ username: "abcde", email: "no-es-un-email", password: PASSWORD }).success).toBe(false);
  });
  it("rechaza contraseña de menos de 6 caracteres", () => {
    expect(registerConsultantSchema.safeParse({ username: "abcde", email: "a@b.com", password: "123" }).success).toBe(false);
  });
  it("rechaza username de menos de 3 caracteres", () => {
    expect(registerConsultantSchema.safeParse({ username: "ab", email: "a@b.com", password: PASSWORD }).success).toBe(false);
  });
  it("rechaza campos faltantes (username, email o password)", () => {
    expect(registerConsultantSchema.safeParse({ email: "a@b.com", password: PASSWORD }).success).toBe(false);
    expect(registerConsultantSchema.safeParse({ username: "abcde", password: PASSWORD }).success).toBe(false);
    expect(registerConsultantSchema.safeParse({ username: "abcde", email: "a@b.com" }).success).toBe(false);
  });
  it("acepta un registro válido", () => {
    expect(registerConsultantSchema.safeParse({ username: "abcde", email: "a@b.com", password: PASSWORD }).success).toBe(true);
  });
});

describe("POST /api/auth/register", () => {
  it("1. registro válido crea la cuenta, deja sesión iniciada, nunca devuelve el password, y permite loguear después", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("valido");
    const email = uniqueEmail("valido");
    const { status, body, cookie } = await register({ username, email, password: PASSWORD }, ip);

    expect(status).toBe(201);
    expect(body.username).toBe(username);
    expect(body.role).toBe("consultant");
    expect(body.password).toBeUndefined();
    expect(cookie).toBeTruthy(); // auto-login: la respuesta ya trae cookie de sesión

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie!, "X-Forwarded-For": ip } });
    expect(me.status).toBe(200);

    // 9. login posterior funciona con la misma contraseña.
    const loginResult = await login(username, PASSWORD, ip);
    expect(loginResult.status).toBe(200);
  });

  it("2. email inválido responde 400 y no crea nada", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("emailinvalido");
    const { status } = await register({ username, email: "no-es-un-email", password: PASSWORD }, ip);
    expect(status).toBe(400);
    expect(await storage.getUserByUsername(username)).toBeUndefined();
  });

  it("3. campo obligatorio faltante (username) responde 400", async () => {
    const ip = nextTestIp();
    const { status } = await register({ email: uniqueEmail("nouser"), password: PASSWORD }, ip);
    expect(status).toBe(400);
  });

  it("6. un intento de role=admin en el body es ignorado — la cuenta creada es consultant, sin privilege escalation", async () => {
    const ip = nextTestIp();
    const username = uniqueUsername("roleadmin");
    const { status, body, cookie } = await register(
      { username, email: uniqueEmail("roleadmin"), password: PASSWORD, role: "admin" },
      ip,
    );
    expect(status).toBe(201);
    expect(body.role).toBe("consultant");

    // No privilege escalation: esta sesión NO puede pegarle a una ruta admin-only.
    const adminRes = await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: cookie!, "X-Forwarded-For": ip } });
    expect(adminRes.status).toBe(403);
  });
});
