import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Prompt 13, ajuste 1 y 7: la sesión dura 10 días de INACTIVIDAD (rolling), no 10 días fijos
// desde el login — ver server/session.ts. Modo memoria, mismo criterio que el resto de los
// tests de auth: no depende de Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const TEN_DAYS_IN_MS = 10 * 24 * 60 * 60 * 1000;
// Margen para el tiempo real que tarda la request — nunca debería acercarse a esto en un test local.
const TOLERANCE_MS = 15_000;

let httpServer: Server;
let baseUrl: string;

// express-session serializa la cookie con `Expires=<fecha>`, no con `Max-Age` (ver
// node_modules/express-session/session/cookie.js: `data` solo expone `expires`, un Date) —
// por eso se mide la distancia a "ahora" en vez de buscar un campo Max-Age que no existe.
function msUntilExpiryOf(setCookieHeader: string | null): number | null {
  const match = setCookieHeader?.match(/Expires=([^;]+)/i);
  if (!match) return null;
  return new Date(match[1]).getTime() - Date.now();
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

describe("Sesión de 10 días con renovación (Prompt 13)", () => {
  it("el login devuelve una cookie que dura 10 días", async () => {
    const { storage } = await import("../storage");
    const user = await storage.createUser({
      username: `vitest_session_rolling_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: "vitest-test-password-123" }),
    });
    expect(loginRes.status).toBe(200);

    const setCookie = loginRes.headers.get("set-cookie");
    const msUntilExpiry = msUntilExpiryOf(setCookie);
    expect(msUntilExpiry).not.toBeNull();
    expect(Math.abs((msUntilExpiry as number) - TEN_DAYS_IN_MS)).toBeLessThan(TOLERANCE_MS);
  });

  it("la cookie se renueva (Set-Cookie) en cada request autenticado, no solo en el login", async () => {
    const { storage } = await import("../storage");
    const user = await storage.createUser({
      username: `vitest_session_rolling2_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: "vitest-test-password-123" }),
    });
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    // Prompt 13, ajuste 1: "entrar a la app" corre el vencimiento 10 días más en CADA visita,
    // no solo en el login — `rolling: true` en server/session.ts hace que express-session
    // mande un Set-Cookie nuevo en cada response, con la cuenta reiniciada desde cero.
    const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(200);

    const renewedSetCookie = meRes.headers.get("set-cookie");
    expect(renewedSetCookie).not.toBeNull();
    const msUntilExpiry = msUntilExpiryOf(renewedSetCookie);
    expect(msUntilExpiry).not.toBeNull();
    expect(Math.abs((msUntilExpiry as number) - TEN_DAYS_IN_MS)).toBeLessThan(TOLERANCE_MS);
  });
});
