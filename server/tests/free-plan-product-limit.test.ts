import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Prompt 14, ajuste 2 y 7 — el límite de 10 productos con stock del plan gratis. Cubre los 4
 * caminos que agregan stock (createProduct, incrementProductStockBatch para pedido y para
 * borrador confirmado, setProductStock para "Editar producto"), la excepción de cancelar una
 * venta (nunca bloqueada, es una corrección no una carga) y que el límite rige igual para
 * cuentas "expired"/"canceled" (no solo "trial") — ver docs/prompts-mejoras.md Prompt 14.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let storage: typeof import("../storage").storage;

async function api(cookie: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let nextTag = 1;
async function createConsultant(): Promise<{ consultantId: number; cookie: string }> {
  const username = `vitest_freeplanlimit_${nextTag++}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const user = await storage.createUser({ username, password: "vitest-test-password-123", role: "consultant", status: true });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password: "vitest-test-password-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  return { consultantId: user.consultantId!, cookie };
}

/** Deja a la consultora en estado "expired" o "canceled" — nunca "trial" (nunca pagó, Prompt
 * 14) ni "active" (pago vigente). `computeAccess` (server/subscription.ts) recalcula el status
 * desde las fechas, así que "expired" necesita currentPeriodEnd en el pasado, no basta con
 * escribir el campo status directo (excepto "canceled", que es el único que se lee tal cual). */
async function setSubscriptionStatus(consultantId: number, status: "expired" | "canceled"): Promise<void> {
  if (status === "canceled") {
    await storage.updateSubscription(consultantId, { status: "canceled", canceledAt: new Date() });
    return;
  }
  const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await storage.updateSubscription(consultantId, { currentPeriodStart: past, currentPeriodEnd: past });
}

/** Crea `count` productos "filler" con 1 unidad cada uno — cada uno ocupa un cupo del límite. */
async function createFillerProducts(cookie: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const res = await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: `Filler ${i}`, precio: 1000, unidades: 1 });
    expect(res.status).toBe(201);
  }
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

describe("Límite de 10 productos con stock del plan gratis — camino 1: createProduct (POST /api/products)", () => {
  it("el 9no producto con stock entra, el 10mo también, el 11vo queda bloqueado con 403", async () => {
    const { cookie } = await createConsultant();
    await createFillerProducts(cookie, 9);

    const tenth = await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Décimo", precio: 1000, unidades: 1 });
    expect(tenth.status).toBe(201);

    const eleventh = await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Onceavo", precio: 1000, unidades: 1 });
    expect(eleventh.status).toBe(403);
    expect((await eleventh.json()).error).toMatch(/límite/i);
  });

  it("crear un producto con 0 unidades nunca cuenta ni se bloquea, incluso ya en el límite", async () => {
    const { cookie } = await createConsultant();
    await createFillerProducts(cookie, 10);

    const res = await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Sin stock todavía", precio: 1000, unidades: 0 });
    expect(res.status).toBe(201); // nunca carga stock, no ocupa cupo
  });
});

describe("Límite de 10 productos con stock del plan gratis — camino 2: incrementProductStockBatch (pedido, sin draftId)", () => {
  it("reponer un producto en 0 cuenta como nuevo: bloqueado si ya se llegó al límite", async () => {
    const { cookie } = await createConsultant();
    await createFillerProducts(cookie, 9);
    const emptyA = await (await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Agotado A", precio: 1000, unidades: 0 })).json();
    const emptyB = await (await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Agotado B", precio: 1000, unidades: 0 })).json();

    // Reponer el primero: 9 fillers + este = 10, todavía entra.
    const firstReplenish = await api(cookie, "PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: emptyA.id, delta: 5 }] });
    expect(firstReplenish.status).toBe(200);

    // Reponer el segundo ya con el cupo lleno: bloqueado.
    const secondReplenish = await api(cookie, "PATCH", "/api/products/stock/increment-batch", { lines: [{ productId: emptyB.id, delta: 5 }] });
    expect(secondReplenish.status).toBe(403);

    const list = await (await api(cookie, "GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === emptyB.id).unidades).toBe(0); // todo o nada, nunca quedó a medias
  });
});

describe("Límite de 10 productos con stock del plan gratis — camino 2b: incrementProductStockBatch (borrador confirmado, con draftId)", () => {
  it("confirmar un borrador que repone un producto en 0 también respeta el límite", async () => {
    const { cookie } = await createConsultant();
    await createFillerProducts(cookie, 10); // ya en el límite
    const empty = await (await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Agotado del borrador", precio: 1000, unidades: 0 })).json();

    const draftRes = await api(cookie, "POST", "/api/drafts", {
      clientDraftId: "11111111-1111-1111-1111-111111111111",
      type: "order",
      payload: { formatVersion: 1, step: "catalogo", discountState: { kind: "unset" }, lines: [{ productId: empty.id, productName: "Agotado del borrador", quantity: 3 }] },
    });
    const draft = await draftRes.json();

    const res = await api(cookie, "PATCH", "/api/products/stock/increment-batch", {
      lines: [{ productId: empty.id, delta: 3 }],
      draftId: draft.id,
    });
    expect(res.status).toBe(403);

    const list = await (await api(cookie, "GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === empty.id).unidades).toBe(0);
  });
});

describe("Límite de 10 productos con stock del plan gratis — camino 3: setProductStock (Editar producto)", () => {
  it("'Editar producto' llevando un producto de 0 a N unidades respeta el límite (9->10 entra, 10->11 no)", async () => {
    const { cookie } = await createConsultant();
    await createFillerProducts(cookie, 9);
    const emptyA = await (await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Agotado editar A", precio: 1000, unidades: 0 })).json();
    const emptyB = await (await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Agotado editar B", precio: 1000, unidades: 0 })).json();

    const first = await api(cookie, "PATCH", `/api/products/${emptyA.id}/stock`, { unidades: 4 });
    expect(first.status).toBe(200);

    const second = await api(cookie, "PATCH", `/api/products/${emptyB.id}/stock`, { unidades: 4 });
    expect(second.status).toBe(403);

    const list = await (await api(cookie, "GET", "/api/products")).json();
    expect(list.find((p: any) => p.id === emptyB.id).unidades).toBe(0);
  });
});

describe("Límite de 10 productos con stock del plan gratis — excepción: cancelar una venta NUNCA se bloquea", () => {
  it("cancelar una venta que devuelve stock, estando ya en el límite, siempre se aplica (es una corrección, no una carga)", async () => {
    const { cookie } = await createConsultant();

    const productA = await (await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Producto A", precio: 1000, unidades: 3 })).json();
    const client = await (await api(cookie, "POST", "/api/clients", { name: "Clienta VITEST límite", phone: "9990001234" })).json();

    const saleRes = await api(cookie, "POST", "/api/sales", {
      clientId: client.id,
      date: "2026-10-06",
      items: [{ productId: productA.id, quantity: 3 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 3000 }],
      status: "pendiente",
    });
    expect(saleRes.status).toBe(201);
    const sale = await saleRes.json();

    // A quedó en 0 (vendido por completo) — ya no ocupa cupo. Se llena el cupo con 10 fillers.
    const afterSaleList = await (await api(cookie, "GET", "/api/products")).json();
    expect(afterSaleList.find((p: any) => p.id === productA.id).unidades).toBe(0);

    await createFillerProducts(cookie, 10); // ahora el cupo está lleno (10/10), sin contar a A

    // Si esto pasara por el chequeo normal (0 -> 3), quedaría bloqueado por estar en el límite.
    // cancelSale escribe productStock.unidades directo, nunca pasa por ese chequeo.
    const cancelRes = await api(cookie, "POST", `/api/sales/${sale.id}/cancel`, {});
    expect(cancelRes.status).toBe(200);

    const afterCancelList = await (await api(cookie, "GET", "/api/products")).json();
    expect(afterCancelList.find((p: any) => p.id === productA.id).unidades).toBe(3); // el stock volvió, nunca se bloqueó
  });
});

describe("Límite de 10 productos con stock del plan gratis — rige igual para 'expired' y 'canceled', no solo 'trial'", () => {
  for (const status of ["expired", "canceled"] as const) {
    it(`cuenta '${status}': sigue con acceso completo, pero el límite de productos se aplica exactamente igual que en trial`, async () => {
      const { consultantId, cookie } = await createConsultant();
      await setSubscriptionStatus(consultantId, status);

      const statusRes = await (await api(cookie, "GET", "/api/subscription/status")).json();
      expect(statusRes.status).toBe(status);
      expect(statusRes.isFreePlan).toBe(true);
      expect(statusRes.freePlanProductLimit).toBe(10);

      // Acceso completo: ninguna ruta de negocio la bloquea por el estado de la cuenta.
      expect((await api(cookie, "GET", "/api/products")).status).toBe(200);

      await createFillerProducts(cookie, 9);
      const tenth = await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Décimo", precio: 1000, unidades: 1 });
      expect(tenth.status).toBe(201);

      const eleventh = await api(cookie, "POST", "/api/products", { seccion: "VITEST", producto: "Onceavo", precio: 1000, unidades: 1 });
      expect(eleventh.status).toBe(403);
    });
  }
});
