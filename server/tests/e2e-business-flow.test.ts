import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

/**
 * Etapa 7.9 — Fase 21: escenario integral de negocio de punta a punta, encadenando en un solo
 * test lo que las suites de las Etapas 7.1-7.8 solo probaban por separado (createSale,
 * SaleDetail, COGS, profit, cuotas, edición bloqueada, cancelación, stock, Reportes). El
 * objetivo no es redemostrar cada regla (ya tienen su test dedicado) sino confirmar que la
 * CADENA completa se comporta de forma consistente cuando los módulos interactúan en el mismo
 * flujo real de uso — exactamente lo que pide una auditoría transversal.
 */

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
  const user = await storage.createUser({ username: `vitest_e2e_flow_${Date.now()}`, password: "vitest-test-password-123", role: "consultant", status: true });
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

describe("Flujo integral de negocio de punta a punta (Etapa 7.9, Fase 21)", () => {
  it("producto -> stock -> clienta -> venta -> SaleDetail/COGS/profit -> cuota pagada -> edición rechazada -> cancelación -> stock restaurado -> Reportes sin la cancelada", async () => {
    // 1-2. Producto + stock inicial, con costo de compra cargado.
    const productRes = await api("POST", "/api/products", { seccion: "VITEST", producto: "Producto flujo E2E", precio: 1000, unidades: 10 });
    expect(productRes.status).toBe(201);
    const product = await productRes.json();
    const discountRes = await api("PATCH", `/api/products/${product.id}/discount`, { discountPercent: 40 }); // costPrice = 600
    expect(discountRes.status).toBe(200);

    // 3. Clienta.
    const clientRes = await api("POST", "/api/clients", { name: "Clienta E2E", phone: "9998887001" });
    expect(clientRes.status).toBe(201);
    const client = await clientRes.json();

    // 4. Venta: 2 unidades, 2 cuotas.
    const date = "2026-06-01";
    const saleRes = await api("POST", "/api/sales", {
      clientId: client.id, date, items: [{ productId: product.id, quantity: 2 }],
      orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo",
      installments: [{ amount: 1000 }, { amount: 1000 }], installmentFrequency: "mensual", status: "pendiente",
    });
    expect(saleRes.status).toBe(201);
    const sale = await saleRes.json();
    expect(sale.total).toBe(2000);
    expect(sale.profit).toBe(2000 - 2 * 600); // 800

    // 5. Stock descontado.
    const catalogAfterSale = await (await api("GET", "/api/products")).json();
    expect(catalogAfterSale.find((p: any) => p.id === product.id).unidades).toBe(8);

    // 6/7. SaleDetail: costo histórico por línea = sale_items.costPrice, nunca el actual.
    const detail = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detail.items[0].costPrice).toBe(600);
    expect(detail.items[0].quantity * detail.items[0].costPrice).toBe(1200); // COGS de la línea

    // 8. Profit de SaleDetail == profit de la venta original (misma fuente, sale.profit).
    expect(detail.profit).toBe(sale.profit);

    // 9/10. Dos cuotas creadas; se marca la primera como pagada.
    expect(detail.installments).toHaveLength(2);
    const firstInstallment = detail.installments[0];
    const payRes = await api("PATCH", `/api/sales/${sale.id}/installments/${firstInstallment.id}`, { status: "pagado" });
    expect(payRes.status).toBe(200);

    // 11/12. Editar una venta con una cuota ya pagada: rechazado (regla ya aprobada, no se rompe).
    const editRes = await api("PATCH", `/api/sales/${sale.id}`, {
      items: [{ productId: product.id, quantity: 1 }],
      orderDiscount: null, orderSurcharge: null, paymentMethod: "efectivo",
      installments: [{ amount: 1000 }],
    });
    expect(editRes.status).toBe(400);
    const editBody = await editRes.json();
    expect(editBody.error).toMatch(/cuotas pagadas/i);

    // La composición de la venta sigue intacta después del intento rechazado.
    const detailAfterRejectedEdit = await (await api("GET", `/api/sales/${sale.id}`)).json();
    expect(detailAfterRejectedEdit.items[0].quantity).toBe(2);

    // 13. Cancelar la venta: la regla actual SÍ lo permite aunque tenga una cuota ya pagada
    // (cancelSale no bloquea por eso — distinto de updateSale/updateInstallmentStatus). Este
    // test documenta esa asimetría real, ya confirmada en el storage, no la asume.
    const cancelRes = await api("POST", `/api/sales/${sale.id}/cancel`);
    expect(cancelRes.status).toBe(200);

    // 14. Stock restaurado por completo (las 2 unidades vuelven).
    const catalogAfterCancel = await (await api("GET", "/api/products")).json();
    expect(catalogAfterCancel.find((p: any) => p.id === product.id).unidades).toBe(10);

    // 15/16. Reportes: la venta cancelada NUNCA aparece en las métricas financieras del período,
    // aunque la cuota que ya estaba pagada haya existido antes de cancelar.
    const summary = await (await api("GET", `/api/reports/sales-summary?start=2026-06-01&end=2026-06-02&groupBy=day`)).json();
    expect(summary.reduce((s: number, p: any) => s + p.salesCount, 0)).toBe(0);

    const productCost = await (await api("GET", `/api/reports/product-cost-summary?start=2026-06-01&end=2026-06-02`)).json();
    expect(productCost.productCost).toBe(0);

    const collected = await (await api("GET", "/api/reports/collected-payments")).json();
    expect(collected.totalCollected).toBe(0); // la cuota pagada de una venta ya cancelada no cuenta como cobrado

    const pendingTotals = await (await api("GET", "/api/reports/pending-installments-totals")).json();
    expect(pendingTotals.totalPendingAmount).toBe(0); // tampoco queda como pendiente
  });
});
