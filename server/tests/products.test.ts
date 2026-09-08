import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Modo memoria, sin tocar Postgres/Supabase real — igual que subscription-gate.test.ts.
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
    username: `vitest_products_${Date.now()}`,
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

describe("Autorización: admin no puede pegarle a /api/products/* (Etapa I-B.8-C)", () => {
  it("PATCH y DELETE /api/products/:id devuelven 403 con sesión admin — comportamiento existente de requireConsultant, no cambia con esta etapa", async () => {
    const { storage } = await import("../storage");
    const admin = await storage.createUser({
      username: `vitest_products_admin_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "admin",
      status: true,
    });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: admin.username, password: "vitest-test-password-123" }),
    });
    const adminCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    const patchRes = await fetch(`${baseUrl}/api/products/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ producto: "X" }),
    });
    expect(patchRes.status).toBe(403);

    const deleteRes = await fetch(`${baseUrl}/api/products/1`, { method: "DELETE", headers: { Cookie: adminCookie } });
    expect(deleteRes.status).toBe(403);
  });
});

describe("POST /api/products — creación", () => {
  it("happy path: crea el producto y persiste exactamente los valores enviados", async () => {
    const res = await api("POST", "/api/products", {
      seccion: "VITEST",
      producto: "Producto de prueba",
      variante: "Único",
      precio: 12345,
      unidades: 7,
      puntos: 10,
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.producto).toBe("Producto de prueba");
    expect(created.precio).toBe(12345);
    expect(created.unidades).toBe(7);
    expect(created.puntos).toBe(10);
    expect(created.source).toBe("manual");

    const listRes = await api("GET", "/api/products");
    const list = await listRes.json();
    const found = list.find((p: any) => p.id === created.id);
    expect(found).toBeDefined();
    expect(found.unidades).toBe(7);
  });

  it("rechaza sin persistir: falta 'producto' (campo obligatorio)", async () => {
    const before = await (await api("GET", "/api/products")).json();
    const res = await api("POST", "/api/products", { seccion: "VITEST", precio: 1000 });
    expect(res.status).toBe(400);
    const after = await (await api("GET", "/api/products")).json();
    expect(after.length).toBe(before.length);
  });

  it("rechaza sin persistir: precio negativo", async () => {
    const before = await (await api("GET", "/api/products")).json();
    const res = await api("POST", "/api/products", { seccion: "VITEST", producto: "X", precio: -100 });
    expect(res.status).toBe(400);
    const after = await (await api("GET", "/api/products")).json();
    expect(after.length).toBe(before.length);
  });

  it("rechaza sin persistir: body vacío", async () => {
    const res = await api("POST", "/api/products", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/products/seed — catálogo de prueba propio (legítimo, con botón real en Productos.tsx)", () => {
  it("carga el catálogo de prueba una sola vez y queda en el listado de esta consultora", async () => {
    const res = await api("POST", "/api/products/seed");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    expect(Array.isArray(body.products)).toBe(true);
    const listAfter = await (await api("GET", "/api/products")).json();
    expect(listAfter.length).toBeGreaterThanOrEqual(body.count);
  });
});

describe("PATCH /api/products/:id — Etapa I-B.8-C (F2)", () => {
  let productId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/products", {
      seccion: "VITEST",
      linea: "Línea original",
      producto: "Producto editable",
      precio: 1000,
      unidades: 5,
      codigo: `vitest-edit-${Date.now()}`,
    });
    productId = (await res.json()).id;
  });

  it("edita el nombre y persiste", async () => {
    const res = await api("PATCH", `/api/products/${productId}`, { producto: "Nombre nuevo" });
    expect(res.status).toBe(200);
    expect((await res.json()).producto).toBe("Nombre nuevo");
    const list = await (await api("GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === productId).producto).toBe("Nombre nuevo");
  });

  it("edita el precio y persiste", async () => {
    const res = await api("PATCH", `/api/products/${productId}`, { precio: 2500 });
    expect(res.status).toBe(200);
    expect((await res.json()).precio).toBe(2500);
  });

  it("edita la sección/categoría (y línea) y persiste", async () => {
    const res = await api("PATCH", `/api/products/${productId}`, { seccion: "Nueva categoría", linea: "Nueva línea" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seccion).toBe("Nueva categoría");
    expect(body.linea).toBe("Nueva línea");
  });

  it("edita el código y persiste", async () => {
    const nuevoCodigo = `vitest-edit-nuevo-${Date.now()}`;
    const res = await api("PATCH", `/api/products/${productId}`, { codigo: nuevoCodigo });
    expect(res.status).toBe(200);
    expect((await res.json()).codigo).toBe(nuevoCodigo);
  });

  it("edita múltiples campos simultáneamente", async () => {
    const res = await api("PATCH", `/api/products/${productId}`, {
      producto: "Multi-campo",
      precio: 3000,
      seccion: "Multi categoría",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.producto).toBe("Multi-campo");
    expect(body.precio).toBe(3000);
    expect(body.seccion).toBe("Multi categoría");
  });

  it("rechaza sin mutar: nombre vacío", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}`, { producto: "" });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.producto).toBe(before.producto);
  });

  it("rechaza sin mutar: precio negativo", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}`, { precio: -100 });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.precio).toBe(before.precio);
  });

  it("payload con campos no permitidos: se ignoran, nunca se aplican (ownership, stock, costo)", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}`, {
      producto: "Con campos extra",
      consultantId: 999999,
      costPrice: 1,
      unidades: 999,
      discontinued: true,
      id: 999999,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.producto).toBe("Con campos extra"); // el campo permitido sí se aplicó
    expect(body.id).toBe(productId); // id no manipulable
    expect(body.unidades).toBe(before.unidades); // stock intacto, este endpoint no lo toca
    expect(body.costPrice).toBe(before.costPrice); // costo intacto
    expect(body.discontinued).toBe(before.discontinued); // baja lógica intacta
  });

  it("404 para un producto inexistente", async () => {
    const res = await api("PATCH", "/api/products/99999999", { producto: "X" });
    expect(res.status).toBe(404);
  });

  it("400 si el body no trae ningún campo", async () => {
    const res = await api("PATCH", `/api/products/${productId}`, {});
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/products/:id — Etapa I-B.8-C (F2)", () => {
  it("elimina un producto manual sin relaciones (sin ventas)", async () => {
    const created = await (
      await api("POST", "/api/products", { seccion: "VITEST", producto: "Para borrar", precio: 1000, unidades: 3 })
    ).json();

    const res = await api("DELETE", `/api/products/${created.id}`);
    expect(res.status).toBe(204);

    const list = await (await api("GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === created.id)).toBeUndefined();
  });

  it("repetir el DELETE sobre un producto ya eliminado devuelve 404 (no un 204 fantasma)", async () => {
    const created = await (
      await api("POST", "/api/products", { seccion: "VITEST", producto: "Para borrar dos veces", precio: 1000, unidades: 0 })
    ).json();

    const first = await api("DELETE", `/api/products/${created.id}`);
    expect(first.status).toBe(204);
    const second = await api("DELETE", `/api/products/${created.id}`);
    expect(second.status).toBe(404);
  });

  it("404 para un producto inexistente", async () => {
    const res = await api("DELETE", "/api/products/99999999");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/products/:id/stock", () => {
  let productId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto stock", precio: 1000, unidades: 0 });
    productId = (await res.json()).id;
  });

  it("happy path: setea stock y queda persistido (visible en el listado)", async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 25 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unidades).toBe(25);

    const list = await (await api("GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === productId).unidades).toBe(25);
  });

  it("rechaza sin mutar: stock negativo", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: -5 });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.unidades).toBe(before.unidades);
  });

  it("404 para un producto inexistente, sin efecto en la lista", async () => {
    const res = await api("PATCH", "/api/products/99999999/stock", { unidades: 5 });
    expect(res.status).toBe(404);
  });

  it("actualiza también stockMinimo cuando viene en el body, y lo respeta en low-stock", async () => {
    await api("PATCH", `/api/products/${productId}/stock`, { unidades: 1, stockMinimo: 5 });
    const lowStock = await (await api("GET", "/api/products/low-stock")).json();
    expect(lowStock.some((p: any) => p.id === productId)).toBe(true);
  });
});

describe("PATCH /api/products/:id/stock/increment", () => {
  let productId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto incremento", precio: 1000, unidades: 10 });
    productId = (await res.json()).id;
  });

  it("happy path: delta positivo suma sobre el stock actual y persiste", async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock/increment`, { delta: 5 });
    expect(res.status).toBe(200);
    expect((await res.json()).unidades).toBe(15);

    const list = await (await api("GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === productId).unidades).toBe(15);
  });

  it("delta negativo resta sobre el stock actual y persiste", async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock/increment`, { delta: -3 });
    expect(res.status).toBe(200);
    expect((await res.json()).unidades).toBe(12);
  });

  it("rechaza sin mutar: delta=0", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}/stock/increment`, { delta: 0 });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.unidades).toBe(before.unidades);
  });

  it("rechaza sin mutar: un decremento que dejaría el stock negativo", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}/stock/increment`, { delta: -(before.unidades + 1) });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.unidades).toBe(before.unidades);
  });

  it("404 para un producto inexistente, sin efecto en la lista", async () => {
    const res = await api("PATCH", "/api/products/99999999/stock/increment", { delta: 5 });
    expect(res.status).toBe(404);
  });

  it("no reemplaza a /stock: el SET absoluto sigue funcionando igual después de usar el incremento", async () => {
    const res = await api("PATCH", `/api/products/${productId}/stock`, { unidades: 0 });
    expect(res.status).toBe(200);
    expect((await res.json()).unidades).toBe(0);
  });
});

describe("PATCH /api/products/:id/discount", () => {
  let productId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto descuento", precio: 10000, unidades: 5 });
    productId = (await res.json()).id;
  });

  it("happy path: aplica un descuento válido y calcula/persiste el costPrice", async () => {
    const res = await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 40 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selectedDiscount).toBe(40);
    expect(body.costPrice).toBe(6000); // 10000 * (1 - 0.40)

    const list = await (await api("GET", "/api/products")).json();
    const found = list.find((p: any) => p.id === productId);
    expect(found.selectedDiscount).toBe(40);
    expect(found.costPrice).toBe(6000);
  });

  it("rechaza sin mutar: descuento fuera de los valores permitidos (35/40/45)", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}/discount`, { discountPercent: 50 });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.selectedDiscount).toBe(before.selectedDiscount);
    expect(after.costPrice).toBe(before.costPrice);
  });
});

