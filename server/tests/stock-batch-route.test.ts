import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Etapa 7.2 — PATCH /api/products/stock/increment-batch a nivel HTTP real (memoria, sin
 * Postgres — la atomicidad/concurrencia real ya está probada contra Postgres real en
 * stock-concurrency.test.ts; acá se prueba el contrato HTTP: auth, forma del payload/
 * respuesta, y el caso de tenant isolation que pide explícitamente la sección 23 del pedido).
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

describe("PATCH /api/products/stock/increment-batch", () => {
  it("sin sesión responde 401", async () => {
    const res = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: [{ productId: 1, delta: 1 }] }),
    });
    expect(res.status).toBe(401);
  });

  it("16. una sola llamada aplica todo el batch: 2 productos, 1 request, ambos quedan actualizados", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_stockbatch_ok_${Date.now()}`);
    const productA = await storage.createProduct(consultantId, { seccion: "Test", producto: "Batch HTTP A", precio: 1000, unidades: 5, puntos: 1 });
    const productB = await storage.createProduct(consultantId, { seccion: "Test", producto: "Batch HTTP B", precio: 1000, unidades: 2, puntos: 1 });

    const res = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        lines: [
          { productId: productA.id, delta: 3 },
          { productId: productB.id, delta: 4 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ updated: 2 });

    const catalog = await storage.getAllProducts(consultantId);
    expect(catalog.find((p) => p.id === productA.id)?.unidades).toBe(8);
    expect(catalog.find((p) => p.id === productB.id)?.unidades).toBe(6);
  });

  it("payload sin `lines` o con `lines` vacío responde 400, nunca 500", async () => {
    const { cookie } = await createConsultant(`vitest_stockbatch_empty_${Date.now()}`);

    const resMissing = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(resMissing.status).toBe(400);

    const resEmpty = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ lines: [] }),
    });
    expect(resEmpty.status).toBe(400);
  });

  it("delta negativo o 0 en cualquier línea responde 400 (este batch es solo entrada de mercadería)", async () => {
    const { consultantId, cookie } = await createConsultant(`vitest_stockbatch_negativo_${Date.now()}`);
    const product = await storage.createProduct(consultantId, { seccion: "Test", producto: "Batch HTTP delta inválido", precio: 1000, unidades: 5, puntos: 1 });

    const res = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ lines: [{ productId: product.id, delta: -1 }] }),
    });
    expect(res.status).toBe(400);

    // Nunca se tocó el stock.
    const catalog = await storage.getAllProducts(consultantId);
    expect(catalog.find((p) => p.id === product.id)?.unidades).toBe(5);
  });

  it("23. tenant isolation: consultora A no puede incrementar stock de un producto MANUAL de B — rechazado, stock de A y de B intactos", async () => {
    const { consultantId: consultantBId } = await createConsultant(`vitest_stockbatch_b_${Date.now()}`);
    const productOfB = await storage.createProduct(consultantBId, { seccion: "Test", producto: "Producto privado de B", precio: 1000, unidades: 20, puntos: 1 });

    const { consultantId: consultantAId, cookie: cookieA } = await createConsultant(`vitest_stockbatch_a_${Date.now()}`);
    const productOfA = await storage.createProduct(consultantAId, { seccion: "Test", producto: "Producto de A", precio: 1000, unidades: 10, puntos: 1 });

    const res = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({
        lines: [
          { productId: productOfA.id, delta: 5 }, // línea legítima de A
          { productId: productOfB.id, delta: 5 }, // intento de tocar el producto de B
        ],
      }),
    });
    expect(res.status).toBe(400); // rechazado, nunca un 200 parcial

    // Rollback completo: ni siquiera la línea legítima de A quedó aplicada.
    const catalogA = await storage.getAllProducts(consultantAId);
    expect(catalogA.find((p) => p.id === productOfA.id)?.unidades).toBe(10);

    // El stock de B, intacto.
    const catalogB = await storage.getAllProducts(consultantBId);
    expect(catalogB.find((p) => p.id === productOfB.id)?.unidades).toBe(20);
  });

  it("Etapa 7.9 — un producto discontinuado SÍ puede recibir stock por importación (reponer ≠ vender): comportamiento confirmado, no un bug", async () => {
    // Auditoría transversal 7.9, Fase 12: createSale/updateSale ya bloquean VENDER un producto
    // discontinuado (ver storage.ts), pero nada en incrementProductStockBatch lo bloquea a él.
    // Es una distinción coherente (podés seguir recibiendo/contando stock de algo que ya no se
    // ofrece a la venta) — este test fija ese comportamiento como documentado, para que un
    // cambio futuro que lo bloquee sea una decisión explícita, no un efecto colateral accidental.
    const { consultantId, cookie } = await createConsultant(`vitest_stockbatch_disc_${Date.now()}`);
    const product = await storage.createProduct(consultantId, { seccion: "Test", producto: "Producto discontinuado", precio: 1000, unidades: 5, puntos: 1 });
    await storage.setProductDiscontinued(consultantId, product.id, true);

    const res = await fetch(`${baseUrl}/api/products/stock/increment-batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ lines: [{ productId: product.id, delta: 3 }] }),
    });
    expect(res.status).toBe(200);

    const catalog = await storage.getAllProducts(consultantId);
    const updated = catalog.find((p) => p.id === product.id);
    expect(updated?.unidades).toBe(8); // el stock sí se actualizó
    expect(updated?.discontinued).toBe(true); // pero sigue discontinuado (no se "reactiva" solo)
  });
});
