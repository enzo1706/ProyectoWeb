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

export interface SaleCostLineHistorical {
  quantity: number;
  /** sale_items.costPrice tal como quedó guardado — null en ventas anteriores a la Etapa
   * I-B.7-D-D, cuando esta columna todavía no existía (nunca se completa retroactivamente). */
  costPrice: number | null;
}

/** COGS histórico de una venta ya persistida (Etapa 7.7 — SaleDetail): a diferencia de
 * `computeProductCost`, acepta líneas con costo desconocido. Si CUALQUIER línea no tiene
 * costPrice, el total se considera no disponible en vez de sumar solo las líneas conocidas —
 * un total parcial se mostraría como si fuera completo, y sería un dato falso. */
export function computeHistoricalProductCost(items: SaleCostLineHistorical[]): number | null {
  if (items.length === 0) return null;
  if (items.some((item) => item.costPrice === null)) return null;
  return computeProductCost(items.map((item) => ({ quantity: item.quantity, costPrice: item.costPrice as number })));
}

export interface SaleProfitInput {
  total: number;
  productCost: number;
  /** Costo REAL del envío para la consultora — null cuando todavía no fue informado (no
   * inventado como 0 en el dato, pero tratado como 0 en este cálculo; ver Etapa I-B.7-D-C). */
  shippingCost?: number | null;
  /** Etapa 4: Ingresos Brutos — importe MANUAL que la consultora informa por venta (impuesto
   * provincial que le toca afrontar a ella, no un cargo que se le suma a lo que paga la
   * clienta). Mismo tratamiento que `shippingCost`: es un COSTO real de la consultora, resta
   * de la ganancia, nunca toca `total` (a diferencia de `shippingCharged`, que sí es dinero
   * que la clienta paga). null cuando no fue informado — tratado como 0 en este cálculo, sin
   * inventar el dato. Decisión de diseño documentada en el informe de la Etapa 4: el pedido
   * agrupaba explícitamente "Ingresos Brutos y costo de envío" bajo el mismo concepto de
   * "costo adicional" — nunca lo describió como algo que se le cobra a la clienta. */
  ingresosBrutos?: number | null;
}

/**
 * Ganancia real de la venta (Etapa I-B.7-D-C, extendida en Etapa 4): a diferencia del cálculo
 * anterior (`(unitPrice-cost)*quantity` por línea, que ignoraba descuento/recargo/envío de
 * toda la orden), esta fórmula parte del `total` ya autoritativo (que sí incluye descuento,
 * recargo y `shippingCharged`) y le resta el costo real de mercadería, el costo real de envío,
 * y el importe de Ingresos Brutos — matemáticamente equivalente a:
 *   subtotal − discountAmount + surchargeAmount + shippingCharged − productCost − shippingCost − ingresosBrutos
 * `shippingCost`/`ingresosBrutos` null se tratan como 0 (todavía no informados, no se inventa
 * un valor) — la ganancia resultante no descuenta esos costos hasta que se informen.
 */
export function computeSaleProfit(input: SaleProfitInput): number {
  return input.total - input.productCost - (input.shippingCost ?? 0) - (input.ingresosBrutos ?? 0);
}

/** Lo que le cuesta el producto a la consultora según su descuento de compra — misma fórmula
 * que usa el backend en `applyProductDiscount` (storage.ts) al persistir `costPrice`. */
export function computeDiscountedCost(precio: number, discountPercent: number): number {
  return Math.round(precio * (1 - discountPercent / 100));
}

/** El más bajo de los descuentos reales (discountOptions = [35, 40, 45] en shared/schema.ts) —
 * deliberado: sin ningún pedido registrado, conviene subestimar la ganancia antes que
 * exagerarla. Fuente única: server/orderDiscount.ts y server/storage.ts (costo estimado de
 * venta) la reusan, en vez de declarar el mismo número dos veces. */
export const DEFAULT_HABITUAL_DISCOUNT_PERCENT = 35;
export const HABITUAL_DISCOUNT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface OrderDiscountLogEntryLike {
  discountPercent: number;
  publicValueArs: number;
}

/** Promedio ponderado por monto de una lista de pedidos (ver computeHabitualDiscountPercent,
 * server/orderDiscount.ts, para los fallbacks de "sin pedidos recientes"/"sin pedidos nunca").
 * `null` cuando no hay nada que promediar — el caller decide el fallback. Función pura, sin
 * acceso a storage, para poder usarla tanto desde server/orderDiscount.ts (que sí importa
 * `storage`) como desde server/storage.ts (que `orderDiscount.ts` ya importa) sin crear un
 * ciclo de imports entre los dos módulos. */
export function computeWeightedDiscountPercent(entries: OrderDiscountLogEntryLike[]): number | null {
  if (entries.length === 0) return null;
  let totalPublic = 0;
  let totalPaid = 0;
  for (const entry of entries) {
    totalPublic += entry.publicValueArs;
    totalPaid += entry.publicValueArs * (1 - entry.discountPercent / 100);
  }
  if (totalPublic === 0) return null;
  return ((totalPublic - totalPaid) / totalPublic) * 100;
}