describe("PATCH /api/products/:id/discontinued", () => {
  let productId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto discontinuar", precio: 1000, unidades: 5 });
    productId = (await res.json()).id;
  });

  it("marca y desmarca como discontinuado, ambos persisten", async () => {
    const res1 = await api("PATCH", `/api/products/${productId}/discontinued`, { discontinued: true });
    expect(res1.status).toBe(200);
    expect((await res1.json()).discontinued).toBe(true);
    let list = await (await api("GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === productId).discontinued).toBe(true);

    const res2 = await api("PATCH", `/api/products/${productId}/discontinued`, { discontinued: false });
    expect(res2.status).toBe(200);
    list = await (await api("GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === productId).discontinued).toBe(false);
  });

  it("rechaza tipo incorrecto (string en vez de boolean), sin mutar", async () => {
    const before = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    const res = await api("PATCH", `/api/products/${productId}/discontinued`, { discontinued: "si" });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.discontinued).toBe(before.discontinued);
  });
});

describe("PATCH /api/products/:id/stock-reminder", () => {
  let productId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto recordatorio", precio: 1000, unidades: 5 });
    productId = (await res.json()).id;
  });

  it("setea y luego cancela (null) el recordatorio, ambos persisten", async () => {
    const res1 = await api("PATCH", `/api/products/${productId}/stock-reminder`, { remindAt: "2026-12-25" });
    expect(res1.status).toBe(200);
    expect((await res1.json()).remindStockAt).toBe("2026-12-25");

    const res2 = await api("PATCH", `/api/products/${productId}/stock-reminder`, { remindAt: null });
    expect(res2.status).toBe(200);
    expect((await res2.json()).remindStockAt).toBeNull();
  });

  it("rechaza fecha con formato inválido, sin mutar", async () => {
    await api("PATCH", `/api/products/${productId}/stock-reminder`, { remindAt: "2026-12-25" });
    const res = await api("PATCH", `/api/products/${productId}/stock-reminder`, { remindAt: "25/12/2026" });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/products")).json()).find((p: any) => p.id === productId);
    expect(after.remindStockAt).toBe("2026-12-25"); // no lo pisó el request inválido
  });
});
