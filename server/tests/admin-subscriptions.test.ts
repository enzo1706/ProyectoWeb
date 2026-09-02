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
let adminCookie: string;

async function login(username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: res.headers.get("set-cookie") };
}

async function subRow(consultantId: number) {
  const sub = await storage.getSubscriptionByConsultantId(consultantId);
  expect(sub).toBeDefined();
  return sub as any;
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  ({ storage } = await import("../storage"));

  // ensureDefaultAdmin corre en NODE_ENV distinto de "production" — en test también.
  const adminLogin = await login("admin", "admin123");
  adminCookie = adminLogin.cookie!;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("GET /api/admin/subscriptions", () => {
  it("1. admin puede listar suscripciones", async () => {
    const res = await fetch(`${baseUrl}/api/admin/subscriptions`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.summary).toHaveProperty("total");
  });

  it("3. una consultora (no admin) no puede acceder al listado administrativo", async () => {
    const user = await storage.createUser({
      username: `vitest_admin_deny_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const { cookie } = await login(user.username, "vitest-test-password-123");
    const res = await fetch(`${baseUrl}/api/admin/subscriptions`, { headers: { Cookie: cookie! } });
    expect(res.status).toBe(403);
  });

  it("5. el estado mostrado coincide con la misma lógica central del gate (trial vencido → expired)", async () => {
    const user = await storage.createUser({
      username: `vitest_admin_status_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const consultantId = user.consultantId!;
    const sub = await subRow(consultantId);
    sub.trialEndAt = new Date(Date.now() - 1 * DAY_MS);

    const res = await fetch(`${baseUrl}/api/admin/subscriptions`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    const row = body.rows.find((r: any) => r.consultantId === consultantId);
    expect(row).toBeDefined();
    expect(row.status).toBe("expired");
    expect(row.hasAccess).toBe(false);
  });

  it("9. filtro por status funciona", async () => {
    const user = await storage.createUser({
      username: `vitest_admin_filter_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const consultantId = user.consultantId!;
    const sub = await subRow(consultantId);
    sub.status = "active";
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(Date.now() + 29 * DAY_MS);

    const res = await fetch(`${baseUrl}/api/admin/subscriptions?status=active`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    expect(body.rows.every((r: any) => r.status === "active")).toBe(true);
    expect(body.rows.some((r: any) => r.consultantId === consultantId)).toBe(true);
  });

  it("10. una consultora sin fila de subscription aparece igual en el listado (no rompe, no se omite)", async () => {
    // MemoryStorage.createUser siempre crea la subscription junto con el consultant — se
    // simula el caso huérfano (real en producción antes del backfill de la Etapa F)
    // insertando el consultant/user directo, sin pasar por ese camino.
    const user = await storage.createUser({
      username: `vitest_admin_orphan_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const consultantId = user.consultantId!;
    // Se le "quita" la subscription para simular el huérfano.
    const memStorage = storage as any;
    memStorage.subscriptions = memStorage.subscriptions.filter((s: any) => s.consultantId !== consultantId);

    const res = await fetch(`${baseUrl}/api/admin/subscriptions`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    const row = body.rows.find((r: any) => r.consultantId === consultantId);
    expect(row).toBeDefined();
    expect(row.status).toBe("expired");
    expect(row.hasAccess).toBe(false);
    expect(row.trialEndAt).toBeNull();
  });

  it("11. la respuesta nunca incluye password ni ningún secreto de Mercado Pago", async () => {
    const res = await fetch(`${baseUrl}/api/admin/subscriptions`, { headers: { Cookie: adminCookie } });
    const text = await res.text();
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/access_?token/i);
    expect(text).not.toMatch(/webhook_?secret/i);
  });
});

describe("GET /api/admin/subscriptions/:consultantId/payments", () => {
  it("4. devuelve únicamente los pagos de esa consultora, nunca los de otra", async () => {
    const userA = await storage.createUser({
      username: `vitest_admin_pay_a_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const userB = await storage.createUser({
      username: `vitest_admin_pay_b_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const consultantA = userA.consultantId!;
    const consultantB = userB.consultantId!;
    await storage.updateSubscription(consultantA, { mpPreapprovalId: "PA-admin-a" });
    await storage.updateSubscription(consultantB, { mpPreapprovalId: "PA-admin-b" });

    await storage.applyApprovedPayment(consultantA, {
      externalReference: `sub-${consultantA}-a1`,
      mpPreapprovalId: "PA-admin-a",
      mpPaymentId: "PAY-admin-a-1",
      amount: 20000,
      statusDetail: "accredited",
      rawPayload: {},
    });
    await storage.applyApprovedPayment(consultantB, {
      externalReference: `sub-${consultantB}-b1`,
      mpPreapprovalId: "PA-admin-b",
      mpPaymentId: "PAY-admin-b-1",
      amount: 20000,
      statusDetail: "accredited",
      rawPayload: {},
    });

    const res = await fetch(`${baseUrl}/api/admin/subscriptions/${consultantA}/payments`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const payments = await res.json();
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every((p: any) => p.consultantId === consultantA)).toBe(true);
    expect(payments.some((p: any) => p.mpPaymentId === "PAY-admin-b-1")).toBe(false);
  });
});

describe("GET /api/admin/payments", () => {
  it("2. admin puede consultar el ledger global de pagos", async () => {
    const res = await fetch(`${baseUrl}/api/admin/payments`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.summary).toHaveProperty("approvedRevenue");
  });

  it("3b. una consultora (no admin) no puede acceder al ledger global de pagos", async () => {
    const user = await storage.createUser({
      username: `vitest_admin_pay_deny_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const { cookie } = await login(user.username, "vitest-test-password-123");
    const res = await fetch(`${baseUrl}/api/admin/payments`, { headers: { Cookie: cookie! } });
    expect(res.status).toBe(403);
  });

  it("6+7+8. approvedRevenue solo suma pagos approved — nunca rejected/in_process/pending", async () => {
    const user = await storage.createUser({
      username: `vitest_admin_revenue_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const consultantId = user.consultantId!;
    await storage.updateSubscription(consultantId, { mpPreapprovalId: "PA-revenue-1" });

    // Un approved real (vía applyApprovedPayment, el único camino legítimo).
    await storage.applyApprovedPayment(consultantId, {
      externalReference: `sub-${consultantId}-rev1`,
      mpPreapprovalId: "PA-revenue-1",
      mpPaymentId: "PAY-revenue-approved-1",
      amount: 20000,
      statusDetail: "accredited",
      rawPayload: {},
    });

    // Pagos NO aprobados: se insertan directo como "pending" y se pisan con updatePayment,
    // igual que el resto del sistema — nunca a través de applyApprovedPayment, que es
    // exclusivo del camino "approved".
    const rejected = await storage.createPendingPayment(consultantId, {
      externalReference: `sub-${consultantId}-rev2`,
      mpPreapprovalId: "PA-revenue-1",
      amount: 20000,
      currency: "ARS",
      periodDaysGranted: 30,
    });
    await storage.updatePayment(rejected.id, { status: "rejected", mpPaymentId: "PAY-revenue-rejected-1" });

    const inProcess = await storage.createPendingPayment(consultantId, {
      externalReference: `sub-${consultantId}-rev3`,
      mpPreapprovalId: "PA-revenue-1",
      amount: 20000,
      currency: "ARS",
      periodDaysGranted: 30,
    });
    await storage.updatePayment(inProcess.id, { status: "in_process", mpPaymentId: "PAY-revenue-inprocess-1" });

    const res = await fetch(`${baseUrl}/api/admin/payments?consultantId=${consultantId}`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    expect(body.rows).toHaveLength(3);
    expect(body.summary.approvedCount).toBe(1);
    expect(body.summary.approvedRevenue).toBe(20000);
  });
});