export interface ResolvedLineCost {
  costPrice: number;
  isEstimated: boolean;
}

/** Costo real de una línea si está cargado (`productStock.costPrice`); si no, lo estima con el
 * descuento de compra habitual de la consultora — NUNCA con el precio de venta (Prompt 2:
 * "nunca uses el precio de venta como costo"). Reemplaza el fallback `costPrice ?? product.precio`
 * que existía en ~9 lugares de server/storage.ts. */
export function resolveLineCost(input: {
  costPrice: number | null;
  publicPrice: number;
  habitualDiscountPercent: number;
}): ResolvedLineCost {
  if (input.costPrice !== null) {
    return { costPrice: input.costPrice, isEstimated: false };
  }
  return {
    costPrice: computeDiscountedCost(input.publicPrice, input.habitualDiscountPercent),
    isEstimated: true,
  };
}

/** Monto de Ingresos Brutos de una venta: el % (en décimas de punto porcentual, mismo formato
 * que `consultants.grossIncomeTaxPercentTenths`) aplicado sobre el `total` que paga la clienta
 * (ya incluye descuento, recargo y envío cobrado — nunca sobre el subtotal). `null` cuando la
 * consultora no cargó el porcentaje en Configuración: no se inventa un valor. */
export function computeGrossIncomeTax(total: number, percentTenths: number | null): number | null {
  if (percentTenths === null) return null;
  return Math.round((total * percentTenths) / 1000);
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

/** Suma `days` días de calendario a una fecha `YYYY-MM-DD` — aritmética pura. Asume que
 * `dateStr` ya representa el día correcto (el caller es responsable de que esté en hora de
 * Argentina); esta función no mira la hora actual ni ningún huso horario. */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const result = new Date(year, month - 1, day);
  result.setDate(result.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}`;
}

export interface InstallmentPlanEntry {
  amount: number;
  dueDate: string;
  status: "pendiente" | "pagado";
}

export interface BuildInstallmentPlansInput {
  /** Montos de cada cuota, en el orden en que se muestran — ya repartidos (ver
   * `splitIntoInstallments`) o editados a mano por la consultora. Con tarjeta, la suma de
   * estos montos es lo que se cobra en la única cuota real que se crea (ver abajo). */
  amounts: number[];
  /** Fecha de la venta (`YYYY-MM-DD`, ya en hora de Argentina). */
  saleDate: string;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta";
  /** "La clienta paga en el momento" — con tarjeta no se usa (la venta queda cobrada siempre). */
  paidNow: boolean;
  /** Vencimiento de la primera cuota cuando NO se paga en el momento (resultado de elegir "En
   * 7/15/30 días" o una fecha puntual). Requerida en ese caso para efectivo/transferencia. */
  firstDueDate?: string | null;
}

/**
 * Prompt 6 — arma el plan de cuotas (monto, vencimiento, si queda cobrada o pendiente) según
 * la forma de pago y si la clienta paga en el momento. Reemplaza la vieja lógica de
 * `computeInstallmentDueDate` + frecuencia semanal/mensual elegible: de acá en más el
 * espaciado entre cuotas pendientes es siempre de 30 días corridos.
 *
 * - Tarjeta (1 pago o en cuotas): las cuotas son con el banco, nunca con la consultora — se
 *   crea UNA sola cuota ya cobrada por el total. La cantidad de cuotas elegida se guarda aparte
 *   como dato (`sales.installmentsCount`), nunca como filas de `sale_installments`.
 * - Efectivo/transferencia, tildada ("paga en el momento"): la primera cuota queda cobrada
 *   con vencimiento en la fecha de la venta; las demás (si hay) quedan pendientes, cada una
 *   30 días después de la fecha de venta (cuota N vence a los 30×N días).
 * - Efectivo/transferencia, destildada: ninguna cuota queda cobrada. La primera vence en
 *   `firstDueDate` (obligatoria en este caso) y las siguientes, 30 días después de esa fecha.
 */
export function buildInstallmentPlans(input: BuildInstallmentPlansInput): InstallmentPlanEntry[] {
  if (input.paymentMethod === "tarjeta") {
    const total = input.amounts.reduce((sum, a) => sum + a, 0);
    return [{ amount: total, dueDate: input.saleDate, status: "pagado" }];
  }

  if (input.paidNow) {
    return input.amounts.map((amount, index) => ({
      amount,
      dueDate: addDays(input.saleDate, 30 * index),
      status: index === 0 ? "pagado" : "pendiente",
    }));
  }

  if (!input.firstDueDate) {
    throw new Error("Falta la fecha de vencimiento de la primera cuota");
  }
  const firstDueDate = input.firstDueDate;
  return input.amounts.map((amount, index) => ({
    amount,
    dueDate: addDays(firstDueDate, 30 * index),
    status: "pendiente",
  }));
}
