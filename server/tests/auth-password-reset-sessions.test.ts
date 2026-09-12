import "../load-env";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { DatabaseStorage } from "../storage";

/**
 * A diferencia de auth-password-reset.test.ts (modo memoria, rápido), este test corre contra
 * Postgres real (misma TEST_DATABASE_URL que tenant-isolation-deep.test.ts/client-isolation.
 * test.ts — nunca Railway, nunca producción) porque `invalidateUserSessions` (server/session.ts)
 * solo está implementado para DATABASE_MODE=postgres — la tabla `session` real de
 * connect-pg-simple es justamente lo que se necesita probar acá; el modo memoria de
 * memorystore queda documentado como limitación conocida, no hace falta un test para un no-op.
 */

const sentCodes: Record<string, string> = {};
vi.mock("../email", () => ({
  sendPasswordResetCode: vi.fn((email: string, code: string) => {
    sentCodes[email] = code;
    return Promise.resolve();
  }),
}));

const storage = new DatabaseStorage();
let httpServer: Server;
let baseUrl: string;

const USERNAME = `vitest_sess_${Date.now()}`;
const EMAIL = `vitest.sess.${Date.now()}@example.com`;
const PASSWORD = "vitest-test-password-123";
const NEW_PASSWORD = "vitest-new-password-456";

beforeAll(async () => {
  await storage.registerConsultant({ username: USERNAME, email: EMAIL, password: PASSWORD });

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

describe("Invalidación de sesiones tras reset de contraseña (Postgres real)", () => {
  it("24. una sesión activa creada ANTES del reset deja de servir después de un reset exitoso", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const oldCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    // Confirma que la sesión "vieja" funciona ANTES del reset (para que el test no dé falso
    // positivo por una cookie mal armada).
    const meBefore = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: oldCookie } });
    expect(meBefore.status).toBe(200);

    await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL }),
    });
    const code = sentCodes[EMAIL];
    expect(code).toMatch(/^\d{6}$/);

    const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, code, newPassword: NEW_PASSWORD }),
    });
    expect(resetRes.status).toBe(200);

    // La sesión vieja, creada con la contraseña anterior, ya no debe servir.
    const meAfter = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: oldCookie } });
    expect(meAfter.status).toBe(401);

    // Una sesión NUEVA con la contraseña nueva sí funciona.
    const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password: NEW_PASSWORD }),
    });
    expect(newLogin.status).toBe(200);
  });
});
