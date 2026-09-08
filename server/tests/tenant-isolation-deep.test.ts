import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { testDb as db, testPool as pool } from "../test-db";
import {
  consultants,
  users,
  clients,
  subscriptions,
  products,
  productStock,
  appointments,
  sales,
  saleItems,
  saleInstallments,
} from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Etapa I-B.3 — aislamiento multi-tenant profundo, a nivel HTTP real (route + middleware +
 * storage), contra Postgres real (misma DATABASE_URL que usan client-isolation.test.ts y
 * stock-concurrency.test.ts — nunca Railway, nunca la base de producción). Convención: TENANT
 * A es quien ataca, TENANT B es la dueña real de los recursos — coincide con la redacción del
 * pedido ("A NO debe poder... sobre recursos de B").
 *
 * `client-isolation.test.ts` ya cubre PATCH de clientas — acá no se repite, solo se completa
 * lo que faltaba (DELETE de clientas) y se cubre products/sales/appointments de punta a punta.
 */

const storage = new DatabaseStorage();
let httpServer: Server;
let baseUrl: string;

const USERNAME_A = `vitest_tiso_a_${Date.now()}`;
const USERNAME_B = `vitest_tiso_b_${Date.now()}`;
const PASSWORD = "vitest-test-password-123";

let userAId: number;
let userBId: number;
let consultantAId: number;
let consultantBId: number;
let cookieA: string;
let cookieB: string;

// Recursos reales de B (la víctima) — todos creados acá, nunca datos reales.
let clientAId: number; // solo se usa en el bloque de aislamiento de clientRequestId, Etapa I-B.6
let clientBId: number;
let manualProductBId: number;
let appointmentBId: number;
let saleBId: number;
let installmentBId: number;
let globalProductId: number;

