import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real — esto solo verifica que el middleware
// de autenticación bloquee correctamente, no depende de ningún dato real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;

beforeAll(async () => {
  // Import dinámico: tiene que pasar DESPUÉS de fijar las env vars de arriba, porque
  // storage.ts decide memoria-vs-Postgres una sola vez al importarse.
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

describe("Autorización — requests sin sesión", () => {
  const protectedRoutes = [
    "/api/admin/stats",
    "/api/admin/users",
    "/api/admin/products",
    "/api/products",
    "/api/clients",
    "/api/sales",
    "/api/appointments",
  ];

  for (const route of protectedRoutes) {
    it(`GET ${route} sin sesión responde 401`, async () => {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
    });
  }

  it("GET /api/health no requiere sesión y responde ok en modo memoria", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("memory");
  });
});
