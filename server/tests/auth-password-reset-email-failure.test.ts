import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

/**
 * Etapa 3.1, sección 9 — simula que el proveedor de email real está caído (ej. Resend
 * devolviendo error) y confirma que POST /api/auth/forgot-password NUNCA se entera hacia
 * afuera: sigue respondiendo el mismo mensaje genérico, y el código que se generó (pero nunca
 * llegó a la consultora) queda invalidado en vez de quedar "vivo" sin que nadie lo tenga.
 */
const capturedCodes: Record<string, string> = {};
vi.mock("../email", () => ({
  sendPasswordResetCode: vi.fn((email: string, code: string) => {
    capturedCodes[email] = code;
    return Promise.reject(new Error("Resend no pudo enviar el código de recuperación a x: Invalid API key"));
  }),
}));

let httpServer: Server;
let baseUrl: string;

function uniqueUsername(tag: string): string {
  return `vitest_emailfail_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}
function uniqueEmail(tag: string): string {
  return `vitest.emailfail.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("Fallo del proveedor de email en /api/auth/forgot-password", () => {
  it("responde el mismo mensaje genérico aunque el proveedor de email falle, y nunca expone el detalle del error", async () => {
    const username = uniqueUsername("gen");
    const email = uniqueEmail("gen");
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password: "vitest-test-password-123" }),
    });

    const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Si existe una cuenta asociada a ese email, vas a recibir un código.");
    expect(JSON.stringify(body)).not.toMatch(/resend|api key|invalid/i);
  });

  it("el código generado pero nunca enviado queda invalidado — no queda utilizable ni por quien lo intercepte", async () => {
    const username = uniqueUsername("invalid");
    const email = uniqueEmail("invalid");
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password: "vitest-test-password-123" }),
    });

    await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const code = capturedCodes[email];
    expect(code).toMatch(/^\d{6}$/);

    const verify = await fetch(`${baseUrl}/api/auth/verify-reset-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    expect(verify.status).toBe(400);
  });

  it("después de un fallo de envío, la consultora puede simplemente volver a pedir el código", async () => {
    const username = uniqueUsername("retry");
    const email = uniqueEmail("retry");
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password: "vitest-test-password-123" }),
    });

    const first = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(second.status).toBe(200); // sigue respondiendo genérico, sin bloquear el reintento
  });
});