async function loginAs(username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

async function api(cookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  const userA = await storage.createUser({ username: USERNAME_A, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  const userB = await storage.createUser({ username: USERNAME_B, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  userAId = userA.id;
  userBId = userB.id;
  consultantAId = userA.consultantId!;
  consultantBId = userB.consultantId!;

  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  cookieA = await loginAs(USERNAME_A);
  cookieB = await loginAs(USERNAME_B);

  // --- Fixtures reales de B ---
  const [clientB] = await db
    .insert(clients)
    .values({ consultantId: consultantBId, name: "Clienta VITEST Tenant B", phone: "9990000002" })
    .returning();
  clientBId = clientB.id;

  const [manualProductB] = await db
    .insert(products)
    .values({
      consultantId: consultantBId,
      seccion: "VITEST",
      producto: "Producto manual Tenant B",
      variante: "Estándar",
      codigo: `vitest-tiso-b-${Date.now()}`,
      puntos: 0,
      precio: 5000,
      source: "manual",
    })
    .returning();
  manualProductBId = manualProductB.id;
  await db.insert(productStock).values({ consultantId: consultantBId, productId: manualProductBId, unidades: 10, stockMinimo: 0, costPrice: 2500 });

  // Producto global (consultantId null = catálogo compartido). Antes de la Etapa I-B.5.1
  // esto leía un producto real del catálogo compartido (182 productos reales en la base
  // real) — ahora que los tests de Postgres corren contra una base de test aislada y vacía
  // (ver docs/TESTING_POSTGRES.md), no hay ningún catálogo preexistente que leer: se crea
  // el producto global acá mismo, como cualquier otro fixture del test.
  const [globalProduct] = await db
    .insert(products)
    .values({
      consultantId: null,
      seccion: "VITEST",
      producto: "Producto global VITEST",
      variante: "Estándar",
      codigo: `vitest-tiso-global-${Date.now()}`,
      puntos: 0,
      precio: 8000,
      source: "import",
    })
    .returning();
  globalProductId = globalProduct.id;

  // Fixtures propias de A, solo para el bloque de aislamiento de clientRequestId (Etapa I-B.6)
  // — necesita poder crear SU PROPIA venta, no solo atacar las de B.
  const [clientA] = await db
    .insert(clients)
    .values({ consultantId: consultantAId, name: "Clienta VITEST Tenant A", phone: "9990000001" })
    .returning();
  clientAId = clientA.id;
  await db.insert(productStock).values({ consultantId: consultantAId, productId: globalProductId, unidades: 10, stockMinimo: 0, costPrice: 4000 });

  const [apptB] = await db
    .insert(appointments)
    .values({
      consultantId: consultantBId,
      clientId: clientBId,
      clientName: clientB.name,
      date: "2026-12-15",
      time: "11:00",
      type: "visita",
      status: "pendiente",
    })
    .returning();
  appointmentBId = apptB.id;

  const saleB = await storage.createSale(consultantBId, {
    clientId: clientBId,
    date: "2026-09-03",
    items: [{ productId: manualProductBId, quantity: 2 }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments: [{ amount: 10000 }],
    status: "pendiente",
  });
  saleBId = saleB.id;
  const [installmentB] = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, saleBId));
  installmentBId = installmentB.id;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  if (saleBId) {
    await db.delete(saleInstallments).where(eq(saleInstallments.saleId, saleBId));
    await db.delete(saleItems).where(eq(saleItems.saleId, saleBId));
    await db.delete(sales).where(eq(sales.id, saleBId));
  }
  await db.delete(appointments).where(inArray(appointments.consultantId, [consultantAId, consultantBId]));
  await db.delete(productStock).where(inArray(productStock.consultantId, [consultantAId, consultantBId]));
  await db.delete(products).where(inArray(products.consultantId, [consultantAId, consultantBId]));
  if (globalProductId) {
    await db.delete(productStock).where(eq(productStock.productId, globalProductId));
    await db.delete(products).where(eq(products.id, globalProductId));
  }
  await db.delete(clients).where(inArray(clients.consultantId, [consultantAId, consultantBId]));
  await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  await db.delete(subscriptions).where(inArray(subscriptions.consultantId, [consultantAId, consultantBId]));
  await db.delete(consultants).where(inArray(consultants.id, [consultantAId, consultantBId]));
  await pool.end();
}, 30_000);

describe("Tenant isolation profundo — Products", () => {
  it("el producto manual de B no aparece en el catálogo visible de A", async () => {
    const res = await api(cookieA, "GET", "/api/products");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.some((p: any) => p.id === manualProductBId)).toBe(false);
  });

  it("A no puede aplicar descuento al producto manual de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "PATCH", `/api/products/${manualProductBId}/discount`, { discountPercent: 40 });
    expect(res.status).toBe(404);

    const [stockRow] = await db.select().from(productStock).where(eq(productStock.productId, manualProductBId));
    expect(stockRow.selectedDiscount).toBeNull();
  });

  it("A no puede tocar stock/discontinued/recordatorio del producto manual de B (404, sin mutación)", async () => {
    // El fixture de B ya vendió 2 unidades en beforeAll (10 -> 8) — se compara contra el
    // estado real antes del ataque, no contra el valor inicial del insert.
    const [before] = await db.select().from(productStock).where(eq(productStock.productId, manualProductBId));

    const attempts = await Promise.all([
      api(cookieA, "PATCH", `/api/products/${manualProductBId}/stock`, { unidades: 999 }),
      api(cookieA, "PATCH", `/api/products/${manualProductBId}/stock/increment`, { delta: 5 }),
      api(cookieA, "PATCH", `/api/products/${manualProductBId}/discontinued`, { discontinued: true }),
      api(cookieA, "PATCH", `/api/products/${manualProductBId}/stock-reminder`, { remindAt: "2026-01-01" }),
    ]);
    for (const res of attempts) expect(res.status).toBe(404);

    const [after] = await db.select().from(productStock).where(eq(productStock.productId, manualProductBId));
    expect(after.unidades).toBe(before.unidades);
    expect(after.discontinued).toBe(before.discontinued);
    expect(after.remindStockAt).toBe(before.remindStockAt);
  });

  it("producto GLOBAL: A y B pueden setear su propio stock sin pisar el de la otra (no es un bug, es el modelo real)", async () => {
    const resA = await api(cookieA, "PATCH", `/api/products/${globalProductId}/stock`, { unidades: 3 });
    expect(resA.status).toBe(200);
    const resB = await api(cookieB, "PATCH", `/api/products/${globalProductId}/stock`, { unidades: 7 });
    expect(resB.status).toBe(200);

    const listA = await (await api(cookieA, "GET", "/api/products")).json();
    const listB = await (await api(cookieB, "GET", "/api/products")).json();
    expect(listA.find((p: any) => p.id === globalProductId).unidades).toBe(3);
    expect(listB.find((p: any) => p.id === globalProductId).unidades).toBe(7);
  });

  // Etapa I-B.8-C (F2): CRUD real de productos — PATCH/DELETE de campos core.
  it("A no puede editar ni eliminar el producto manual de B (404, sin mutación ni borrado)", async () => {
    const [before] = await db.select().from(products).where(eq(products.id, manualProductBId));

    const patchRes = await api(cookieA, "PATCH", `/api/products/${manualProductBId}`, { producto: "Hackeado" });
    expect(patchRes.status).toBe(404);
    const deleteRes = await api(cookieA, "DELETE", `/api/products/${manualProductBId}`);
    expect(deleteRes.status).toBe(404);

    const [after] = await db.select().from(products).where(eq(products.id, manualProductBId));
    expect(after).toEqual(before);
  });

  it("A no puede editar ni eliminar el producto GLOBAL con PATCH/DELETE de campos core (404 — no es 'suyo', aunque pueda setear su propio stock sobre él)", async () => {
    const [before] = await db.select().from(products).where(eq(products.id, globalProductId));

    const patchRes = await api(cookieA, "PATCH", `/api/products/${globalProductId}`, { producto: "Hackeado global" });
    expect(patchRes.status).toBe(404);
    const deleteRes = await api(cookieA, "DELETE", `/api/products/${globalProductId}`);
    expect(deleteRes.status).toBe(404);

    const [after] = await db.select().from(products).where(eq(products.id, globalProductId));
    expect(after).toEqual(before);
  });

  it("B (dueña real) SÍ puede editar su propio producto manual", async () => {
    const res = await api(cookieB, "PATCH", `/api/products/${manualProductBId}`, { producto: "Producto manual B editado" });
    expect(res.status).toBe(200);
    expect((await res.json()).producto).toBe("Producto manual B editado");

    await db.update(products).set({ producto: "Producto manual Tenant B" }).where(eq(products.id, manualProductBId));
  });

  it("B (dueña real) NO puede eliminar su propio producto manual porque tiene ventas registradas (409 — mismo dominio que deleteClient)", async () => {
    const res = await api(cookieB, "DELETE", `/api/products/${manualProductBId}`);
    expect(res.status).toBe(409);
    const [stillThere] = await db.select().from(products).where(eq(products.id, manualProductBId));
    expect(stillThere).toBeDefined();
  });

  it("mandar consultantId en el body no cambia el ownership — se ignora silenciosamente (Zod strip), sigue siendo de B", async () => {
    const res = await api(cookieB, "PATCH", `/api/products/${manualProductBId}`, {
      producto: "Con intento de robo",
      consultantId: consultantAId,
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(products).where(eq(products.id, manualProductBId));
    expect(row.consultantId).toBe(consultantBId); // nunca cambió

    const attackAfter = await api(cookieA, "PATCH", `/api/products/${manualProductBId}`, { producto: "x" });
    expect(attackAfter.status).toBe(404); // A sigue sin poder tocarlo después del intento

    await db.update(products).set({ producto: "Producto manual Tenant B" }).where(eq(products.id, manualProductBId));
  });
});

describe("Tenant isolation profundo — Sales", () => {
  it("A no puede leer la venta de B (404)", async () => {
    const res = await api(cookieA, "GET", `/api/sales/${saleBId}`);
    expect(res.status).toBe(404);
  });

  it("A no puede editar (PATCH) la venta de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "PATCH", `/api/sales/${saleBId}`, {
      items: [{ productId: manualProductBId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 5000 }],
    });
    expect(res.status).toBe(404);
  });

  it("A no puede cancelar la venta de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "POST", `/api/sales/${saleBId}/cancel`);
    expect(res.status).toBe(404);
  });

  it("A no puede modificar la cuota de la venta de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "PATCH", `/api/sales/${saleBId}/installments/${installmentBId}`, { status: "pagado" });
    expect(res.status).toBe(404);
  });

  it("después de todos los intentos de A, la venta de B (leída por B) sigue exactamente igual", async () => {
    const res = await api(cookieB, "GET", `/api/sales/${saleBId}`);
    expect(res.status).toBe(200);
    const sale = await res.json();
    expect(sale.status).toBe("pendiente");
    expect(sale.total).toBe(10000);
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(2);
    expect(sale.installments).toHaveLength(1);
    expect(sale.installments[0].status).toBe("pendiente");
  });
});

