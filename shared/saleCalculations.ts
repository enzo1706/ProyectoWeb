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
  shippingCost?: number | null;
}

export interface SaleTotals {
  subtotal: number;
  discountAmount: number;
  surchargeAmount: number;
  shippingCost: number;
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
  const shippingCost = input.shippingCost ?? 0;
  const total = Math.max(0, input.subtotal - discountAmount + surchargeAmount + shippingCost);
  return { subtotal: input.subtotal, discountAmount, surchargeAmount, shippingCost, total };
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
