import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, users, clients, products, productStock, sales, saleItems, saleInstallments, clientPayments, paymentAllocations, subscriptions } from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Prompt 9, punto 5 — "Total cobrado" tiene que seguir contando correctamente una cuota
 * "pagado" de ANTES de este sistema (backfill de amount_paid, sin ningún payment_allocations
 * real) — y nunca contarla dos veces si, además, hay pagos nuevos reales sobre otras cuotas de
 * la misma clienta. No hay ningún camino de la app que hoy pueda crear esa situación (todo
 * cobro nuevo pasa por el sistema de pagos) — se simula a mano, con SQL directo, exactamente
 * lo que deja el backfill de docs/migracion-deploy-2.md: status='pagado', amount_paid=amount,
 * cero filas en payment_allocations.
 */

process.env.NODE_ENV = "test";

const storage = new DatabaseStorage();
let consultantId: number;
let userId: number;
let clientId: number;
let productId: number;
let legacySaleId: number;
let legacyInstallmentId: number;
const extraSaleIds: number[] = [];

const USERNAME = `vitest_legacy_pay_${Date.now()}`;
const PASSWORD = "vitest-test-password-123";

beforeAll(async () => {
  const user = await storage.createUser({ username: USERNAME, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  userId = user.id;
  consultantId = user.consultantId!;

  const [client] = await db.insert(clients).values({ consultantId, name: "Clienta VITEST Legacy Pay", phone: "9990006001" }).returning();
  clientId = client.id;

  const [product] = await db
    .insert(products)
    .values({ consultantId, seccion: "VITEST", producto: "Producto legacy pay", variante: "Estándar", codigo: `vitest-legacy-${Date.now()}`, puntos: 0, precio: 5000, source: "manual" })
    .returning();
  productId = product.id;
  await db.insert(productStock).values({ consultantId, productId, unidades: 100, stockMinimo: 0, costPrice: 2000 });

  // Venta "legacy": se crea normal (pendiente), y después se la marca pagada a mano por SQL
  // directo, SIN pasar por el sistema de pagos — exactamente lo que deja el backfill sobre una
  // fila que ya estaba "pagado" antes de que amount_paid/client_payments existieran.
  const legacySale = await storage.createSale(consultantId, {
    clientId,
    date: "2025-06-01",
    items: [{ productId, quantity: 1 }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments: [{ amount: 5000 }],
    paidNow: false,
    firstDueDate: "2025-06-10",
  });
  legacySaleId = legacySale.id;
  const [legacyInstallment] = await db.select().from(saleInstallments).where(eq(saleInstallments.saleId, legacySaleId));
  legacyInstallmentId = legacyInstallment.id;

  await db
    .update(saleInstallments)
    .set({ status: "pagado", amountPaid: 5000 })
    .where(eq(saleInstallments.id, legacyInstallmentId));
});

afterAll(async () => {
  const saleIds = [legacySaleId, ...extraSaleIds];
  const installmentRows = await db.select({ id: saleInstallments.id }).from(saleInstallments).where(inArray(saleInstallments.saleId, saleIds));
  const installmentIds = installmentRows.map((r) => r.id);
  if (installmentIds.length) {
    const paymentRows = await db
      .select({ paymentId: paymentAllocations.paymentId })
      .from(paymentAllocations)
      .where(inArray(paymentAllocations.installmentId, installmentIds));
    await db.delete(paymentAllocations).where(inArray(paymentAllocations.installmentId, installmentIds));
    const paymentIds = Array.from(new Set(paymentRows.map((r) => r.paymentId)));
    if (paymentIds.length) await db.delete(clientPayments).where(inArray(clientPayments.id, paymentIds));
  }
  await db.delete(clientPayments).where(eq(clientPayments.consultantId, consultantId));
  await db.delete(saleInstallments).where(inArray(saleInstallments.saleId, saleIds));
  await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
  await db.delete(sales).where(inArray(sales.id, saleIds));
  await db.delete(productStock).where(eq(productStock.consultantId, consultantId));
  await db.delete(products).where(eq(products.consultantId, consultantId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(subscriptions).where(eq(subscriptions.consultantId, consultantId));
  await db.delete(consultants).where(eq(consultants.id, consultantId));
  await pool.end();
});

describe("getCollectedPayments — cuota legacy sin payment_allocations (Prompt 9, punto 5)", () => {
  it("cuenta la cuota legacy una sola vez", async () => {
    const result = await storage.getCollectedPayments(consultantId);
    expect(result.totalCollected).toBe(5000);
  });

  it("sumada a un pago real nuevo, nunca se cuenta dos veces", async () => {
    const newSale = await storage.createSale(consultantId, {
      clientId,
      date: "2026-01-01",
      items: [{ productId, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: 5000 }],
      paidNow: false,
      firstDueDate: "2026-01-10",
    });

    extraSaleIds.push(newSale.id);

    await storage.registerClientPayment(consultantId, clientId, { amount: 2000, date: "2026-01-15", paymentMethod: "efectivo" });

    const result = await storage.getCollectedPayments(consultantId);
    // 5000 (legacy, sin asignación) + 2000 (pago real, con asignación) — nunca 5000 contado
    // dos veces, ni el pago real confundido con la cuota legacy. La limpieza de esta venta
    // (y de su pago/asignación real) queda para afterAll, en el orden correcto de FKs.
    expect(result.totalCollected).toBe(5000 + 2000);
  });

  it("cancelar la venta legacy la excluye del total", async () => {
    await storage.cancelSale(consultantId, legacySaleId);
    const result = await storage.getCollectedPayments(consultantId);
    // El test anterior ya sumó 2000 sobre una venta distinta, que sigue activa.
    // Cancelar SOLO la legacy debe excluir sus 5000 y dejar esos 2000 intactos.
    expect(result.totalCollected).toBe(2000);

    // Deja la venta como estaba para no afectar otros tests de este archivo si corrieran de nuevo.
    await db.update(sales).set({ status: "pendiente" }).where(eq(sales.id, legacySaleId));
  });
});
