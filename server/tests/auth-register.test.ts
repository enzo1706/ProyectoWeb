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

function uniqueEmail(tag: string): string {
  return `vitest.reg.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

// Prompt 14 — WhatsApp único por llamada, sin caer nunca en "los 10 dígitos son todos
// iguales" (shared/phone.ts lo rechaza a propósito). Un contador alcanza, no hace falta nada
// más elaborado.
let nextWhatsappSuffix = 1;
function uniqueWhatsapp(): string {
  const suffix = String(nextWhatsappSuffix++).padStart(7, "0");
  return `261${suffix}`;
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

async function login(identifier: string, password: string, ip: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ identifier, password }),
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

describe("registerConsultantSchema (validación pura, sin HTTP) — Prompt 14: sin 'username', con WhatsApp", () => {
  it("rechaza email con formato inválido", () => {
    expect(
      registerConsultantSchema.safeParse({ contactName: "Ana Pérez", email: "no-es-un-email", whatsapp: "261 555 1234", password: PASSWORD })
        .success,
    ).toBe(false);
  });
  it("rechaza contraseña de menos de 6 caracteres", () => {
    expect(
      registerConsultantSchema.safeParse({ contactName: "Ana Pérez", email: "a@b.com", whatsapp: "261 555 1234", password: "123" }).success,
    ).toBe(false);
  });
  it("rechaza WhatsApp con formato inválido (ej. con el '15' clásico intercalado)", () => {
    expect(
      registerConsultantSchema.safeParse({ contactName: "Ana Pérez", email: "a@b.com", whatsapp: "0261 15 555 1234", password: PASSWORD })
        .success,
    ).toBe(false);
  });
  it("rechaza contactName vacío", () => {
    expect(registerConsultantSchema.safeParse({ contactName: "", email: "a@b.com", whatsapp: "261 555 1234", password: PASSWORD }).success).toBe(
      false,
    );
  });
  it("rechaza campos faltantes (contactName, email, whatsapp o password)", () => {
    expect(registerConsultantSchema.safeParse({ email: "a@b.com", whatsapp: "261 555 1234", password: PASSWORD }).success).toBe(false);
    expect(registerConsultantSchema.safeParse({ contactName: "Ana", whatsapp: "261 555 1234", password: PASSWORD }).success).toBe(false);
    expect(registerConsultantSchema.safeParse({ contactName: "Ana", email: "a@b.com", password: PASSWORD }).success).toBe(false);
    expect(registerConsultantSchema.safeParse({ contactName: "Ana", email: "a@b.com", whatsapp: "261 555 1234" }).success).toBe(false);
  });
  it("acepta un registro válido y normaliza el WhatsApp a 10 dígitos", () => {
    const parsed = registerConsultantSchema.safeParse({
      contactName: "Ana Pérez",
      email: "a@b.com",
      whatsapp: "+54 9 261 555 1234",
      password: PASSWORD,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.whatsapp).toBe("2615551234");
  });
  it("ya no tiene ningún campo 'username' — el registro público dejó de pedirlo (Prompt 14)", () => {
    expect("username" in registerConsultantSchema.shape).toBe(false);
  });
});

describe("POST /api/auth/register (Prompt 14: nombre, email, WhatsApp y contraseña — sin usuario)", () => {
  it("1. registro válido crea la cuenta, deja sesión iniciada, nunca devuelve el password, y el username se deriva del email", async () => {
    const ip = nextTestIp();
    const email = uniqueEmail("valido");
    const whatsapp = uniqueWhatsapp();
    const { status, body, cookie } = await register({ contactName: "Ana Pérez", email, whatsapp, password: PASSWORD }, ip);

    expect(status).toBe(201);
    // El username derivado es la parte del email antes de la "@" (ver storage.deriveUniqueUsername).
    expect(body.username).toBe(email.split("@")[0]);
    expect(body.role).toBe("consultant");
    expect(body.password).toBeUndefined();
    expect(cookie).toBeTruthy(); // auto-login: la respuesta ya trae cookie de sesión

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie!, "X-Forwarded-For": ip } });
    expect(me.status).toBe(200);

    // Login posterior funciona con el email.
    const loginByEmail = await login(email, PASSWORD, ip);
    expect(loginByEmail.status).toBe(200);
    // ...y con el WhatsApp.
    const loginByWhatsapp = await login(whatsapp, PASSWORD, ip);
    expect(loginByWhatsapp.status).toBe(200);
    // ...y con el username derivado (como una cuenta vieja con usuario propio).
    const loginByUsername = await login(body.username, PASSWORD, ip);
    expect(loginByUsername.status).toBe(200);
  });

  it("2. email inválido responde 400 y no crea nada", async () => {
    const ip = nextTestIp();
    const email = "no-es-un-email";
    const { status } = await register({ contactName: "Ana Pérez", email, whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(status).toBe(400);
  });

  it("3. campo obligatorio faltante (contactName) responde 400", async () => {
    const ip = nextTestIp();
    const { status } = await register({ email: uniqueEmail("nocontact"), whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(status).toBe(400);
  });

  it("4. WhatsApp con formato inválido responde 400 y no crea nada", async () => {
    const ip = nextTestIp();
    const email = uniqueEmail("whatsappinvalido");
    const { status } = await register({ contactName: "Ana Pérez", email, whatsapp: "0261 15 555 1234", password: PASSWORD }, ip);
    expect(status).toBe(400);
    expect(await storage.getUserByConsultantEmail(email)).toBeUndefined();
  });

  it("6. un intento de role=admin en el body es ignorado — la cuenta creada es consultant, sin privilege escalation", async () => {
    const ip = nextTestIp();
    const { status, body, cookie } = await register(
      { contactName: "Ana Pérez", email: uniqueEmail("roleadmin"), whatsapp: uniqueWhatsapp(), password: PASSWORD, role: "admin" },
      ip,
    );
    expect(status).toBe(201);
    expect(body.role).toBe("consultant");

    // No privilege escalation: esta sesión NO puede pegarle a una ruta admin-only.
    const adminRes = await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: cookie!, "X-Forwarded-For": ip } });
    expect(adminRes.status).toBe(403);
  });

  it("7. el username derivado nunca coincide con la forma de un WhatsApp válido (evita que el login lo busque siempre como WhatsApp primero)", async () => {
    const ip = nextTestIp();
    // El local-part del email ES, literalmente, un WhatsApp argentino válido de 10 dígitos.
    const phoneLikeLocalPart = "2615559999";
    const email = `${phoneLikeLocalPart}@example.com`;
    const { status, body } = await register({ contactName: "Ana Pérez", email, whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(status).toBe(201);
    // El username NUNCA puede quedar igual al local-part puro si ese string es un WhatsApp
    // válido — tiene que llevar un sufijo (ver storage.deriveUniqueUsername).
    expect(body.username).not.toBe(phoneLikeLocalPart);
    expect(body.username.startsWith(phoneLikeLocalPart)).toBe(true);
  });

  it("8. dos registros con emails de local-part idéntico (distinto dominio) reciben usernames distintos, con sufijo en el segundo", async () => {
    const ip1 = nextTestIp();
    const ip2 = nextTestIp();
    const localPart = `vitestdup${Date.now()}`;
    const first = await register(
      { contactName: "Primera", email: `${localPart}@dominio-uno.com`, whatsapp: uniqueWhatsapp(), password: PASSWORD },
      ip1,
    );
    const second = await register(
      { contactName: "Segunda", email: `${localPart}@dominio-dos.com`, whatsapp: uniqueWhatsapp(), password: PASSWORD },
      ip2,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.username).toBe(localPart);
    expect(second.body.username).not.toBe(localPart);
    expect(second.body.username.startsWith(localPart)).toBe(true);
  });
});
