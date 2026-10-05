import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.81.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function createConsultant(username: string) {
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextTestIp() },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!;
  return { consultantId: user.consultantId!, cookie };
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

describe("GET/PATCH /api/business-settings (Prompt 1 — Configuración)", () => {
  it("sin ningún pedido registrado, habitualDiscountPercent viene en 35 (el más bajo)", async () => {
    const { cookie } = await createConsultant(`vitest_cfg_default_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/business-settings`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.habitualDiscountPercent).toBe(35);
    expect(body.orderReminderDay1).toBeNull();
    expect(body.orderReminderDay2).toBeNull();
    expect(body.grossIncomeTaxPercentTenths).toBeNull();
  });

  it("guarda día de pedido único, umbral de stock e Ingresos Brutos", async () => {
    const { cookie } = await createConsultant(`vitest_cfg_save_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/business-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        businessName: "Mi negocio",
        currency: "ARS",
        orderReminderDay1: 15,
        defaultLowStockThreshold: 3,
        grossIncomeTaxPercentTenths: 35, // 3.5%
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderReminderDay1).toBe(15);
    expect(body.orderReminderDay2).toBeNull();
    expect(body.defaultLowStockThreshold).toBe(3);
    expect(body.grossIncomeTaxPercentTenths).toBe(35);
  });

  it("acepta un segundo día de pedido distinto del primero", async () => {
    const { cookie } = await createConsultant(`vitest_cfg_twodays_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/business-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ businessName: "Mi negocio", currency: "ARS", orderReminderDay1: 1, orderReminderDay2: 15 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderReminderDay1).toBe(1);
    expect(body.orderReminderDay2).toBe(15);
  });

  it("rechaza el segundo día si no se eligió primero el primer día", async () => {
    const { cookie } = await createConsultant(`vitest_cfg_day2only_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/business-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ businessName: "Mi negocio", currency: "ARS", orderReminderDay2: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it("rechaza repetir el mismo día en ambos selectores", async () => {
    const { cookie } = await createConsultant(`vitest_cfg_sameday_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/business-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ businessName: "Mi negocio", currency: "ARS", orderReminderDay1: 10, orderReminderDay2: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it("un admin recibe 404 explícito (la configuración de negocio no le aplica)", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": nextTestIp() },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    const cookie = loginRes.headers.get("set-cookie")!;
    const res = await fetch(`${baseUrl}/api/business-settings`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/products/order-discount-log (Prompt 1/2 — descuento de compra habitual)", () => {
  it("registra un pedido confirmado", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_odl_create_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/products/order-discount-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ discountPercent: 40, publicValueArs: 10000 }),
    });
    expect(res.status).toBe(201);
    const entries = await storage.listOrderDiscountLogSince(consultantId, new Date(0));
    expect(entries).toHaveLength(1);
    expect(entries[0].discountPercent).toBe(40);
    expect(entries[0].publicValueArs).toBe(10000);
  });

  it("rechaza un descuento que no es uno de los valores permitidos (discountOptions)", async () => {
    const { cookie } = await createConsultant(`vitest_odl_invalid_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/products/order-discount-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ discountPercent: 50, publicValueArs: 10000 }),
    });
    expect(res.status).toBe(400);
  });

  it("sin sesión, responde 401", async () => {
    const res = await fetch(`${baseUrl}/api/products/order-discount-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discountPercent: 35, publicValueArs: 10000 }),
    });
    expect(res.status).toBe(401);
  });
});

describe("computeHabitualDiscountPercent — promedio ponderado de los últimos 3 meses", () => {
  it("con pedidos recientes, pondera por monto (no es un promedio simple de porcentajes)", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_hd_weighted_${Date.now()}`);
    // Pedido grande al 35% + pedido chico al 45% → el resultado debe quedar mucho más cerca
    // del 35% que un promedio simple (40%), porque el pedido grande pesa más.
    await storage.createOrderDiscountLogEntry(consultantId, { discountPercent: 35, publicValueArs: 90000 });
    await storage.createOrderDiscountLogEntry(consultantId, { discountPercent: 45, publicValueArs: 10000 });

    const res = await fetch(`${baseUrl}/api/business-settings`, { headers: { Cookie: cookie } });
    const body = await res.json();
    // (90000*0.35 + 10000*0.45) / 100000 * 100 = 36%
    expect(body.habitualDiscountPercent).toBeCloseTo(36, 5);
  });

  it("sin pedidos en los últimos 3 meses, usa el descuento del último pedido histórico (no el default)", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_hd_stale_${Date.now()}`);
    const entry = await storage.createOrderDiscountLogEntry(consultantId, { discountPercent: 45, publicValueArs: 5000 });
    // Simula que ese pedido fue hace más de 3 meses (acceso directo al array interno de
    // MemoryStorage, mismo criterio ya usado en subscription-pricing.test.ts).
    const all = (storage as any).orderDiscountLog as Array<{ id: number; confirmedAt: Date }>;
    const row = all.find((e) => e.id === entry.id)!;
    row.confirmedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

    const res = await fetch(`${baseUrl}/api/business-settings`, { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.habitualDiscountPercent).toBe(45);
  });
});
