import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real — mismo criterio que auth-register.test.ts.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

const PASSWORD = "vitest-test-password-123";

function uniqueEmail(tag: string): string {
  return `vitest.profile.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

let nextWhatsappSuffix = 1;
function uniqueWhatsapp(): string {
  const suffix = String(nextWhatsappSuffix++).padStart(7, "0");
  return `261${suffix}`;
}

let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.78.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
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
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function patchProfile(cookie: string, body: unknown, ip: string) {
  const res = await fetch(`${baseUrl}/api/consultant/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function registerFreshConsultant(tag: string, ip: string) {
  const email = uniqueEmail(tag);
  const whatsapp = uniqueWhatsapp();
  const res = await register({ contactName: `Consultora ${tag}`, email, whatsapp, password: PASSWORD }, ip);
  expect(res.status).toBe(201);
  return { email, whatsapp, cookie: res.cookie!, username: res.body.username as string };
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

describe("PATCH /api/consultant/profile — Prompt 14, ajuste: contraseña para cambiar email o WhatsApp", () => {
  it("sin currentPassword, cambiando el email: 400, no cambia nada", async () => {
    const ip = nextTestIp();
    const { email, cookie } = await registerFreshConsultant("sinpass", ip);
    const res = await patchProfile(cookie, { email: uniqueEmail("nuevo") }, ip);
    expect(res.status).toBe(400);

    // El email sigue siendo el original.
    const loginRes = await login(email, PASSWORD, ip);
    expect(loginRes.status).toBe(200);
  });

  it("sin currentPassword, cambiando el WhatsApp: 400, no cambia nada", async () => {
    const ip = nextTestIp();
    const { whatsapp, cookie } = await registerFreshConsultant("sinpasswsp", ip);
    const res = await patchProfile(cookie, { whatsapp: uniqueWhatsapp() }, ip);
    expect(res.status).toBe(400);

    const loginRes = await login(whatsapp, PASSWORD, ip);
    expect(loginRes.status).toBe(200);
  });

  it("con currentPassword incorrecta: 403, no cambia nada", async () => {
    const ip = nextTestIp();
    const { email, cookie } = await registerFreshConsultant("passmala", ip);
    const newEmail = uniqueEmail("nuevo2");
    const res = await patchProfile(cookie, { email: newEmail, currentPassword: "esta-no-es-la-contraseña" }, ip);
    expect(res.status).toBe(403);

    const oldStillWorks = await login(email, PASSWORD, ip);
    expect(oldStillWorks.status).toBe(200);
    const newDoesNotExist = await login(newEmail, PASSWORD, ip);
    expect(newDoesNotExist.status).toBe(401);
  });

  it("con currentPassword correcta: 200, el email cambia de verdad", async () => {
    const ip = nextTestIp();
    const { email, cookie } = await registerFreshConsultant("passok", ip);
    const newEmail = uniqueEmail("nuevo3");
    const res = await patchProfile(cookie, { email: newEmail, currentPassword: PASSWORD }, ip);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(newEmail);

    const byNewEmail = await login(newEmail, PASSWORD, ip);
    expect(byNewEmail.status).toBe(200);
    const byOldEmail = await login(email, PASSWORD, ip);
    expect(byOldEmail.status).toBe(401); // el viejo ya no es de nadie
  });

  it("con currentPassword correcta: 200, el WhatsApp cambia de verdad", async () => {
    const ip = nextTestIp();
    const { whatsapp, cookie } = await registerFreshConsultant("passokwsp", ip);
    const newWhatsapp = uniqueWhatsapp();
    const res = await patchProfile(cookie, { whatsapp: newWhatsapp, currentPassword: PASSWORD }, ip);
    expect(res.status).toBe(200);
    expect(res.body.whatsapp).toBe(newWhatsapp);

    const byNewWhatsapp = await login(newWhatsapp, PASSWORD, ip);
    expect(byNewWhatsapp.status).toBe(200);
    const byOldWhatsapp = await login(whatsapp, PASSWORD, ip);
    expect(byOldWhatsapp.status).toBe(401);
  });

  it("email repetido de otra cuenta: 409, no cambia nada (con contraseña correcta)", async () => {
    const ip = nextTestIp();
    const other = await registerFreshConsultant("otroemail", ip);
    const { email, cookie } = await registerFreshConsultant("propioemail", ip);
    const res = await patchProfile(cookie, { email: other.email, currentPassword: PASSWORD }, ip);
    expect(res.status).toBe(409);

    const stillOriginal = await login(email, PASSWORD, ip);
    expect(stillOriginal.status).toBe(200);
  });

  it("WhatsApp repetido de otra cuenta: 409, no cambia nada (con contraseña correcta)", async () => {
    const ip = nextTestIp();
    const other = await registerFreshConsultant("otrowsp", ip);
    const { whatsapp, cookie } = await registerFreshConsultant("propiowsp", ip);
    const res = await patchProfile(cookie, { whatsapp: other.whatsapp, currentPassword: PASSWORD }, ip);
    expect(res.status).toBe(409);

    const stillOriginal = await login(whatsapp, PASSWORD, ip);
    expect(stillOriginal.status).toBe(200);
  });
});

describe("Prompt 14, ajuste — el WhatsApp nunca puede coincidir con el username de otra cuenta", () => {
  it("registro: WhatsApp igual al username de una cuenta vieja responde 409, no crea nada", async () => {
    const ip = nextTestIp();
    const phoneLikeUsername = `26199${String(Date.now()).slice(-5)}`;
    await storage.createUser({ username: phoneLikeUsername, password: PASSWORD, role: "consultant", status: true });

    const email = uniqueEmail("choquereg");
    const res = await register({ contactName: "Nueva", email, whatsapp: phoneLikeUsername, password: PASSWORD }, ip);
    expect(res.status).toBe(409);
    expect(await storage.getUserByConsultantEmail(email)).toBeUndefined();
  });

  it("Tus datos: guardar un WhatsApp igual al username de OTRA cuenta responde 409, no cambia nada", async () => {
    const ip = nextTestIp();
    const phoneLikeUsername = `26198${String(Date.now()).slice(-5)}`;
    await storage.createUser({ username: phoneLikeUsername, password: PASSWORD, role: "consultant", status: true });

    const { whatsapp, cookie } = await registerFreshConsultant("choqueperfil", ip);
    const res = await patchProfile(cookie, { whatsapp: phoneLikeUsername, currentPassword: PASSWORD }, ip);
    expect(res.status).toBe(409);

    const stillOriginal = await login(whatsapp, PASSWORD, ip);
    expect(stillOriginal.status).toBe(200);
  });

  it("Tus datos: guardar como WhatsApp el PROPIO username no se bloquea (no es 'otra' cuenta)", async () => {
    const ip = nextTestIp();
    // Cuenta vieja, sin email/whatsapp, cuyo propio username tiene forma de WhatsApp.
    const ownPhoneUsername = `26197${String(Date.now()).slice(-5)}`;
    const user = await storage.createUser({ username: ownPhoneUsername, password: PASSWORD, role: "consultant", status: true });
    const loginRes = await login(ownPhoneUsername, PASSWORD, ip);
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.cookie!;

    const res = await patchProfile(cookie, { whatsapp: ownPhoneUsername, currentPassword: PASSWORD }, ip);
    expect(res.status).toBe(200);
    expect(res.body.whatsapp).toBe(ownPhoneUsername);
    void user;
  });

  it("login: cuenta vieja con username con forma de WhatsApp (sin WhatsApp propio) entra tipeando ese mismo string", async () => {
    const ip = nextTestIp();
    const phoneLikeUsername = `26196${String(Date.now()).slice(-5)}`;
    await storage.createUser({ username: phoneLikeUsername, password: PASSWORD, role: "consultant", status: true });

    // Antes de este ajuste, esto daba 401: se buscaba SOLO como WhatsApp, nunca como usuario.
    const res = await login(phoneLikeUsername, PASSWORD, ip);
    expect(res.status).toBe(200);
  });

  it("login: si SÍ hay una cuenta con ese WhatsApp, el fallback a username nunca se intenta (sigue entrando por WhatsApp)", async () => {
    const ip = nextTestIp();
    const phoneLikeDigits = `26195${String(Date.now()).slice(-5)}`;
    // Cuenta vieja con ESE string como username, pero CONTRASEÑA DISTINTA — si el fallback se
    // intentara igual (porque el match por WhatsApp no se encontró), este login fallaría.
    await storage.createUser({ username: phoneLikeDigits, password: "otra-contraseña-cualquiera-999", role: "consultant", status: true });

    // Otra cuenta con ese mismo string como WhatsApp. El guard nuevo (WhatsAppMatchesUsernameError)
    // ya impide crear esta combinación por los caminos normales de acá en adelante — para probar
    // que el login sigue resolviendo bien datos YA existentes (de antes del guard), se arma
    // directo en memoria, único lugar donde MemoryStorage expone sus arrays internos (mismo
    // criterio que ya usan business-settings.test.ts / subscription-pricing.test.ts).
    const { consultant } = await storage.registerConsultant({
      contactName: "Con WhatsApp",
      email: uniqueEmail("conwsp"),
      whatsapp: uniqueWhatsapp(),
      password: PASSWORD,
    });
    (storage as any).consultants.find((c: { id: number }) => c.id === consultant.id).whatsapp = phoneLikeDigits;

    const loginRes = await login(phoneLikeDigits, PASSWORD, ip);
    expect(loginRes.status).toBe(200); // entró por WhatsApp, con la contraseña de ESA cuenta (no la del username viejo)
  });
});
