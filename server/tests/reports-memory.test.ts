import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

/**
 * Etapa 7.8 — smoke test en runtime (no solo type-check) de los 3 métodos nuevos de storage
 * (getProductCostSummary, getCollectedPayments, getPendingInstallmentsTotals) contra
 * MemoryStorage — server/tests/reports.test.ts ya cubre el caso completo contra Postgres real,
 * acá solo se confirma que la implementación espejo de MemoryStorage no está rota.
 */

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;
let productId: number; // precio 1000, costPrice 600

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { storage } = await import("../storage");
  const user = await storage.createUser({ username: `vitest_reports_mem_${Date.now()}`, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: "vitest-test-password-123" }),
  });
  cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST Reports Memory", phone: "9990002001" });
  clientId = (await clientRes.json()).id;

  const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto Reports Memory", precio: 1000, unidades: 20 });
  productId = (await productRes.json()).id;
  await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 40 }); // costPrice = 600
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("Reportes — MemoryStorage (Etapa 7.8, Fase 23)", () => {
  it("product-cost-summary: COGS correcto y sin advertencia cuando todo tiene costo", async () => {
    const saleRes = await api("POST", "/api/sales", {
      clientId, date: "2026-06-15", items: [{ productId, quantity: 3 }],
      orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo", installments: [{ amount: 3000 }], status: "pendiente",
    });
    expect(saleRes.status).toBe(201);

    const res = await api("GET", "/api/reports/product-cost-summary?start=2026-06-01&end=2026-07-01");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.productCost).toBe(3 * 600);
    expect(body.hasIncompleteCostData).toBe(false);
  });

  it("collected-payments: 0 cuando ninguna cuota fue marcada pagada", async () => {
    const res = await api("GET", "/api/reports/collected-payments");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalCollected).toBe(0);
  });

  it("pending-installments-totals: refleja la cuota recién creada como pendiente", async () => {
    const res = await api("GET", "/api/reports/pending-installments-totals");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalPendingAmount).toBeGreaterThanOrEqual(3000);
    expect(body.totalPendingCount).toBeGreaterThanOrEqual(1);
  });

  it("sales-summary sin start/end -> 400 (nunca 200 con datos vacíos silenciosos)", async () => {
    const res = await api("GET", "/api/reports/sales-summary");
    expect(res.status).toBe(400);
  });

  it("top-clients sin start/end -> 400 (ya no cae al mes actual silenciosamente)", async () => {
    const res = await api("GET", "/api/reports/top-clients");
    expect(res.status).toBe(400);
  });
});
