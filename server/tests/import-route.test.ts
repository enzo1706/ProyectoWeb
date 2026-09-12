import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Etapa 5 — POST /api/products/import/parse a nivel HTTP real (memoria, sin Postgres real —
 * no hace falta para probar tenant isolation ni auth, mismo criterio que subscription-routes/
 * auth-register). Nunca sube el PDF real de 108KB acá (ver importParsers.test.ts para eso) —
 * estos tests usan CSV, mucho más liviano para armar en memoria por caso.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

async function createConsultant(username: string) {
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  return { consultantId: user.consultantId!, cookie };
}

function csvFile(content: string, filename = "pedido.csv"): FormData {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/csv" }), filename);
  return form;
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

describe("POST /api/products/import/parse", () => {
  it("sin sesión responde 401", async () => {
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      body: csvFile("Producto;Cantidad\nAlgo;1\n"),
    });
    expect(res.status).toBe(401);
  });

  it("admin (sin consultantId) responde 403 — no aplica", async () => {
    const admin = await storage.createUser({ username: `vitest_import_admin_${Date.now()}`, password: "vitest-test-password-123", role: "admin", status: true });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: admin.username, password: "vitest-test-password-123" }),
    });
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: csvFile("Producto;Cantidad\nAlgo;1\n"),
    });
    expect(res.status).toBe(403);
  });

  it("21/22. match correcto: precio y puntos vienen del catálogo, nunca del CSV (que ni los tiene)", async () => {
    const { cookie } = await createConsultant(`vitest_import_match_${Date.now()}`);
    // Catálogo GLOBAL (consultantId null) vía storage directo — no hace falta una sesión
    // admin real para este test puntual, alcanza con insertar la fila igual que lo haría
    // POST /api/admin/products/bulk.
    await storage.bulkInsertProducts([
      { seccion: "Test", producto: "Base de Maquillaje At Play", variante: "Estándar", codigo: "BASE-AP-1", puntos: 12, precio: 27000, source: "import" },
    ]);

    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: csvFile("Producto;Cantidad;Precio\nBase de Maquillaje At Play;3;999999\n"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.matched).toBe(1);
    expect(body.matches[0].status).toBe("matched");
    expect(body.matches[0].quantity).toBe(3); // del archivo
    expect(body.matches[0].product.precio).toBe(27000); // del catálogo, NUNCA 999999 del CSV
    expect(body.matches[0].product.puntos).toBe(12); // del catálogo
  });

  it("tenant isolation: consultora A nunca matchea contra un producto MANUAL privado de consultora B", async () => {
    const { consultantId: consultantBId } = await createConsultant(`vitest_import_b_${Date.now()}`);
    // Producto MANUAL de B (consultantId propio, no global) — vía storage directo.
    await storage.createProduct(consultantBId, {
      seccion: "Test",
      producto: "Producto Privado De B",
      precio: 5000,
      unidades: 0,
      puntos: 0,
    });

    const { cookie: cookieA } = await createConsultant(`vitest_import_a_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookieA },
      body: csvFile("Producto;Cantidad\nProducto Privado De B;1\n"),
    });
    const body = await res.json();
    expect(body.matches[0].status).toBe("not_found"); // A no puede ver ni matchear el privado de B
  });

  it("15/29. producto no encontrado en el catálogo -> not_found, la importación no se rompe entera", async () => {
    const { cookie } = await createConsultant(`vitest_import_notfound_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: csvFile("Producto;Cantidad\nProducto Que No Existe;5\n"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.notFound).toBe(1);
    expect(body.matches[0].status).toBe("not_found");
  });

  it("23. archivo con tipo no permitido (.txt) responde 400, nunca 500", async () => {
    const { cookie } = await createConsultant(`vitest_import_badtype_${Date.now()}`);
    const form = new FormData();
    form.append("file", new Blob(["contenido cualquiera"], { type: "text/plain" }), "archivo.txt");
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("24. PDF corrupto/malformado responde 400 con mensaje claro, nunca 500", async () => {
    const { cookie } = await createConsultant(`vitest_import_badpdf_${Date.now()}`);
    const form = new FormData();
    form.append("file", new Blob(["esto no es un PDF real"], { type: "application/pdf" }), "falso.pdf");
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("17. sin archivo adjunto responde 400", async () => {
    const { cookie } = await createConsultant(`vitest_import_nofile_${Date.now()}`);
    const res = await fetch(`${baseUrl}/api/products/import/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });
});
