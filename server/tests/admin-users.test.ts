import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real — mismo criterio que admin-subscriptions.test.ts.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

async function login(username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function toggleStatus(cookie: string, id: number) {
  return fetch(`${baseUrl}/api/admin/users/${id}/toggle-status`, {
    method: "PATCH",
    headers: { Cookie: cookie },
  });
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

describe("PATCH /api/admin/users/:id/toggle-status — hardening post-I-B.8-F", () => {
  it("1. admin puede activar/desactivar una cuenta de consultora", async () => {
    const admin = await storage.createUser({
      username: `vitest_toggle_admin1_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "admin",
      status: true,
    });
    const consultant = await storage.createUser({
      username: `vitest_toggle_consultant1_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const { cookie } = await login(admin.username, "vitest-test-password-123");

    const res = await toggleStatus(cookie!, consultant.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe(false); // arrancó en true, togglea a false
    expect(body.password).toBeUndefined(); // omitPassword sigue aplicando
  });

  it("2. un admin NO puede togglear a otro admin", async () => {
    const adminA = await storage.createUser({
      username: `vitest_toggle_adminA_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "admin",
      status: true,
    });
    const adminB = await storage.createUser({
      username: `vitest_toggle_adminB_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "admin",
      status: true,
    });
    const { cookie } = await login(adminA.username, "vitest-test-password-123");

    const res = await toggleStatus(cookie!, adminB.id);
    expect(res.status).toBe(403);

    const untouched = await storage.getUser(adminB.id);
    expect(untouched?.status).toBe(true); // sin mutar
  });

  it("3. un admin NO puede desactivarse a sí mismo mediante este endpoint", async () => {
    const admin = await storage.createUser({
      username: `vitest_toggle_self_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "admin",
      status: true,
    });
    const { cookie } = await login(admin.username, "vitest-test-password-123");

    const res = await toggleStatus(cookie!, admin.id);
    expect(res.status).toBe(403);

    const untouched = await storage.getUser(admin.id);
    expect(untouched?.status).toBe(true);
  });

  it("4. un usuario no-admin sigue recibiendo 403 (comportamiento existente de requireAdmin, sin cambios)", async () => {
    const consultant = await storage.createUser({
      username: `vitest_toggle_notadmin_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const target = await storage.createUser({
      username: `vitest_toggle_target_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const { cookie } = await login(consultant.username, "vitest-test-password-123");

    const res = await toggleStatus(cookie!, target.id);
    expect(res.status).toBe(403);
  });

  it("5. usuario inexistente conserva el comportamiento previo (404)", async () => {
    const admin = await storage.createUser({
      username: `vitest_toggle_404_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "admin",
      status: true,
    });
    const { cookie } = await login(admin.username, "vitest-test-password-123");

    const res = await toggleStatus(cookie!, 999999999);
    expect(res.status).toBe(404);
  });
});
