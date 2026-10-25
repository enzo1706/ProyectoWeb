import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Prompt 13, punto 4 — pega contra Postgres real (misma TEST_DATABASE_URL que el resto de los
// tests de Postgres) porque necesita escribir una fila real en la tabla "session" con la
// forma exacta que dejaba el código VIEJO (maxAge 7 días, sin `rolling`), para probar qué le
// pasa a una sesión así el día que se despliega el código nuevo (maxAge 10 días + rolling).
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "postgres";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

const OLD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;
const TOLERANCE_MS = 15_000;

let httpServer: Server;
let baseUrl: string;

// Replica exacta de cookie-signature (dependencia transitiva de express-session, sin tipos
// propios) — evita importar un paquete sin declaraciones para esto solo.
function signSessionId(sid: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return "s:" + sid + "." + mac;
}

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

describe("Sesión creada con la config VIEJA (7 días, sin rolling) después del deploy del Prompt 13", () => {
  it("sigue logueada (nunca se la desloguea) y la renovación migra de 7 a 10 días desde la primera visita", async () => {
    const { storage } = await import("../storage");
    const user = await storage.createUser({
      username: `vitest_oldsession_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });

    const { testPool } = await import("../test-db");
    const sid = `vitest-old-sid-${Date.now()}`;
    // Bajo el código viejo, sin rolling, el vencimiento quedaba clavado al momento del login
    // — simula una sesión que todavía le quedaban 2 días de los 7 originales.
    const oldExpires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const sess = {
      cookie: {
        originalMaxAge: OLD_MAX_AGE_MS,
        expires: oldExpires.toISOString(),
        secure: false,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      },
      userId: user.id,
    };
    await testPool.query(`INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2, $3)`, [
      sid,
      JSON.stringify(sess),
      oldExpires,
    ]);

    const cookieHeader = `connect.sid=${encodeURIComponent(signSessionId(sid, process.env.SESSION_SECRET as string))}`;

    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieHeader } });
    // Clave: NUNCA se la desloguea por el cambio de configuración — la sesión vieja sigue siendo válida.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(user.id);

    // La renovación de esta primera visita después del deploy ya tiene que reflejar 10 días,
    // no los 7 originales — ver el middleware de migración en server/session.ts.
    const msUntilExpiry = msUntilExpiryOf(res.headers.get("set-cookie"));
    expect(msUntilExpiry).not.toBeNull();
    expect(Math.abs((msUntilExpiry as number) - NEW_MAX_AGE_MS)).toBeLessThan(TOLERANCE_MS);

    // `connect-pg-simple`.touch() (lo que usa `rolling` cuando el hash de la sesión no cambió
    // — y cambiar solo `cookie.maxAge` nunca cuenta como cambio, express-session lo excluye a
    // propósito del hash) solo pisa la columna `expire`, NUNCA reescribe el JSON de `sess` —
    // confirmado leyendo node_modules/connect-pg-simple/index.js. Por eso la fila en la base
    // se queda para siempre con `originalMaxAge: 7 días` en su JSON (inofensivo: nada más lo
    // lee) — lo que importa de verdad es que CADA visita futura de esta misma sesión vuelva a
    // pasar por el middleware de migración y reciba 10 días igual, nunca que la fila "quede
    // arreglada" en la base. Se prueba con una segunda visita, simulando que effectivamente
    // vuelve a pasar.
    const res2 = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieHeader } });
    expect(res2.status).toBe(200);
    const msUntilExpiry2 = msUntilExpiryOf(res2.headers.get("set-cookie"));
    expect(msUntilExpiry2).not.toBeNull();
    expect(Math.abs((msUntilExpiry2 as number) - NEW_MAX_AGE_MS)).toBeLessThan(TOLERANCE_MS);
  });
});
