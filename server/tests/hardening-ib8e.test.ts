import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real — mismo criterio que products.test.ts.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;

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
  const user = await storage.createUser({
    username: `vitest_hardening_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: "vitest-test-password-123" }),
  });
  cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("POST/PATCH /api/clients — validación de email en backend (Etapa I-B.8-E, F6)", () => {
  it("acepta un email con formato válido", async () => {
    const res = await api("POST", "/api/clients", { phone: "2610000001", email: "clienta@example.com" });
    expect(res.status).toBe(201);
    expect((await res.json()).email).toBe("clienta@example.com");
  });

  it("rechaza un email con formato inválido (antes lo aceptaba tal cual)", async () => {
    const res = await api("POST", "/api/clients", { phone: "2610000002", email: "no-es-un-email" });
    expect(res.status).toBe(400);
  });

  it("email ausente sigue siendo válido (sigue siendo opcional)", async () => {
    const res = await api("POST", "/api/clients", { phone: "2610000003" });
    expect(res.status).toBe(201);
  });

  it("email vacío ('') sigue aceptándose tal cual (comportamiento preexistente, no se inventa una conversión a null)", async () => {
    const res = await api("POST", "/api/clients", { phone: "2610000004", email: "" });
    expect(res.status).toBe(201);
  });

  it("PATCH también valida el formato al editar", async () => {
    const created = await (await api("POST", "/api/clients", { phone: "2610000005" })).json();
    const res = await api("PATCH", `/api/clients/${created.id}`, { email: "tampoco-es-un-email" });
    expect(res.status).toBe(400);

    const validRes = await api("PATCH", `/api/clients/${created.id}`, { email: "editado@example.com" });
    expect(validRes.status).toBe(200);
    expect((await validRes.json()).email).toBe("editado@example.com");
  });
});

describe("PATCH /api/business-settings — validación real de ISO 4217 (Etapa I-B.8-E, F9)", () => {
  it("acepta códigos ISO 4217 reales (ARS, USD)", async () => {
    const resArs = await api("PATCH", "/api/business-settings", { businessName: "Negocio VITEST", currency: "ARS" });
    expect(resArs.status).toBe(200);
    const resUsd = await api("PATCH", "/api/business-settings", { businessName: "Negocio VITEST", currency: "USD" });
    expect(resUsd.status).toBe(200);
  });

  it("rechaza un código de 3 letras que NO es una moneda real (antes solo exigía 'largo 3 y mayúsculas')", async () => {
    const res = await api("PATCH", "/api/business-settings", { businessName: "Negocio VITEST", currency: "ZZZ" });
    expect(res.status).toBe(400);
  });

  it("sigue rechazando largos inválidos (regresión: la validación previa de longitud sigue intacta)", async () => {
    const res = await api("PATCH", "/api/business-settings", { businessName: "Negocio VITEST", currency: "PESOS" });
    expect(res.status).toBe(400);
  });

  it("normaliza a mayúsculas antes de validar (comportamiento preexistente, sigue intacto)", async () => {
    const res = await api("PATCH", "/api/business-settings", { businessName: "Negocio VITEST", currency: "ars" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("ARS");
  });
});
