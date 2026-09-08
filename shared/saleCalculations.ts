export interface OrderAdjustment {
  type: "percent" | "fixed";
  value: number;
}

export interface SaleLineInput {
  quantity: number;
  unitPrice: number;
}

export interface SaleTotalsInput {
  subtotal: number;
  orderDiscount?: OrderAdjustment | null;
  orderSurcharge?: OrderAdjustment | null;
  /** Importe de envío COBRADO a la clienta — no confundir con el costo real del envío
   * (`shippingCost`, ver `computeSaleProfit`). Siempre suma al total, es dinero que la
   * clienta paga. Etapa I-B.7-D-C: antes de esta etapa este mismo concepto se llamaba
   * `shippingCost`, que en la práctica siempre representó lo cobrado, nunca el costo real. */
  shippingCharged?: number | null;
}

export interface SaleTotals {
  subtotal: number;
  discountAmount: number;
  surchargeAmount: number;
  shippingCharged: number;
  total: number;
}

export type ItemAdjustmentMode = "none" | "discountPercent" | "surchargePercent" | "manualPrice";

/** Monto resultante de aplicar un ajuste (fijo o %) sobre una base — no el total, solo el delta. */
export function computeAdjustmentAmount(baseAmount: number, adjustment: OrderAdjustment | null | undefined): number {
  if (!adjustment) return 0;
  if (adjustment.type === "percent") {
    return Math.round((baseAmount * adjustment.value) / 100);
  }
  return Math.round(adjustment.value);
}

export function computeSubtotal(items: SaleLineInput[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

/** Fuente de verdad de subtotal/descuento/recargo/envío/total — usada por frontend (preview) y backend (autoritativo). */
export function computeSaleTotals(input: SaleTotalsInput): SaleTotals {
  const discountAmount = computeAdjustmentAmount(input.subtotal, input.orderDiscount);
  const surchargeAmount = computeAdjustmentAmount(input.subtotal, input.orderSurcharge);
  const shippingCharged = input.shippingCharged ?? 0;
  const total = Math.max(0, input.subtotal - discountAmount + surchargeAmount + shippingCharged);
  return { subtotal: input.subtotal, discountAmount, surchargeAmount, shippingCharged, total };
}

export interface SaleCostLineInput {
  quantity: number;
  costPrice: number;
}

/** Costo de mercadería vendida (COGS): Σ(quantity × costPrice) — el costo real de cada
 * producto vendido, resuelto por el caller con el mismo fallback que ya existía
 * (`costPrice ?? product.precio`) antes de llamar a esta función. */
export function computeProductCost(items: SaleCostLineInput[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
}

export interface SaleProfitInput {
  total: number;
  productCost: number;
  /** Costo REAL del envío para la consultora — null cuando todavía no fue informado (no
   * inventado como 0 en el dato, pero tratado como 0 en este cálculo; ver Etapa I-B.7-D-C). */
  shippingCost?: number | null;
}

/**
 * Ganancia real de la venta (Etapa I-B.7-D-C): a diferencia del cálculo anterior
 * (`(unitPrice-cost)*quantity` por línea, que ignoraba descuento/recargo/envío de toda la
 * orden), esta fórmula parte del `total` ya autoritativo (que sí incluye descuento, recargo
 * y `shippingCharged`) y le resta el costo real de mercadería y el costo real de envío —
 * matemáticamente equivalente a:
 *   subtotal − discountAmount + surchargeAmount + shippingCharged − productCost − shippingCost
 * `shippingCost` null se trata como 0 (el costo real de envío todavía no fue informado, no se
 * inventa un valor) — la ganancia resultante no descuenta ese costo hasta que se informe.
 */
export function computeSaleProfit(input: SaleProfitInput): number {
  return input.total - input.productCost - (input.shippingCost ?? 0);
}

/** Lo que le cuesta el producto a la consultora según su descuento de compra — misma fórmula
 * que usa el backend en `applyProductDiscount` (storage.ts) al persistir `costPrice`. */
export function computeDiscountedCost(precio: number, discountPercent: number): number {
  return Math.round(precio * (1 - discountPercent / 100));
}

/** Precio final de una línea según el modo de ajuste elegido en EditSaleItemDialog. */
export function computeItemFinalPrice(originalPrice: number, mode: ItemAdjustmentMode, value: number | null): number {
  switch (mode) {
    case "discountPercent":
      return Math.max(0, Math.round(originalPrice * (1 - (value ?? 0) / 100)));
    case "surchargePercent":
      return Math.round(originalPrice * (1 + (value ?? 0) / 100));
    case "manualPrice":
      return Math.max(0, value ?? originalPrice);
    case "none":
    default:
      return originalPrice;
  }
}

/** Reparte un total en `count` cuotas iguales; el resto de la división entera queda en la última cuota
 * para que la suma sea siempre exactamente igual al total. */
export function splitIntoInstallments(total: number, count: number): number[] {
  if (count <= 1) return [total];
  const base = Math.floor(total / count);
  const amounts = Array.from({ length: count }, () => base);
  amounts[count - 1] = total - base * (count - 1);
  return amounts;
}

export function installmentsSumMatches(amounts: number[], total: number): boolean {
  return amounts.reduce((sum, a) => sum + a, 0) === total;
}

/** Fecha de vencimiento de la cuota `installmentIndex` (0-based) a partir de la fecha de venta y la frecuencia. */
export function computeInstallmentDueDate(
  saleDate: string,
  frequency: "semanal" | "mensual" | undefined,
  installmentIndex: number,
): string {
  const [year, month, day] = saleDate.split("-").map(Number);
  const due = new Date(year, month - 1, day);

  if (installmentIndex > 0 && frequency) {
    if (frequency === "semanal") {
      due.setDate(due.getDate() + 7 * installmentIndex);
    } else {
      due.setMonth(due.getMonth() + installmentIndex);
    }
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}
