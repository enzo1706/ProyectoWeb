import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real — mismo criterio que products.test.ts. La
// concurrencia real contra Postgres (el objetivo central de la Etapa I-B.8-D) se prueba aparte
// en bulk-import-concurrency.test.ts, contra TEST_DATABASE_URL.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let adminCookie: string;
let consultantCookie: string;

async function api(cookie: string, method: string, path: string, body?: unknown) {
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
  const admin = await storage.createUser({
    username: `vitest_bulkimport_admin_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "admin",
    status: true,
  });
  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: "vitest-test-password-123" }),
  });
  adminCookie = adminLogin.headers.get("set-cookie")!.split(";")[0];

  const consultant = await storage.createUser({
    username: `vitest_bulkimport_consultant_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const consultantLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: consultant.username, password: "vitest-test-password-123" }),
  });
  consultantCookie = consultantLogin.headers.get("set-cookie")!.split(";")[0];
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("POST /api/admin/products/bulk — Etapa I-B.8-D (F3)", () => {
  it("Test 1 — import normal: códigos únicos, todos se crean, sin error", async () => {
    const suffix = Date.now();
    const res = await api(adminCookie, "POST", "/api/admin/products/bulk", {
      products: [
        { seccion: "VITEST", producto: "Bulk A", precio: 1000, codigo: `bulk-a-${suffix}` },
        { seccion: "VITEST", producto: "Bulk B", precio: 2000, codigo: `bulk-b-${suffix}` },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);

    const list = await (await api(adminCookie, "GET", "/api/admin/products")).json();
    expect(list.some((p: any) => p.codigo === `bulk-a-${suffix}`)).toBe(true);
    expect(list.some((p: any) => p.codigo === `bulk-b-${suffix}`)).toBe(true);
  });

  it("Test 2 — duplicado DENTRO del mismo import: no crea dos filas, la segunda pisa a la primera (mismo comportamiento ya existente)", async () => {
    const codigo = `bulk-dup-${Date.now()}`;
    const res = await api(adminCookie, "POST", "/api/admin/products/bulk", {
      products: [
        { seccion: "VITEST", producto: "Primera versión", precio: 1000, codigo },
        { seccion: "VITEST", producto: "Segunda versión (gana)", precio: 1500, codigo },
      ],
    });
    expect(res.status).toBe(200);

    const list = await (await api(adminCookie, "GET", "/api/admin/products")).json();
    const matches = list.filter((p: any) => p.codigo === codigo);
    expect(matches).toHaveLength(1); // nunca dos filas para el mismo código global
    expect(matches[0].producto).toBe("Segunda versión (gana)");
    expect(matches[0].precio).toBe(1500);
  });

  it("Test 3 — reimportar un código global ya existente actualiza la fila en vez de duplicarla (upsert secuencial, no es el caso de carrera)", async () => {
    const codigo = `bulk-reimport-${Date.now()}`;
    await api(adminCookie, "POST", "/api/admin/products/bulk", {
      products: [{ seccion: "VITEST", producto: "Original", precio: 1000, codigo }],
    });
    const secondRes = await api(adminCookie, "POST", "/api/admin/products/bulk", {
      products: [{ seccion: "VITEST", producto: "Actualizado", precio: 3000, codigo }],
    });
    expect(secondRes.status).toBe(200);

    const list = await (await api(adminCookie, "GET", "/api/admin/products")).json();
    const matches = list.filter((p: any) => p.codigo === codigo);
    expect(matches).toHaveLength(1);
    expect(matches[0].producto).toBe("Actualizado");
  });

  it("Test 4 — el mismo código puede coexistir entre un producto global y uno manual de una consultora (semántica multi-tenant intacta)", async () => {
    const codigo = `bulk-shared-codigo-${Date.now()}`;
    const bulkRes = await api(adminCookie, "POST", "/api/admin/products/bulk", {
      products: [{ seccion: "VITEST", producto: "Global compartido", precio: 1000, codigo }],
    });
    expect(bulkRes.status).toBe(200);

    const manualRes = await api(consultantCookie, "POST", "/api/products", {
      seccion: "VITEST",
      producto: "Manual con mismo código",
      precio: 500,
      unidades: 1,
      codigo,
    });
    expect(manualRes.status).toBe(201); // el índice parcial NO bloquea esto — solo protege entre globales

    const globalList = await (await api(adminCookie, "GET", "/api/admin/products")).json();
    const consultantList = await (await api(consultantCookie, "GET", "/api/products")).json();
    expect(globalList.filter((p: any) => p.codigo === codigo)).toHaveLength(1);
    expect(consultantList.some((p: any) => p.codigo === codigo && p.source === "manual")).toBe(true);
  });

  it("400 en payload inválido, sin crear nada", async () => {
    const res = await api(adminCookie, "POST", "/api/admin/products/bulk", { products: [{ seccion: "" }] });
    expect(res.status).toBe(400);
  });

  it("admin-only: un consultant no puede pegarle a /api/admin/products/bulk", async () => {
    const res = await api(consultantCookie, "POST", "/api/admin/products/bulk", {
      products: [{ seccion: "VITEST", producto: "X", precio: 1000 }],
    });
    expect(res.status).toBe(403); // requireAdmin — autenticado pero no admin
  });
});
