import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

const PASSWORD = "vitest-test-password-123";

function uniqueEmail(tag: string): string {
  return `vitest.regt.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}
// Prompt 14 — el registro ya no pide "usuario": lo deriva el backend del email. Cada llamada
// necesita su propio WhatsApp único (shared/phone.ts rechaza dígitos repetidos).
let nextWhatsappSuffix = 1;
function uniqueWhatsapp(): string {
  const suffix = String(nextWhatsappSuffix++).padStart(7, "0");
  return `261${suffix}`;
}

// Ver auth-register.test.ts: cada test usa su propia IP sintética (X-Forwarded-For, con
// trust proxy en 1 hop) para no compartir el balde del rate limiter con los demás tests.
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

describe("POST /api/auth/register — duplicados y unicidad de email", () => {
  it("4. email duplicado responde 409, la segunda cuenta nunca se crea", async () => {
    const ip = nextTestIp();
    const email = uniqueEmail("dup");
    const first = await register({ contactName: "Vitest Test", email, whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(first.status).toBe(201);

    const second = await register({ contactName: "Vitest Test", email, whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(second.status).toBe(409);
    expect(await storage.getUserByUsername((second.body as { username?: string })?.username ?? "")).toBeUndefined();
  });

  it("4b. mismo email con mayúsculas/espacios distintos también choca (normalización)", async () => {
    const ip = nextTestIp();
    const base = uniqueEmail("norm");
    const first = await register({ contactName: "Vitest Test", email: base, whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(first.status).toBe(201);

    const variant = `  ${base.toUpperCase()}  `;
    const second = await register({ contactName: "Vitest Test", email: variant, whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    expect(second.status).toBe(409);
  });

  it("Prompt 14: WhatsApp duplicado también responde 409 (ya no hay username elegido para duplicar)", async () => {
    const ip = nextTestIp();
    const whatsapp = uniqueWhatsapp();
    const first = await register({ contactName: "Vitest Test", email: uniqueEmail("wadup1"), whatsapp, password: PASSWORD }, ip);
    expect(first.status).toBe(201);

    const second = await register({ contactName: "Vitest Test", email: uniqueEmail("wadup2"), whatsapp, password: PASSWORD }, ip);
    expect(second.status).toBe(409);
  });
});

describe("POST /api/auth/register — no tenant injection", () => {
  it("7. un intento de consultantId ajeno en el body es ignorado — nace con su propio tenant", async () => {
    const ip = nextTestIp();
    const victim = await register({ contactName: "Vitest Test", email: uniqueEmail("victima"), whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    const victimUser = await storage.getUserByUsername((victim.body as { username: string }).username);
    expect(victimUser).toBeDefined();

    const attacker = await register(
      {
        contactName: "Vitest Test",
        email: uniqueEmail("atacante"),
        whatsapp: uniqueWhatsapp(),
        password: PASSWORD,
        consultantId: victimUser!.consultantId,
      },
      ip,
    );
    expect(attacker.status).toBe(201);
    const attackerUser = await storage.getUserByUsername((attacker.body as { username: string }).username);
    expect(attackerUser!.consultantId).not.toBe(victimUser!.consultantId);
  });

  it("8. cada registro crea un tenant (consultant) propio y nuevo", async () => {
    const ip = nextTestIp();
    const a = await register({ contactName: "Vitest Test", email: uniqueEmail("tenanta"), whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    const b = await register({ contactName: "Vitest Test", email: uniqueEmail("tenantb"), whatsapp: uniqueWhatsapp(), password: PASSWORD }, ip);
    const userA = await storage.getUserByUsername((a.body as { username: string }).username);
    const userB = await storage.getUserByUsername((b.body as { username: string }).username);

    expect(userA!.consultantId).not.toBeNull();
    expect(userB!.consultantId).not.toBeNull();
    expect(userA!.consultantId).not.toBe(userB!.consultantId);
  });
});

describe("Multi-tenancy del registro", () => {
  it("10+11. dos registros nuevos crean dos tenants distintos, y A no ve datos creados por B", async () => {
    const ipA = nextTestIp();
    const ipB = nextTestIp();
    const a = await register({ contactName: "Vitest Test", email: uniqueEmail("iso_a"), whatsapp: uniqueWhatsapp(), password: PASSWORD }, ipA);
    const b = await register({ contactName: "Vitest Test", email: uniqueEmail("iso_b"), whatsapp: uniqueWhatsapp(), password: PASSWORD }, ipB);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const userA = await storage.getUserByUsername((a.body as { username: string }).username);
    const userB = await storage.getUserByUsername((b.body as { username: string }).username);
    expect(userA!.consultantId).not.toBe(userB!.consultantId);

    const cookieA = a.cookie!;
    const cookieB = b.cookie!;

    // B crea una clienta propia.
    const createRes = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB, "X-Forwarded-For": ipB },
      body: JSON.stringify({ name: "Clienta de B", phone: "2611234567" }),
    });
    expect(createRes.status).toBe(201);

    // A jamás debe ver esa clienta en su propio listado.
    const listAsA = await fetch(`${baseUrl}/api/clients`, { headers: { Cookie: cookieA, "X-Forwarded-For": ipA } });
    const clientsOfA = await listAsA.json();
    expect(Array.isArray(clientsOfA) ? clientsOfA.length : 0).toBe(0);
  });
});
