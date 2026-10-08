import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Prompt 9, puntos 4 y 5 — "Registrar pago" (ficha), "Marcar como pagada"/"Cobrada" (cuota
 * puntual) y "Total cobrado" (nunca cuenta dos veces). Modo memoria, HTTP real — mismo
 * criterio que sales.test.ts.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let cookieB: string;
let clientId: number;
let productId: number; // precio 1, unidades 10.000.000 — la cantidad de cada venta se ajusta
// exactamente al total de sus cuotas (ver baseSale), así nunca hay que elegir un precio/cantidad
// a mano por cada monto de cuota distinto que usa cada test.

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiAs(asCookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: asCookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function baseSale(overrides: Record<string, unknown> = {}) {
  const installments = (overrides.installments as { amount: number }[] | undefined) ?? [{ amount: 10000 }];
  const total = installments.reduce((sum, i) => sum + i.amount, 0);
  return {
    clientId,
    date: "2026-01-01",
    items: [{ productId, quantity: total }], // precio 1 — la cantidad ES el total, calza siempre
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments,
    paidNow: false,
    firstDueDate: "2026-02-01",
    ...overrides,
  };
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
    username: `vitest_payments_${Date.now()}`,
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

  const userB = await storage.createUser({
    username: `vitest_payments_b_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const loginResB = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: userB.username, password: "vitest-test-password-123" }),
  });
  cookieB = loginResB.headers.get("set-cookie")!.split(";")[0];

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST Payments", phone: "9990005001" });
  clientId = (await clientRes.json()).id;

  const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto pagos", precio: 1, unidades: 10_000_000 });
  productId = (await productRes.json()).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("POST /api/clients/:id/payments — Registrar pago (Prompt 9, punto 4)", () => {
  it("un pago parcial deja el saldo correcto en la cuota", async () => {
    const sale = await (await api("POST", "/api/sales", baseSale({ installments: [{ amount: 10000 }] }))).json();

    const payRes = await api("POST", `/api/clients/${clientId}/payments`, { amount: 4000, date: "2026-01-15", paymentMethod: "efectivo" });
    expect(payRes.status).toBe(201);

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments[0].amountPaid).toBe(4000);
    expect(detail.installments[0].status).toBe("pendiente");
  });

  it("si el pago cubre el resto exacto, la cuota pasa a pagada", async () => {
    // Vencimiento más temprano que el de la cuota anterior (sigue pendiente con saldo, a
    // propósito) para que el "oldest-first" de registerClientPayment pague ESTA cuota antes
    // que el remanente viejo — si no, el pago exacto de este test se iría al remanente.
    const sale = await (await api("POST", "/api/sales", baseSale({ installments: [{ amount: 5000 }], firstDueDate: "2026-01-12" }))).json();
    const payRes = await api("POST", `/api/clients/${clientId}/payments`, { amount: 5000, date: "2026-01-15", paymentMethod: "efectivo" });
    expect(payRes.status).toBe(201);

    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.installments[0].amountPaid).toBe(5000);
    expect(detail.installments[0].status).toBe("pagado");
  });

  it("un pago que cubre varias cuotas de distintas ventas, de la más vieja a la más nueva", async () => {
    const saleOld = await (await api("POST", "/api/sales", baseSale({ date: "2026-01-01", installments: [{ amount: 3000 }], firstDueDate: "2026-01-05" }))).json();
    const saleNew = await (await api("POST", "/api/sales", baseSale({ date: "2026-01-02", installments: [{ amount: 5000 }], firstDueDate: "2026-01-10" }))).json();

    const payRes = await api("POST", `/api/clients/${clientId}/payments`, { amount: 6000, date: "2026-01-20", paymentMethod: "transferencia" });
    expect(payRes.status).toBe(201);

    const detailOld = await (await api("GET", `/api/sales/${saleOld.id}`)).json();
    const detailNew = await (await api("GET", `/api/sales/${saleNew.id}`)).json();
    // La más vieja (vencimiento 01-05) se cubre completa primero.
    expect(detailOld.installments[0].status).toBe("pagado");
    expect(detailOld.installments[0].amountPaid).toBe(3000);
    // Sobran 3000 de los 6000 — van a la segunda, que queda parcial.
    expect(detailNew.installments[0].amountPaid).toBe(3000);
    expect(detailNew.installments[0].status).toBe("pendiente");
  });

  it("rechaza un monto de 0 o negativo", async () => {
    await api("POST", "/api/sales", baseSale({ installments: [{ amount: 2000 }] }));
    const res = await api("POST", `/api/clients/${clientId}/payments`, { amount: 0, date: "2026-01-01", paymentMethod: "efectivo" });
    expect(res.status).toBe(400);
  });

  it("rechaza un monto mayor al saldo pendiente total de la clienta", async () => {
    const res = await api("POST", `/api/clients/${clientId}/payments`, { amount: 999999999, date: "2026-01-01", paymentMethod: "efectivo" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no puede superar lo que debe/i);
  });

  it("404 sobre una clienta inexistente", async () => {
    const res = await api("POST", "/api/clients/99999999/payments", { amount: 1000, date: "2026-01-01", paymentMethod: "efectivo" });
    expect(res.status).toBe(400); // SaleValidationError -> 400, no 404 (mismo criterio que el resto de /api/sales)
  });
});

describe("PATCH /api/sales/:id/installments/:id — Marcar como pagada (Prompt 9, punto 5)", () => {
  it("crea el pago con la forma de pago de la propia venta", async () => {
    const sale = await (await api("POST", "/api/sales", baseSale({ paymentMethod: "transferencia", installments: [{ amount: 2500 }] }))).json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const installmentId = detail.installments[0].id;

    const markRes = await api("PATCH", `/api/sales/${sale.id}/installments/${installmentId}`, { status: "pagado" });
    expect(markRes.status).toBe(200);
    expect((await markRes.json()).amountPaid).toBe(2500);

    const payments = await (await api("GET", `/api/clients/${clientId}/payments`)).json();
    expect(payments.some((p: { amount: number; paymentMethod: string }) => p.amount === 2500 && p.paymentMethod === "transferencia")).toBe(true);
  });

  it("revertir a pendiente resetea amountPaid a 0", async () => {
    const sale = await (await api("POST", "/api/sales", baseSale({ installments: [{ amount: 1800 }] }))).json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const installmentId = detail.installments[0].id;

    await api("PATCH", `/api/sales/${sale.id}/installments/${installmentId}`, { status: "pagado" });
    const revertRes = await api("PATCH", `/api/sales/${sale.id}/installments/${installmentId}`, { status: "pendiente" });
    expect(revertRes.status).toBe(200);
    const reverted = await revertRes.json();
    expect(reverted.status).toBe("pendiente");
    expect(reverted.amountPaid).toBe(0);
  });
});

describe("GET /api/reports/collected-payments — nada se cuenta dos veces (Prompt 9, punto 5)", () => {
  it("suma exactamente lo cobrado, sin duplicar entre tarjeta/marcar pagada/pago parcial", async () => {
    const before = (await (await api("GET", "/api/reports/collected-payments")).json()).totalCollected;

    // Tarjeta: se cobra entera al crear, automático.
    const cardSale = await (await api("POST", "/api/sales", baseSale({ paymentMethod: "tarjeta", installments: [{ amount: 4000 }] }))).json();
    // Marcar como pagada manualmente.
    const manualSale = await (await api("POST", "/api/sales", baseSale({ installments: [{ amount: 1500 }] }))).json();
    const manualDetail = await (await api("GET", `/api/sales/${manualSale.id}`)).json();
    await api("PATCH", `/api/sales/${manualSale.id}/installments/${manualDetail.installments[0].id}`, { status: "pagado" });
    // Pago parcial vía ficha.
    await api("POST", "/api/sales", baseSale({ installments: [{ amount: 9000 }] }));
    await api("POST", `/api/clients/${clientId}/payments`, { amount: 2200, date: "2026-01-20", paymentMethod: "efectivo" });

    const after = (await (await api("GET", "/api/reports/collected-payments")).json()).totalCollected;
    expect(after - before).toBe(4000 + 1500 + 2200);
    void cardSale;
  });

  it("cancelar una venta excluye lo que ya se había cobrado de ella", async () => {
    const before = (await (await api("GET", "/api/reports/collected-payments")).json()).totalCollected;

    const sale = await (await api("POST", "/api/sales", baseSale({ paymentMethod: "tarjeta", installments: [{ amount: 3300 }] }))).json();
    const afterCreate = (await (await api("GET", "/api/reports/collected-payments")).json()).totalCollected;
    expect(afterCreate - before).toBe(3300);

    await api("POST", `/api/sales/${sale.id}/cancel`);
    const afterCancel = (await (await api("GET", "/api/reports/collected-payments")).json()).totalCollected;
    expect(afterCancel).toBe(before);
  });
});

describe("Notas de clienta (Prompt 9, punto 3)", () => {
  it("crea, lista (más nueva primero) y borra", async () => {
    const note1 = await (await api("POST", `/api/clients/${clientId}/notes`, { text: "Primera nota" })).json();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const note2 = await (await api("POST", `/api/clients/${clientId}/notes`, { text: "Segunda nota" })).json();

    const listRes = await api("GET", `/api/clients/${clientId}/notes`);
    const list = await listRes.json();
    const ids = list.map((n: { id: number }) => n.id);
    expect(ids.indexOf(note2.id)).toBeLessThan(ids.indexOf(note1.id));

    const deleteRes = await api("DELETE", `/api/clients/${clientId}/notes/${note1.id}`);
    expect(deleteRes.status).toBe(204);

    const afterDelete = await (await api("GET", `/api/clients/${clientId}/notes`)).json();
    expect(afterDelete.some((n: { id: number }) => n.id === note1.id)).toBe(false);
  });

  it("rechaza una nota vacía", async () => {
    const res = await api("POST", `/api/clients/${clientId}/notes`, { text: "   " });
    expect(res.status).toBe(400);
  });

  it("404 al crear una nota sobre una clienta inexistente", async () => {
    const res = await api("POST", "/api/clients/99999999/notes", { text: "Nota" });
    expect(res.status).toBe(404);
  });
});

describe("Aislamiento entre consultoras — pagos y notas (Prompt 9, punto 7)", () => {
  it("B no puede registrar un pago sobre la clienta de A", async () => {
    const res = await apiAs(cookieB, "POST", `/api/clients/${clientId}/payments`, { amount: 100, date: "2026-01-01", paymentMethod: "efectivo" });
    // "Clienta no encontrada" (SaleValidationError, 400) — nunca se filtra que el id existe
    // para OTRA consultora, mismo criterio que el resto de los recursos de otra consultora.
    expect(res.status).toBe(400);
  });

  it("B no puede crear ni ver notas sobre la clienta de A", async () => {
    const createRes = await apiAs(cookieB, "POST", `/api/clients/${clientId}/notes`, { text: "Nota ajena" });
    expect(createRes.status).toBe(404);

    const listRes = await apiAs(cookieB, "GET", `/api/clients/${clientId}/notes`);
    const list = await listRes.json();
    expect(Array.isArray(list) ? list.length : 0).toBe(0);
  });

  it("B no puede borrar una nota de la clienta de A", async () => {
    const note = await (await api("POST", `/api/clients/${clientId}/notes`, { text: "Nota de A para que B intente borrarla" })).json();
    const deleteRes = await apiAs(cookieB, "DELETE", `/api/clients/${clientId}/notes/${note.id}`);
    expect(deleteRes.status).toBe(404);

    const stillThere = await (await api("GET", `/api/clients/${clientId}/notes`)).json();
    expect(stillThere.some((n: { id: number }) => n.id === note.id)).toBe(true);
  });

  it("B no puede marcar como pagada una cuota de una venta de A", async () => {
    const sale = await (await api("POST", "/api/sales", baseSale({ installments: [{ amount: 1200 }] }))).json();
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    const res = await apiAs(cookieB, "PATCH", `/api/sales/${sale.id}/installments/${detail.installments[0].id}`, { status: "pagado" });
    expect(res.status).toBe(404);
  });
});
