import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Etapa 7.1 — cierra el P1 de la auditoría de Etapa 6: GET /api/clients en modo paginado
 * (`page` presente) reemplaza el viejo `limit: "100"` fijo sin ORDER BY determinístico.
 * HTTP real contra storage en memoria (mismo criterio que import-route.test.ts/sales.test.ts
 * para tests de comportamiento — no de concurrencia real): la lógica de orden/filtro/paginado
 * de searchClientsPaginated es idéntica en JS para ambos backends (ver server/storage.ts,
 * DatabaseStorage y MemoryStorage comparten el mismo criterio de sort/filter/slice), así que
 * esto ejercita el mismo código que correría contra Postgres real.
 *
 * Un solo login por consultora (en beforeAll, reusado por todos los tests de esa consultora)
 * — no uno por `it()` — porque loginRateLimiter es 10/15min por IP y todos estos tests pegan
 * desde el mismo 127.0.0.1. Cada test usa su propio prefijo de nombre/teléfono para no
 * pisarse con los demás dentro de la misma consultora compartida.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

let consultantId: number;
let cookie: string;
let consultantBId: number;
let cookieB: string;

async function login(username: string, consultantIdOverride?: number) {
  const user = await storage.createUser({
    username,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
    ...(consultantIdOverride ? { consultantId: consultantIdOverride } : {}),
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "vitest-test-password-123" }),
  });
  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Login falló para ${username}: ${loginRes.status} ${await loginRes.text()}`);
  return { consultantId: user.consultantId!, cookie: setCookie.split(";")[0] };
}

/** Nombres con padding numérico -> el orden alfabético coincide con el orden numérico, así
 * los asserts pueden predecir exactamente qué nombre cae en cada página. */
async function createManyClients(forConsultantId: number, count: number, namePrefix: string, phonePrefix: string) {
  for (let i = 0; i < count; i++) {
    await storage.createClient(forConsultantId, {
      name: `${namePrefix} ${String(i).padStart(4, "0")}`,
      phone: `${phonePrefix}${String(i).padStart(6, "0")}`,
    });
  }
}

async function fetchClients(withCookie: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/clients?${qs}`, { headers: { Cookie: withCookie } });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  ({ storage } = await import("../storage"));

  ({ consultantId, cookie } = await login(`vitest_clientspg_a_${Date.now()}`));
  ({ consultantId: consultantBId, cookie: cookieB } = await login(`vitest_clientspg_b_${Date.now()}`));
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("GET /api/clients — modo paginado (page presente)", () => {
  it("0 clientas para un filtro que no matchea nada -> items vacío, total 0, totalPages 0, nunca un error", async () => {
    const { status, body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "no-existe-ningun-nombre-asi-xyz" });
    expect(status).toBe(200);
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0, totalRevenue: 0 });
  });

  it("1 clienta -> total 1, totalPages 1, aparece en la página 1", async () => {
    await storage.createClient(consultantId, { name: "Única Clienta 3900", phone: "3900000001" });
    const { body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "Única Clienta 3900" });
    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Única Clienta 3900");
  });

  it("exactamente 100 clientas (el viejo límite hardcodeado) con pageSize 25 -> 4 páginas completas, total 100", async () => {
    await createManyClients(consultantId, 100, "Cien", "2100");
    const page1 = await fetchClients(cookie, { page: "1", pageSize: "25", search: "Cien " });
    expect(page1.body.total).toBe(100);
    expect(page1.body.totalPages).toBe(4);
    expect(page1.body.items).toHaveLength(25);
    const page4 = await fetchClients(cookie, { page: "4", pageSize: "25", search: "Cien " });
    expect(page4.body.items).toHaveLength(25);
  });

  it("101 clientas -> total 101, la 101ra NUNCA queda invisible (el bug original: limit fijo de 100)", async () => {
    await createManyClients(consultantId, 101, "CientoUno", "2200");
    const { body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "CientoUno" });
    expect(body.total).toBe(101);
    expect(body.totalPages).toBe(5);

    const lastPage = await fetchClients(cookie, { page: "5", pageSize: "25", search: "CientoUno" });
    expect(lastPage.body.items).toHaveLength(1);
    expect(lastPage.body.items[0].name).toBe("CientoUno 0100");
  });

  it("pageSize igual al viejo límite (100) con 101 clientas -> página 1 trae 100, página 2 trae la que antes se perdía", async () => {
    await createManyClients(consultantId, 101, "Frontera", "2300");
    const page1 = await fetchClients(cookie, { page: "1", pageSize: "100", search: "Frontera" });
    expect(page1.body.items).toHaveLength(100);
    const page2 = await fetchClients(cookie, { page: "2", pageSize: "100", search: "Frontera" });
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].name).toBe("Frontera 0100");
  });

  it("pageSize por encima del máximo permitido se clampea (nunca desactiva la paginación)", async () => {
    await createManyClients(consultantId, 150, "Clamp", "2400");
    const { body } = await fetchClients(cookie, { page: "1", pageSize: "999999", search: "Clamp" });
    expect(body.pageSize).toBeLessThanOrEqual(100);
    expect(body.items.length).toBeLessThanOrEqual(100);
    expect(body.total).toBe(150);
  });

  it("búsqueda que matchea más de 100 resultados también pagina correctamente (no se trunca en silencio)", async () => {
    await createManyClients(consultantId, 120, "Buscable", "2500");
    await storage.createClient(consultantId, { name: "No Coincide 2599", phone: "2599999999" });

    const { body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "Buscable" });
    expect(body.total).toBe(120);
    expect(body.totalPages).toBe(5);
    expect(body.items.every((c: { name: string }) => c.name.startsWith("Buscable"))).toBe(true);
  });

  it("página siguiente devuelve clientas distintas de la página anterior (sin solapar ni repetir)", async () => {
    await createManyClients(consultantId, 50, "Sig", "2600");
    const page1 = await fetchClients(cookie, { page: "1", pageSize: "20", search: "Sig " });
    const page2 = await fetchClients(cookie, { page: "2", pageSize: "20", search: "Sig " });
    const idsPage1 = new Set(page1.body.items.map((c: { id: number }) => c.id));
    const idsPage2 = page2.body.items.map((c: { id: number }) => c.id);
    expect(idsPage2.every((id: number) => !idsPage1.has(id))).toBe(true);
    expect(page1.body.items[0].name).toBe("Sig 0000");
    expect(page2.body.items[0].name).toBe("Sig 0020");
  });

  it("última página parcial trae solo el resto exacto, sin caerse ni repetir la anterior", async () => {
    await createManyClients(consultantId, 47, "Ultima", "2700"); // 47 / 20 = 3 páginas, la última con 7
    const { body } = await fetchClients(cookie, { page: "3", pageSize: "20", search: "Ultima" });
    expect(body.items).toHaveLength(7);
    expect(body.totalPages).toBe(3);
  });

  it("página fuera de rango -> items vacío, metadata sigue correcta (nunca un error 500 ni se inventa contenido)", async () => {
    await createManyClients(consultantId, 5, "Rango", "2800");
    const { status, body } = await fetchClients(cookie, { page: "99", pageSize: "25", search: "Rango" });
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(5);
    expect(body.totalPages).toBe(1);
  });

  it("búsqueda + paginación combinadas: el total refleja SOLO lo que matchea la búsqueda, no el universo completo", async () => {
    await createManyClients(consultantId, 30, "Combo", "2900");
    await createManyClients(consultantId, 30, "OtroDistinto", "2910");
    const { body } = await fetchClients(cookie, { page: "1", pageSize: "10", search: "Combo" });
    expect(body.total).toBe(30);
    expect(body.items.every((c: { name: string }) => c.name.startsWith("Combo"))).toBe(true);
  });

  it("orden determinístico: la misma página pedida dos veces da EXACTAMENTE el mismo orden", async () => {
    await createManyClients(consultantId, 40, "Determ", "3000");
    const first = await fetchClients(cookie, { page: "2", pageSize: "15", search: "Determ" });
    const second = await fetchClients(cookie, { page: "2", pageSize: "15", search: "Determ" });
    expect(second.body.items.map((c: { id: number }) => c.id)).toEqual(first.body.items.map((c: { id: number }) => c.id));
    expect(first.body.items[0].name).toBe("Determ 0015");
  });

  it("orden determinístico: dos clientas con el mismo nombre desempatan siempre por id ascendente", async () => {
    const first = await storage.createClient(consultantId, { name: "Homónima 3100", phone: "3100000001" });
    const second = await storage.createClient(consultantId, { name: "Homónima 3100", phone: "3100000002" });
    const { body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "Homónima 3100" });
    expect(body.items.map((c: { id: number }) => c.id)).toEqual([first.id, second.id]);
  });

  it("tenant isolation: consultora A nunca ve clientas de B manipulando page/pageSize/search", async () => {
    await createManyClients(consultantId, 10, "SoloA", "3200");
    await createManyClients(consultantBId, 150, "SoloB", "3300");

    // Página fuera del propio rango de A, pageSize grande, y hasta buscando el prefijo de B:
    // nada de eso debe devolver una sola clienta de B.
    const attempts = [
      { page: "1", pageSize: "25", search: "SoloA" },
      { page: "1", pageSize: "100", search: "SoloB" },
      { page: "9", pageSize: "100", search: "SoloA" },
    ];
    for (const params of attempts) {
      const { body } = await fetchClients(cookie, params);
      expect(body.items.some((c: { name: string }) => c.name.startsWith("SoloB"))).toBe(false);
    }
    // Y el total de A (buscando su propio prefijo) nunca incluye a las 150 de B.
    const { body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "SoloA" });
    expect(body.total).toBe(10);
  });

  it("balanceFilter=con_saldo excluye clientas sin cuotas pendientes reales (via storage.createSale)", async () => {
    const product = await storage.createProduct(consultantId, { seccion: "Test", producto: "Producto Saldo 3400", precio: 1000, unidades: 10, puntos: 1 });
    const withBalance = await storage.createClient(consultantId, { name: "Con Saldo 3400", phone: "3400000001" });
    const withoutBalance = await storage.createClient(consultantId, { name: "Con Saldo 3400 Sin Cuota", phone: "3400000002" });

    await storage.createSale(consultantId, {
      clientId: withBalance.id,
      date: "2026-01-01",
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      status: "pendiente",
    });

    const { body } = await fetchClients(cookie, { page: "1", pageSize: "25", search: "Con Saldo 3400", balanceFilter: "con_saldo" });
    expect(body.items.map((c: { id: number }) => c.id)).toEqual([withBalance.id]);
    expect(body.items.some((c: { id: number }) => c.id === withoutBalance.id)).toBe(false);
  });
});