describe("Tenant isolation profundo — Appointments", () => {
  it("A no puede editar (PATCH completo) la cita de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "PATCH", `/api/appointments/${appointmentBId}`, {
      clientId: clientBId,
      date: "2026-01-01",
      time: "23:59",
      type: "visita",
    });
    expect(res.status).toBe(404);
  });

  it("A no puede cambiar el estado de la cita de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "PATCH", `/api/appointments/${appointmentBId}/status`, { status: "completada" });
    expect(res.status).toBe(404);
  });

  it("A no puede eliminar la cita de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "DELETE", `/api/appointments/${appointmentBId}`);
    expect(res.status).toBe(404);
  });

  it("después de todos los intentos de A, la cita de B (leída por B) sigue exactamente igual", async () => {
    const res = await api(cookieB, "GET", "/api/appointments?start=2026-12-01&end=2026-12-31");
    expect(res.status).toBe(200);
    const list = await res.json();
    const appt = list.find((a: any) => a.id === appointmentBId);
    expect(appt).toBeDefined();
    expect(appt.date).toBe("2026-12-15");
    expect(appt.time).toBe("11:00");
    expect(appt.status).toBe("pendiente");
  });
});

describe("Tenant isolation profundo — Clients (completa lo que client-isolation.test.ts no cubre: DELETE)", () => {
  it("A no puede eliminar la clienta de B (404, sin mutación)", async () => {
    const res = await api(cookieA, "DELETE", `/api/clients/${clientBId}`);
    expect(res.status).toBe(404);
  });

  it("después del intento de A, la clienta de B (leída por B) sigue existiendo intacta", async () => {
    const res = await api(cookieB, "GET", "/api/clients?limit=100");
    expect(res.status).toBe(200);
    const list = await res.json();
    const found = list.find((c: any) => c.id === clientBId);
    expect(found).toBeDefined();
    expect(found.name).toBe("Clienta VITEST Tenant B");
  });
});

