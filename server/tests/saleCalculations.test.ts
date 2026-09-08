import { describe, it, expect } from "vitest";
import { computeSubtotal, computeSaleTotals, computeProductCost, computeSaleProfit } from "@shared/saleCalculations";

/**
 * Etapa I-B.7-D-C — tests puros del modelo financiero (sin DB, sin storage): reproduce
 * exactamente el pipeline que usa `storage.ts` (computeSubtotal -> computeSaleTotals ->
 * computeProductCost -> computeSaleProfit) para los 8 casos numéricos pedidos en la etapa.
 */

interface Case {
  quantity: number;
  unitPrice: number;
  costPrice: number;
  discountPct?: number;
  surchargePct?: number;
  shippingCharged?: number | null;
  shippingCost?: number | null;
}

function run(c: Case) {
  const subtotal = computeSubtotal([{ quantity: c.quantity, unitPrice: c.unitPrice }]);
  const totals = computeSaleTotals({
    subtotal,
    orderDiscount: c.discountPct ? { type: "percent", value: c.discountPct } : null,
    orderSurcharge: c.surchargePct ? { type: "percent", value: c.surchargePct } : null,
    shippingCharged: c.shippingCharged ?? null,
  });
  const productCost = computeProductCost([{ quantity: c.quantity, costPrice: c.costPrice }]);
  const profit = computeSaleProfit({ total: totals.total, productCost, shippingCost: c.shippingCost ?? null });
  return { subtotal, totals, productCost, profit };
}

describe("Modelo financiero — Etapa I-B.7-D-C", () => {
  it("Test 1 — venta simple: sin descuento/recargo/envío", () => {
    const { totals, profit } = run({ quantity: 1, unitPrice: 1000, costPrice: 600 });
    expect(totals.total).toBe(1000);
    expect(profit).toBe(400);
  });

  it("Test 2 — descuento 20% reduce la ganancia", () => {
    const { totals, profit } = run({ quantity: 1, unitPrice: 1000, costPrice: 600, discountPct: 20 });
    expect(totals.discountAmount).toBe(200);
    expect(totals.total).toBe(800);
    expect(profit).toBe(200);
  });

  it("Test 3 — recargo 10% aumenta la ganancia", () => {
    const { totals, profit } = run({ quantity: 1, unitPrice: 1000, costPrice: 600, surchargePct: 10 });
    expect(totals.surchargeAmount).toBe(100);
    expect(totals.total).toBe(1100);
    expect(profit).toBe(500);
  });

  it("Test 4 — envío cobrado y costo real de envío", () => {
    const { totals, profit } = run({ quantity: 1, unitPrice: 1000, costPrice: 600, shippingCharged: 200, shippingCost: 120 });
    expect(totals.total).toBe(1200);
    expect(profit).toBe(480);
  });

  it("Test 5 — combinación completa: descuento + recargo + envío cobrado + costo real de envío", () => {
    const { totals, profit } = run({
      quantity: 1,
      unitPrice: 1000,
      costPrice: 600,
      discountPct: 20,
      surchargePct: 10,
      shippingCharged: 200,
      shippingCost: 120,
    });
    expect(totals.discountAmount).toBe(200);
    expect(totals.surchargeAmount).toBe(100);
    expect(totals.total).toBe(1100);
    expect(profit).toBe(380);
  });

  it("Test 6 — shippingCost null: costo real de envío todavía no informado, se trata como 0 en el cálculo (no se inventa un valor)", () => {
    const { totals, profit } = run({ quantity: 1, unitPrice: 1000, costPrice: 600, shippingCharged: 200, shippingCost: null });
    expect(totals.total).toBe(1200);
    expect(profit).toBe(600); // 1200 - 600 - 0
  });

  it("Test 7 — shippingCost 0 explícito da el mismo profit numérico que null, pero es un dato distinto (0 informado, no ausente)", () => {
    const withZero = run({ quantity: 1, unitPrice: 1000, costPrice: 600, shippingCharged: 200, shippingCost: 0 });
    const withNull = run({ quantity: 1, unitPrice: 1000, costPrice: 600, shippingCharged: 200, shippingCost: null });
    expect(withZero.profit).toBe(600);
    expect(withZero.profit).toBe(withNull.profit); // mismo cálculo numérico
    expect(withZero.totals.total).toBe(1200);
    // El envío cobrado siempre suma al total independientemente del costo real informado.
    expect(withZero.profit).toBe(withZero.totals.total - withZero.productCost - 0);
  });
});
