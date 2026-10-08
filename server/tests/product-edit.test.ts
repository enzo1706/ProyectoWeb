import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real.
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;

// loginRateLimiter (10 intentos / 15') cuenta por IP — cada consultora nueva de este archivo
// usa su propia IP sintética para no compartir balde con las demás (mismo patrón que
// subscription-pricing.test.ts).
let ipCounter = 1;
function nextTestIp(): string {
  ipCounter += 1;
  return `10.82.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function createConsultant(username: string) {
  const { storage } = await import("../storage");
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextTestIp() },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  return {
    consultantId: user.consultantId!,
    api: async (method: string, path: string, body?: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
}

async function createGlobalProduct(precio: number) {
  const { storage } = await import("../storage");
  // listGlobalProducts/bulkInsertProducts no exponen directo "crear uno" simple en el test —
  // usamos bulkInsertProducts, que es el camino real de la importación del admin.
  await storage.bulkInsertProducts([
    {
      consultantId: null,
      seccion: "VITEST",
      producto: "Producto de catálogo",
      precio,
      codigo: `vitest-global-${Date.now()}-${Math.random()}`,
      variante: "Estándar",
      puntos: 0,
      imagen: null,
      linea: null,
      source: "import",
    } as any,
  ]);
  const globals = await storage.listGlobalProducts();
  return globals[globals.length - 1];
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

describe("Prompt 4 — producto del catálogo: solo los campos de SU product_stock", () => {
  it("la consultora puede cambiar price_override, costo, unidades y umbral", async () => {
    const { api } = await createConsultant(`vitest_catalog_edit_${Date.now()}`);
    const product = await createGlobalProduct(20000);

    const priceRes = await api("PATCH", `/api/products/${product.id}/price-override`, { priceOverride: 18000 });
    expect(priceRes.status).toBe(200);
    expect((await priceRes.json()).priceOverride).toBe(18000);

    const costRes = await api("PATCH", `/api/products/${product.id}/cost`, { costPrice: 11000 });
    expect(costRes.status).toBe(200);
    expect((await costRes.json()).costPrice).toBe(11000);

    const stockRes = await api("PATCH", `/api/products/${product.id}/stock`, { unidades: 5, stockMinimo: 3 });
    expect(stockRes.status).toBe(200);
    const stockBody = await stockRes.json();
    expect(stockBody.unidades).toBe(5);
    expect(stockBody.stockMinimo).toBe(3);
  });

  it("si el precio propio coincide con el del catálogo, se guarda null (no un override idéntico)", async () => {
    const { api } = await createConsultant(`vitest_catalog_samePrice_${Date.now()}`);
    const product = await createGlobalProduct(20000);

    const res = await api("PATCH", `/api/products/${product.id}/price-override`, { priceOverride: 20000 });
    expect(res.status).toBe(200);
    expect((await res.json()).priceOverride).toBeNull();
  });

  it("rechaza un precio propio <= 0", async () => {
    const { api } = await createConsultant(`vitest_catalog_badPrice_${Date.now()}`);
    const product = await createGlobalProduct(20000);

    const res = await api("PATCH", `/api/products/${product.id}/price-override`, { priceOverride: 0 });
    expect(res.status).toBe(400);
  });

  it("rechaza (404) cualquier intento de cambiar nombre/tono/categoría/puntos/código/precio de catálogo vía PATCH /api/products/:id", async () => {
    const { api } = await createConsultant(`vitest_catalog_corefields_${Date.now()}`);
    const product = await createGlobalProduct(20000);

    const res = await api("PATCH", `/api/products/${product.id}`, {
      seccion: "Otra categoría",
      producto: "Nombre pisado",
      precio: 1,
    });
    // updateProduct filtra siempre por consultantId propio en el WHERE — un producto global
    // (consultantId null) nunca matchea, así que esto da "no encontrado", nunca un 200.
    expect(res.status).toBe(404);

    // Confirmamos que de verdad no se tocó nada.
    const products = await (await api("GET", "/api/products")).json();
    const unchanged = products.find((p: any) => p.id === product.id);
    expect(unchanged.seccion).toBe("VITEST");
    expect(unchanged.producto).toBe("Producto de catálogo");
    expect(unchanged.precio).toBe(20000);
  });

  it("GET /api/products/:id/price-override sobre un producto MANUAL se rechaza (400) — el override es solo de catálogo", async () => {
    const { api } = await createConsultant(`vitest_manual_rejectOverride_${Date.now()}`);
    const manual = await (
      await api("POST", "/api/products", { seccion: "VITEST", producto: "Manual", precio: 10000, unidades: 1 })
    ).json();

    const res = await api("PATCH", `/api/products/${manual.id}/price-override`, { priceOverride: 5000 });
    expect(res.status).toBe(400);
  });
});

describe("Prompt 4 — producto cargado a mano: editable completo", () => {
  it("edita nombre, categoría, línea, tono, puntos y código vía PATCH /api/products/:id", async () => {
    const { api } = await createConsultant(`vitest_manual_full_${Date.now()}`);
    const created = await (
      await api("POST", "/api/products", { seccion: "VITEST", producto: "Original", precio: 10000, unidades: 1 })
    ).json();

    const res = await api("PATCH", `/api/products/${created.id}`, {
      seccion: "Nueva categoría",
      linea: "Nueva línea",
      producto: "Nuevo nombre",
      variante: "Nuevo tono",
      puntos: 15,
      precio: 12000,
      codigo: `vitest-manual-${Date.now()}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seccion).toBe("Nueva categoría");
    expect(body.linea).toBe("Nueva línea");
    expect(body.producto).toBe("Nuevo nombre");
    expect(body.variante).toBe("Nuevo tono");
    expect(body.puntos).toBe(15);
    expect(body.precio).toBe(12000);
  });

  it("también se le puede cargar el costo directo en pesos", async () => {
    const { api } = await createConsultant(`vitest_manual_cost_${Date.now()}`);
    const created = await (
      await api("POST", "/api/products", { seccion: "VITEST", producto: "Manual con costo", precio: 10000, unidades: 1 })
    ).json();

    const res = await api("PATCH", `/api/products/${created.id}/cost`, { costPrice: 6000 });
    expect(res.status).toBe(200);
    expect((await res.json()).costPrice).toBe(6000);
  });
});

