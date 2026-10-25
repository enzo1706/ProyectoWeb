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

// Un único login real compartido por casi todos los casos — ya no hay ningún gate que
// dependa de nada guardado en la sesión, así que alcanza con mutar la fila de subscriptions
// entre tests. Loguear una consultora nueva por caso pegaría contra el rate limiter real de
// /api/auth/login (10 intentos / 15 min) sin necesidad.
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
    body: JSON.stringify({ identifier: username, password: "vitest-test-password-123" }),
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

/** Endpoint de negocio representativo de los 6 prefijos que ANTES del Prompt 14 exigían
 * suscripción activa — GET /api/products, sin efectos secundarios. Desde el Prompt 14 (P30)
 * estos 6 prefijos (products/clients/sales/appointments/reports/dashboard) ya NO tienen
 * ningún gate de suscripción — solo requireAuth+requireConsultant. */
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

describe("Prompt 14 (P30) — ya no hay gate de suscripción, el plan gratis tiene acceso a todo", () => {
  it("1. trial vigente → acceso permitido", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.trialEndAt = new Date(Date.now() + 5 * DAY_MS);
    sub.currentPeriodStart = null;
    sub.currentPeriodEnd = null;
    sub.canceledAt = null;

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("2. trial con trialEndAt en el pasado → acceso IGUAL permitido (ya no vence por fecha, Prompt 14)", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);
    sub.currentPeriodEnd = null;

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("3. active con currentPeriodEnd vigente → acceso permitido", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "active";
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(Date.now() + 29 * DAY_MS);

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("4. active vencida (currentPeriodEnd pasado) → acceso permitido igual, pasa al plan gratis", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "active";
    sub.currentPeriodStart = new Date(Date.now() - 31 * DAY_MS);
    sub.currentPeriodEnd = new Date(Date.now() - 1 * DAY_MS);

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("5. preapproval autorizado en Mercado Pago pero sin payment aprobado (currentPeriodEnd sigue null) → acceso permitido igual (plan gratis)", async () => {
    const sub = await subRow(sharedConsultantId);
    // Simula lo que deja el webhook de subscription_preapproval: solo guarda el
    // mpPreapprovalId, nunca toca status/currentPeriodEnd — ver handleApprovedPaymentTopic,
    // la rama "subscription_preapproval" es puramente informativa (server/routes.ts).
    sub.status = "trial";
    sub.mpPreapprovalId = "PA-authorized-sin-pago";
    sub.currentPeriodEnd = null;
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("6. canceled con currentPeriodEnd todavía vigente → acceso permitido igual (Prompt 14: canceled nunca bloquea, cae en plan gratis como cualquier otro estado sin pago activo)", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "canceled";
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(Date.now() + 15 * DAY_MS);
    sub.canceledAt = new Date();

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("7. canceled sin período vigente → acceso permitido igual", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "canceled";
    sub.currentPeriodEnd = null;
    sub.canceledAt = new Date();

    const res = await getProtectedRoute(sharedCookie);
    expect(res.status).toBe(200);
  });

  it("8. /api/subscription/status sigue accesible y reporta isFreePlan true para una suscripción 'vencida'", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.canceledAt = null;
    sub.currentPeriodEnd = null;
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    const res = await fetch(`${baseUrl}/api/subscription/status`, { headers: { Cookie: sharedCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasAccess).toBe(true);
    expect(body.isFreePlan).toBe(true);
  });

  it("9. /api/subscription/start sigue accesible con la suscripción vencida (nunca 403, aunque falle después por otra razón)", async () => {
    const res = await fetch(`${baseUrl}/api/subscription/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sharedCookie },
      body: JSON.stringify({ email: "bloqueada@example.com" }),
    });
    // Puede fallar más adelante por otra razón (acá, Mercado Pago no configurado en test →
    // 500), pero nunca por un gate de suscripción — eso es justo lo que se está probando.
    expect(res.status).not.toBe(403);
  });

  it("11. /api/health sigue funcionando sin sesión, independiente del estado de cualquier suscripción", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it("10. login sigue funcionando para una consultora con la suscripción 'vencida'", async () => {
    const { consultantId, cookie } = await createLoggedInConsultant("vitest_gate_login_ok");
    const sub = await subRow(consultantId);
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    // El login en sí ya fue el punto que se está probando (createLoggedInConsultant no tira
    // si /api/auth/login falla — se confirma acá que la cookie realmente autenticó).
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
  });

  it("13. una consultora con la suscripción vencida/cancelada accede a los 6 endpoints que antes bloqueaba el gate, pegándoles directo sin pasar por el frontend", async () => {
    const sub = await subRow(sharedConsultantId);
    sub.status = "trial";
    sub.canceledAt = null;
    sub.currentPeriodEnd = null;
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    // Golpea el prefijo pelado de cada uno (sin parámetros) — a varios eso les da 400 por
    // validación propia del endpoint (ej. /api/appointments pide un rango de fechas) y a
    // /api/dashboard un 404 llano (no tiene ruta propia, solo el middleware montado, igual
    // que antes de este prompt) — nada de eso es lo que se prueba acá. Lo que importa
    // confirmar es que NINGUNO devuelve 401/403: antes del Prompt 14, los 6 sí daban 403 con
    // esta misma suscripción "vencida", porque requireActiveSubscription cortaba antes de
    // llegar a la validación propia de cada endpoint.
    const [products, clients, sales, appointments, reports, dashboard] = await Promise.all([
      fetch(`${baseUrl}/api/products`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/clients`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/sales`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/appointments`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/reports/sales-summary?start=2026-01-01&end=2026-12-31`, { headers: { Cookie: sharedCookie } }),
      fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: sharedCookie } }),
    ]);
    for (const res of [products, clients, sales, appointments, reports, dashboard]) {
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  });
});