describe("Tenant isolation profundo — clientRequestId (Etapa I-B.6)", () => {
  const sharedKey = randomUUID();
  const saleIdsToClean: number[] = [];

  afterAll(async () => {
    if (saleIdsToClean.length > 0) {
      await db.delete(saleInstallments).where(inArray(saleInstallments.saleId, saleIdsToClean));
      await db.delete(saleItems).where(inArray(saleItems.saleId, saleIdsToClean));
      await db.delete(sales).where(inArray(sales.id, saleIdsToClean));
    }
  });

  it("el mismo clientRequestId usado por dos consultoras distintas -> cada una crea su propia venta, sin colisión", async () => {
    const saleA = await storage.createSale(consultantAId, {
      clientId: clientAId,
      date: "2026-09-03",
      items: [{ productId: globalProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 8000 }],
      status: "pendiente",
      clientRequestId: sharedKey,
    });
    saleIdsToClean.push(saleA.id);

    const saleB2 = await storage.createSale(consultantBId, {
      clientId: clientBId,
      date: "2026-09-03",
      items: [{ productId: manualProductBId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 5000 }],
      status: "pendiente",
      clientRequestId: sharedKey,
    });
    saleIdsToClean.push(saleB2.id);

    expect(saleA.id).not.toBe(saleB2.id);
    expect(saleA.consultantId).toBe(consultantAId);
    expect(saleB2.consultantId).toBe(consultantBId);
  });

  it("el lookup de clientRequestId filtra por consultantId: A nunca recibe la venta de B, ni al reintentar su propio POST", async () => {
    const [matchA] = await db
      .select()
      .from(sales)
      .where(and(eq(sales.consultantId, consultantAId), eq(sales.clientRequestId, sharedKey)));
    const [matchB] = await db
      .select()
      .from(sales)
      .where(and(eq(sales.consultantId, consultantBId), eq(sales.clientRequestId, sharedKey)));
    expect(matchA).toBeDefined();
    expect(matchB).toBeDefined();
    expect(matchA.id).not.toBe(matchB.id);

    // Reintentar el POST de A con el mismo clientRequestId sigue devolviendo SU propia venta,
    // nunca la de B — confirma que el UNIQUE/lookup es (consultantId, clientRequestId), no
    // solo clientRequestId (ver diseño explícito de la Etapa I-B.6, no un UNIQUE global).
    const replayA = await storage.createSale(consultantAId, {
      clientId: clientAId,
      date: "2026-09-03",
      items: [{ productId: globalProductId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 8000 }],
      status: "pendiente",
      clientRequestId: sharedKey,
    });
    expect(replayA.id).toBe(matchA.id);
    expect(replayA.id).not.toBe(matchB.id);
  });
});
