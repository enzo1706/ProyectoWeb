import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const DAY_MS = 24 * 60 * 60 * 1000;

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

// Un único login real compartido por casi todos los casos — el gate solo depende del estado
// de `subscriptions` en el momento del request, no de nada guardado en la sesión, así que
// alcanza con mutar la fila entre tests. Loguear una consultora nueva por caso pegaría contra
// el rate limiter real de /api/auth/login (10 intentos / 15 min) sin necesidad.
let sharedConsultantId: number;
let sharedCookie: string;

async function createLoggedInConsultant(usernamePrefix: string) {
  const username = `${usernamePrefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const user = await storage.createUser({
    username,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!;
  return { consultantId: user.consultantId!, username, cookie };
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  ({ storage } = await import("../storage"));

  const shared = await createLoggedInConsultant("vitest_gate_shared");
  sharedConsultantId = shared.consultantId;
  sharedCookie = shared.cookie;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

/** Endpoint de negocio representativo de los 6 prefijos que ahora exigen suscripción activa
 * — GET /api/products, sin efectos secundarios, misma cadena requireAuth+requireConsultant+
 * requireActiveSubscription que /api/clients, /api/sales, /api/appointments, /api/reports,
 * /api/dashboard (los 6 se montan con exactamente la misma cadena de middleware). */
async function getProtectedRoute(cookie: string) {
  return fetch(`${baseUrl}/api/products`, { headers: { Cookie: cookie } });
}

/** MemoryStorage.getSubscriptionByConsultantId devuelve la referencia real, no una copia —
 * mutar los campos acá persiste en el store, igual que ya se usaba en los tests de Etapa B. */
async function subRow(consultantId: number) {
  const sub = await storage.getSubscriptionByConsultantId(consultantId);
  expect(sub).toBeDefined();
  return sub as any;
}

describe("requireActiveSubscription — gate de acceso por suscripción", () => {
  it("1. trial vigente → acceso permitido a rutas de negocio", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.trialEndAt = new Date(Date.now() + 5 * DAY_MS);
    sub.currentPeriodStart = null;
    sub.currentPeriodEnd = null;
    sub.canceledAt = null;

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("2. trial vencido → endpoint protegido responde 403 subscription_required", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);
    sub.currentPeriodEnd = null;

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("subscription_required");
  });

  it("3. active con currentPeriodEnd vigente → acceso permitido", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "active";
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(Date.now() + 29 * DAY_MS);

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("4. active vencida (currentPeriodEnd pasado) → bloqueo", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "active";
    sub.currentPeriodStart = new Date(Date.now() - 31 * DAY_MS);
    sub.currentPeriodEnd = new Date(Date.now() - 1 * DAY_MS);

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(403);
  });

  it("5. preapproval autorizado en Mercado Pago pero sin payment aprobado → nunca otorga acceso pago (currentPeriodEnd sigue null)", async () => {
    const sub = await subRow(sharedConsultantId);
    // Simula lo que deja el webhook de subscription_preapproval: solo guarda el
    // mpPreapprovalId, nunca toca status/currentPeriodEnd — ver handleApprovedPaymentTopic,
    // la rama "subscription_preapproval" es puramente informativa (server/routes.ts).
    sub.status = "trial";
    sub.mpPreapprovalId = "PA-authorized-sin-pago";
    sub.currentPeriodEnd = null;
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS); // trial ya vencido — "authorized" no la salva

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(403);
  });

  it("6. canceled con currentPeriodEnd todavía vigente → bloqueada (regla actual: canceled siempre bloquea, no se inventa una excepción)", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "canceled";
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(Date.now() + 15 * DAY_MS);
    sub.canceledAt = new Date();

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(403);
  });

  it("7. canceled sin período vigente → bloqueada", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "canceled";
    sub.currentPeriodEnd = null;
    sub.canceledAt = new Date();

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(403);
  });

  it("8. /api/subscription/status sigue accesible con la suscripción vencida", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.canceledAt = null;
    sub.currentPeriodEnd = null;
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    const res = await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: sharedCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasAccess).toBe(false);
  });

  it("9. /api/subscription/start sigue accesible con la suscripción vencida (nunca 403 por el gate, aunque falle después por otra razón)", async () => {
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sharedCookie },
      body: JSON.stringify({ email: "bloqueada@example.com" }),
    });
    // Puede fallar más adelante por otra razón (acá, Mercado Pago no configurado en test →
    // 500), pero nunca por el gate — eso es justo lo que se está probando.
    expect(res.status).not.toBe(403);
  });

  it("11. /api/health sigue funcionando sin sesión, independiente del estado de cualquier suscripción", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it("10. login sigue funcionando para una consultora con la suscripción vencida", async () => {
    const { consultantId, cookie } = await createLoggedInConsultant("vitest_gate_login_ok");
    const sub = await subRow(consultantId);
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    // El login en sí ya fue el punto que se está probando (createLoggedInConsultant no tira
    // si /api/auth/login falla — se confirma acá que la cookie realmente autenticó).
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
  });

  it("13. una consultora con la suscripción vencida no puede sortear el bloqueo pegándole directo a los 6 endpoints protegidos, sin pasar por el frontend", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.canceledAt = null;
    sub.currentPeriodEnd = null;
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    const [products, clients, sales, appointments, reports, dashboard] = await Promise.all([
      fetch(`${baseUrl}/api/products`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/clients`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/sales`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/appointments`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/reports/sales-summary?start=2026-01-01&end=2026-12-31`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/dashboard/seed-demo`, { method: "POST", headers: { Cookie: sharedCookie } }),
    ]);
    for (const res of [products, clients, sales, appointments, reports, dashboard]) {
      expect(res.status).toBe(403);
    }
  });
});
