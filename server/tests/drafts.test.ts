import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;
let productId: number; // precio 1000, unidades 20

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function saleDraftPayload(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    step: "productos",
    clientId: null,
    clientName: null,
    clientSkipped: false,
    date: "2026-09-03",
    lines: [{ productId, productName: "Producto para borradores", quantity: 1, originalPrice: 1000, mode: "none", adjustmentValue: null }],
    paymentMethod: "efectivo",
    installmentsCount: 1,
    installmentAmounts: [1000],
    paidNow: true,
    dueDatePreset: "7",
    customDueDate: null,
    adjustmentsOpen: false,
    orderDiscountPct: "",
    orderSurchargePct: "",
    shippingCharged: null,
    shippingCostReal: null,
    notes: "",
    ...overrides,
  };
}

function orderDraftPayload(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    step: "catalogo",
    discountState: { kind: "unset" },
    lines: [{ productId, productName: "Producto para borradores", quantity: 1 }],
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
    username: `vitest_drafts_${Date.now()}`,
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

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST Drafts", phone: "9990000004" });
  clientId = (await clientRes.json()).id;

  const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto para borradores", precio: 1000, unidades: 20 });
  productId = (await productRes.json()).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("POST /api/drafts — guardado y upsert (Prompt 7)", () => {
  it("crea un borrador nuevo de venta", async () => {
    const res = await api("POST", "/api/drafts", { clientDraftId: randomUUID(), type: "sale", payload: saleDraftPayload() });
    expect(res.status).toBe(200);
    const draft = await res.json();
    expect(draft.id).toBeTypeOf("number");
    expect(draft.type).toBe("sale");
  });

  it("crea un borrador nuevo de pedido", async () => {
    const res = await api("POST", "/api/drafts", { clientDraftId: randomUUID(), type: "order", payload: orderDraftPayload() });
    expect(res.status).toBe(200);
    const draft = await res.json();
    expect(draft.type).toBe("order");
  });

  it("el mismo clientDraftId en dos guardados pisa la misma fila — nunca crea una segunda (regla 1)", async () => {
    const clientDraftId = randomUUID();
    const first = await api("POST", "/api/drafts", { clientDraftId, type: "sale", payload: saleDraftPayload({ step: "productos" }) });
    const firstDraft = await first.json();

    const second = await api("POST", "/api/drafts", { clientDraftId, type: "sale", payload: saleDraftPayload({ step: "pago" }) });
    const secondDraft = await second.json();

    expect(secondDraft.id).toBe(firstDraft.id);

    const listRes = await api("GET", "/api/drafts?type=sale");
    const list = await listRes.json();
    const matches = list.filter((d: { id: number }) => d.id === firstDraft.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].payload.step).toBe("pago");
  });

  it("rechaza un payload de pedido declarado como venta (no corresponde al type)", async () => {
    const res = await api("POST", "/api/drafts", { clientDraftId: randomUUID(), type: "sale", payload: orderDraftPayload() });
    expect(res.status).toBe(400);
  });

  it("rechaza un payload más grande que el límite (50 KB)", async () => {
    // Por debajo de los 100kb que express.json() le impone al body completo (ver server/app.ts)
    // — así el que realmente corta es NUESTRO chequeo, no body-parser con un 413 genérico.
    const hugeNotes = "x".repeat(60_000);
    const res = await api("POST", "/api/drafts", {
      clientDraftId: randomUUID(),
      type: "sale",
      payload: saleDraftPayload({ notes: hugeNotes }),
    });
    expect(res.status).toBe(400);
  });

  it("rechaza clientDraftId que no es un UUID", async () => {
    const res = await api("POST", "/api/drafts", { clientDraftId: "no-es-un-uuid", type: "sale", payload: saleDraftPayload() });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/drafts — listado (Prompt 7)", () => {
  it("ordena por updatedAt descendente — el más reciente primero", async () => {
    const olderId = randomUUID();
    const newerId = randomUUID();
    await api("POST", "/api/drafts", { clientDraftId: olderId, type: "sale", payload: saleDraftPayload() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await api("POST", "/api/drafts", { clientDraftId: newerId, type: "sale", payload: saleDraftPayload() });

    const listRes = await api("GET", "/api/drafts?type=sale");
    const list = await listRes.json();
    const olderIndex = list.findIndex((d: { clientDraftId: string }) => d.clientDraftId === olderId);
    const newerIndex = list.findIndex((d: { clientDraftId: string }) => d.clientDraftId === newerId);
    expect(newerIndex).toBeLessThan(olderIndex);
  });

  it("filtra por type", async () => {
    const res = await api("GET", "/api/drafts?type=order");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.every((d: { type: string }) => d.type === "order")).toBe(true);
  });

  it("rechaza un type desconocido", async () => {
    const res = await api("GET", "/api/drafts?type=invalido");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/drafts/:id y DELETE /api/drafts/:id (Prompt 7)", () => {
  it("devuelve el borrador completo para retomar", async () => {
    const createRes = await api("POST", "/api/drafts", { clientDraftId: randomUUID(), type: "sale", payload: saleDraftPayload({ step: "confirmar" }) });
    const draft = await createRes.json();

    const res = await api("GET", `/api/drafts/${draft.id}`);
    expect(res.status).toBe(200);
    const fetched = await res.json();
    expect(fetched.payload.step).toBe("confirmar");
  });

  it("404 sobre un borrador inexistente", async () => {
    const res = await api("GET", "/api/drafts/99999999");
    expect(res.status).toBe(404);
  });

  it("lo descarta y deja de aparecer", async () => {
    const createRes = await api("POST", "/api/drafts", { clientDraftId: randomUUID(), type: "sale", payload: saleDraftPayload() });
    const draft = await createRes.json();

    const deleteRes = await api("DELETE", `/api/drafts/${draft.id}`);
    expect(deleteRes.status).toBe(204);

    const getRes = await api("GET", `/api/drafts/${draft.id}`);
    expect(getRes.status).toBe(404);
  });

  it("404 al descartar un borrador que ya no existe", async () => {
    const res = await api("DELETE", "/api/drafts/99999999");
    expect(res.status).toBe(404);
  });
});

describe("Confirmar borra el borrador en la misma operación (Prompt 7, punto 2)", () => {
  it("POST /api/sales con draftId borra el borrador al crear la venta", async () => {
    const draftRes = await api("POST", "/api/drafts", {
      clientDraftId: randomUUID(),
      type: "sale",
      payload: saleDraftPayload({ clientId, clientName: "Clienta VITEST Drafts" }),
    });
    const draft = await draftRes.json();

    const saleRes = await api("POST", "/api/sales", {
      clientId,
      date: "2026-09-03",
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
      paidNow: true,
      draftId: draft.id,
    });
    expect(saleRes.status).toBe(201);

    const getRes = await api("GET", `/api/drafts/${draft.id}`);
    expect(getRes.status).toBe(404);
  });

  it("PATCH /api/products/stock/increment-batch con draftId borra el borrador al confirmar el pedido", async () => {
    const draftRes = await api("POST", "/api/drafts", { clientDraftId: randomUUID(), type: "order", payload: orderDraftPayload() });
    const draft = await draftRes.json();

    const incrementRes = await api("PATCH", "/api/products/stock/increment-batch", {
      lines: [{ productId, delta: 1 }],
      draftId: draft.id,
    });
    expect(incrementRes.status).toBe(200);

    const getRes = await api("GET", `/api/drafts/${draft.id}`);
    expect(getRes.status).toBe(404);
  });
});