describe("Prompt 4 — aislamiento entre consultoras", () => {
  it("una consultora no puede editar un producto MANUAL de otra (404)", async () => {
    const a = await createConsultant(`vitest_tenant_a_${Date.now()}`);
    const b = await createConsultant(`vitest_tenant_b_${Date.now()}`);

    const productOfA = await (
      await a.api("POST", "/api/products", { seccion: "VITEST", producto: "De A", precio: 10000, unidades: 1 })
    ).json();

    const attack = await b.api("PATCH", `/api/products/${productOfA.id}`, { producto: "Hackeado" });
    expect(attack.status).toBe(404);

    const stillA = await (await a.api("GET", "/api/products")).json();
    expect(stillA.find((p: any) => p.id === productOfA.id).producto).toBe("De A");
  });

  it("el precio propio y el costo de un producto de catálogo son por consultora — nunca se mezclan", async () => {
    const a = await createConsultant(`vitest_tenant_price_a_${Date.now()}`);
    const b = await createConsultant(`vitest_tenant_price_b_${Date.now()}`);
    const product = await createGlobalProduct(20000);

    await a.api("PATCH", `/api/products/${product.id}/price-override`, { priceOverride: 17000 });
    await b.api("PATCH", `/api/products/${product.id}/price-override`, { priceOverride: 19000 });

    const productsOfA = await (await a.api("GET", "/api/products")).json();
    const productsOfB = await (await b.api("GET", "/api/products")).json();
    expect(productsOfA.find((p: any) => p.id === product.id).priceOverride).toBe(17000);
    expect(productsOfB.find((p: any) => p.id === product.id).priceOverride).toBe(19000);
  });
});
