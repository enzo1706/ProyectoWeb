import {
  users,
  products,
  productStock,
  clients,
  appointments,
  sales,
  saleItems,
  saleInstallments,
  consultants,
  subscriptions,
  payments,
  subscriptionPriceHistory,
  coupons,
  couponRedemptions,
  orderDiscountLog,
  passwordResetCodes,
  createSaleSchema,
  updateSaleSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  updateBusinessSettingsSchema,
  createProductSchema,
  updateProductSchema,
  appointmentStatuses,
  subscriptionStatuses,
  paymentStatuses,
  type User,
  type InsertUser,
  type Product,
  type InsertProduct,
  type ProductStock,
  type Client,
  type InsertClient,
  type Appointment,
  type AppointmentStatus,
  type Sale,
  type SaleItem,
  type SaleInstallment,
  type Consultant,
  type Subscription,
  type Payment,
  type PaymentStatus,
  type PasswordResetCode,
  type SubscriptionPriceHistoryEntry,
  type PriceChangeScope,
  type Coupon,
  type CouponDiscountType,
  type CouponDuration,
  type CouponRedemption,
  type CouponRedemptionStatus,
  type OrderDiscountLogEntry,
} from "@shared/schema";
import { normalizeEmail } from "@shared/email";
import {
  computeSubtotal,
  computeSaleTotals,
  computeProductCost,
  computeSaleProfit,
  installmentsSumMatches,
  buildInstallmentPlans,
  computeHistoricalProductCost,
  computeWeightedDiscountPercent,
  DEFAULT_HABITUAL_DISCOUNT_PERCENT,
  HABITUAL_DISCOUNT_WINDOW_MS,
  resolveLineCost,
  computeGrossIncomeTax,
} from "@shared/saleCalculations";
import { resolveLowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD } from "@shared/stockAlerts";
import {
  type BalanceFilter,
  type StaleFilter,
  STALE_THRESHOLDS,
  matchesBalanceFilter,
  matchesStaleFilter,
  MAX_CLIENTS_PAGE_SIZE,
} from "@shared/clientFilters";
import { isKnownEventType, normalizeCustomEventTypeName, KNOWN_EVENT_TYPES } from "@shared/eventTypes";
import type { z } from "zod";
import { eq, ne, count, sql, and, gt, gte, lt, asc, desc, isNotNull, isNull, inArray, notInArray, ilike, or } from "drizzle-orm";
import type { db as database } from "./db";
import { resolveStorageMode } from "./storage-mode";
import { slugify } from "@shared/slug";
import bcrypt from "bcryptjs";
import { TRIAL_DAYS, PERIOD_DAYS } from "./config/subscription";

/** Misma fórmula que `computeDiscountEndsAt` de server/subscription.ts, duplicada acá adentro
 * (sin import) para no crear una dependencia circular storage.ts ↔ subscription.ts
 * (subscription.ts ya importa `storage` de acá). Pura, sin acceso a datos — null para
 * "forever" y "first_payment" (sin fecha futura: se revierte apenas se confirma este pago). */
function computeDiscountEndsAtInline(
  redemption: { duration: string; durationMonths: number | null },
  confirmedAt: Date,
): Date | null {
  if (redemption.duration !== "months" || !redemption.durationMonths) return null;
  return new Date(confirmedAt.getTime() + redemption.durationMonths * 30 * 24 * 60 * 60 * 1000);
}

export class SaleValidationError extends Error {}
export class AppointmentValidationError extends Error {}
/** Etapa 7.5: mismo horario (consultantId+date+time) ya ocupado por otro turno activo — mapea
 * a 409 (conflicto de estado), no a 400, mismo criterio que ProductConflictError/
 * SaleRequestConflictError. Separada de AppointmentValidationError porque es una categoría de
 * error distinta ("ya existe algo ahí"), no un dato inválido. */
export class AppointmentConflictError extends Error {}
/** Mismo `clientRequestId` que una venta ya existente, pero con un payload distinto — no es
 * un reintento legítimo (ver Etapa I-B.6, sección "Payload diferente con el mismo
 * clientRequestId"). Separada de `SaleValidationError` porque mapea a 409, no a 400. */
export class SaleRequestConflictError extends Error {}
/** Etapa I-B.8-C: violación del unique `(consultantId, codigo)` al editar un producto — mapea
 * a 409 (conflicto de estado), no a 400 (el payload en sí era válido). */
export class ProductConflictError extends Error {}
/** Prompt 4: `priceOverride` solo tiene sentido en un producto del CATÁLOGO (consultantId
 * null) — un producto cargado a mano ya tiene su propio `products.precio` editable directo, no
 * necesita (ni debe tener) un override separado. Mapea a 400: el payload en sí no es inválido
 * en el vacío, pero no aplica a este producto puntual. */
export class ProductValidationError extends Error {}
/** Etapa 3 (registro): ya existe una cuenta con ese email normalizado — mapea a 409. */
export class DuplicateEmailError extends Error {}
/** Etapa 3 (registro): ya existe una cuenta con ese username — mapea a 409. */
export class DuplicateUsernameError extends Error {}

export interface RegisterConsultantInput {
  username: string;
  email: string;
  password: string;
}

const SALE_CLIENT_REQUEST_ID_CONSTRAINT = "sales_consultant_id_client_request_id_unique";

/** Señal interna: esta transacción perdió la carrera de INSERT contra otra con el mismo
 * `(consultantId, clientRequestId)` — el UNIQUE de Postgres la abortó. Nunca sale de
 * `createSale`; se captura para ir a buscar la fila que sí ganó (ver Etapa I-B.6, sección 4). */
class ClientRequestIdRaceLostError extends Error {}

/** `pg` no tipa sus errores — un violation de constraint UNIQUE llega como un objeto plano con
 * `code: "23505"` y `constraint: <nombre del índice>`. Comparamos el nombre exacto para no
 * confundir esta violación con cualquier otra (ej. si en el futuro se agrega otro UNIQUE a
 * `sales`) — ver advertencia explícita del pedido de la Etapa I-B.6.
 *
 * Etapa I-C.0.1 (remediación de drizzle-orm por GHSA-gpj5-g38j-94v9, 0.39.1 -> 0.45.2): desde
 * 0.44, drizzle-orm envuelve TODO error del driver en `DrizzleQueryError` (ver
 * pg-core/session.js, `queryWithCache`) y mueve el error real de `pg` a `.cause` — el código/
 * constraint ya no están en el objeto que se atrapa directamente. Se revisa primero el error
 * tal cual (compatibilidad hacia atrás, por si algún día deja de envolver) y si no matchea, se
 * revisa `.cause` — nunca al revés, para no aflojar la comparación exacta de arriba. */
function isUniqueViolationOn(err: unknown, constraintName: string): boolean {
  const matchesPgError = (candidate: unknown): boolean =>
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { code?: unknown }).code === "23505" &&
    (candidate as { constraint?: unknown }).constraint === constraintName;

  if (matchesPgError(err)) return true;
  const cause = (err as { cause?: unknown })?.cause;
  return matchesPgError(cause);
}

/** Normaliza y compara items por `(productId, quantity)` — orden no importa. El precio unitario
 * solo se exige si el request nuevo lo mandó explícitamente: si vino `undefined`, no hay forma
 * de verificarlo sin volver a resolver el catálogo, así que no se lo usa para rechazar un
 * reintento legítimo (ver Etapa I-B.6, sección 5). */
function saleItemsMatchInput(
  inputItems: { productId: number; quantity: number; unitPrice?: number }[],
  existingItems: { productId: number | null; quantity: number; price: number }[],
): boolean {
  if (inputItems.length !== existingItems.length) return false;
  const sortByProduct = <T extends { productId: number | null }>(items: T[]) =>
    [...items].sort((a, b) => (a.productId ?? -1) - (b.productId ?? -1));
  const sortedInput = sortByProduct(inputItems);
  const sortedExisting = sortByProduct(existingItems);
  return sortedInput.every((item, i) => {
    const existing = sortedExisting[i];
    if (item.productId !== existing.productId || item.quantity !== existing.quantity) return false;
    if (item.unitPrice === undefined) return true;
    return item.unitPrice === existing.price;
  });
}

/**
 * Determina si un POST que repite un `clientRequestId` ya usado es el MISMO intento lógico de
 * venta (reintento legítimo → se devuelve la venta existente) o una operación distinta (409 —
 * ver Etapa I-B.6, sección 5). Compara contra columnas ya persistidas/calculadas de la venta
 * original — no reinventa el cálculo de totales, solo reutiliza lo que `createSale` ya guardó.
 */
function saleRequestMatchesExisting(
  input: CreateSaleInput,
  existing: Pick<
    Sale,
    | "clientId"
    | "date"
    | "paymentMethod"
    | "orderDiscountType"
    | "orderDiscountValue"
    | "orderSurchargeType"
    | "orderSurchargeValue"
    | "shippingCharged"
    | "shippingCost"
    | "installmentsCount"
  >,
  existingItems: { productId: number | null; quantity: number; price: number }[],
): boolean {
  // Prompt 6: clientId ahora es opcional en el input ("Completar después") — se normaliza
  // contra `null` (lo que queda persistido en la venta sin clienta) para no tratar
  // `undefined !== null` como "es una operación distinta" cuando en realidad las dos
  // representan "sin clienta".
  if ((existing.clientId ?? null) !== (input.clientId ?? null)) return false;
  if (existing.date !== input.date) return false;
  if (existing.paymentMethod !== input.paymentMethod) return false;
  if ((existing.orderDiscountType ?? null) !== (input.orderDiscount?.type ?? null)) return false;
  if ((existing.orderDiscountValue ?? null) !== (input.orderDiscount?.value ?? null)) return false;
  if ((existing.orderSurchargeType ?? null) !== (input.orderSurcharge?.type ?? null)) return false;
  if ((existing.orderSurchargeValue ?? null) !== (input.orderSurcharge?.value ?? null)) return false;
  // Etapa I-B.7-D-C: `shippingCharged` es el que afecta `total` (lo que la clienta paga) —
  // reemplaza acá al viejo `shippingCost`, que cumplía ese mismo rol antes de esta etapa.
  // `shippingCost` (costo real) también se compara: más estricto es más seguro para decidir
  // "misma operación lógica" — nunca reduce ninguna garantía de idempotencia ya existente.
  if ((existing.shippingCharged ?? null) !== (input.shippingCharged ?? null)) return false;
  if ((existing.shippingCost ?? null) !== (input.shippingCost ?? null)) return false;
  if (existing.installmentsCount !== input.installments.length) return false;
  return saleItemsMatchInput(input.items, existingItems);
}

/** Citas que todavía requieren atención — se excluyen las que ya no están "pendientes de que pase algo". */
const UPCOMING_APPOINTMENT_STATUSES: AppointmentStatus[] = appointmentStatuses.filter(
  (s) => s !== "cancelada" && s !== "completada",
);

const BCRYPT_SALT_ROUNDS = 10;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

/** Distingue un hash bcrypt de una contraseña legacy en texto plano (previa a esta etapa de seguridad). */
export function isBcryptHash(value: string): boolean {
  return BCRYPT_HASH_PATTERN.test(value);
}

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type UpdateSaleInput = z.infer<typeof updateSaleSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type UpdateBusinessSettingsInput = z.infer<typeof updateBusinessSettingsSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type SubscriptionUpdate = Partial<
  Pick<
    Subscription,
    | "status"
    | "currentPeriodStart"
    | "currentPeriodEnd"
    | "lastPaymentId"
    | "mpPreapprovalId"
    | "mpPreapprovalCreatedAt"
    | "canceledAt"
    | "priceHistoryAppliedId"
  >
>;
/** Todos los campos van explícitos a propósito (nada de defaults acá): el precio/moneda/
 * duración del período viven únicamente en server/config/subscription.ts — si esta capa
 * pusiera un fallback propio, sería un segundo lugar con el mismo número. */
export interface CreatePendingPaymentInput {
  externalReference: string;
  mpPreapprovalId?: string | null;
  amount: number;
  currency: string;
  periodDaysGranted: number;
}
export type PaymentUpdate = Partial<Pick<Payment, "status" | "mpPaymentId" | "mpStatusDetail" | "rawPayload" | "paidAt">>;
export interface ApplyApprovedPaymentInput {
  externalReference: string;
  mpPreapprovalId: string;
  mpPaymentId: string;
  amount: number;
  statusDetail: string | null;
  rawPayload: unknown;
}
export type ApplyApprovedPaymentResult =
  | { outcome: "applied"; payment: Payment }
  | { outcome: "already_processed"; payment: Payment }
  | { outcome: "preapproval_mismatch" };

// ---------------------------------------------------------------------------
// Prompt U — precio editable + cupones.
// ---------------------------------------------------------------------------

export interface CreatePriceChangeInput {
  oldPriceArs: number | null;
  newPriceArs: number;
  appliesTo: PriceChangeScope;
  effectiveAt: Date | null;
  changedByAdminId: number | null;
}

export interface CreateCouponInput {
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  duration: CouponDuration;
  durationMonths: number | null;
  maxUses: number | null;
  expiresAt: Date | null;
  createdByAdminId: number | null;
}
export type CouponUpdate = Partial<
  Pick<Coupon, "discountType" | "discountValue" | "duration" | "durationMonths" | "maxUses" | "expiresAt" | "active">
>;

export interface ReserveCouponInput {
  discountType: CouponDiscountType;
  discountValue: number;
  duration: CouponDuration;
  durationMonths: number | null;
}
export type ReserveCouponResult =
  | { outcome: "reserved"; redemption: CouponRedemption }
  | { outcome: "already_used" }
  | { outcome: "limit_reached" };

/** Fila de detalle para el panel admin: una redención + los datos de la consultora que la usó. */
export interface CouponRedemptionDetailRow {
  redemption: CouponRedemption;
  consultantId: number;
  businessName: string;
  username: string;
}

/** Etapa de hardening post-I-B.8-F: `PATCH /api/admin/users/:id/toggle-status` es exclusivo
 * para administrar cuentas de CONSULTORA — nunca cuentas admin. `"forbidden"` cubre tanto "un
 * admin desactiva a otro admin" como "un admin se desactiva a sí mismo": quien llama acá
 * siempre es admin (requireAdmin), así que si el target también es admin, alcanza con chequear
 * el rol del target — no hace falta comparar IDs por separado. */
export type ToggleUserStatusResult =
  | { outcome: "toggled"; user: User }
  | { outcome: "not_found" }
  | { outcome: "forbidden" };

/** Admin-only: una fila por consultora para el panel de Suscripciones. `subscription` es
 * null solo si la consultora todavía no tiene fila (no debería pasar en uso normal, pero se
 * contempla — ver Etapa F, hubo consultoras reales así antes del backfill). */
export interface AdminSubscriptionRow {
  consultantId: number;
  businessName: string;
  username: string;
  email: string | null;
  subscription: Subscription | null;
  lastPayment: Payment | null;
}
export interface AdminPaymentRow extends Payment {
  businessName: string;
}
export interface AdminPaymentFilters {
  status?: PaymentStatus;
  consultantId?: number;
  from?: Date;
  to?: Date;
}

type ProductRow = typeof products.$inferSelect;
type StockFields = Pick<
  ProductStock,
  "unidades" | "stockMinimo" | "costPrice" | "selectedDiscount" | "discontinued" | "remindStockAt" | "priceOverride"
>;

/** `previousImage` es el valor que tenía la fila justo antes de este cambio, leído bajo lock
 * — nunca una foto vieja tomada antes de subir el archivo nuevo. Así, si dos reemplazos del
 * mismo producto se pisan, cada uno borra exactamente el archivo que dejó de estar referenciado
 * (nunca el que "ganó"), sin importar el orden en que terminen. */
export interface SetProductImageResult {
  product: ProductRow | undefined;
  previousImage: string | null;
}

/** Combina un producto de catálogo con la fila de stock de la consultora que lo está mirando
 * (o los defaults, si todavía no tiene una) — la forma `Product` que consume el resto de la app.
 * `consultantDefaultThreshold` es el umbral de perfil (Configuración) — ver resolveLowStockThreshold. */
function withStockDefaults(
  product: ProductRow,
  stock?: StockFields | null,
  consultantDefaultThreshold?: number | null,
): Product {
  const stockMinimo = stock?.stockMinimo ?? null;
  const priceOverride = stock?.priceOverride ?? null;
  return {
    ...product,
    unidades: stock?.unidades ?? 0,
    stockMinimo,
    costPrice: stock?.costPrice ?? null,
    selectedDiscount: stock?.selectedDiscount ?? null,
    discontinued: stock?.discontinued ?? false,
    remindStockAt: stock?.remindStockAt ?? null,
    priceOverride,
    effectiveStockMinimo: resolveLowStockThreshold(stockMinimo, consultantDefaultThreshold),
    effectivePrecio: priceOverride ?? product.precio,
  };
}

export interface TopClient {
  clientId: number;
  clientName: string;
  purchaseCount: number;
  totalAmount: number;
  productCount: number;
}

export interface ClientWithStats extends Client {
  totalPurchases: number;
  lastPurchase: string | null;
  /** Suma de cuotas con status "pendiente" de ventas no canceladas — misma condición que ya
   * usa getPendingInstallments, acá agregada por clienta en vez de listada por cuota. */
  pendingBalance: number;
}

export interface SearchClientsPaginatedParams {
  query?: string;
  page: number;
  pageSize: number;
  balanceFilter?: BalanceFilter;
  staleFilter?: StaleFilter;
}

export interface PaginatedClients {
  items: ClientWithStats[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Suma de totalPurchases sobre TODO el conjunto filtrado (no solo la página) — antes se
   * calculaba en el frontend sobre el subset truncado a 100, ahora es el total real. */
  totalRevenue: number;
}

export interface SaleWithItemCount extends Sale {
  itemCount: number;
  // Prompt 2: true si alguna línea de esta venta tiene costo estimado — Ventas/Reportes lo
  // muestran con "≈" junto a la ganancia (otra tarea de UI).
  hasEstimatedCost: boolean;
  // Prompt 6: estado de pago derivado de sale_installments, calculado acá (un solo query
  // agregado, mismo patrón que itemCount) para que la lista de Ventas pueda mostrar
  // "Cobrada"/"Te debe $X" y filtrar por eso sin un fetch por venta (evita N+1). "cobrada"
  // = no queda ninguna cuota pendiente (incluye el caso tarjeta, que siempre crea una sola
  // cuota ya pagada) — nunca se guarda en la base, se recalcula cada vez a partir de las
  // cuotas reales, así nunca puede quedar desincronizado.
  paymentStatus: "cobrada" | "te_debe";
  pendingAmount: number;
  nextDueDate: string | null;
}

export interface SaleWithDetails extends Sale {
  items: SaleItem[];
  installments: SaleInstallment[];
}

export interface TopProductByCategory {
  productId: number | null;
  productName: string;
  category: string;
  imagen: string | null;
  quantitySold: number;
  totalSales: number;
}

export type ReportGroupBy = "day" | "week" | "month";

export interface SalesSummaryPoint {
  period: string;
  totalSales: number;
  totalProfit: number;
  salesCount: number;
  avgTicket: number;
}

export interface TopCategory {
  category: string;
  quantitySold: number;
  totalSales: number;
}

export interface PaymentMethodBreakdown {
  paymentMethod: string;
  salesCount: number;
  totalSales: number;
}

export interface InstallmentsBreakdown {
  singlePayment: { salesCount: number; totalSales: number };
  financed: { salesCount: number; totalSales: number };
}

export interface StockValuation {
  valueAtCost: number;
  valueAtPrice: number;
  potentialProfit: number;
  productCount: number;
  unitCount: number;
  // Prompt 2: true si algún producto con unidades no tiene costo real cargado (valueAtCost
  // incluye costos estimados con el descuento habitual para esos casos) — la UI de Stock
  // (otra tarea) lo muestra con "≈".
  hasEstimatedCost: boolean;
}

export interface InactiveClient {
  clientId: number;
  name: string | null;
  phone: string;
  lastPurchase: string | null;
  daysSinceLastPurchase: number | null;
  totalPurchased: number;
}

export interface UpcomingBirthday {
  clientId: number;
  name: string | null;
  phone: string;
  birthday: string;
  daysUntil: number;
}

export interface AppointmentsSummary {
  pendiente: number;
  confirmada: number;
  completada: number;
  cancelada: number;
}

export interface PendingInstallmentRow {
  saleId: number;
  clientName: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
}

/** Etapa 7.8 — COGS agregado de Reportes: Σ(quantity × sale_items.costPrice) de ventas no
 * canceladas del período. `hasIncompleteCostData` es true si alguna línea del período no tiene
 * costPrice (venta anterior a la Etapa I-B.7-D-D) — en ese caso `productCost` es la suma de
 * SOLO las líneas conocidas, nunca inventa el resto, y el frontend debe advertirlo (ver Fase 7,
 * Etapa 7.8: "evitar presentar un número aparentemente exacto"). */
export interface ProductCostSummary {
  productCost: number;
  hasIncompleteCostData: boolean;
}

/** Etapa 7.8 — "dinero efectivamente cobrado", diferenciado de facturación (sales.total).
 * Deliberadamente NO acepta start/end: sale_installments no tiene una fecha de cuándo se pagó
 * (solo `status` y `dueDate`), así que no hay forma de saber si un pago caído dentro de
 * [start,end) ocurrió en ese rango — es un acumulado "a hoy", mismo criterio que
 * getStockValuation. Ver reporte final de la Etapa 7.8 para la limitación completa. */
export interface CollectedPayments {
  totalCollected: number;
}

/** Etapa 7.8 — totales reales de cuotas pendientes/vencidas (no el listado capado de
 * getPendingInstallments, que trunca en `limit`). `totalPendingAmount`/`totalPendingCount`
 * incluyen TODAS las cuotas con status "pendiente" (vencidas o no); `overdueAmount`/
 * `overdueCount` son el subconjunto cuyo `dueDate` ya pasó — "vencido" es un caso particular
 * de "pendiente", nunca una categoría separada que se sume aparte. */
export interface PendingInstallmentsTotals {
  totalPendingAmount: number;
  totalPendingCount: number;
  overdueAmount: number;
  overdueCount: number;
}

function getCurrentMonthRange(): { monthStart: string; monthEnd: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
  return { monthStart, monthEnd };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysBetween(from: Date, to: Date): number {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / 86400000);
}

/** Días hasta el próximo cumpleaños, resolviendo el cruce de año (ej. hoy en diciembre, cumpleaños en enero). */
function daysUntilNextBirthday(birthday: string, today: Date): number {
  const [, month, day] = birthday.split("-").map(Number);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let next = new Date(today.getFullYear(), month - 1, day);
  if (next.getTime() < todayMidnight.getTime()) {
    next = new Date(today.getFullYear() + 1, month - 1, day);
  }

  return Math.round((next.getTime() - todayMidnight.getTime()) / 86400000);
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  /** Si `user.role === "consultant"` y no trae consultantId, crea la consultora automáticamente y la linkea. */
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: number, newHash: string): Promise<void>;
  getConsultants(): Promise<User[]>;
  toggleUserStatus(id: number): Promise<ToggleUserStatusResult>;
  /** Para el bootstrap del primer admin: si ya existe alguno, el script no debe crear otro. */
  hasAdminAccount(): Promise<boolean>;
  getProductCount(): Promise<number>;
  /** Admin-only: lista de consultoras existentes. */
  listConsultantAccounts(): Promise<Consultant[]>;
  getBusinessSettings(consultantId: number): Promise<Consultant | undefined>;
  updateBusinessSettings(consultantId: number, input: UpdateBusinessSettingsInput): Promise<Consultant | undefined>;
  /** Prompt 1/2 — una fila por pedido confirmado, para calcular el "descuento de compra
   * habitual" (ver server/orderDiscount.ts). Append-only, nunca se edita ni se borra. */
  createOrderDiscountLogEntry(consultantId: number, input: { discountPercent: number; publicValueArs: number }): Promise<OrderDiscountLogEntry>;
  listOrderDiscountLogSince(consultantId: number, since: Date): Promise<OrderDiscountLogEntry[]>;
  getLatestOrderDiscountLogEntry(consultantId: number): Promise<OrderDiscountLogEntry | undefined>;
  /** Autogestión: la consultora lo carga la primera vez que inicia una suscripción (Mercado
   * Pago exige payer_email) — no hay alta desde el admin. */
  setConsultantEmail(consultantId: number, email: string): Promise<Consultant | undefined>;
  /**
   * Etapa 3 — registro público: crea consultant + trial + user en una sola operación
   * (transaccional en DatabaseStorage), con el email ya normalizado. Deliberadamente separado
   * de `createUser` (que no acepta email) — no se le agrega un parámetro opcional a un método
   * ya usado por el alta admin y el bootstrap del admin por defecto, donde el email nunca
   * aplica. Tira `DuplicateEmailError`/`DuplicateUsernameError` ante un choque.
   */
  registerConsultant(input: RegisterConsultantInput): Promise<{ user: User; consultant: Consultant }>;
  /** Recuperación de contraseña: el email vive en `consultants.email`, no en `users` — resuelve
   * el usuario consultora dueño de ese email ya normalizado. undefined si no existe ninguno. */
  getUserByConsultantEmail(normalizedEmail: string): Promise<User | undefined>;
  /** Marca usados (sin poder volver a intentarse) todos los códigos de recuperación sin usar
   * de este usuario — se llama antes de crear uno nuevo (una solicitud nueva invalida
   * cualquier código anterior todavía pendiente) y también después de un reset exitoso. */
  invalidateActivePasswordResetCodes(userId: number): Promise<void>;
  createPasswordResetCode(userId: number, codeHash: string, expiresAt: Date): Promise<PasswordResetCode>;
  /** El código más reciente de este usuario (usado o no, vencido o no) — la decisión de si
   * sigue siendo válido vive en server/auth-reset.ts, no acá. */
  getLatestPasswordResetCode(userId: number): Promise<PasswordResetCode | undefined>;
  incrementPasswordResetCodeAttempts(id: number): Promise<void>;
  markPasswordResetCodeUsed(id: number): Promise<void>;
  getSubscriptionByConsultantId(consultantId: number): Promise<Subscription | undefined>;
  /** Crea la fila de trial de una consultora recién nacida. Nunca se llama dos veces para la
   * misma consultora — protegido por el unique de consultantId en el schema. */
  createTrialSubscription(consultantId: number, trialStartAt: Date, trialEndAt: Date): Promise<Subscription>;
  updateSubscription(consultantId: number, patch: SubscriptionUpdate): Promise<Subscription | undefined>;
  /** Ledger de pagos de Mercado Pago — append-only, nunca se borra ni se reutiliza una fila. */
  createPendingPayment(consultantId: number, input: CreatePendingPaymentInput): Promise<Payment>;
  /** `externalReference` NO es unique (varios cobros de una suscripción la comparten): devuelve
   * el payment más reciente con esa referencia. La identidad de un cobro es `mpPaymentId`. */
  getPaymentByExternalReference(externalReference: string): Promise<Payment | undefined>;
  getPaymentByMpPaymentId(mpPaymentId: string): Promise<Payment | undefined>;
  updatePayment(id: number, patch: PaymentUpdate): Promise<Payment | undefined>;
  getPaymentsByConsultantId(consultantId: number): Promise<Payment[]>;
  /** Única puerta de entrada para acreditar un pago real y extender el acceso — transaccional
   * e idempotente por `mpPaymentId` (una notificación de webhook duplicada nunca extiende dos
   * veces). Nunca se llama con datos del frontend: solo tras reconsultar el pago real contra
   * la API de Mercado Pago (ver server/mercadopago.ts). */
  applyApprovedPayment(consultantId: number, input: ApplyApprovedPaymentInput): Promise<ApplyApprovedPaymentResult>;
  /** Confirma la redención de cupón "reserved" más reciente de esta consultora (si hay alguna)
   * — se llama SIEMPRE que se acredita un pago aprobado, nunca antes. undefined si no había
   * ninguna reserva pendiente (alta sin cupón). */
  confirmCouponRedemption(consultantId: number, confirmedAt: Date): Promise<CouponRedemption | undefined>;
  /** Activa una suscripción SIN pasar por Mercado Pago — solo cuando un cupón deja el precio en
   * $0. Crea igual un registro en `payments` (amount 0, approved) para que el historial de la
   * consultora quede completo y auditable. */
  activateFreeSubscription(consultantId: number, input: { couponRedemptionId: number; periodDays: number }): Promise<Payment>;

  // --- Prompt U: historial de precio ---
  getLatestSubscriptionPriceChange(): Promise<SubscriptionPriceHistoryEntry | undefined>;
  /** La entrada "all" más reciente cuya `effectiveAt` ya pasó — para el mecanismo perezoso de
   * `reconcileSubscriptionPricing`. undefined si no hay ninguna pendiente. */
  getLatestDuePriceChange(now: Date): Promise<SubscriptionPriceHistoryEntry | undefined>;
  listSubscriptionPriceHistory(): Promise<SubscriptionPriceHistoryEntry[]>;
  createSubscriptionPriceChange(input: CreatePriceChangeInput): Promise<SubscriptionPriceHistoryEntry>;

  // --- Prompt U: cupones ---
  getCouponByCode(normalizedCode: string): Promise<Coupon | undefined>;
  getCouponById(id: number): Promise<Coupon | undefined>;
  listCoupons(): Promise<Coupon[]>;
  createCoupon(input: CreateCouponInput): Promise<Coupon>;
  updateCoupon(id: number, patch: CouponUpdate): Promise<Coupon | undefined>;
  getCouponRedemption(couponId: number, consultantId: number): Promise<CouponRedemption | undefined>;
  /** La reserva "reserved" más reciente de esta consultora, sin importar el cupón — para saber
   * qué monto se cotizó en el preapproval que se está por confirmar (ver handleApprovedPaymentTopic
   * en server/routes.ts). undefined si no hay ninguna reserva pendiente (alta sin cupón). */
  getReservedCouponRedemption(consultantId: number): Promise<CouponRedemption | undefined>;
  /** Filas "confirmed" + "reserved" dentro de `reservationTtlMs` — lo que de verdad cuenta
   * contra `maxUses` ahora mismo. */
  countActiveCouponUses(couponId: number, reservationTtlMs: number): Promise<number>;
  /** Único punto de escritura de una reserva — transaccional (lock del cupón + chequeo de
   * límite + insert), nunca una verificación de límite separada del insert. */
  reserveCouponForConsultant(couponId: number, consultantId: number, input: ReserveCouponInput, reservationTtlMs: number): Promise<ReserveCouponResult>;
  /** La redención CONFIRMADA vigente de esta consultora ahora mismo (para mostrar "Tenés un
   * X% de descuento hasta…" en /api/subscription/status) — undefined si no tiene ninguna o ya
   * venció. */
  getActiveCouponRedemptionForConsultant(consultantId: number): Promise<(CouponRedemption & { couponCode: string }) | undefined>;
  /** Redención confirmada cuyo `discountEndsAt` ya pasó y todavía no se revirtió en Mercado
   * Pago (`priceRevertedAt` null) — para `reconcileSubscriptionPricing`. */
  getActiveExpiredCouponRedemption(consultantId: number, now: Date): Promise<CouponRedemption | undefined>;
  markCouponRedemptionReverted(id: number): Promise<void>;
  /** Admin-only: detalle de un cupón — quiénes lo usaron y cuándo. */
  listCouponRedemptionsByCoupon(couponId: number): Promise<CouponRedemptionDetailRow[]>;

  /** Admin-only: una fila por consultora (con su subscription y su último payment, si los
   * tiene) para el panel de administración de Suscripciones — nunca llama a la API de
   * Mercado Pago, solo lee lo que ya tenemos guardado. */
  listAdminSubscriptions(): Promise<AdminSubscriptionRow[]>;
  /** Admin-only: ledger completo de payments de todas las consultoras, con filtros opcionales. */
  listAllPayments(filters?: AdminPaymentFilters): Promise<AdminPaymentRow[]>;
  getAllProducts(consultantId: number): Promise<Product[]>;
  getProductsByIds(consultantId: number, ids: number[]): Promise<Product[]>;
  /** Admin-only: carga/actualiza el catálogo GLOBAL (consultantId null) — no toca stock de nadie. */
  bulkInsertProducts(items: InsertProduct[]): Promise<number>;
  /** Catálogo de prueba de una consultora (ej. botón "Cargar catálogo de prueba"): productos
   * privados de ella, no globales — igual que bulkInsertProducts pero scopeado, con stock propio. */
  seedOwnProducts(consultantId: number, items: CreateProductInput[]): Promise<number>;
  getLowStockProducts(consultantId: number): Promise<Product[]>;
  applyProductDiscount(consultantId: number, productId: number, discountPercent: number): Promise<Product | undefined>;
  createProduct(consultantId: number, input: CreateProductInput): Promise<Product>;
  /**
   * Etapa I-B.8-C: edita los campos CORE (nombre/precio/sección/línea/código) de un producto
   * MANUAL propio — nunca uno global (`consultantId` null), esos son catálogo compartido y no
   * se editan desde acá. `undefined` si no existe o no es de esta consultora (mismo criterio
   * de ownership que `updateClient`). Nunca toca stock/costo/descuento/discontinued: eso sigue
   * viviendo exclusivamente en sus propios endpoints.
   */
  updateProduct(consultantId: number, id: number, input: UpdateProductInput): Promise<Product | undefined>;
  /**
   * Etapa I-B.8-C: borrado físico de un producto MANUAL propio, solo si nunca tuvo ventas
   * (`sale_items`) — si las tiene, se rechaza (`"has_relations"`) para no romper historial
   * financiero; la baja lógica ya existente (`setProductDiscontinued`) sigue siendo la vía
   * correcta para ese caso. Mismo patrón/firma que `deleteClient`.
   */
  deleteProduct(consultantId: number, id: number): Promise<"deleted" | "not_found" | "has_relations">;
  setProductDiscontinued(consultantId: number, productId: number, discontinued: boolean): Promise<Product | undefined>;
  /** Prompt 4 — precio propio de la consultora sobre un producto del CATÁLOGO. Tira
   * `ProductValidationError` si el producto es manual (ahí el precio se edita con
   * `updateProduct`, en `products.precio` directo). Si `priceOverride` coincide exactamente con
   * `products.precio`, se guarda `null` igual (nunca un override "de casualidad" idéntico) —
   * así las subas futuras del precio de catálogo le llegan solas. `undefined` si el producto no
   * existe o no es visible para esta consultora. */
  setProductPriceOverride(consultantId: number, productId: number, priceOverride: number | null): Promise<Product | undefined>;
  /** Prompt 4 — "¿Cuánto te costó?" cuando se escribe el costo directo en pesos (en vez de
   * elegir uno de los 3 descuentos fijos de `applyProductDiscount`). Funciona para cualquier
   * producto visible (catálogo o manual) — el costo siempre vive en `product_stock`, sin
   * importar el tipo de producto. Si el costo pasa de null a un valor por primera vez,
   * dispara `recalculateEstimatedSalesForProduct` (mismo criterio que la carga de un pedido:
   * acá SÍ corresponde recalcular, porque es justo el caso previsto — "Editar producto" que
   * menciona el Prompt 2, a diferencia de un pedido nuevo). */
  setProductCost(consultantId: number, productId: number, costPrice: number): Promise<Product | undefined>;
  /** La consultora fija su propio stock sobre un producto (global o manual propio). `stockMinimo`
   * es opcional: si viene, actualiza también el umbral propio del producto (null lo borra). */
  setProductStock(
    consultantId: number,
    productId: number,
    unidades: number,
    stockMinimo?: number | null,
  ): Promise<Product | undefined>;
  /** Pospone la alerta de stock bajo de este producto hasta `remindAt` (YYYY-MM-DD), o la
   * cancela si `remindAt` es null. */
  setProductStockReminder(consultantId: number, productId: number, remindAt: string | null): Promise<Product | undefined>;
  /**
   * Etapa I-B.8-B: incremento/decremento ATÓMICO de stock — `unidades = unidades + delta`,
   * calculado siempre por la base de datos, nunca por TypeScript a partir de un valor leído
   * previamente (eso es exactamente la carrera que esta operación reemplaza, ver
   * `LoadOrderDialog.tsx` y el hallazgo F1 de la auditoría I-B.8-A). Distinta de
   * `setProductStock`, que sigue siendo un SET ABSOLUTO para ajustes manuales — no la
   * reemplaza, coexisten. Tira `SaleValidationError` si el delta dejaría el stock negativo
   * (mismo error de dominio que ya usa `createSale`/`updateSale` para "stock insuficiente").
   */
  incrementProductStock(consultantId: number, productId: number, delta: number): Promise<Product | undefined>;
  /** Etapa 7.2 — confirmación de pedido/importación como UNA sola operación atómica (todo o
   * nada), en vez del loop de `incrementProductStock` por línea que podía dejar una
   * importación aplicada a medias si una línea intermedia fallaba (hallazgo P2, Etapa 6).
   * Reusa el mismo patrón de UPSERT con delta calculado por Postgres (nunca leído y sumado en
   * JS) que ya usa `incrementProductStock`, solo que ahora las líneas comparten una única
   * transacción. Si cualquier línea es inválida (producto no visible para este consultantId,
   * o el resultado quedaría negativo), tira `SaleValidationError` y NINGUNA línea queda
   * aplicada — ni las que "ya habían pasado" antes en el loop. */
  incrementProductStockBatch(
    consultantId: number,
    lines: { productId: number; delta: number }[],
    discountPercent?: number,
  ): Promise<{ updated: number }>;
  /** Prompt 2 — corrige las líneas de venta estimadas (producto sin costo al momento de
   * vender) de un producto con el costo recién conocido, y recalcula el `profit` cacheado de
   * cada venta afectada. NO se llama desde `incrementProductStockBatch`: un pedido nunca
   * cambia la ganancia de una venta vieja, por acuerdo explícito del Prompt 2. El único
   * llamador previsto es la edición manual de costo de un producto sin costo ("Editar
   * producto", Prompt 4) — esta función queda lista y testeada para engancharse ahí. No toca
   * líneas ya reales (costIsEstimated = false) ni las de otros productos. */
  recalculateEstimatedSalesForProduct(consultantId: number, productId: number, newCostPrice: number): Promise<void>;
  /** Prompt 2 — dato para el aviso de Inicio "Tenés N productos sin costo cargado" (el diseño
   * del aviso en sí es otra tarea). Solo cuenta productos con unidades en stock: uno agotado y
   * sin costo no tiene ninguna urgencia de completarse. */
  countProductsWithoutCost(consultantId: number): Promise<number>;
  /** Admin-only: catálogo global completo (sin stock, eso es por consultora) para la pantalla de imágenes. */
  listGlobalProducts(): Promise<ProductRow[]>;
  /** Admin-only: solo aplica a productos globales — las imágenes de productos manuales las
   * gestiona cada consultora dueña, no el admin. */
  setProductImage(productId: number, imagen: string | null): Promise<SetProductImageResult>;
  getUpcomingAppointments(consultantId: number, limit?: number): Promise<Appointment[]>;
  getAppointmentsInRange(consultantId: number, start: string, end: string): Promise<Appointment[]>;
  /** Tipos de evento personalizados (no fijos/legacy) que la consultora ya usó alguna vez, para
   * ofrecerlos de nuevo al crear una cita y para el filtro "Todos los eventos" de la Agenda. */
  getAppointmentCustomTypes(consultantId: number): Promise<string[]>;
  createAppointment(consultantId: number, input: CreateAppointmentInput): Promise<Appointment | undefined>;
  updateAppointment(consultantId: number, id: number, input: UpdateAppointmentInput): Promise<Appointment | undefined>;
  updateAppointmentStatus(consultantId: number, id: number, status: AppointmentStatus): Promise<Appointment | undefined>;
  deleteAppointment(consultantId: number, id: number): Promise<boolean>;
  getTopClients(consultantId: number, limit?: number, start?: string, end?: string): Promise<TopClient[]>;
  getClientById(consultantId: number, id: number): Promise<Client | undefined>;
  searchClients(consultantId: number, query?: string, limit?: number): Promise<ClientWithStats[]>;
  /** Listado paginado real (a diferencia de searchClients, que trunca a `limit` para los
   * combobox de búsqueda rápida) — usado por la pantalla de Clientas. Orden determinístico,
   * total real, y soporta los mismos filtros de saldo/antigüedad que antes vivían solo en el
   * frontend (Etapa 7.1 — ver shared/clientFilters.ts). */
  searchClientsPaginated(consultantId: number, params: SearchClientsPaginatedParams): Promise<PaginatedClients>;
  createClient(consultantId: number, input: InsertClient): Promise<Client>;
  updateClient(consultantId: number, id: number, input: Partial<InsertClient>): Promise<Client | undefined>;
  findDuplicateClient(consultantId: number, phone: string, email: string | null, excludeId?: number): Promise<Client | undefined>;
  deleteClient(consultantId: number, id: number): Promise<"deleted" | "not_found" | "has_relations">;
  getSalesByClient(consultantId: number, clientId: number, limit?: number): Promise<SaleWithDetails[]>;
  getAppointmentsByClient(consultantId: number, clientId: number, limit?: number): Promise<Appointment[]>;
  getTopProductsByCategory(
    consultantId: number,
    category?: string,
    limit?: number,
    start?: string,
    end?: string,
    order?: "asc" | "desc",
  ): Promise<TopProductByCategory[]>;
  getAllSales(consultantId: number): Promise<SaleWithItemCount[]>;
  getSaleDetails(consultantId: number, id: number): Promise<SaleWithDetails | undefined>;
  createSale(consultantId: number, input: CreateSaleInput): Promise<Sale>;
  updateSale(consultantId: number, id: number, input: UpdateSaleInput): Promise<Sale | undefined>;
  cancelSale(consultantId: number, id: number): Promise<Sale | undefined>;
  updateInstallmentStatus(consultantId: number, saleId: number, installmentId: number, status: "pendiente" | "pagado"): Promise<SaleInstallment | undefined>;
  /** Prompt 6, punto 6 — cambiar a mano entre "entregada" y "pendiente_entrega" desde el
   * detalle de la venta. Independiente del pago: no toca sale_installments ni status. */
  setSaleDeliveryStatus(consultantId: number, saleId: number, deliveryStatus: "entregada" | "pendiente_entrega"): Promise<Sale | undefined>;
  getSalesSummary(consultantId: number, start: string, end: string, groupBy?: ReportGroupBy): Promise<SalesSummaryPoint[]>;
  getTopCategories(consultantId: number, start?: string, end?: string): Promise<TopCategory[]>;
  getSalesByPaymentMethod(consultantId: number, start?: string, end?: string): Promise<PaymentMethodBreakdown[]>;
  getInstallmentsBreakdown(consultantId: number, start?: string, end?: string): Promise<InstallmentsBreakdown>;
  getStockValuation(consultantId: number): Promise<StockValuation>;
  getInactiveClients(consultantId: number, days: number): Promise<InactiveClient[]>;
  getUpcomingBirthdays(consultantId: number, days: number): Promise<UpcomingBirthday[]>;
  getAppointmentsSummary(consultantId: number, start: string, end: string): Promise<AppointmentsSummary>;
  getPendingInstallments(consultantId: number, limit?: number): Promise<PendingInstallmentRow[]>;
  getProductCostSummary(consultantId: number, start?: string, end?: string): Promise<ProductCostSummary>;
  getCollectedPayments(consultantId: number): Promise<CollectedPayments>;
  getPendingInstallmentsTotals(consultantId: number): Promise<PendingInstallmentsTotals>;
}

type Database = typeof database;

export class DatabaseStorage implements IStorage {
  private dbPromise: Promise<Database> | undefined;

  private async getDb(): Promise<Database> {
    // TEST_DATABASE_URL solo existe cuando un test la seteó explícitamente y pasó el guard
    // de server/test-db-guard.ts (host loopback + nombre "*_test") — producción real nunca
    // la tiene, así que este branch nunca se activa fuera de los tests de Postgres real
    // (client-isolation/stock-concurrency/tenant-isolation-deep, ver Etapa I-B.5.1).
    this.dbPromise ??= process.env.TEST_DATABASE_URL
      ? import("./test-db").then((module) => module.testDb)
      : import("./db").then((module) => module.db);
    return this.dbPromise;
  }

  /** Mismo cálculo que computeHabitualDiscountPercent (server/orderDiscount.ts), reimplementado
   * acá en vez de importado: ese módulo importa `storage` desde este archivo, así que
   * importarlo de vuelta crearía un ciclo. Ambos usan la misma función pura de
   * shared/saleCalculations.ts — solo el "pegamento" de fetch+fallback está duplicado. */
  private async resolveHabitualDiscountPercent(consultantId: number): Promise<number> {
    const since = new Date(Date.now() - HABITUAL_DISCOUNT_WINDOW_MS);
    const recent = await this.listOrderDiscountLogSince(consultantId, since);
    const weighted = computeWeightedDiscountPercent(recent);
    if (weighted !== null) return weighted;
    const latestEver = await this.getLatestOrderDiscountLogEntry(consultantId);
    if (latestEver) return latestEver.discountPercent;
    return DEFAULT_HABITUAL_DISCOUNT_PERCENT;
  }

  async getUser(id: number): Promise<User | undefined> {
    const db = await this.getDb();
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const db = await this.getDb();
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const db = await this.getDb();
    const hashedPassword = await bcrypt.hash(insertUser.password, BCRYPT_SALT_ROUNDS);

    // Transaccional: consultora + su trial + el usuario nacen juntos o no nace ninguno — nunca
    // queda una consultora sin subscription (la migración 0007 ya está aplicada, ver Etapa C).
    return db.transaction(async (tx) => {
      // Toda cuenta consultora nace con su propia consultora — nunca comparte tenant con otra.
      let consultantId = insertUser.consultantId ?? null;
      if (insertUser.role === "consultant" && consultantId === null) {
        const [consultant] = await tx
          .insert(consultants)
          .values({ businessName: insertUser.username, currency: "ARS", monthlyGoal: null })
          .returning();
        consultantId = consultant.id;

        const trialStartAt = new Date();
        const trialEndAt = new Date(trialStartAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        await tx
          .insert(subscriptions)
          .values({ consultantId, status: subscriptionStatuses[0], trialStartAt, trialEndAt });
      }

      const [user] = await tx
        .insert(users)
        .values({ ...insertUser, password: hashedPassword, consultantId })
        .returning();
      return user;
    });
  }

  async updateUserPassword(id: number, newHash: string): Promise<void> {
    const db = await this.getDb();
    await db.update(users).set({ password: newHash }).where(eq(users.id, id));
  }

  async getConsultants(): Promise<User[]> {
    const db = await this.getDb();
    return db
      .select()
      .from(users)
      .where(ne(users.role, "admin"));
  }

  async toggleUserStatus(id: number): Promise<ToggleUserStatusResult> {
    const existing = await this.getUser(id);
    if (!existing) return { outcome: "not_found" };
    if (existing.role === "admin") return { outcome: "forbidden" };

    const db = await this.getDb();
    const [updated] = await db
      .update(users)
      .set({ status: !existing.status })
      .where(eq(users.id, id))
      .returning();
    return { outcome: "toggled", user: updated };
  }

  async hasAdminAccount(): Promise<boolean> {
    const db = await this.getDb();
    const [result] = await db.select({ value: count() }).from(users).where(eq(users.role, "admin"));
    return (result?.value ?? 0) > 0;
  }

  async getProductCount(): Promise<number> {
    const db = await this.getDb();
    const [result] = await db.select({ value: count() }).from(products);
    return result?.value ?? 0;
  }

  async listConsultantAccounts(): Promise<Consultant[]> {
    const db = await this.getDb();
    return db.select().from(consultants).orderBy(asc(consultants.businessName));
  }

  async getBusinessSettings(consultantId: number): Promise<Consultant | undefined> {
    const db = await this.getDb();
    const [row] = await db.select().from(consultants).where(eq(consultants.id, consultantId));
    return row;
  }

  /** Umbral de stock bajo predeterminado del perfil de la consultora — usado por
   * withStockDefaults para resolver el umbral efectivo de cada producto. */
  private async getDefaultThreshold(db: Database, consultantId: number): Promise<number | null> {
    const [row] = await db
      .select({ defaultLowStockThreshold: consultants.defaultLowStockThreshold })
      .from(consultants)
      .where(eq(consultants.id, consultantId));
    return row?.defaultLowStockThreshold ?? null;
  }

  async updateBusinessSettings(consultantId: number, input: UpdateBusinessSettingsInput): Promise<Consultant | undefined> {
    const db = await this.getDb();
    const [updated] = await db
      .update(consultants)
      .set({
        businessName: input.businessName,
        currency: input.currency,
        monthlyGoal: input.monthlyGoal ?? null,
        defaultLowStockThreshold: input.defaultLowStockThreshold ?? null,
        orderReminderDay1: input.orderReminderDay1 ?? null,
        orderReminderDay2: input.orderReminderDay2 ?? null,
        grossIncomeTaxPercentTenths: input.grossIncomeTaxPercentTenths ?? null,
      })
      .where(eq(consultants.id, consultantId))
      .returning();
    return updated;
  }

  async createOrderDiscountLogEntry(consultantId: number, input: { discountPercent: number; publicValueArs: number }): Promise<OrderDiscountLogEntry> {
    const db = await this.getDb();
    const [entry] = await db
      .insert(orderDiscountLog)
      .values({ consultantId, discountPercent: input.discountPercent, publicValueArs: input.publicValueArs })
      .returning();
    return entry;
  }

  async listOrderDiscountLogSince(consultantId: number, since: Date): Promise<OrderDiscountLogEntry[]> {
    const db = await this.getDb();
    return db
      .select()
      .from(orderDiscountLog)
      .where(and(eq(orderDiscountLog.consultantId, consultantId), gte(orderDiscountLog.confirmedAt, since)));
  }

  async getLatestOrderDiscountLogEntry(consultantId: number): Promise<OrderDiscountLogEntry | undefined> {
    const db = await this.getDb();
    const [entry] = await db
      .select()
      .from(orderDiscountLog)
      .where(eq(orderDiscountLog.consultantId, consultantId))
      .orderBy(desc(orderDiscountLog.confirmedAt))
      .limit(1);
    return entry;
  }

  async setConsultantEmail(consultantId: number, email: string): Promise<Consultant | undefined> {
    const db = await this.getDb();
    // Etapa 3: siempre normalizado antes de guardar — única forma de que el unique index
    // parcial (consultants_email_unique_idx) y la búsqueda de recuperación de contraseña
    // (getUserByConsultantEmail) comparen contra la misma representación.
    const [updated] = await db
      .update(consultants)
      .set({ email: normalizeEmail(email) })
      .where(eq(consultants.id, consultantId))
      .returning();
    return updated;
  }

  async registerConsultant(input: RegisterConsultantInput): Promise<{ user: User; consultant: Consultant }> {
    const db = await this.getDb();
    const normalizedEmail = normalizeEmail(input.email);
    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    try {
      // Mismo criterio transaccional que createUser: consultant + trial + user nacen juntos o
      // no nace ninguno — acá además el email queda seteado desde el vamos, en la misma
      // transacción (a diferencia del flujo de suscripción, que lo completa después).
      return await db.transaction(async (tx) => {
        const [consultant] = await tx
          .insert(consultants)
          .values({ businessName: input.username, currency: "ARS", monthlyGoal: null, email: normalizedEmail })
          .returning();

        const trialStartAt = new Date();
        const trialEndAt = new Date(trialStartAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        await tx
          .insert(subscriptions)
          .values({ consultantId: consultant.id, status: subscriptionStatuses[0], trialStartAt, trialEndAt });

        const [user] = await tx
          .insert(users)
          .values({ username: input.username, password: hashedPassword, role: "consultant", status: true, consultantId: consultant.id })
          .returning();

        return { user, consultant };
      });
    } catch (err) {
      if (isUniqueViolationOn(err, "consultants_email_unique_idx")) {
        throw new DuplicateEmailError("Ya existe una cuenta con ese email");
      }
      if (isUniqueViolationOn(err, "users_username_unique")) {
        throw new DuplicateUsernameError("Ese nombre de usuario ya está en uso");
      }
      throw err;
    }
  }

  async getUserByConsultantEmail(normalizedEmail: string): Promise<User | undefined> {
    const db = await this.getDb();
    const [row] = await db
      .select({ user: users })
      .from(consultants)
      .innerJoin(users, eq(users.consultantId, consultants.id))
      .where(and(eq(consultants.email, normalizedEmail), eq(users.role, "consultant")));
    return row?.user;
  }

  async invalidateActivePasswordResetCodes(userId: number): Promise<void> {
    const db = await this.getDb();
    await db
      .update(passwordResetCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetCodes.userId, userId), isNull(passwordResetCodes.usedAt)));
  }

  async createPasswordResetCode(userId: number, codeHash: string, expiresAt: Date): Promise<PasswordResetCode> {
    const db = await this.getDb();
    const [row] = await db.insert(passwordResetCodes).values({ userId, codeHash, expiresAt }).returning();
    return row;
  }

  async getLatestPasswordResetCode(userId: number): Promise<PasswordResetCode | undefined> {
    const db = await this.getDb();
    const [row] = await db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, userId))
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);
    return row;
  }

  async incrementPasswordResetCodeAttempts(id: number): Promise<void> {
    const db = await this.getDb();
    await db
      .update(passwordResetCodes)
      .set({ attempts: sql`${passwordResetCodes.attempts} + 1` })
      .where(eq(passwordResetCodes.id, id));
  }

  async markPasswordResetCodeUsed(id: number): Promise<void> {
    const db = await this.getDb();
    await db.update(passwordResetCodes).set({ usedAt: new Date() }).where(eq(passwordResetCodes.id, id));
  }

  async getSubscriptionByConsultantId(consultantId: number): Promise<Subscription | undefined> {
    const db = await this.getDb();
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.consultantId, consultantId));
    return sub;
  }

  async createTrialSubscription(consultantId: number, trialStartAt: Date, trialEndAt: Date): Promise<Subscription> {
    const db = await this.getDb();
    const [sub] = await db
      .insert(subscriptions)
      .values({ consultantId, status: subscriptionStatuses[0], trialStartAt, trialEndAt })
      .returning();
    return sub;
  }

  async updateSubscription(consultantId: number, patch: SubscriptionUpdate): Promise<Subscription | undefined> {
    const db = await this.getDb();
    const [updated] = await db.update(subscriptions).set(patch).where(eq(subscriptions.consultantId, consultantId)).returning();
    return updated;
  }

  async createPendingPayment(consultantId: number, input: CreatePendingPaymentInput): Promise<Payment> {
    const db = await this.getDb();
    const [payment] = await db
      .insert(payments)
      .values({
        consultantId,
        externalReference: input.externalReference,
        mpPreapprovalId: input.mpPreapprovalId ?? null,
        amount: input.amount,
        currency: input.currency,
        periodDaysGranted: input.periodDaysGranted,
        status: paymentStatuses[0],
      })
      .returning();
    return payment;
  }

  async getPaymentByExternalReference(externalReference: string): Promise<Payment | undefined> {
    const db = await this.getDb();
    // externalReference ya no es unique (MP-1): puede haber varios cobros con la misma —
    // se devuelve el más reciente, de forma determinista.
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.externalReference, externalReference))
      .orderBy(desc(payments.id))
      .limit(1);
    return payment;
  }

  async getPaymentByMpPaymentId(mpPaymentId: string): Promise<Payment | undefined> {
    const db = await this.getDb();
    const [payment] = await db.select().from(payments).where(eq(payments.mpPaymentId, mpPaymentId));
    return payment;
  }

  async updatePayment(id: number, patch: PaymentUpdate): Promise<Payment | undefined> {
    const db = await this.getDb();
    const [updated] = await db.update(payments).set(patch).where(eq(payments.id, id)).returning();
    return updated;
  }

  async getPaymentsByConsultantId(consultantId: number): Promise<Payment[]> {
    const db = await this.getDb();
    return db.select().from(payments).where(eq(payments.consultantId, consultantId)).orderBy(desc(payments.createdAt));
  }

  async applyApprovedPayment(consultantId: number, input: ApplyApprovedPaymentInput): Promise<ApplyApprovedPaymentResult> {
    const db = await this.getDb();
    return db.transaction(async (tx) => {
      // FOR UPDATE: bloquea la fila hasta el commit, igual que createSale con el stock —
      // dos notificaciones casi simultáneas para la misma consultora no pueden pisarse. Va
      // ANTES del chequeo de idempotencia (MP-1): si el chequeo corriera antes del lock, dos
      // notificaciones idénticas podrían pasarlo a la vez y la segunda reventaría con un
      // unique violation en vez de reconocerse como duplicada.
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.consultantId, consultantId)).for("update");

      // Idempotencia: si esta notificación ya se procesó antes (webhook duplicado), no
      // extender el período una segunda vez — mpPaymentId es único por diseño.
      const [existing] = await tx.select().from(payments).where(eq(payments.mpPaymentId, input.mpPaymentId));
      if (existing) return { outcome: "already_processed", payment: existing };

      if (!sub || sub.mpPreapprovalId !== input.mpPreapprovalId) {
        return { outcome: "preapproval_mismatch" };
      }

      const now = new Date();
      // ON CONFLICT (mp_payment_id): el lock de arriba es por consultora, así que no cubre el
      // mismo mpPaymentId llegando a la vez para dos consultoras distintas — ahí la única
      // defensa es el unique global. Se traduce a "ya procesado" en vez de una excepción.
      // `externalReference` NO participa: varios cobros de una suscripción pueden compartirlo.
      const [payment] = await tx
        .insert(payments)
        .values({
          consultantId,
          externalReference: input.externalReference,
          mpPreapprovalId: input.mpPreapprovalId,
          mpPaymentId: input.mpPaymentId,
          status: "approved",
          amount: input.amount,
          currency: "ARS",
          periodDaysGranted: PERIOD_DAYS,
          mpStatusDetail: input.statusDetail,
          rawPayload: input.rawPayload as any,
          paidAt: now,
        })
        .onConflictDoNothing({ target: payments.mpPaymentId })
        .returning();

      if (!payment) {
        const [duplicate] = await tx.select().from(payments).where(eq(payments.mpPaymentId, input.mpPaymentId));
        return { outcome: "already_processed", payment: duplicate };
      }

      // Sin lógica de "renovación anticipada": cada pago aprobado otorga PERIOD_DAYS desde
      // el momento de la confirmación, sin arrastrar días de un período anterior. El cobro
      // recurrente lo programa Mercado Pago (no nuestro backend), así que la superposición
      // de períodos no debería darse en la práctica — ver informe de Etapa C, es una regla
      // de negocio deliberadamente NO decidida más allá de esto (Etapa A ya lo había dejado
      // como pregunta abierta).
      await tx
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000),
          lastPaymentId: payment.id,
        })
        .where(eq(subscriptions.consultantId, consultantId));

      return { outcome: "applied", payment };
    });
  }

  async confirmCouponRedemption(consultantId: number, confirmedAt: Date): Promise<CouponRedemption | undefined> {
    const db = await this.getDb();
    const [reserved] = await db
      .select()
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.consultantId, consultantId), eq(couponRedemptions.status, "reserved")))
      .orderBy(desc(couponRedemptions.reservedAt))
      .limit(1);
    if (!reserved) return undefined;
    const [confirmed] = await db
      .update(couponRedemptions)
      .set({ status: "confirmed", confirmedAt, discountEndsAt: computeDiscountEndsAtInline(reserved, confirmedAt) })
      .where(eq(couponRedemptions.id, reserved.id))
      .returning();
    return confirmed;
  }

  async activateFreeSubscription(consultantId: number, input: { couponRedemptionId: number; periodDays: number }): Promise<Payment> {
    const db = await this.getDb();
    return db.transaction(async (tx) => {
      const now = new Date();
      const [payment] = await tx
        .insert(payments)
        .values({
          consultantId,
          externalReference: `coupon-${input.couponRedemptionId}`,
          mpPreapprovalId: null,
          // Sintético y estable — nunca choca con un mpPaymentId real de Mercado Pago (siempre
          // numérico) y deja una identidad clara en el ledger para auditar.
          mpPaymentId: `coupon-free-${input.couponRedemptionId}`,
          status: "approved",
          amount: 0,
          currency: "ARS",
          periodDaysGranted: input.periodDays,
          mpStatusDetail: "coupon_100_percent_off",
          rawPayload: null,
          paidAt: now,
        })
        .returning();

      await tx
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + input.periodDays * 24 * 60 * 60 * 1000),
          lastPaymentId: payment.id,
        })
        .where(eq(subscriptions.consultantId, consultantId));

      return payment;
    });
  }

  async getLatestSubscriptionPriceChange(): Promise<SubscriptionPriceHistoryEntry | undefined> {
    const db = await this.getDb();
    const [latest] = await db.select().from(subscriptionPriceHistory).orderBy(desc(subscriptionPriceHistory.changedAt)).limit(1);
    return latest;
  }

  async getLatestDuePriceChange(now: Date): Promise<SubscriptionPriceHistoryEntry | undefined> {
    const db = await this.getDb();
    const [due] = await db
      .select()
      .from(subscriptionPriceHistory)
      .where(and(eq(subscriptionPriceHistory.appliesTo, "all"), lt(subscriptionPriceHistory.effectiveAt, now)))
      .orderBy(desc(subscriptionPriceHistory.changedAt))
      .limit(1);
    return due;
  }

  async listSubscriptionPriceHistory(): Promise<SubscriptionPriceHistoryEntry[]> {
    const db = await this.getDb();
    return db.select().from(subscriptionPriceHistory).orderBy(desc(subscriptionPriceHistory.changedAt));
  }

  async createSubscriptionPriceChange(input: CreatePriceChangeInput): Promise<SubscriptionPriceHistoryEntry> {
    const db = await this.getDb();
    const [entry] = await db.insert(subscriptionPriceHistory).values(input).returning();
    return entry;
  }

  async getCouponByCode(normalizedCode: string): Promise<Coupon | undefined> {
    const db = await this.getDb();
    const [coupon] = await db.select().from(coupons).where(eq(coupons.code, normalizedCode));
    return coupon;
  }

  async getCouponById(id: number): Promise<Coupon | undefined> {
    const db = await this.getDb();
    const [coupon] = await db.select().from(coupons).where(eq(coupons.id, id));
    return coupon;
  }

  async listCoupons(): Promise<Coupon[]> {
    const db = await this.getDb();
    return db.select().from(coupons).orderBy(desc(coupons.createdAt));
  }

  async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    const db = await this.getDb();
    const [coupon] = await db.insert(coupons).values(input).returning();
    return coupon;
  }

  async updateCoupon(id: number, patch: CouponUpdate): Promise<Coupon | undefined> {
    const db = await this.getDb();
    const [coupon] = await db.update(coupons).set(patch).where(eq(coupons.id, id)).returning();
    return coupon;
  }

  async getCouponRedemption(couponId: number, consultantId: number): Promise<CouponRedemption | undefined> {
    const db = await this.getDb();
    const [redemption] = await db
      .select()
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, couponId), eq(couponRedemptions.consultantId, consultantId)));
    return redemption;
  }

  async getReservedCouponRedemption(consultantId: number): Promise<CouponRedemption | undefined> {
    const db = await this.getDb();
    const [redemption] = await db
      .select()
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.consultantId, consultantId), eq(couponRedemptions.status, "reserved")))
      .orderBy(desc(couponRedemptions.reservedAt))
      .limit(1);
    return redemption;
  }

  async countActiveCouponUses(couponId: number, reservationTtlMs: number): Promise<number> {
    const db = await this.getDb();
    const reservationCutoff = new Date(Date.now() - reservationTtlMs);
    const [row] = await db
      .select({ total: count() })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, couponId),
          or(eq(couponRedemptions.status, "confirmed"), and(eq(couponRedemptions.status, "reserved"), gt(couponRedemptions.reservedAt, reservationCutoff))),
        ),
      );
    return row?.total ?? 0;
  }

  async reserveCouponForConsultant(
    couponId: number,
    consultantId: number,
    input: ReserveCouponInput,
    reservationTtlMs: number,
  ): Promise<ReserveCouponResult> {
    const db = await this.getDb();
    return db.transaction(async (tx) => {
      // Lock de la fila del cupón: serializa reservas concurrentes del MISMO cupón — dos
      // consultoras tocando "Aplicar" al mismo tiempo para el último cupo nunca pasan las dos.
      const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).for("update");
      if (coupon?.maxUses != null) {
        const reservationCutoff = new Date(Date.now() - reservationTtlMs);
        const [row] = await tx
          .select({ total: count() })
          .from(couponRedemptions)
          .where(
            and(
              eq(couponRedemptions.couponId, couponId),
              or(eq(couponRedemptions.status, "confirmed"), and(eq(couponRedemptions.status, "reserved"), gt(couponRedemptions.reservedAt, reservationCutoff))),
            ),
          );
        if ((row?.total ?? 0) >= coupon.maxUses) return { outcome: "limit_reached" };
      }

      const [redemption] = await tx
        .insert(couponRedemptions)
        .values({
          couponId,
          consultantId,
          status: "reserved",
          discountType: input.discountType,
          discountValue: input.discountValue,
          duration: input.duration,
          durationMonths: input.durationMonths,
        })
        .onConflictDoNothing({ target: [couponRedemptions.couponId, couponRedemptions.consultantId] })
        .returning();

      if (!redemption) return { outcome: "already_used" };
      return { outcome: "reserved", redemption };
    });
  }

  async getActiveCouponRedemptionForConsultant(consultantId: number): Promise<(CouponRedemption & { couponCode: string }) | undefined> {
    const db = await this.getDb();
    const now = new Date();
    const [row] = await db
      .select({ redemption: couponRedemptions, couponCode: coupons.code })
      .from(couponRedemptions)
      .innerJoin(coupons, eq(couponRedemptions.couponId, coupons.id))
      .where(
        and(
          eq(couponRedemptions.consultantId, consultantId),
          eq(couponRedemptions.status, "confirmed"),
          or(isNull(couponRedemptions.discountEndsAt), gt(couponRedemptions.discountEndsAt, now)),
        ),
      )
      .orderBy(desc(couponRedemptions.confirmedAt))
      .limit(1);
    return row ? { ...row.redemption, couponCode: row.couponCode } : undefined;
  }

  async getActiveExpiredCouponRedemption(consultantId: number, now: Date): Promise<CouponRedemption | undefined> {
    const db = await this.getDb();
    const [redemption] = await db
      .select()
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.consultantId, consultantId),
          eq(couponRedemptions.status, "confirmed"),
          isNotNull(couponRedemptions.discountEndsAt),
          lt(couponRedemptions.discountEndsAt, now),
          isNull(couponRedemptions.priceRevertedAt),
        ),
      );
    return redemption;
  }

  async markCouponRedemptionReverted(id: number): Promise<void> {
    const db = await this.getDb();
    await db.update(couponRedemptions).set({ priceRevertedAt: new Date() }).where(eq(couponRedemptions.id, id));
  }

  async listCouponRedemptionsByCoupon(couponId: number): Promise<CouponRedemptionDetailRow[]> {
    const db = await this.getDb();
    const rows = await db
      .select({ redemption: couponRedemptions, businessName: consultants.businessName, username: users.username })
      .from(couponRedemptions)
      .innerJoin(consultants, eq(couponRedemptions.consultantId, consultants.id))
      .innerJoin(users, and(eq(users.consultantId, consultants.id), eq(users.role, "consultant")))
      .where(eq(couponRedemptions.couponId, couponId))
      .orderBy(desc(couponRedemptions.reservedAt));
    return rows.map((r) => ({ redemption: r.redemption, consultantId: r.redemption.consultantId, businessName: r.businessName, username: r.username }));
  }

  async listAdminSubscriptions(): Promise<AdminSubscriptionRow[]> {
    const db = await this.getDb();
    const rows = await db
      .select({
        consultantId: consultants.id,
        businessName: consultants.businessName,
        email: consultants.email,
        username: users.username,
        subscription: subscriptions,
        lastPayment: payments,
      })
      .from(consultants)
      .innerJoin(users, and(eq(users.consultantId, consultants.id), eq(users.role, "consultant")))
      .leftJoin(subscriptions, eq(subscriptions.consultantId, consultants.id))
      .leftJoin(payments, eq(payments.id, subscriptions.lastPaymentId))
      .orderBy(consultants.businessName);
    return rows;
  }

  async listAllPayments(filters?: AdminPaymentFilters): Promise<AdminPaymentRow[]> {
    const db = await this.getDb();
    const conditions = [
      filters?.status ? eq(payments.status, filters.status) : undefined,
      filters?.consultantId ? eq(payments.consultantId, filters.consultantId) : undefined,
      filters?.from ? gte(payments.createdAt, filters.from) : undefined,
      filters?.to ? lt(payments.createdAt, filters.to) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await db
      .select({ payment: payments, businessName: consultants.businessName })
      .from(payments)
      .innerJoin(consultants, eq(consultants.id, payments.consultantId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(payments.createdAt));
    return rows.map((r) => ({ ...r.payment, businessName: r.businessName }));
  }

  /** Catálogo visible para la consultora: lo global (consultantId null) + lo manual propio,
   * con su stock resuelto (o defaults si todavía no cargó stock para ese producto). */
  async getAllProducts(consultantId: number): Promise<Product[]> {
    const db = await this.getDb();
    const [rows, defaultThreshold] = await Promise.all([
      db
        .select({ product: products, stock: productStock })
        .from(products)
        .leftJoin(productStock, and(eq(productStock.productId, products.id), eq(productStock.consultantId, consultantId)))
        .where(or(isNull(products.consultantId), eq(products.consultantId, consultantId)))
        .orderBy(products.seccion, products.linea, products.producto),
      this.getDefaultThreshold(db, consultantId),
    ]);
    return rows.map((r) => withStockDefaults(r.product, r.stock, defaultThreshold));
  }

  async getProductsByIds(consultantId: number, ids: number[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const db = await this.getDb();
    const rows = await db
      .select({ product: products, stock: productStock })
      .from(products)
      .leftJoin(productStock, and(eq(productStock.productId, products.id), eq(productStock.consultantId, consultantId)))
      .where(and(inArray(products.id, ids), or(isNull(products.consultantId), eq(products.consultantId, consultantId))));
    // effectiveStockMinimo no es relevante para los consumidores actuales de este método
    // (precios/cálculo de venta) — se omite la consulta extra al perfil de la consultora.
    return rows.map((r) => withStockDefaults(r.product, r.stock));
  }

  /** Admin-only: carga/actualiza el catálogo GLOBAL. El select-then-upsert por código sigue
   * siendo la validación anticipada (da mensajes claros y dedupea correctamente DENTRO de un
   * mismo batch, ya que el SELECT ve las propias escrituras aún no comiteadas de esta misma
   * transacción). Pero ESA validación sola no alcanza contra dos llamadas concurrentes a este
   * método: dos transacciones pueden hacer el mismo SELECT antes de que cualquiera comitee su
   * INSERT y las dos insertar el mismo código global (hallazgo F3, auditoría I-B.8-A — TOCTOU
   * real, no teórico). La defensa final es `products_global_codigo_unique_idx` (índice único
   * PARCIAL en `shared/schema.ts`, `WHERE consultant_id IS NULL`) — verificado contra Postgres
   * real en Etapa I-B.8-D. Atómico: todo el lote va en UNA transacción, así que si cualquier
   * item choca contra esa constraint, se revierte el batch completo (nunca queda una
   * importación parcialmente aplicada). */
  async bulkInsertProducts(items: InsertProduct[]): Promise<number> {
    if (items.length === 0) return 0;

    const db = await this.getDb();
    let changed = 0;
    try {
      await db.transaction(async (tx) => {
        for (const item of items) {
          const [existing] = await tx
            .select({ id: products.id })
            .from(products)
            .where(and(isNull(products.consultantId), eq(products.codigo, item.codigo)));

          if (existing) {
            await tx
              .update(products)
              .set({
                seccion: item.seccion,
                linea: item.linea ?? null,
                producto: item.producto,
                variante: item.variante ?? "Estándar",
                puntos: item.puntos ?? 0,
                precio: item.precio,
                imagen: item.imagen ?? null,
              })
              .where(eq(products.id, existing.id));
          } else {
            await tx.insert(products).values({ ...item, consultantId: null, source: "import" });
          }
          changed++;
        }
      });
    } catch (err) {
      if (isUniqueViolationOn(err, "products_global_codigo_unique_idx")) {
        throw new ProductConflictError(
          "Conflicto al importar: otra importación concurrente ya creó un producto global con uno de estos códigos. No se guardó ningún producto de este lote — reintentá la importación.",
        );
      }
      throw err;
    }

    return changed;
  }

  /** Mismo patrón select-then-upsert que bulkInsertProducts, pero scopeado a UNA consultora
   * (productos privados, no globales) y sembrando también su propio stock en la misma pasada —
   * usado por el botón "Cargar catálogo de prueba". Idempotente: reintentar no duplica. */
  async seedOwnProducts(consultantId: number, items: CreateProductInput[]): Promise<number> {
    if (items.length === 0) return 0;

    const db = await this.getDb();
    let changed = 0;
    await db.transaction(async (tx) => {
      for (const item of items) {
        const variante = item.variante ?? "Estándar";
        const codigo = item.codigo ?? slugify(`${item.seccion}-${item.linea ?? ""}-${item.producto}-${variante}-${Date.now()}`);

        const [existing] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.consultantId, consultantId), eq(products.codigo, codigo)));

        let productId: number;
        if (existing) {
          await tx
            .update(products)
            .set({
              seccion: item.seccion,
              linea: item.linea ?? null,
              producto: item.producto,
              variante,
              puntos: item.puntos,
              precio: item.precio,
              imagen: item.imagen ?? null,
            })
            .where(eq(products.id, existing.id));
          productId = existing.id;
        } else {
          const [created] = await tx
            .insert(products)
            .values({
              consultantId,
              seccion: item.seccion,
              linea: item.linea ?? null,
              producto: item.producto,
              variante,
              codigo,
              puntos: item.puntos,
              precio: item.precio,
              imagen: item.imagen ?? null,
              source: "manual",
            })
            .returning();
          productId = created.id;
        }

        await tx
          .insert(productStock)
          .values({ consultantId, productId, unidades: item.unidades, stockMinimo: item.stockMinimo ?? 5 })
          .onConflictDoUpdate({
            target: [productStock.consultantId, productStock.productId],
            set: { unidades: item.unidades },
          });
        changed++;
      }
    });

    return changed;
  }

  /** Solo productos que la consultora ya tiene cargados en su stock — no tiene sentido avisar
   * "stock bajo" de todo el catálogo global que todavía no tocó. Alerta cuando unidades es
   * MENOR al umbral efectivo (propio del producto, si no el del perfil, si no 2 — ver
   * resolveLowStockThreshold), nunca cuando es igual. */
  async getLowStockProducts(consultantId: number): Promise<Product[]> {
    const db = await this.getDb();
    const defaultThreshold = await this.getDefaultThreshold(db, consultantId);
    const effectiveThresholdSql = sql`coalesce(${productStock.stockMinimo}, ${defaultThreshold}, ${DEFAULT_LOW_STOCK_THRESHOLD})`;
    const rows = await db
      .select({ product: products, stock: productStock })
      .from(productStock)
      .innerJoin(products, eq(products.id, productStock.productId))
      .where(and(eq(productStock.consultantId, consultantId), sql`${productStock.unidades} < ${effectiveThresholdSql}`))
      .orderBy(asc(productStock.unidades));
    return rows.map((r) => withStockDefaults(r.product, r.stock, defaultThreshold));
  }

  private async findVisibleProduct(db: Database, consultantId: number, productId: number): Promise<ProductRow | undefined> {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), or(isNull(products.consultantId), eq(products.consultantId, consultantId))));
    return product;
  }

  async applyProductDiscount(consultantId: number, productId: number, discountPercent: number): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    const costPrice = Math.round(product.precio * (1 - discountPercent / 100));
    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, selectedDiscount: discountPercent, costPrice })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: { selectedDiscount: discountPercent, costPrice },
      })
      .returning();
    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async createProduct(consultantId: number, input: CreateProductInput): Promise<Product> {
    const db = await this.getDb();
    const variante = input.variante ?? "Estándar";
    const codigo = input.codigo ?? slugify(`${input.seccion}-${input.linea ?? ""}-${input.producto}-${variante}-${Date.now()}`);
    const [created, stock] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          consultantId,
          seccion: input.seccion,
          linea: input.linea ?? null,
          producto: input.producto,
          variante,
          codigo,
          puntos: input.puntos,
          precio: input.precio,
          imagen: input.imagen ?? null,
          source: "manual",
        })
        .returning();
      const [stock] = await tx
        .insert(productStock)
        .values({
          consultantId,
          productId: created.id,
          unidades: input.unidades,
          stockMinimo: input.stockMinimo ?? null,
        })
        .returning();
      return [created, stock];
    });
    return withStockDefaults(created, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async updateProduct(consultantId: number, id: number, input: UpdateProductInput): Promise<Product | undefined> {
    const db = await this.getDb();
    let updated: ProductRow | undefined;
    try {
      // Ownership en el propio WHERE (igual que updateClient) — nunca matchea un producto
      // global (consultantId null) ni uno de otra consultora, sin necesidad de un chequeo
      // separado antes del UPDATE.
      [updated] = await db
        .update(products)
        .set(input)
        .where(and(eq(products.id, id), eq(products.consultantId, consultantId)))
        .returning();
    } catch (err) {
      if (isUniqueViolationOn(err, "products_consultant_codigo_unique")) {
        throw new ProductConflictError("Ya existe otro producto tuyo con ese código");
      }
      throw err;
    }
    if (!updated) return undefined;

    const [stock] = await db
      .select()
      .from(productStock)
      .where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, id)));
    return withStockDefaults(updated, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async deleteProduct(consultantId: number, id: number): Promise<"deleted" | "not_found" | "has_relations"> {
    const db = await this.getDb();
    const [product] = await db.select().from(products).where(and(eq(products.id, id), eq(products.consultantId, consultantId)));
    if (!product) return "not_found";

    const [itemCount] = await db.select({ value: count() }).from(saleItems).where(eq(saleItems.productId, id));
    if ((itemCount?.value ?? 0) > 0) return "has_relations";

    try {
      return await db.transaction(async (tx) => {
        await tx.delete(productStock).where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, id)));
        const deleted = await tx
          .delete(products)
          .where(and(eq(products.id, id), eq(products.consultantId, consultantId)))
          .returning();
        return deleted.length > 0 ? "deleted" : "not_found";
      });
    } catch (err) {
      // Defensa ante una carrera real: una venta pudo insertar un sale_item referenciando este
      // producto justo entre el chequeo de arriba y este DELETE — el FK de Postgres (sin
      // onDelete, ver shared/schema.ts) lo bloquea igual, nunca deja un huérfano.
      // Etapa I-C.0.1: drizzle-orm 0.45.2 envuelve el error real de `pg` en `.cause` (ver
      // isUniqueViolationOn más arriba) — mismo criterio acá, error directo primero, `.cause`
      // como fallback.
      const isForeignKeyViolation = (candidate: unknown): boolean =>
        typeof candidate === "object" && candidate !== null && (candidate as { code?: unknown }).code === "23503";
      if (isForeignKeyViolation(err) || isForeignKeyViolation((err as { cause?: unknown })?.cause)) {
        return "has_relations";
      }
      throw err;
    }
  }

  async setProductDiscontinued(consultantId: number, productId: number, discontinued: boolean): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, discontinued })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: { discontinued },
      })
      .returning();
    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async setProductPriceOverride(consultantId: number, productId: number, priceOverride: number | null): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;
    if (product.consultantId !== null) {
      throw new ProductValidationError("El precio de un producto cargado a mano se edita en el producto, no con un precio propio");
    }

    // Igual al precio de catálogo "de casualidad" -> se guarda null, no un override idéntico
    // (así una suba futura del precio de catálogo le llega sola, sin quedar pisada).
    const effectiveOverride = priceOverride === product.precio ? null : priceOverride;

    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, priceOverride: effectiveOverride })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: { priceOverride: effectiveOverride },
      })
      .returning();
    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async setProductCost(consultantId: number, productId: number, costPrice: number): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    // Antes del UPSERT, para saber si corresponde recalcular ventas estimadas (ver abajo) —
    // mismo criterio de "lectura previa solo informativa" que incrementProductStockBatch.
    const [existing] = await db
      .select({ costPrice: productStock.costPrice })
      .from(productStock)
      .where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, productId)));
    const hadNoRealCost = !existing || existing.costPrice === null;

    // selectedDiscount queda en null: ya no representa un % real, la consultora escribió el
    // costo directo en pesos.
    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, costPrice, selectedDiscount: null })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: { costPrice, selectedDiscount: null },
      })
      .returning();

    // Prompt 2: acá SÍ corresponde recalcular — es justo el caso previsto ("Editar producto"
    // carga el costo a mano), a diferencia de un pedido nuevo (que nunca recalcula).
    if (hadNoRealCost) {
      await this.recalculateEstimatedSalesForProduct(consultantId, productId, costPrice);
    }

    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async setProductStock(
    consultantId: number,
    productId: number,
    unidades: number,
    stockMinimo?: number | null,
  ): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    const setFields: Partial<typeof productStock.$inferInsert> = { unidades };
    if (stockMinimo !== undefined) setFields.stockMinimo = stockMinimo;

    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, ...setFields })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: setFields,
      })
      .returning();
    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async incrementProductStock(consultantId: number, productId: number, delta: number): Promise<Product | undefined> {
    if (delta === 0) {
      throw new SaleValidationError("El delta de stock no puede ser 0");
    }
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    // UPSERT atómico: `unidades = unidades + delta` lo calcula Postgres en la misma sentencia,
    // nunca TypeScript a partir de un valor leído antes — esa es exactamente la carrera que esta
    // operación reemplaza (ver LoadOrderDialog.tsx, hallazgo F1 de la auditoría I-B.8-A). Si el
    // producto todavía no tiene fila en product_stock, el INSERT usa el delta crudo (no
    // GREATEST(delta,0)): así un decremento sobre stock inexistente también da negativo y lo
    // atrapa el mismo chequeo de abajo, sin duplicar la fila (mismo target de conflicto que ya
    // usan setProductStock/applyProductDiscount/etc.).
    //
    // La transacción es necesaria para poder deshacer la escritura si el resultado da negativo:
    // el UPSERT por sí solo ya habría comiteado el valor antes de que este código lo revise.
    const stock = await db.transaction(async (tx) => {
      const [stock] = await tx
        .insert(productStock)
        .values({ consultantId, productId, unidades: delta })
        .onConflictDoUpdate({
          target: [productStock.consultantId, productStock.productId],
          set: { unidades: sql`${productStock.unidades} + ${delta}` },
        })
        .returning();
      if (stock.unidades < 0) {
        throw new SaleValidationError(`Stock insuficiente: quedarían ${stock.unidades} unidades`);
      }
      return stock;
    });

    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async incrementProductStockBatch(
    consultantId: number,
    lines: { productId: number; delta: number }[],
    discountPercent?: number,
  ): Promise<{ updated: number }> {
    if (lines.length === 0) {
      throw new SaleValidationError("El lote no puede estar vacío");
    }

    // Duplicados: se combinan (nunca dos escrituras separadas para el mismo producto) — mismo
    // criterio pedido en Etapa 7.2, sección 8. Este es el punto de verdad, no confía en que
    // LoadOrderDialog ya haya fusionado antes de enviar.
    const deltaByProductId = new Map<number, number>();
    for (const line of lines) {
      if (!Number.isInteger(line.delta) || line.delta <= 0) {
        throw new SaleValidationError(`Delta inválido para el producto ${line.productId}: tiene que ser un entero positivo`);
      }
      deltaByProductId.set(line.productId, (deltaByProductId.get(line.productId) ?? 0) + line.delta);
    }

    // Orden ascendente de productId antes de tocar cualquier fila — mismo criterio de lock
    // ordering que ya usa el resto del storage (createSale/updateSale/cancelSale, Etapa
    // I-B.7-C) para que dos batches concurrentes con productos solapados en distinto orden
    // nunca se bloqueen en cruz (deadlock). Acá no hace falta un SELECT ... FOR UPDATE previo
    // como en createSale: cada UPSERT de abajo ya toma su propio lock de fila al ejecutarse,
    // así que basta con procesarlas siempre en el mismo orden dentro de la transacción.
    const orderedProductIds = Array.from(deltaByProductId.keys()).sort((a, b) => a - b);

    const db = await this.getDb();

    // Visibilidad de catálogo (global o propio) ANTES de abrir la transacción — igual criterio
    // que createSale: el catálogo no lo modifica ninguna venta/import concurrente, no hace
    // falta bloquearlo. Un producto de OTRO consultantId (privado, no global) da exactamente
    // el mismo error que uno inexistente — nunca se distingue, para no filtrar si existe.
    // Prompt 2: también trae `precio`, necesario para el costo de esta compra cuando viene
    // discountPercent.
    const catalogRows = await db
      .select({ id: products.id, precio: products.precio })
      .from(products)
      .where(and(inArray(products.id, orderedProductIds), or(isNull(products.consultantId), eq(products.consultantId, consultantId))));
    const precioById = new Map(catalogRows.map((p) => [p.id, p.precio]));
    for (const productId of orderedProductIds) {
      if (!precioById.has(productId)) {
        throw new SaleValidationError(`Producto ${productId} no encontrado`);
      }
    }

    // TODO o NADA: las N líneas comparten una única transacción. Si cualquiera tira
    // SaleValidationError (stock insuficiente), Postgres revierte TODAS las escrituras ya
    // hechas por líneas anteriores de este mismo batch — nunca queda una importación aplicada
    // a medias (hallazgo P2, Etapa 6).
    //
    // Prompt 2: un pedido NUNCA dispara `recalculateEstimatedSalesForProduct` — lo acordado es
    // que la ganancia de una venta vieja no cambia cuando entra un pedido nuevo, sin excepción.
    // El producto toma el costo promedio ponderado de esta compra; las ventas viejas siguen
    // "estimadas" con su "≈". La única puerta para recalcularlas es que la consultora cargue el
    // costo a mano desde "Editar producto" (Prompt 4) — esa función ya existe y está testeada,
    // lista para engancharse ahí.
    await db.transaction(async (tx) => {
      for (const productId of orderedProductIds) {
        const delta = deltaByProductId.get(productId)!;

        if (discountPercent === undefined) {
          // Camino de siempre: solo cantidad, no toca costo (correcciones manuales de stock
          // sin contexto de pedido/costo).
          const [stock] = await tx
            .insert(productStock)
            .values({ consultantId, productId, unidades: delta })
            .onConflictDoUpdate({
              target: [productStock.consultantId, productStock.productId],
              set: { unidades: sql`${productStock.unidades} + ${delta}` },
            })
            .returning();
          if (stock.unidades < 0) {
            throw new SaleValidationError(`Stock insuficiente para el producto ${productId}: quedarían ${stock.unidades} unidades`);
          }
          continue;
        }

        // Prompt 2 — costo promedio ponderado por unidades, calculado en una ÚNICA sentencia
        // atómica junto con el incremento de stock: Postgres evalúa todo el SET contra la fila
        // VIEJA (antes de este UPDATE), así que `unidades`/`cost_price` de la derecha son
        // siempre los valores previos a este pedido, sin necesidad de FOR UPDATE explícito (el
        // propio UPSERT ya toma el lock de fila al ejecutarse). Si no había costo o el stock
        // estaba en 0 (o menos), el costo nuevo es directamente el de esta compra — nunca se
        // promedia contra "nada".
        const lineCost = Math.round(precioById.get(productId)! * (1 - discountPercent / 100));
        const [stock] = await tx
          .insert(productStock)
          .values({ consultantId, productId, unidades: delta, costPrice: lineCost, selectedDiscount: discountPercent })
          .onConflictDoUpdate({
            target: [productStock.consultantId, productStock.productId],
            set: {
              unidades: sql`${productStock.unidades} + ${delta}`,
              costPrice: sql`CASE
                WHEN ${productStock.costPrice} IS NULL OR ${productStock.unidades} <= 0 THEN ${lineCost}
                ELSE ROUND((${productStock.unidades} * ${productStock.costPrice} + ${delta}::integer * ${lineCost}::integer)::numeric / (${productStock.unidades} + ${delta}))
              END`,
              selectedDiscount: discountPercent,
            },
          })
          .returning({ unidades: productStock.unidades });
        if (stock.unidades < 0) {
          throw new SaleValidationError(`Stock insuficiente para el producto ${productId}: quedarían ${stock.unidades} unidades`);
        }
      }
    });

    return { updated: orderedProductIds.length };
  }

  async recalculateEstimatedSalesForProduct(consultantId: number, productId: number, newCostPrice: number): Promise<void> {
    const db = await this.getDb();
    await db.transaction(async (tx) => {
      const estimatedItems = await tx
        .select({ id: saleItems.id, saleId: saleItems.saleId })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(eq(sales.consultantId, consultantId), eq(saleItems.productId, productId), eq(saleItems.costIsEstimated, true)));
      if (estimatedItems.length === 0) return;

      await tx
        .update(saleItems)
        .set({ costPrice: newCostPrice, costIsEstimated: false })
        .where(
          inArray(
            saleItems.id,
            estimatedItems.map((i) => i.id),
          ),
        );

      // Una venta puede tener más de un producto — el profit se recalcula con TODAS sus
      // líneas, no solo las que se acaban de corregir.
      const affectedSaleIds = Array.from(new Set(estimatedItems.map((i) => i.saleId)));
      for (const saleId of affectedSaleIds) {
        const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId));
        if (!sale) continue;
        const items = await tx
          .select({ quantity: saleItems.quantity, costPrice: saleItems.costPrice })
          .from(saleItems)
          .where(eq(saleItems.saleId, saleId));
        // Si alguna OTRA línea de esta venta es tan vieja que nunca tuvo costPrice (de antes
        // de que esa columna existiera), no se inventa un valor para poder recalcular el
        // profit — se deja la venta como estaba (mismo criterio que computeHistoricalProductCost).
        const productCost = computeHistoricalProductCost(items);
        if (productCost === null) continue;
        const profit = computeSaleProfit({
          total: sale.total,
          productCost,
          shippingCost: sale.shippingCost,
          ingresosBrutos: sale.ingresosBrutos,
        });
        await tx.update(sales).set({ profit }).where(eq(sales.id, saleId));
      }
    });
  }

  async countProductsWithoutCost(consultantId: number): Promise<number> {
    const db = await this.getDb();
    const [row] = await db
      .select({ value: count() })
      .from(productStock)
      .where(and(eq(productStock.consultantId, consultantId), isNull(productStock.costPrice), gt(productStock.unidades, 0)));
    return row?.value ?? 0;
  }

  async setProductStockReminder(consultantId: number, productId: number, remindAt: string | null): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, remindStockAt: remindAt })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: { remindStockAt: remindAt },
      })
      .returning();
    return withStockDefaults(product, stock, await this.getDefaultThreshold(db, consultantId));
  }

  async listGlobalProducts(): Promise<ProductRow[]> {
    const db = await this.getDb();
    return db
      .select()
      .from(products)
      .where(isNull(products.consultantId))
      .orderBy(products.seccion, products.linea, products.producto);
  }

  async setProductImage(productId: number, imagen: string | null): Promise<SetProductImageResult> {
    const db = await this.getDb();
    return db.transaction(async (tx) => {
      // FOR UPDATE: si dos requests tocan la imagen del mismo producto a la vez (dos filas
      // de una carga masiva apuntando al mismo id, o un reemplazo superpuesto con un borrado),
      // el segundo espera acá y lee el valor que dejó el primero — nunca una foto stale.
      const [current] = await tx
        .select({ imagen: products.imagen })
        .from(products)
        .where(and(eq(products.id, productId), isNull(products.consultantId)))
        .for("update");
      if (!current) return { product: undefined, previousImage: null };

      const [updated] = await tx
        .update(products)
        .set({ imagen })
        .where(and(eq(products.id, productId), isNull(products.consultantId)))
        .returning();
      return { product: updated, previousImage: current.imagen };
    });
  }

  async getUpcomingAppointments(consultantId: number, limit = 10): Promise<Appointment[]> {
    const db = await this.getDb();
    const now = new Date();
    const nowDate = toDateStr(now);
    const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    return db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.consultantId, consultantId),
          or(gt(appointments.date, nowDate), and(eq(appointments.date, nowDate), gte(appointments.time, nowTime))),
          inArray(appointments.status, UPCOMING_APPOINTMENT_STATUSES),
        ),
      )
      .orderBy(asc(appointments.date), asc(appointments.time))
      .limit(limit);
  }

  async getAppointmentsInRange(consultantId: number, start: string, end: string): Promise<Appointment[]> {
    const db = await this.getDb();
    return db
      .select()
      .from(appointments)
      .where(and(eq(appointments.consultantId, consultantId), gte(appointments.date, start), lt(appointments.date, end)))
      .orderBy(asc(appointments.date), asc(appointments.time));
  }

  async getAppointmentCustomTypes(consultantId: number): Promise<string[]> {
    const db = await this.getDb();
    const knownValues = KNOWN_EVENT_TYPES.map((t) => t.value);
    const rows = await db
      .selectDistinct({ type: appointments.type })
      .from(appointments)
      .where(and(eq(appointments.consultantId, consultantId), notInArray(appointments.type, knownValues)));
    return rows.map((r) => r.type).sort((a, b) => a.localeCompare(b));
  }

  /** Si el tipo mandado ya es uno fijo/legacy, se usa tal cual. Si no, es un tipo personalizado
   * nuevo o reusado: se resuelve contra los que ya existen para no crear casi-duplicados. */
  private async resolveEventType(consultantId: number, rawType: string): Promise<string> {
    if (isKnownEventType(rawType)) return rawType;
    const existingCustomTypes = await this.getAppointmentCustomTypes(consultantId);
    return normalizeCustomEventTypeName(rawType, existingCustomTypes);
  }

  /** Etapa 7.5: choque EXACTO de horario (mismo consultantId+date+time, turno activo — no
   * cancelado). El modelo actual no tiene campo de fin/duración en ningún lado de la app, así
   * que "conflicto" acá es punto-a-punto, no solapamiento de intervalos. Este SELECT es solo
   * la respuesta rápida/amigable para el caso común (secuencial) — la garantía real contra la
   * carrera concurrente la da `appointments_consultant_active_slot_unique_idx` (constraint de
   * Postgres), verificada más abajo capturando el 23505. `excludeId` se usa en updateAppointment
   * para no detectarse a sí mismo. */
  private async findConflictingAppointment(
    db: Database,
    consultantId: number,
    date: string,
    time: string,
    excludeId?: number,
  ) {
    const [conflict] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.consultantId, consultantId),
          eq(appointments.date, date),
          eq(appointments.time, time),
          ne(appointments.status, "cancelada"),
          excludeId !== undefined ? ne(appointments.id, excludeId) : undefined,
        ),
      );
    return conflict;
  }

  async createAppointment(consultantId: number, input: CreateAppointmentInput): Promise<Appointment | undefined> {
    const db = await this.getDb();
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.consultantId, consultantId)));
    if (!client) return undefined;
    const clientName = client.name ?? client.phone;
    const type = await this.resolveEventType(consultantId, input.type);

    if (await this.findConflictingAppointment(db, consultantId, input.date, input.time)) {
      throw new AppointmentConflictError("Ya existe un turno en ese horario");
    }

    try {
      const [appointment] = await db
        .insert(appointments)
        .values({
          consultantId,
          clientId: client.id,
          clientName,
          date: input.date,
          time: input.time,
          type,
          location: input.location ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return appointment;
    } catch (err) {
      // Última línea de defensa contra la carrera real (dos creaciones concurrentes que
      // pasaron el SELECT de arriba las dos, ninguna vio a la otra porque ninguna había
      // comiteado todavía) — el índice único parcial deja pasar solo una.
      if (isUniqueViolationOn(err, "appointments_consultant_active_slot_unique_idx")) {
        throw new AppointmentConflictError("Ya existe un turno en ese horario");
      }
      throw err;
    }
  }

  async updateAppointment(consultantId: number, id: number, input: UpdateAppointmentInput): Promise<Appointment | undefined> {
    const db = await this.getDb();
    const [existing] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.consultantId, consultantId)));
    if (!existing) return undefined;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.consultantId, consultantId)));
    if (!client) throw new AppointmentValidationError("Clienta no encontrada");
    const clientName = client.name ?? client.phone;
    const type = input.type === existing.type ? existing.type : await this.resolveEventType(consultantId, input.type);

    if (await this.findConflictingAppointment(db, consultantId, input.date, input.time, id)) {
      throw new AppointmentConflictError("Ya existe un turno en ese horario");
    }

    try {
      const [updated] = await db
        .update(appointments)
        .set({
          clientId: client.id,
          clientName,
          date: input.date,
          time: input.time,
          type,
          location: input.location ?? null,
          notes: input.notes ?? null,
        })
        .where(and(eq(appointments.id, id), eq(appointments.consultantId, consultantId)))
        .returning();
      return updated;
    } catch (err) {
      if (isUniqueViolationOn(err, "appointments_consultant_active_slot_unique_idx")) {
        throw new AppointmentConflictError("Ya existe un turno en ese horario");
      }
      throw err;
    }
  }

  async updateAppointmentStatus(consultantId: number, id: number, status: AppointmentStatus): Promise<Appointment | undefined> {
    const db = await this.getDb();
    const [updated] = await db
      .update(appointments)
      .set({ status })
      .where(and(eq(appointments.id, id), eq(appointments.consultantId, consultantId)))
      .returning();
    return updated;
  }

  async deleteAppointment(consultantId: number, id: number): Promise<boolean> {
    const db = await this.getDb();
    const [deleted] = await db
      .delete(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.consultantId, consultantId)))
      .returning();
    return !!deleted;
  }

  async getTopClients(consultantId: number, limit = 5, start?: string, end?: string): Promise<TopClient[]> {
    const db = await this.getDb();
    const range = start && end ? { monthStart: start, monthEnd: end } : getCurrentMonthRange();

    const salesAgg = await db
      .select({
        clientId: sales.clientId,
        clientName: sales.clientName,
        purchaseCount: count(sales.id),
        totalAmount: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.consultantId, consultantId),
          gte(sales.date, range.monthStart),
          lt(sales.date, range.monthEnd),
          isNotNull(sales.clientId),
          ne(sales.status, "cancelada"),
        ),
      )
      .groupBy(sales.clientId, sales.clientName)
      .orderBy(desc(sql`sum(${sales.total})`))
      .limit(limit);

    if (salesAgg.length === 0) return [];

    const clientIds = salesAgg
      .map((row) => row.clientId)
      .filter((id): id is number => id !== null);

    const itemsAgg = clientIds.length
      ? await db
          .select({
            clientId: sales.clientId,
            productCount: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
          })
          .from(saleItems)
          .innerJoin(sales, eq(saleItems.saleId, sales.id))
          .where(and(eq(sales.consultantId, consultantId), inArray(sales.clientId, clientIds), ne(sales.status, "cancelada")))
          .groupBy(sales.clientId)
      : [];

    const productCountByClient = new Map(itemsAgg.map((row) => [row.clientId, Number(row.productCount)]));

    return salesAgg.map((row) => ({
      clientId: row.clientId as number,
      clientName: row.clientName,
      purchaseCount: Number(row.purchaseCount),
      totalAmount: Number(row.totalAmount),
      productCount: productCountByClient.get(row.clientId) ?? 0,
    }));
  }

  async getClientById(consultantId: number, id: number): Promise<Client | undefined> {
    const db = await this.getDb();
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.consultantId, consultantId)));
    return client;
  }

  /** Compartido por searchClients (combobox, truncado) y searchClientsPaginated (listado
   * real) — dos queries agregadas separadas (nunca un JOIN sales+saleInstallments directo,
   * que produciría un fan-out y falsearía las sumas) unidas en JS por clientId. */
  private async computeClientStats(
    consultantId: number,
    clientIds: number[],
  ): Promise<{
    statsByClient: Map<number | null, { totalAmount: number; lastDate: string | null }>;
    balanceByClient: Map<number | null, number>;
  }> {
    const db = await this.getDb();
    if (clientIds.length === 0) {
      return { statsByClient: new Map(), balanceByClient: new Map() };
    }

    const statsRows = await db
      .select({
        clientId: sales.clientId,
        totalAmount: sql<number>`coalesce(sum(${sales.total}), 0)`,
        lastDate: sql<string | null>`max(${sales.date})`,
      })
      .from(sales)
      .where(and(eq(sales.consultantId, consultantId), inArray(sales.clientId, clientIds), ne(sales.status, "cancelada")))
      .groupBy(sales.clientId);

    const statsByClient = new Map(statsRows.map((s) => [s.clientId, s]));

    // Misma condición que getPendingInstallments (cuota "pendiente" de una venta no cancelada),
    // acá agregada por clienta en vez de listada por cuota individual.
    const balanceRows = await db
      .select({
        clientId: sales.clientId,
        pendingBalance: sql<number>`coalesce(sum(${saleInstallments.amount}), 0)`,
      })
      .from(saleInstallments)
      .innerJoin(sales, eq(saleInstallments.saleId, sales.id))
      .where(
        and(
          eq(sales.consultantId, consultantId),
          inArray(sales.clientId, clientIds),
          eq(saleInstallments.status, "pendiente"),
          ne(sales.status, "cancelada"),
        ),
      )
      .groupBy(sales.clientId);

    const balanceByClient = new Map(balanceRows.map((b) => [b.clientId, Number(b.pendingBalance)]));

    return { statsByClient, balanceByClient };
  }

  async searchClients(consultantId: number, query = "", limit = 20): Promise<ClientWithStats[]> {
    const db = await this.getDb();
    const term = query.trim();

    const rows = term
      ? await db
          .select()
          .from(clients)
          .where(
            and(
              eq(clients.consultantId, consultantId),
              or(
                ilike(clients.name, `%${term}%`),
                ilike(clients.phone, `%${term}%`),
                ilike(clients.email, `%${term}%`),
                ilike(clients.address, `%${term}%`),
                ilike(clients.notes, `%${term}%`),
              ),
            ),
          )
          .orderBy(asc(clients.name), asc(clients.id))
          .limit(limit)
      : await db
          .select()
          .from(clients)
          .where(eq(clients.consultantId, consultantId))
          .orderBy(asc(clients.name), asc(clients.id))
          .limit(limit);

    if (rows.length === 0) return [];

    const { statsByClient, balanceByClient } = await this.computeClientStats(consultantId, rows.map((r) => r.id));

    return rows.map((row) => ({
      ...row,
      totalPurchases: Number(statsByClient.get(row.id)?.totalAmount ?? 0),
      lastPurchase: statsByClient.get(row.id)?.lastDate ?? null,
      pendingBalance: balanceByClient.get(row.id) ?? 0,
    }));
  }

  /** Listado real de Clientas (Etapa 7.1 — cierra el P1 de la auditoría: antes truncaba
   * silenciosamente a 100 filas sin ORDER BY determinístico). A diferencia de searchClients
   * (pensado para combobox chicos, trunca en SQL con LIMIT), acá el orden/saldo/antigüedad
   * dependen de agregados que no viven en la tabla clients, así que se trae el universo
   * completo que matchea la búsqueda (siempre acotado a un único consultantId, nunca global),
   * se filtra/ordena/pagina en memoria, y recién ahí se corta a la página pedida. Para el
   * volumen real de una consultora (cientos, no millones) esto es simple y correcto; no vale
   * la pena la complejidad de un HAVING con sub-selects para este caso de uso. */
  async searchClientsPaginated(consultantId: number, params: SearchClientsPaginatedParams): Promise<PaginatedClients> {
    const db = await this.getDb();
    const term = (params.query ?? "").trim();
    const page = Number.isFinite(params.page) && params.page >= 1 ? Math.floor(params.page) : 1;
    const pageSize = Number.isFinite(params.pageSize)
      ? Math.min(Math.max(Math.floor(params.pageSize), 1), MAX_CLIENTS_PAGE_SIZE)
      : MAX_CLIENTS_PAGE_SIZE;
    const balanceFilter: BalanceFilter = params.balanceFilter ?? "todas";
    const staleFilter: StaleFilter = params.staleFilter ?? "todas";

    const matched = term
      ? await db
          .select()
          .from(clients)
          .where(
            and(
              eq(clients.consultantId, consultantId),
              or(
                ilike(clients.name, `%${term}%`),
                ilike(clients.phone, `%${term}%`),
                ilike(clients.email, `%${term}%`),
                ilike(clients.address, `%${term}%`),
                ilike(clients.notes, `%${term}%`),
              ),
            ),
          )
      : await db.select().from(clients).where(eq(clients.consultantId, consultantId));

    if (matched.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0, totalRevenue: 0 };
    }

    const { statsByClient, balanceByClient } = await this.computeClientStats(consultantId, matched.map((r) => r.id));

    let withStats: ClientWithStats[] = matched.map((row) => ({
      ...row,
      totalPurchases: Number(statsByClient.get(row.id)?.totalAmount ?? 0),
      lastPurchase: statsByClient.get(row.id)?.lastDate ?? null,
      pendingBalance: balanceByClient.get(row.id) ?? 0,
    }));

    if (balanceFilter !== "todas") {
      withStats = withStats.filter((c) => matchesBalanceFilter(c.pendingBalance, balanceFilter));
    }

    if (staleFilter !== "todas") {
      const cutoff = toDateStr(new Date(Date.now() - STALE_THRESHOLDS[staleFilter] * 86400000));
      withStats = withStats.filter((c) => matchesStaleFilter(c.lastPurchase, staleFilter, cutoff));
    }

    // Orden estable y reproducible: mismo criterio de display que el resto de la app (nombre,
    // o teléfono si no tiene nombre cargado — ClientCard/ClientCombobox ya usan ese fallback),
    // con id como desempate para que el orden nunca dependa de un empate de nombre/hora de
    // inserción de Postgres.
    withStats.sort((a, b) => {
      const keyA = (a.name?.trim() || a.phone).toLowerCase();
      const keyB = (b.name?.trim() || b.phone).toLowerCase();
      if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      return a.id - b.id;
    });

    const total = withStats.length;
    const totalPages = Math.ceil(total / pageSize);
    const totalRevenue = withStats.reduce((sum, c) => sum + c.totalPurchases, 0);
    const start = (page - 1) * pageSize;
    const items = withStats.slice(start, start + pageSize);

    return { items, total, page, pageSize, totalPages, totalRevenue };
  }

  async createClient(consultantId: number, input: InsertClient): Promise<Client> {
    const db = await this.getDb();
    const [client] = await db.insert(clients).values({ ...input, consultantId }).returning();
    return client;
  }

  async updateClient(consultantId: number, id: number, input: Partial<InsertClient>): Promise<Client | undefined> {
    const db = await this.getDb();
    const [updated] = await db
      .update(clients)
      .set(input)
      .where(and(eq(clients.id, id), eq(clients.consultantId, consultantId)))
      .returning();
    return updated;
  }

  async findDuplicateClient(consultantId: number, phone: string, email: string | null, excludeId?: number): Promise<Client | undefined> {
    const db = await this.getDb();
    const matchCondition = email ? or(eq(clients.phone, phone), ilike(clients.email, email)) : eq(clients.phone, phone);
    const conditions = [eq(clients.consultantId, consultantId), matchCondition];
    if (excludeId !== undefined) conditions.push(ne(clients.id, excludeId));
    const [existing] = await db
      .select()
      .from(clients)
      .where(and(...conditions))
      .limit(1);
    return existing;
  }

  /**
   * No borra si hay ventas o citas asociadas (integridad referencial). No es un chequeo redundante
   * con "cuotas pendientes": una cuota siempre pertenece a una venta, así que bloquear por venta ya
   * cubre ese caso — no hace falta una tercera consulta separada para cuotas.
   */
  async deleteClient(consultantId: number, id: number): Promise<"deleted" | "not_found" | "has_relations"> {
    const db = await this.getDb();
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.consultantId, consultantId)));
    if (!client) return "not_found";

    const [saleCount] = await db.select({ value: count() }).from(sales).where(eq(sales.clientId, id));
    if ((saleCount?.value ?? 0) > 0) return "has_relations";

    const [appointmentCount] = await db.select({ value: count() }).from(appointments).where(eq(appointments.clientId, id));
    if ((appointmentCount?.value ?? 0) > 0) return "has_relations";

    await db.delete(clients).where(and(eq(clients.id, id), eq(clients.consultantId, consultantId)));
    return "deleted";
  }

  async getSalesByClient(consultantId: number, clientId: number, limit = 100): Promise<SaleWithDetails[]> {
    const db = await this.getDb();
    const clientSales = await db
      .select()
      .from(sales)
      .where(and(eq(sales.clientId, clientId), eq(sales.consultantId, consultantId)))
      .orderBy(desc(sales.date), desc(sales.id))
      .limit(limit);
    if (clientSales.length === 0) return [];

    const saleIds = clientSales.map((s) => s.id);
    const items = await db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds));
    const installments = await db
      .select()
      .from(saleInstallments)
      .where(inArray(saleInstallments.saleId, saleIds))
      .orderBy(asc(saleInstallments.installmentNumber));

    const itemsBySale = new Map<number, SaleItem[]>();
    for (const item of items) {
      const arr = itemsBySale.get(item.saleId) ?? [];
      arr.push(item);
      itemsBySale.set(item.saleId, arr);
    }
    const installmentsBySale = new Map<number, SaleInstallment[]>();
    for (const inst of installments) {
      const arr = installmentsBySale.get(inst.saleId) ?? [];
      arr.push(inst);
      installmentsBySale.set(inst.saleId, arr);
    }

    return clientSales.map((s) => ({
      ...s,
      items: itemsBySale.get(s.id) ?? [],
      installments: installmentsBySale.get(s.id) ?? [],
    }));
  }

  async getAppointmentsByClient(consultantId: number, clientId: number, limit = 100): Promise<Appointment[]> {
    const db = await this.getDb();
    return db
      .select()
      .from(appointments)
      .where(and(eq(appointments.clientId, clientId), eq(appointments.consultantId, consultantId)))
      .orderBy(desc(appointments.date), desc(appointments.time))
      .limit(limit);
  }

  async getTopProductsByCategory(
    consultantId: number,
    category?: string,
    limit?: number,
    start?: string,
    end?: string,
    order: "asc" | "desc" = "desc",
  ): Promise<TopProductByCategory[]> {
    const db = await this.getDb();

    const conditions = [eq(sales.consultantId, consultantId), ne(sales.status, "cancelada")];
    if (category) conditions.push(eq(saleItems.category, category));
    if (start) conditions.push(gte(sales.date, start));
    if (end) conditions.push(lt(sales.date, end));

    const orderFn = order === "asc" ? asc : desc;

    const query = db
      .select({
        productId: saleItems.productId,
        productName: saleItems.productName,
        category: saleItems.category,
        quantitySold: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
        totalSales: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.price}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(saleItems.productId, saleItems.productName, saleItems.category)
      .orderBy(orderFn(sql`sum(${saleItems.quantity})`));

    const rows = limit ? await query.limit(limit) : await query;

    const productIds = rows.map((r) => r.productId).filter((id): id is number => id !== null);
    const imagesById = new Map<number, string | null>();
    if (productIds.length > 0) {
      const imgs = await db
        .select({ id: products.id, imagen: products.imagen })
        .from(products)
        .where(inArray(products.id, productIds));
      imgs.forEach((p) => imagesById.set(p.id, p.imagen));
    }

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      category: row.category,
      imagen: row.productId !== null ? imagesById.get(row.productId) ?? null : null,
      quantitySold: Number(row.quantitySold),
      totalSales: Number(row.totalSales),
    }));
  }

  async getSalesSummary(consultantId: number, start: string, end: string, groupBy: ReportGroupBy = "day"): Promise<SalesSummaryPoint[]> {
    const db = await this.getDb();

    const periodExpr =
      groupBy === "month"
        ? sql<string>`substring(${sales.date}, 1, 7)`
        : groupBy === "week"
          ? sql<string>`to_char(date_trunc('week', ${sales.date}::date), 'YYYY-MM-DD')`
          : sql<string>`${sales.date}`;

    const rows = await db
      .select({
        period: periodExpr,
        totalSales: sql<number>`coalesce(sum(${sales.total}), 0)`,
        totalProfit: sql<number>`coalesce(sum(${sales.profit}), 0)`,
        salesCount: count(sales.id),
      })
      .from(sales)
      .where(and(eq(sales.consultantId, consultantId), gte(sales.date, start), lt(sales.date, end), ne(sales.status, "cancelada")))
      .groupBy(periodExpr)
      .orderBy(asc(periodExpr));

    return rows.map((row) => {
      const salesCount = Number(row.salesCount);
      const totalSales = Number(row.totalSales);
      return {
        period: row.period,
        totalSales,
        totalProfit: Number(row.totalProfit),
        salesCount,
        avgTicket: salesCount > 0 ? Math.round(totalSales / salesCount) : 0,
      };
    });
  }

  async getTopCategories(consultantId: number, start?: string, end?: string): Promise<TopCategory[]> {
    const db = await this.getDb();
    const conditions = [eq(sales.consultantId, consultantId), ne(sales.status, "cancelada")];
    if (start) conditions.push(gte(sales.date, start));
    if (end) conditions.push(lt(sales.date, end));

    const rows = await db
      .select({
        category: saleItems.category,
        quantitySold: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
        totalSales: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.price}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(and(...conditions))
      .groupBy(saleItems.category)
      .orderBy(desc(sql`sum(${saleItems.quantity})`));

    return rows.map((row) => ({
      category: row.category,
      quantitySold: Number(row.quantitySold),
      totalSales: Number(row.totalSales),
    }));
  }

  async getSalesByPaymentMethod(consultantId: number, start?: string, end?: string): Promise<PaymentMethodBreakdown[]> {
    const db = await this.getDb();
    const conditions = [eq(sales.consultantId, consultantId), ne(sales.status, "cancelada")];
    if (start) conditions.push(gte(sales.date, start));
    if (end) conditions.push(lt(sales.date, end));

    const rows = await db
      .select({
        paymentMethod: sales.paymentMethod,
        salesCount: count(sales.id),
        totalSales: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(sales)
      .where(and(...conditions))
      .groupBy(sales.paymentMethod)
      .orderBy(desc(sql`sum(${sales.total})`));

    return rows.map((row) => ({
      paymentMethod: row.paymentMethod,
      salesCount: Number(row.salesCount),
      totalSales: Number(row.totalSales),
    }));
  }

  async getInstallmentsBreakdown(consultantId: number, start?: string, end?: string): Promise<InstallmentsBreakdown> {
    const db = await this.getDb();
    const conditions = [eq(sales.consultantId, consultantId), ne(sales.status, "cancelada")];
    if (start) conditions.push(gte(sales.date, start));
    if (end) conditions.push(lt(sales.date, end));

    const rows = await db
      .select({
        isFinanced: sql<boolean>`${sales.installmentsCount} > 1`,
        salesCount: count(sales.id),
        totalSales: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(sales)
      .where(and(...conditions))
      .groupBy(sql`${sales.installmentsCount} > 1`);

    const single = rows.find((r) => !r.isFinanced);
    const financed = rows.find((r) => r.isFinanced);

    return {
      singlePayment: { salesCount: Number(single?.salesCount ?? 0), totalSales: Number(single?.totalSales ?? 0) },
      financed: { salesCount: Number(financed?.salesCount ?? 0), totalSales: Number(financed?.totalSales ?? 0) },
    };
  }

  async getStockValuation(consultantId: number): Promise<StockValuation> {
    const db = await this.getDb();
    // Prompt 2: nunca el precio de venta como costo — un producto sin costPrice se estima con
    // el descuento de compra habitual, igual que al vender (ver resolveLineCost).
    const habitualDiscountPercent = await this.resolveHabitualDiscountPercent(consultantId);
    const [row] = await db
      .select({
        valueAtCost: sql<number>`coalesce(sum(${productStock.unidades} * coalesce(${productStock.costPrice}, round(${products.precio} * (1 - ${habitualDiscountPercent} / 100.0)))), 0)`,
        // Prompt 4: "A precio de venta" respeta el precio propio de la consultora cuando existe
        // (nunca el costo, que siempre parte de products.precio — ver valueAtCost arriba).
        valueAtPrice: sql<number>`coalesce(sum(${productStock.unidades} * coalesce(${productStock.priceOverride}, ${products.precio})), 0)`,
        productCount: count(products.id),
        unitCount: sql<number>`coalesce(sum(${productStock.unidades}), 0)`,
        hasEstimatedCost: sql<boolean>`coalesce(bool_or(${productStock.costPrice} is null and ${productStock.unidades} > 0), false)`,
      })
      .from(productStock)
      .innerJoin(products, eq(products.id, productStock.productId))
      .where(eq(productStock.consultantId, consultantId));

    const valueAtCost = Number(row?.valueAtCost ?? 0);
    const valueAtPrice = Number(row?.valueAtPrice ?? 0);
    return {
      valueAtCost,
      valueAtPrice,
      potentialProfit: valueAtPrice - valueAtCost,
      productCount: Number(row?.productCount ?? 0),
      unitCount: Number(row?.unitCount ?? 0),
      hasEstimatedCost: row?.hasEstimatedCost ?? false,
    };
  }

  async getInactiveClients(consultantId: number, days: number): Promise<InactiveClient[]> {
    const db = await this.getDb();
    const cutoff = toDateStr(new Date(Date.now() - days * 86400000));
    const today = new Date();

    const rows = await db
      .select({
        id: clients.id,
        name: clients.name,
        phone: clients.phone,
        lastPurchase: sql<string | null>`max(${sales.date})`,
        totalPurchased: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(clients)
      .leftJoin(sales, and(eq(sales.clientId, clients.id), ne(sales.status, "cancelada")))
      .where(eq(clients.consultantId, consultantId))
      .groupBy(clients.id, clients.name, clients.phone)
      .having(sql`max(${sales.date}) is null or max(${sales.date}) < ${cutoff}`)
      .orderBy(sql`max(${sales.date}) asc nulls first`);

    return rows.map((row) => ({
      clientId: row.id,
      name: row.name,
      phone: row.phone,
      lastPurchase: row.lastPurchase,
      daysSinceLastPurchase: row.lastPurchase ? daysBetween(parseDateStr(row.lastPurchase), today) : null,
      totalPurchased: Number(row.totalPurchased),
    }));
  }

  async getUpcomingBirthdays(consultantId: number, days: number): Promise<UpcomingBirthday[]> {
    const db = await this.getDb();
    const rows = await db
      .select({ id: clients.id, name: clients.name, phone: clients.phone, birthday: clients.birthday })
      .from(clients)
      .where(and(eq(clients.consultantId, consultantId), isNotNull(clients.birthday)));

    const today = new Date();
    return rows
      .map((row) => ({
        clientId: row.id,
        name: row.name,
        phone: row.phone,
        birthday: row.birthday as string,
        daysUntil: daysUntilNextBirthday(row.birthday as string, today),
      }))
      .filter((r) => r.daysUntil <= days)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }

  async getAppointmentsSummary(consultantId: number, start: string, end: string): Promise<AppointmentsSummary> {
    const db = await this.getDb();
    const rows = await db
      .select({ status: appointments.status, salesCount: count(appointments.id) })
      .from(appointments)
      .where(and(eq(appointments.consultantId, consultantId), gte(appointments.date, start), lt(appointments.date, end)))
      .groupBy(appointments.status);

    const result: Record<string, number> = { pendiente: 0, confirmada: 0, completada: 0, cancelada: 0 };
    for (const row of rows) {
      if (row.status in result) {
        result[row.status] = Number(row.salesCount);
      }
    }
    return result as unknown as AppointmentsSummary;
  }

  async getPendingInstallments(consultantId: number, limit = 20): Promise<PendingInstallmentRow[]> {
    const db = await this.getDb();
    const today = toDateStr(new Date());

    const rows = await db
      .select({
        saleId: saleInstallments.saleId,
        clientName: sales.clientName,
        installmentNumber: saleInstallments.installmentNumber,
        amount: saleInstallments.amount,
        dueDate: saleInstallments.dueDate,
      })
      .from(saleInstallments)
      .innerJoin(sales, eq(saleInstallments.saleId, sales.id))
      .where(and(eq(sales.consultantId, consultantId), eq(saleInstallments.status, "pendiente"), ne(sales.status, "cancelada")))
      .orderBy(asc(saleInstallments.dueDate))
      .limit(limit);

    return rows.map((row) => ({ ...row, isOverdue: row.dueDate < today }));
  }

  /** Etapa 7.8 — COGS agregado del período: Σ(quantity × costPrice), igual criterio de join +
   * exclusión de canceladas que getTopCategories/getTopProductsByCategory. `sum()` de Postgres
   * ignora NULL automáticamente, así que `productCost` ya es "solo líneas con costo conocido"
   * sin necesitar un filtro aparte — el flag de abajo es lo único que hace falta calcular extra. */
  async getProductCostSummary(consultantId: number, start?: string, end?: string): Promise<ProductCostSummary> {
    const db = await this.getDb();
    const conditions = [eq(sales.consultantId, consultantId), ne(sales.status, "cancelada")];
    if (start) conditions.push(gte(sales.date, start));
    if (end) conditions.push(lt(sales.date, end));

    const [row] = await db
      .select({
        productCost: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.costPrice}), 0)`,
        // Prompt 2: desde que costPrice nunca más queda null en ventas nuevas (siempre real o
        // estimado), "costo incompleto" pasa a incluir también las líneas marcadas estimadas
        // — no solo las legacy sin costPrice. Ambas producen el mismo "≈" en pantalla.
        incompleteCostLines: sql<number>`count(*) filter (where ${saleItems.costPrice} is null or ${saleItems.costIsEstimated} = true)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(and(...conditions));

    return {
      productCost: Number(row?.productCost ?? 0),
      hasIncompleteCostData: Number(row?.incompleteCostLines ?? 0) > 0,
    };
  }

  /** Etapa 7.8 — ver doc de CollectedPayments: acumulado a hoy, nunca filtrado por período. */
  async getCollectedPayments(consultantId: number): Promise<CollectedPayments> {
    const db = await this.getDb();
    const [row] = await db
      .select({ totalCollected: sql<number>`coalesce(sum(${saleInstallments.amount}), 0)` })
      .from(saleInstallments)
      .innerJoin(sales, eq(saleInstallments.saleId, sales.id))
      .where(and(eq(sales.consultantId, consultantId), eq(saleInstallments.status, "pagado"), ne(sales.status, "cancelada")));

    return { totalCollected: Number(row?.totalCollected ?? 0) };
  }

  /** Etapa 7.8 — totales reales (no capados por `limit` como getPendingInstallments). */
  async getPendingInstallmentsTotals(consultantId: number): Promise<PendingInstallmentsTotals> {
    const db = await this.getDb();
    const today = toDateStr(new Date());

    const [row] = await db
      .select({
        totalAmount: sql<number>`coalesce(sum(${saleInstallments.amount}), 0)`,
        totalCount: count(saleInstallments.id),
        overdueAmount: sql<number>`coalesce(sum(${saleInstallments.amount}) filter (where ${saleInstallments.dueDate} < ${today}), 0)`,
        overdueCount: sql<number>`coalesce(count(*) filter (where ${saleInstallments.dueDate} < ${today}), 0)`,
      })
      .from(saleInstallments)
      .innerJoin(sales, eq(saleInstallments.saleId, sales.id))
      .where(and(eq(sales.consultantId, consultantId), eq(saleInstallments.status, "pendiente"), ne(sales.status, "cancelada")));

    return {
      totalPendingAmount: Number(row?.totalAmount ?? 0),
      totalPendingCount: Number(row?.totalCount ?? 0),
      overdueAmount: Number(row?.overdueAmount ?? 0),
      overdueCount: Number(row?.overdueCount ?? 0),
    };
  }

  async getAllSales(consultantId: number): Promise<SaleWithItemCount[]> {
    const db = await this.getDb();
    const salesRows = await db.select().from(sales).where(eq(sales.consultantId, consultantId)).orderBy(desc(sales.date), desc(sales.id));
    if (salesRows.length === 0) return [];

    const saleIds = salesRows.map((s) => s.id);
    const counts = await db
      .select({
        saleId: saleItems.saleId,
        itemCount: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
        // Prompt 2: "≈" en la lista cuando alguna línea es estimada, o cuando es tan vieja que
        // ni siquiera tiene costPrice (misma incertidumbre, mismo símbolo).
        hasEstimatedCost: sql<boolean>`coalesce(bool_or(${saleItems.costIsEstimated} = true or ${saleItems.costPrice} is null), false)`,
      })
      .from(saleItems)
      .where(inArray(saleItems.saleId, saleIds))
      .groupBy(saleItems.saleId);
    const countsBySale = new Map(counts.map((c) => [c.saleId, c]));

    // Prompt 6: agregado de cuotas pendientes — mismo patrón que arriba (un solo query extra,
    // nunca un fetch por venta).
    const pendingAgg = await db
      .select({
        saleId: saleInstallments.saleId,
        pendingAmount: sql<number>`coalesce(sum(case when ${saleInstallments.status} = 'pendiente' then ${saleInstallments.amount} else 0 end), 0)`,
        nextDueDate: sql<string | null>`min(case when ${saleInstallments.status} = 'pendiente' then ${saleInstallments.dueDate} end)`,
      })
      .from(saleInstallments)
      .where(inArray(saleInstallments.saleId, saleIds))
      .groupBy(saleInstallments.saleId);
    const pendingBySale = new Map(pendingAgg.map((p) => [p.saleId, p]));

    return salesRows.map((s) => {
      // Una venta cancelada no le debe nada a nadie — mismo criterio que
      // getCollectedPayments/getPendingInstallmentsTotals, que ya excluyen "cancelada" de
      // cualquier total pendiente/cobrado real.
      const pendingAmount = s.status === "cancelada" ? 0 : Number(pendingBySale.get(s.id)?.pendingAmount ?? 0);
      return {
        ...s,
        itemCount: countsBySale.get(s.id)?.itemCount ?? 0,
        hasEstimatedCost: countsBySale.get(s.id)?.hasEstimatedCost ?? false,
        paymentStatus: pendingAmount > 0 ? "te_debe" : "cobrada",
        pendingAmount,
        nextDueDate: s.status === "cancelada" ? null : pendingBySale.get(s.id)?.nextDueDate ?? null,
      };
    });
  }

  async getSaleDetails(consultantId: number, id: number): Promise<SaleWithDetails | undefined> {
    const db = await this.getDb();
    const [sale] = await db.select().from(sales).where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)));
    if (!sale) return undefined;

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, id));
    const installments = await db
      .select()
      .from(saleInstallments)
      .where(eq(saleInstallments.saleId, id))
      .orderBy(asc(saleInstallments.installmentNumber));

    return { ...sale, items, installments };
  }

  /** Busca una venta ya registrada con este `(consultantId, clientRequestId)` y resuelve si el
   * request actual es un reintento legítimo (devuelve la existente) o un conflicto real (409) —
   * ver Etapa I-B.6, secciones 4 y 5. `undefined` si no había ninguna venta con ese ID todavía. */
  private async resolveExistingSaleByClientRequestId(
    db: Database,
    consultantId: number,
    input: CreateSaleInput,
  ): Promise<Sale | undefined> {
    if (!input.clientRequestId) return undefined;
    const [existing] = await db
      .select()
      .from(sales)
      .where(and(eq(sales.consultantId, consultantId), eq(sales.clientRequestId, input.clientRequestId)));
    if (!existing) return undefined;

    const existingItems = await db
      .select({ productId: saleItems.productId, quantity: saleItems.quantity, price: saleItems.price })
      .from(saleItems)
      .where(eq(saleItems.saleId, existing.id));

    if (saleRequestMatchesExisting(input, existing, existingItems)) {
      return existing;
    }
    throw new SaleRequestConflictError("El clientRequestId ya fue utilizado para otra venta");
  }

  async createSale(consultantId: number, input: CreateSaleInput): Promise<Sale> {
    const db = await this.getDb();

    // Camino rápido: si este clientRequestId ya se procesó (reintento humano tras perder la
    // respuesta, doble pestaña, etc.), no hace falta abrir transacción ni tocar stock — ver
    // Etapa I-B.6. Esto NO es la garantía definitiva contra una carrera real (dos requests
    // concurrentes pueden pasar este SELECT los dos, ver más abajo el catch del INSERT), solo
    // evita el trabajo redundante en el caso, largamente más común, de un reintento secuencial.
    const earlyMatch = await this.resolveExistingSaleByClientRequestId(db, consultantId, input);
    if (earlyMatch) return earlyMatch;

    const productIds = Array.from(new Set(input.items.map((i) => i.productId)));

    // Catálogo (nombre/precio/sección): no lo toca ninguna venta concurrente, se puede leer
    // sin lock. El stock sí — se relee y se bloquea recién dentro de la transacción, más abajo.
    const catalogRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, productIds), or(isNull(products.consultantId), eq(products.consultantId, consultantId))));
    const catalogById = new Map(catalogRows.map((p) => [p.id, p]));

    // Prompt 6: clienta opcional ("Completar después") — sin input.clientId, la venta se
    // guarda con client_id NULL (la columna ya lo permite) y un nombre fijo "Sin clienta". Si
    // mandan un clientId, tiene que existir — mismo criterio que siempre.
    let client: Client | undefined;
    let clientName: string;
    if (input.clientId !== undefined) {
      [client] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.consultantId, consultantId)));
      if (!client) throw new SaleValidationError("Clienta no encontrada");
      clientName = client.name ?? client.phone;
    } else {
      clientName = "Sin clienta";
    }

    // Prompt 2: costo estimado (cuando el producto no tiene costPrice) y el % de IIBB vigente
    // se resuelven ANTES de la transacción — son lecturas de otras tablas, no de productStock,
    // así que no necesitan el mismo lock que el stock.
    const habitualDiscountPercent = await this.resolveHabitualDiscountPercent(consultantId);
    const [consultantRow] = await db
      .select({ grossIncomeTaxPercentTenths: consultants.grossIncomeTaxPercentTenths })
      .from(consultants)
      .where(eq(consultants.id, consultantId));
    const grossIncomeTaxPercentTenths = consultantRow?.grossIncomeTaxPercentTenths ?? null;

    try {
      return await db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE: bloquea las filas de stock involucradas hasta el commit. Si
      // dos ventas del mismo producto llegan a la vez, la segunda queda esperando acá y
      // recién lee (y valida) el stock ya descontado por la primera — nunca las dos ven el
      // mismo número y "pisan" la escritura de la otra (lost update).
      const stockRows = productIds.length
        ? await tx
            .select()
            .from(productStock)
            .where(and(eq(productStock.consultantId, consultantId), inArray(productStock.productId, productIds)))
            .for("update")
        : [];
      const stockByProductId = new Map(stockRows.map((s) => [s.productId, s]));

      const lines = input.items.map((item) => {
        const product = catalogById.get(item.productId);
        if (!product) throw new SaleValidationError(`Producto ${item.productId} no encontrado`);
        const stock = stockByProductId.get(item.productId);
        // Etapa 7.4: un producto discontinuado no es vendible en una venta NUEVA — se
        // comprueba con el mismo `stock` ya releído bajo el `FOR UPDATE` de arriba, nunca con
        // una consulta previa fuera de la transacción (evita la ventana de carrera entre
        // "discontinuar" y "vender" descripta en la auditoría).
        if (stock?.discontinued) {
          throw new SaleValidationError(`"${product.producto}" está discontinuado y no está disponible para nuevas ventas`);
        }
        const available = stock?.unidades ?? 0;
        if (available < item.quantity) {
          throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${available})`);
        }
        const resolvedCost = resolveLineCost({
          costPrice: stock?.costPrice ?? null,
          publicPrice: product.precio,
          habitualDiscountPercent,
        });
        return {
          product,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? product.precio,
          costPrice: resolvedCost.costPrice,
          costIsEstimated: resolvedCost.isEstimated,
          remainingAfterSale: available - item.quantity,
        };
      });

      const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
      const totals = computeSaleTotals({
        subtotal,
        orderDiscount: input.orderDiscount ?? null,
        orderSurcharge: input.orderSurcharge ?? null,
        shippingCharged: input.shippingCharged ?? null,
      });

      const installmentAmounts = input.installments.map((i) => i.amount);
      if (!installmentsSumMatches(installmentAmounts, totals.total)) {
        throw new SaleValidationError("La suma de las cuotas no coincide con el total de la venta");
      }

      // Prompt 6: sin `paidNow` (compatibilidad), se preserva el comportamiento de siempre —
      // cuota pendiente con vencimiento en la fecha de la venta. Con tarjeta `firstDueDate` no
      // se usa (buildInstallmentPlans cobra todo en una sola cuota igual).
      const paidNow = input.paidNow ?? false;
      const firstDueDate = paidNow ? null : input.firstDueDate ?? input.date;
      const installmentPlans = buildInstallmentPlans({
        amounts: installmentAmounts,
        saleDate: input.date,
        paymentMethod: input.paymentMethod,
        paidNow,
        firstDueDate,
      });
      // Prompt 6: una venta con algo pendiente de cobro necesita una clienta a quien reclamarle.
      if (client === undefined && installmentPlans.some((p) => p.status === "pendiente")) {
        throw new SaleValidationError("Para dejar una venta pendiente de cobro tenés que elegir la clienta");
      }

      // Prompt 2: costo de mercadería SIEMPRE real o explícitamente estimado — nunca más el
      // precio de venta como sustituto (costPrice ya viene resuelto de arriba, nunca null).
      const productCost = computeProductCost(lines.map((l) => ({ quantity: l.quantity, costPrice: l.costPrice })));
      const ingresosBrutosAmount = computeGrossIncomeTax(totals.total, grossIncomeTaxPercentTenths);
      const profit = computeSaleProfit({
        total: totals.total,
        productCost,
        shippingCost: input.shippingCost ?? null,
        ingresosBrutos: ingresosBrutosAmount,
      });

      // Última línea de defensa contra una carrera real (dos requests concurrentes con el
      // mismo consultantId+clientRequestId, ninguno de los dos vio al otro en el SELECT previo
      // porque ambos corrieron antes de que cualquiera hiciera commit): el UNIQUE de Postgres
      // deja pasar solo uno de los dos INSERT. El que pierde levanta acá una excepción de
      // violación de constraint — la capturamos, pero SOLO si es específicamente esta
      // constraint (nunca cualquier otro 23505), y la convertimos en una señal interna que
      // aborta esta transacción de forma controlada (no queda ninguna escritura a medias:
      // todavía no se insertó nada más, ni sale_items ni el stock). Ver Etapa I-B.6, sección 4.
      let sale: Sale;
      try {
        [sale] = await tx
          .insert(sales)
          .values({
            consultantId,
            clientId: client?.id ?? null,
            clientName,
            date: input.date,
            subtotal,
            orderDiscountType: input.orderDiscount?.type ?? null,
            orderDiscountValue: input.orderDiscount?.value ?? null,
            orderSurchargeType: input.orderSurcharge?.type ?? null,
            orderSurchargeValue: input.orderSurcharge?.value ?? null,
            shippingCharged: input.shippingCharged ?? null,
            shippingCost: input.shippingCost ?? null,
            ingresosBrutos: ingresosBrutosAmount,
            grossIncomeTaxPercentTenths,
            total: totals.total,
            profit,
            paymentMethod: input.paymentMethod,
            // Prompt 6: con tarjeta esto es solo informativo (la cuenta real con el banco) —
            // sale_installments siempre tiene una sola fila pagada en ese caso, ver abajo.
            installmentsCount: input.installments.length,
            installmentFrequency: input.installments.length > 1 ? input.installmentFrequency ?? null : null,
            // Prompt 6: único valor real que se escribe hoy en creación — "entregado"/"pagado"
            // quedaron retirados (ver comentario en shared/schema.ts).
            status: "pendiente",
            deliveryStatus: "entregada",
            notes: input.notes ?? null,
            clientRequestId: input.clientRequestId ?? null,
          })
          .returning();
      } catch (err) {
        if (input.clientRequestId && isUniqueViolationOn(err, SALE_CLIENT_REQUEST_ID_CONSTRAINT)) {
          throw new ClientRequestIdRaceLostError();
        }
        throw err;
      }

      await tx.insert(saleItems).values(
        lines.map((l) => ({
          saleId: sale.id,
          productId: l.product.id,
          productName: l.product.producto,
          category: l.product.seccion,
          quantity: l.quantity,
          originalPrice: l.product.precio,
          price: l.unitPrice,
          // Mismo costo, misma expresión, que ya usa `computeProductCost` más arriba — nunca
          // una fuente distinta para lo que se persiste vs. lo que se calculó.
          costPrice: l.costPrice,
          costIsEstimated: l.costIsEstimated,
        })),
      );

      await tx.insert(saleInstallments).values(
        installmentPlans.map((plan, index) => ({
          saleId: sale.id,
          installmentNumber: index + 1,
          amount: plan.amount,
          dueDate: plan.dueDate,
          status: plan.status,
        })),
      );

      for (const line of lines) {
        await tx
          .update(productStock)
          .set({ unidades: line.remainingAfterSale })
          .where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, line.product.id)));
      }

      return sale;
      });
    } catch (err) {
      if (err instanceof ClientRequestIdRaceLostError) {
        // Perdimos la carrera: la transacción de arriba ya hizo ROLLBACK (drizzle lo hace
        // automáticamente al propagarse una excepción desde el callback), así que no quedó
        // ninguna escritura nuestra. Para cuando llegamos acá, la otra transacción YA hizo
        // commit — Postgres solo reporta 23505 una vez que la fila conflictiva es visible, así
        // que esta relectura siempre encuentra a la ganadora, sin necesidad de reintentar.
        const winner = await this.resolveExistingSaleByClientRequestId(db, consultantId, input);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Reemplaza por completo productos/cuotas de una venta existente y recalcula todo,
   * exactamente como si se eliminara la venta y se volviera a crear con los nuevos datos,
   * pero conservando el mismo registro (para auditoría e historial).
   * Todo o nada: reutiliza el mismo `db.transaction` que ya usa `createSale`.
   */
  async updateSale(consultantId: number, id: number, input: UpdateSaleInput): Promise<Sale | undefined> {
    const db = await this.getDb();

    // Prompt 2: mismo criterio que createSale — se resuelven antes de la transacción, no
    // dependen del lock de stock.
    const habitualDiscountPercent = await this.resolveHabitualDiscountPercent(consultantId);
    const [consultantRow] = await db
      .select({ grossIncomeTaxPercentTenths: consultants.grossIncomeTaxPercentTenths })
      .from(consultants)
      .where(eq(consultants.id, consultantId));
    const grossIncomeTaxPercentTenths = consultantRow?.grossIncomeTaxPercentTenths ?? null;

    return db.transaction(async (tx) => {
      // Etapa I-B.7-C: `FOR UPDATE` acá también — mismo orden global de locks que
      // `cancelSale`/`updateInstallmentStatus` (sales siempre primero, antes de cualquier
      // recurso secundario). Sin este lock, una edición y una cancelación concurrentes podían
      // leer la venta como "pendiente" las dos, y la que terminaba después seguía escribiendo
      // sobre una venta que la otra ya había cancelado (hallazgo I-B.7-A [5-E]). Con el lock,
      // la segunda en llegar espera acá y relee el estado ya resuelto por la primera.
      const [existingSale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)))
        .for("update");
      if (!existingSale) return undefined;
      if (existingSale.status === "cancelada") {
        throw new SaleValidationError("No se puede editar una venta cancelada");
      }

      // Prompt 6 — "edición inteligente": una cuota ya cobrada se preserva tal cual (nunca se
      // borra ni se re-crea, nunca pierde su estado ni su fecha de pago). Solo se recalculan
      // las cuotas que seguían pendientes, sobre el saldo que falta después de lo ya cobrado.
      // Antes de esta etapa, cualquier cuota pagada bloqueaba la edición ENTERA (Etapa
      // I-B.7-B) — eso dejó de ser viable en la práctica: con "paga en el momento" (Prompt 6),
      // la mayoría de las ventas nuevas tienen su primera cuota pagada desde el instante de la
      // creación. `FOR UPDATE` acá, no un SELECT simple: cierra la ventana donde
      // `updateInstallmentStatus` marca una cuota "pagado" justo en el medio de esta
      // transacción — ver Etapa I-B.7-B para el detalle de esa carrera, que sigue protegida
      // igual: las cuotas pagadas (bajo este lock) nunca se tocan más abajo.
      const existingInstallments = await tx
        .select()
        .from(saleInstallments)
        .where(eq(saleInstallments.saleId, id))
        .for("update");
      const paidInstallments = existingInstallments.filter((i) => i.status === "pagado");
      const alreadyPaidAmount = paidInstallments.reduce((sum, i) => sum + i.amount, 0);

      const existingItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));

      // Etapa 7.4: un producto discontinuado que YA formaba parte de esta venta es histórico
      // válido (se puede seguir editando su cantidad, o dejarlo tal cual) — pero si la edición
      // intenta agregar por PRIMERA VEZ un producto que está discontinuado, se rechaza igual
      // que en createSale. La distinción es exactamente esta: ¿el productId ya estaba en
      // existingItems antes de esta edición, o es nuevo en `input.items`?
      const existingProductIds = new Set(
        existingItems.map((i) => i.productId).filter((pid): pid is number => pid !== null),
      );

      const involvedIds = Array.from(
        new Set([
          ...existingItems.map((i) => i.productId).filter((pid): pid is number => pid !== null),
          ...input.items.map((i) => i.productId),
        ]),
      );

      // Catálogo: sin lock, no compite por concurrencia.
      const productRows = involvedIds.length
        ? await tx
            .select()
            .from(products)
            .where(and(inArray(products.id, involvedIds), or(isNull(products.consultantId), eq(products.consultantId, consultantId))))
        : [];
      const productById = new Map(productRows.map((p) => [p.id, p]));

      // Stock: FOR UPDATE — bloquea estas filas hasta el commit, igual que en createSale,
      // para que dos ediciones/ventas concurrentes sobre el mismo producto no se pisen.
      const stockRows = involvedIds.length
        ? await tx
            .select()
            .from(productStock)
            .where(and(eq(productStock.consultantId, consultantId), inArray(productStock.productId, involvedIds)))
            .for("update")
        : [];
      const stockRowById = new Map(stockRows.map((s) => [s.productId, s]));
      const stockById = new Map(involvedIds.map((pid) => [pid, stockRowById.get(pid)?.unidades ?? 0]));

      // 1) Restaurar el stock que esta venta tenía reservado (como si se hubiera eliminado).
      for (const item of existingItems) {
        if (item.productId !== null) {
          stockById.set(item.productId, (stockById.get(item.productId) ?? 0) + item.quantity);
        }
      }

      // 2) Validar y reservar stock para la nueva composición, sobre el stock ya restaurado.
      const lines = input.items.map((item) => {
        const product = productById.get(item.productId);
        if (!product) throw new SaleValidationError(`Producto ${item.productId} no encontrado`);
        // Solo se rechaza si es un producto NUEVO en esta edición — uno que ya era parte de
        // la venta sigue siendo histórico válido aunque hoy esté discontinuado (sección 14).
        if (stockRowById.get(item.productId)?.discontinued && !existingProductIds.has(item.productId)) {
          throw new SaleValidationError(`"${product.producto}" está discontinuado y no está disponible para nuevas ventas`);
        }
        const available = stockById.get(item.productId) ?? 0;
        if (available < item.quantity) {
          throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${available})`);
        }
        stockById.set(item.productId, available - item.quantity);
        const resolvedCost = resolveLineCost({
          costPrice: stockRowById.get(item.productId)?.costPrice ?? null,
          publicPrice: product.precio,
          habitualDiscountPercent,
        });
        return {
          product,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? product.precio,
          costPrice: resolvedCost.costPrice,
          costIsEstimated: resolvedCost.isEstimated,
        };
      });

      const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
      const totals = computeSaleTotals({
        subtotal,
        orderDiscount: input.orderDiscount ?? null,
        orderSurcharge: input.orderSurcharge ?? null,
        shippingCharged: input.shippingCharged ?? null,
      });

      // Prompt 6: `input.installments` describe el SALDO que falta — no el total de la venta
      // — cuando ya se cobró algo antes de esta edición. El total nuevo nunca puede quedar
      // por debajo de lo ya cobrado (bajarlo ahí sería borrar un cobro real).
      const installmentAmounts = input.installments.map((i) => i.amount);
      const remainingTotal = totals.total - alreadyPaidAmount;
      if (remainingTotal < 0) {
        throw new SaleValidationError(`El nuevo total no puede ser menor que lo que ya se cobró (${alreadyPaidAmount})`);
      }
      if (!installmentsSumMatches(installmentAmounts, remainingTotal)) {
        throw new SaleValidationError("La suma de las cuotas no coincide con el saldo pendiente de la venta");
      }

      const paidNow = input.paidNow ?? false;
      const firstDueDate = paidNow ? null : input.firstDueDate ?? existingSale.date;
      // Solo describe las cuotas NUEVAS (el saldo pendiente) — las ya cobradas, arriba, no
      // pasan por acá nunca.
      const installmentPlans = buildInstallmentPlans({
        amounts: installmentAmounts,
        saleDate: existingSale.date,
        paymentMethod: input.paymentMethod,
        paidNow,
        firstDueDate,
      }).filter((plan) => plan.amount > 0); // saldo pendiente en $0: no hay cuota nueva que crear
      if (existingSale.clientId === null && installmentPlans.some((p) => p.status === "pendiente")) {
        throw new SaleValidationError("Para dejar una venta pendiente de cobro tenés que elegir la clienta");
      }

      // Prompt 2: misma fórmula que createSale — total autoritativo menos costo real/estimado
      // de mercadería (con costos ACTUALES de productStock, ya releídos arriba bajo el lock)
      // menos costo real de envío e Ingresos Brutos de esta edición.
      const productCost = computeProductCost(lines.map((l) => ({ quantity: l.quantity, costPrice: l.costPrice })));
      const ingresosBrutosAmount = computeGrossIncomeTax(totals.total, grossIncomeTaxPercentTenths);
      const profit = computeSaleProfit({
        total: totals.total,
        productCost,
        shippingCost: input.shippingCost ?? null,
        ingresosBrutos: ingresosBrutosAmount,
      });

      // A partir de acá ya está todo validado: recién ahora se escribe.
      for (const productId of involvedIds) {
        await tx
          .update(productStock)
          .set({ unidades: stockById.get(productId)! })
          .where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, productId)));
      }

      await tx.delete(saleItems).where(eq(saleItems.saleId, id));
      // Prompt 6: solo se borran las cuotas que seguían PENDIENTES — las ya cobradas (arriba)
      // quedan intactas, con su mismo id, status y dueDate (su fecha de pago).
      await tx.delete(saleInstallments).where(and(eq(saleInstallments.saleId, id), eq(saleInstallments.status, "pendiente")));

      await tx.insert(saleItems).values(
        lines.map((l) => ({
          saleId: id,
          productId: l.product.id,
          productName: l.product.producto,
          category: l.product.seccion,
          quantity: l.quantity,
          originalPrice: l.product.precio,
          price: l.unitPrice,
          // Costo vigente al momento de esta edición (releído de productStock bajo el mismo
          // lock, arriba) — misma fuente que computeProductCost. Una edición reemplaza la
          // composición completa, así que el snapshot viejo de la línea anterior no se
          // conserva (mismo criterio ya vigente para el resto de la fila).
          costPrice: l.costPrice,
          costIsEstimated: l.costIsEstimated,
        })),
      );

      if (installmentPlans.length > 0) {
        await tx.insert(saleInstallments).values(
          // El número sigue después de las cuotas ya cobradas (que conservan el suyo).
          installmentPlans.map((plan, index) => ({
            saleId: id,
            installmentNumber: paidInstallments.length + index + 1,
            amount: plan.amount,
            dueDate: plan.dueDate,
            status: plan.status,
          })),
        );
      }

      // Prompt 6: cuántas cuotas tiene la venta en total (ya cobradas + nuevas) — con tarjeta
      // esto es solo informativo, igual que en createSale (una sola fila real se crea arriba).
      const installmentsCount = paidInstallments.length + installmentAmounts.filter((a) => a > 0).length;

      const [updated] = await tx
        .update(sales)
        .set({
          subtotal,
          orderDiscountType: input.orderDiscount?.type ?? null,
          orderDiscountValue: input.orderDiscount?.value ?? null,
          orderSurchargeType: input.orderSurcharge?.type ?? null,
          orderSurchargeValue: input.orderSurcharge?.value ?? null,
          shippingCharged: input.shippingCharged ?? null,
          shippingCost: input.shippingCost ?? null,
          ingresosBrutos: ingresosBrutosAmount,
          grossIncomeTaxPercentTenths,
          total: totals.total,
          profit,
          paymentMethod: input.paymentMethod,
          installmentsCount,
          installmentFrequency: installmentsCount > 1 ? input.installmentFrequency ?? null : null,
          notes: input.notes ?? null,
        })
        .where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)))
        .returning();

      return updated;
    });
  }

  /**
   * No elimina la venta: la conserva para auditoría, solo cambia su estado y devuelve el
   * stock. Etapa I-B.7-C: `FOR UPDATE` sobre `sales` es el primer lock de la transacción —
   * mismo orden global que `updateSale`/`updateInstallmentStatus` (sales primero, siempre),
   * así que dos cancelaciones concurrentes sobre la misma venta se serializan ACÁ, antes de
   * que ninguna de las dos llegue a tocar `product_stock`: la segunda espera, y cuando
   * obtiene el lock ya ve `status==="cancelada"` (escrito por la primera) y rechaza sin
   * volver a restaurar stock. Sin este lock, ambas podían leer "pendiente" a la vez y las
   * dos restauraban el mismo stock (hallazgo I-B.7-A [1]). También resuelve, como efecto
   * lateral necesario, que el SELECT de `sale_items` de más abajo (que corre después de
   * adquirir este lock) nunca vea una composición a medio reemplazar por un `updateSale`
   * concurrente — ver informe de esta etapa, Paso 5/Test 3.
   */
  async cancelSale(consultantId: number, id: number): Promise<Sale | undefined> {
    const db = await this.getDb();

    return db.transaction(async (tx) => {
      const [existingSale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)))
        .for("update");
      if (!existingSale) return undefined;
      if (existingSale.status === "cancelada") {
        throw new SaleValidationError("La venta ya está cancelada");
      }

      const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
      const productIds = items.map((i) => i.productId).filter((pid): pid is number => pid !== null);
      if (productIds.length > 0) {
        const stockRows = await tx
          .select()
          .from(productStock)
          .where(and(eq(productStock.consultantId, consultantId), inArray(productStock.productId, productIds)))
          .for("update");
        const stockById = new Map(stockRows.map((s) => [s.productId, s.unidades]));
        for (const item of items) {
          if (item.productId !== null) {
            stockById.set(item.productId, (stockById.get(item.productId) ?? 0) + item.quantity);
          }
        }
        for (const productId of productIds) {
          await tx
            .update(productStock)
            .set({ unidades: stockById.get(productId)! })
            .where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, productId)));
        }
      }

      const [updated] = await tx
        .update(sales)
        .set({ status: "cancelada" })
        .where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)))
        .returning();
      return updated;
    });
  }

  /**
   * Etapa I-B.7-C: antes eran 3 statements sueltos sin transacción ni lock — una carrera real
   * con `cancelSale` podía dejar `sale.status="cancelada"` + `installment.status="pagado"` (la
   * cancelación committeaba en el medio, entre el chequeo de acá y el UPDATE final, sin que
   * esta función se enterara). Ahora todo corre dentro de una transacción con el mismo primer
   * lock que `cancelSale`/`updateSale` (`sales` `FOR UPDATE`) — mismo orden global de locks,
   * así que las tres operaciones se serializan entre sí en este punto antes de tocar nada más.
   */
  async updateInstallmentStatus(consultantId: number, saleId: number, installmentId: number, status: "pendiente" | "pagado"): Promise<SaleInstallment | undefined> {
    const db = await this.getDb();
    return db.transaction(async (tx) => {
      const [sale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, saleId), eq(sales.consultantId, consultantId)))
        .for("update");
      if (!sale) return undefined;
      if (sale.status === "cancelada") {
        throw new SaleValidationError("No se puede modificar una cuota de una venta cancelada");
      }

      const [installment] = await tx
        .select()
        .from(saleInstallments)
        .where(and(eq(saleInstallments.id, installmentId), eq(saleInstallments.saleId, saleId)));
      if (!installment) return undefined;

      const [updated] = await tx
        .update(saleInstallments)
        .set({ status })
        .where(and(eq(saleInstallments.id, installmentId), eq(saleInstallments.saleId, saleId)))
        .returning();
      return updated;
    });
  }

  async setSaleDeliveryStatus(consultantId: number, saleId: number, deliveryStatus: "entregada" | "pendiente_entrega"): Promise<Sale | undefined> {
    const db = await this.getDb();
    const [sale] = await db.select().from(sales).where(and(eq(sales.id, saleId), eq(sales.consultantId, consultantId)));
    if (!sale) return undefined;
    if (sale.status === "cancelada") {
      throw new SaleValidationError("No se puede cambiar la entrega de una venta cancelada");
    }
    const [updated] = await db
      .update(sales)
      .set({ deliveryStatus })
      .where(and(eq(sales.id, saleId), eq(sales.consultantId, consultantId)))
      .returning();
    return updated;
  }

}

export class MemoryStorage implements IStorage {
  private users: User[] = [];
  private consultants: Consultant[] = [];
  private products: ProductRow[] = [];
  private productStock: ProductStock[] = [];
  private clients: Client[] = [];
  private appointments: Appointment[] = [];
  private sales: Sale[] = [];
  private saleItems: SaleItem[] = [];
  private saleInstallments: SaleInstallment[] = [];
  private subscriptions: Subscription[] = [];
  private payments: Payment[] = [];
  private passwordResetCodes: PasswordResetCode[] = [];
  private subscriptionPriceHistory: SubscriptionPriceHistoryEntry[] = [];
  private coupons: Coupon[] = [];
  private couponRedemptions: CouponRedemption[] = [];
  private orderDiscountLog: OrderDiscountLogEntry[] = [];
  private nextOrderDiscountLogId = 1;
  private nextUserId = 1;
  private nextConsultantId = 1;
  private nextProductId = 1;
  private nextProductStockId = 1;
  private nextClientId = 1;
  private nextAppointmentId = 1;
  private nextSaleId = 1;
  private nextSaleItemId = 1;
  private nextSaleInstallmentId = 1;
  private nextSubscriptionId = 1;
  private nextPaymentId = 1;
  private nextPasswordResetCodeId = 1;
  private nextPriceHistoryId = 1;
  private nextCouponId = 1;
  private nextCouponRedemptionId = 1;

  /** Fila de stock de la consultora sobre un producto, creándola con defaults si no existe. */
  private getOrCreateStock(consultantId: number, productId: number): ProductStock {
    let stock = this.productStock.find((s) => s.consultantId === consultantId && s.productId === productId);
    if (!stock) {
      stock = {
        id: this.nextProductStockId++,
        consultantId,
        productId,
        unidades: 0,
        stockMinimo: null,
        costPrice: null,
        selectedDiscount: null,
        discontinued: false,
        remindStockAt: null,
        priceOverride: null,
      };
      this.productStock.push(stock);
    }
    return stock;
  }

  /** Producto visible para la consultora (global o manual propio) o undefined si no aplica. */
  private findVisibleProduct(consultantId: number, productId: number): ProductRow | undefined {
    return this.products.find((p) => p.id === productId && (p.consultantId === null || p.consultantId === consultantId));
  }

  /** Espejo de DatabaseStorage.resolveHabitualDiscountPercent. */
  private resolveHabitualDiscountPercentMem(consultantId: number): number {
    const since = new Date(Date.now() - HABITUAL_DISCOUNT_WINDOW_MS);
    const recent = this.orderDiscountLog.filter((e) => e.consultantId === consultantId && e.confirmedAt.getTime() >= since.getTime());
    const weighted = computeWeightedDiscountPercent(recent);
    if (weighted !== null) return weighted;
    const latestEver = this.orderDiscountLog
      .filter((e) => e.consultantId === consultantId)
      .sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime())[0];
    if (latestEver) return latestEver.discountPercent;
    return DEFAULT_HABITUAL_DISCOUNT_PERCENT;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.find((user) => user.id === id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.users.find((user) => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const hashedPassword = await bcrypt.hash(insertUser.password, BCRYPT_SALT_ROUNDS);
    const role = insertUser.role ?? "consultant";

    let consultantId = insertUser.consultantId ?? null;
    if (role === "consultant" && consultantId === null) {
      const consultant: Consultant = {
        id: this.nextConsultantId++,
        businessName: insertUser.username,
        currency: "ARS",
        monthlyGoal: null,
        defaultLowStockThreshold: null,
        email: null,
        orderReminderDay1: null,
        orderReminderDay2: null,
        grossIncomeTaxPercentTenths: null,
      };
      this.consultants.push(consultant);
      consultantId = consultant.id;

      const trialStartAt = new Date();
      const trialEndAt = new Date(trialStartAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      await this.createTrialSubscription(consultantId, trialStartAt, trialEndAt);
    }

    const user: User = {
      id: this.nextUserId++,
      username: insertUser.username,
      password: hashedPassword,
      role,
      status: insertUser.status ?? true,
      consultantId,
    };
    this.users.push(user);
    return user;
  }

  async updateUserPassword(id: number, newHash: string): Promise<void> {
    const user = this.users.find((u) => u.id === id);
    if (user) user.password = newHash;
  }

  async getConsultants(): Promise<User[]> {
    return this.users.filter((user) => user.role !== "admin");
  }

  async toggleUserStatus(id: number): Promise<ToggleUserStatusResult> {
    const user = await this.getUser(id);
    if (!user) return { outcome: "not_found" };
    if (user.role === "admin") return { outcome: "forbidden" };

    user.status = !user.status;
    return { outcome: "toggled", user };
  }

  async hasAdminAccount(): Promise<boolean> {
    return this.users.some((u) => u.role === "admin");
  }

  async getProductCount(): Promise<number> {
    return this.products.length;
  }

  async listConsultantAccounts(): Promise<Consultant[]> {
    return [...this.consultants].sort((a, b) => a.businessName.localeCompare(b.businessName));
  }

  async getBusinessSettings(consultantId: number): Promise<Consultant | undefined> {
    return this.consultants.find((c) => c.id === consultantId);
  }

  async updateBusinessSettings(consultantId: number, input: UpdateBusinessSettingsInput): Promise<Consultant | undefined> {
    const consultant = this.consultants.find((c) => c.id === consultantId);
    if (!consultant) return undefined;
    consultant.businessName = input.businessName;
    consultant.currency = input.currency;
    consultant.monthlyGoal = input.monthlyGoal ?? null;
    consultant.defaultLowStockThreshold = input.defaultLowStockThreshold ?? null;
    consultant.orderReminderDay1 = input.orderReminderDay1 ?? null;
    consultant.orderReminderDay2 = input.orderReminderDay2 ?? null;
    consultant.grossIncomeTaxPercentTenths = input.grossIncomeTaxPercentTenths ?? null;
    return consultant;
  }

  async createOrderDiscountLogEntry(consultantId: number, input: { discountPercent: number; publicValueArs: number }): Promise<OrderDiscountLogEntry> {
    const entry: OrderDiscountLogEntry = {
      id: this.nextOrderDiscountLogId++,
      consultantId,
      discountPercent: input.discountPercent,
      publicValueArs: input.publicValueArs,
      confirmedAt: new Date(),
    };
    this.orderDiscountLog.push(entry);
    return entry;
  }

  async listOrderDiscountLogSince(consultantId: number, since: Date): Promise<OrderDiscountLogEntry[]> {
    return this.orderDiscountLog.filter((e) => e.consultantId === consultantId && e.confirmedAt.getTime() >= since.getTime());
  }

  async getLatestOrderDiscountLogEntry(consultantId: number): Promise<OrderDiscountLogEntry | undefined> {
    return this.orderDiscountLog
      .filter((e) => e.consultantId === consultantId)
      .sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime())[0];
  }

  async setConsultantEmail(consultantId: number, email: string): Promise<Consultant | undefined> {
    const consultant = this.consultants.find((c) => c.id === consultantId);
    if (!consultant) return undefined;
    consultant.email = normalizeEmail(email);
    return consultant;
  }

  async registerConsultant(input: RegisterConsultantInput): Promise<{ user: User; consultant: Consultant }> {
    const normalizedEmail = normalizeEmail(input.email);
    if (this.users.some((u) => u.username === input.username)) {
      throw new DuplicateUsernameError("Ese nombre de usuario ya está en uso");
    }
    if (this.consultants.some((c) => c.email === normalizedEmail)) {
      throw new DuplicateEmailError("Ya existe una cuenta con ese email");
    }

    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    const consultant: Consultant = {
      id: this.nextConsultantId++,
      businessName: input.username,
      currency: "ARS",
      monthlyGoal: null,
      defaultLowStockThreshold: null,
      email: normalizedEmail,
      orderReminderDay1: null,
      orderReminderDay2: null,
      grossIncomeTaxPercentTenths: null,
    };
    this.consultants.push(consultant);

    const trialStartAt = new Date();
    const trialEndAt = new Date(trialStartAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await this.createTrialSubscription(consultant.id, trialStartAt, trialEndAt);

    const user: User = {
      id: this.nextUserId++,
      username: input.username,
      password: hashedPassword,
      role: "consultant",
      status: true,
      consultantId: consultant.id,
    };
    this.users.push(user);

    return { user, consultant };
  }

  async getUserByConsultantEmail(normalizedEmail: string): Promise<User | undefined> {
    const consultant = this.consultants.find((c) => c.email === normalizedEmail);
    if (!consultant) return undefined;
    return this.users.find((u) => u.consultantId === consultant.id && u.role === "consultant");
  }

  async invalidateActivePasswordResetCodes(userId: number): Promise<void> {
    const now = new Date();
    for (const code of this.passwordResetCodes) {
      if (code.userId === userId && code.usedAt === null) code.usedAt = now;
    }
  }

  async createPasswordResetCode(userId: number, codeHash: string, expiresAt: Date): Promise<PasswordResetCode> {
    const row: PasswordResetCode = {
      id: this.nextPasswordResetCodeId++,
      userId,
      codeHash,
      expiresAt,
      attempts: 0,
      usedAt: null,
      createdAt: new Date(),
    };
    this.passwordResetCodes.push(row);
    return row;
  }

  async getLatestPasswordResetCode(userId: number): Promise<PasswordResetCode | undefined> {
    return this.passwordResetCodes
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async incrementPasswordResetCodeAttempts(id: number): Promise<void> {
    const code = this.passwordResetCodes.find((c) => c.id === id);
    if (code) code.attempts += 1;
  }

  async markPasswordResetCodeUsed(id: number): Promise<void> {
    const code = this.passwordResetCodes.find((c) => c.id === id);
    if (code) code.usedAt = new Date();
  }

  async getSubscriptionByConsultantId(consultantId: number): Promise<Subscription | undefined> {
    return this.subscriptions.find((s) => s.consultantId === consultantId);
  }

  async createTrialSubscription(consultantId: number, trialStartAt: Date, trialEndAt: Date): Promise<Subscription> {
    if (this.subscriptions.some((s) => s.consultantId === consultantId)) {
      throw new Error(`Ya existe una subscription para la consultora ${consultantId}`);
    }
    const sub: Subscription = {
      id: this.nextSubscriptionId++,
      consultantId,
      status: subscriptionStatuses[0],
      trialStartAt,
      trialEndAt,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      lastPaymentId: null,
      mpPreapprovalId: null,
      mpPreapprovalCreatedAt: null,
      canceledAt: null,
      priceHistoryAppliedId: null,
    };
    this.subscriptions.push(sub);
    return sub;
  }

  async updateSubscription(consultantId: number, patch: SubscriptionUpdate): Promise<Subscription | undefined> {
    const sub = this.subscriptions.find((s) => s.consultantId === consultantId);
    if (!sub) return undefined;
    Object.assign(sub, patch);
    return sub;
  }

  async createPendingPayment(consultantId: number, input: CreatePendingPaymentInput): Promise<Payment> {
    // Sin chequeo de externalReference duplicada: no es unique en Postgres (MP-1), y
    // MemoryStorage no puede imponer una restricción que la base real no tiene.
    const payment: Payment = {
      id: this.nextPaymentId++,
      consultantId,
      externalReference: input.externalReference,
      mpPreapprovalId: input.mpPreapprovalId ?? null,
      mpPaymentId: null,
      status: paymentStatuses[0],
      amount: input.amount,
      currency: input.currency,
      periodDaysGranted: input.periodDaysGranted,
      mpStatusDetail: null,
      rawPayload: null,
      createdAt: new Date(),
      paidAt: null,
    };
    this.payments.push(payment);
    return payment;
  }

  async getPaymentByExternalReference(externalReference: string): Promise<Payment | undefined> {
    // Más reciente primero (mismo criterio que DatabaseStorage): la referencia puede repetirse.
    return this.payments
      .filter((p) => p.externalReference === externalReference)
      .sort((a, b) => b.id - a.id)[0];
  }

  async getPaymentByMpPaymentId(mpPaymentId: string): Promise<Payment | undefined> {
    return this.payments.find((p) => p.mpPaymentId === mpPaymentId);
  }

  async updatePayment(id: number, patch: PaymentUpdate): Promise<Payment | undefined> {
    const payment = this.payments.find((p) => p.id === id);
    if (!payment) return undefined;
    Object.assign(payment, patch);
    return payment;
  }

  async getPaymentsByConsultantId(consultantId: number): Promise<Payment[]> {
    return this.payments
      .filter((p) => p.consultantId === consultantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async applyApprovedPayment(consultantId: number, input: ApplyApprovedPaymentInput): Promise<ApplyApprovedPaymentResult> {
    const existing = this.payments.find((p) => p.mpPaymentId === input.mpPaymentId);
    if (existing) return { outcome: "already_processed", payment: existing };

    const sub = this.subscriptions.find((s) => s.consultantId === consultantId);
    if (!sub || sub.mpPreapprovalId !== input.mpPreapprovalId) {
      return { outcome: "preapproval_mismatch" };
    }

    const now = new Date();
    const payment: Payment = {
      id: this.nextPaymentId++,
      consultantId,
      externalReference: input.externalReference,
      mpPreapprovalId: input.mpPreapprovalId,
      mpPaymentId: input.mpPaymentId,
      status: "approved",
      amount: input.amount,
      currency: "ARS",
      periodDaysGranted: PERIOD_DAYS,
      mpStatusDetail: input.statusDetail,
      rawPayload: input.rawPayload as any,
      createdAt: now,
      paidAt: now,
    };
    this.payments.push(payment);

    sub.status = "active";
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = new Date(now.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
    sub.lastPaymentId = payment.id;

    return { outcome: "applied", payment };
  }

  async confirmCouponRedemption(consultantId: number, confirmedAt: Date): Promise<CouponRedemption | undefined> {
    const reserved = this.couponRedemptions
      .filter((r) => r.consultantId === consultantId && r.status === "reserved")
      .sort((a, b) => b.reservedAt.getTime() - a.reservedAt.getTime())[0];
    if (!reserved) return undefined;
    reserved.status = "confirmed";
    reserved.confirmedAt = confirmedAt;
    reserved.discountEndsAt = computeDiscountEndsAtInline(reserved, confirmedAt);
    return reserved;
  }

  async activateFreeSubscription(consultantId: number, input: { couponRedemptionId: number; periodDays: number }): Promise<Payment> {
    const now = new Date();
    const payment: Payment = {
      id: this.nextPaymentId++,
      consultantId,
      externalReference: `coupon-${input.couponRedemptionId}`,
      mpPreapprovalId: null,
      mpPaymentId: `coupon-free-${input.couponRedemptionId}`,
      status: "approved",
      amount: 0,
      currency: "ARS",
      periodDaysGranted: input.periodDays,
      mpStatusDetail: "coupon_100_percent_off",
      rawPayload: null,
      createdAt: now,
      paidAt: now,
    };
    this.payments.push(payment);

    const sub = this.subscriptions.find((s) => s.consultantId === consultantId);
    if (sub) {
      sub.status = "active";
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = new Date(now.getTime() + input.periodDays * 24 * 60 * 60 * 1000);
      sub.lastPaymentId = payment.id;
    }

    return payment;
  }

  async getLatestSubscriptionPriceChange(): Promise<SubscriptionPriceHistoryEntry | undefined> {
    return [...this.subscriptionPriceHistory].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0];
  }

  async getLatestDuePriceChange(now: Date): Promise<SubscriptionPriceHistoryEntry | undefined> {
    return this.subscriptionPriceHistory
      .filter((e) => e.appliesTo === "all" && e.effectiveAt !== null && e.effectiveAt.getTime() < now.getTime())
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0];
  }

  async listSubscriptionPriceHistory(): Promise<SubscriptionPriceHistoryEntry[]> {
    return [...this.subscriptionPriceHistory].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
  }

  async createSubscriptionPriceChange(input: CreatePriceChangeInput): Promise<SubscriptionPriceHistoryEntry> {
    const entry: SubscriptionPriceHistoryEntry = {
      id: this.nextPriceHistoryId++,
      oldPriceArs: input.oldPriceArs,
      newPriceArs: input.newPriceArs,
      appliesTo: input.appliesTo,
      effectiveAt: input.effectiveAt,
      changedAt: new Date(),
      changedByAdminId: input.changedByAdminId,
    };
    this.subscriptionPriceHistory.push(entry);
    return entry;
  }

  async getCouponByCode(normalizedCode: string): Promise<Coupon | undefined> {
    return this.coupons.find((c) => c.code === normalizedCode);
  }

  async getCouponById(id: number): Promise<Coupon | undefined> {
    return this.coupons.find((c) => c.id === id);
  }

  async listCoupons(): Promise<Coupon[]> {
    return [...this.coupons].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    const coupon: Coupon = {
      id: this.nextCouponId++,
      code: input.code,
      discountType: input.discountType,
      discountValue: input.discountValue,
      duration: input.duration,
      durationMonths: input.durationMonths,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt,
      active: true,
      createdAt: new Date(),
      createdByAdminId: input.createdByAdminId,
    };
    this.coupons.push(coupon);
    return coupon;
  }

  async updateCoupon(id: number, patch: CouponUpdate): Promise<Coupon | undefined> {
    const coupon = this.coupons.find((c) => c.id === id);
    if (!coupon) return undefined;
    Object.assign(coupon, patch);
    return coupon;
  }

  async getCouponRedemption(couponId: number, consultantId: number): Promise<CouponRedemption | undefined> {
    return this.couponRedemptions.find((r) => r.couponId === couponId && r.consultantId === consultantId);
  }

  async getReservedCouponRedemption(consultantId: number): Promise<CouponRedemption | undefined> {
    return this.couponRedemptions
      .filter((r) => r.consultantId === consultantId && r.status === "reserved")
      .sort((a, b) => b.reservedAt.getTime() - a.reservedAt.getTime())[0];
  }

  private countActiveCouponUsesSync(couponId: number, reservationTtlMs: number): number {
    const cutoff = Date.now() - reservationTtlMs;
    return this.couponRedemptions.filter(
      (r) => r.couponId === couponId && (r.status === "confirmed" || (r.status === "reserved" && r.reservedAt.getTime() > cutoff)),
    ).length;
  }

  async countActiveCouponUses(couponId: number, reservationTtlMs: number): Promise<number> {
    return this.countActiveCouponUsesSync(couponId, reservationTtlMs);
  }

  async reserveCouponForConsultant(
    couponId: number,
    consultantId: number,
    input: ReserveCouponInput,
    reservationTtlMs: number,
  ): Promise<ReserveCouponResult> {
    if (this.couponRedemptions.some((r) => r.couponId === couponId && r.consultantId === consultantId)) {
      return { outcome: "already_used" };
    }
    const coupon = this.coupons.find((c) => c.id === couponId);
    if (coupon?.maxUses != null && this.countActiveCouponUsesSync(couponId, reservationTtlMs) >= coupon.maxUses) {
      return { outcome: "limit_reached" };
    }
    const redemption: CouponRedemption = {
      id: this.nextCouponRedemptionId++,
      couponId,
      consultantId,
      status: "reserved",
      discountType: input.discountType,
      discountValue: input.discountValue,
      duration: input.duration,
      durationMonths: input.durationMonths,
      reservedAt: new Date(),
      confirmedAt: null,
      discountEndsAt: null,
      priceRevertedAt: null,
    };
    this.couponRedemptions.push(redemption);
    return { outcome: "reserved", redemption };
  }

  async getActiveCouponRedemptionForConsultant(consultantId: number): Promise<(CouponRedemption & { couponCode: string }) | undefined> {
    const now = Date.now();
    const redemption = this.couponRedemptions
      .filter(
        (r) =>
          r.consultantId === consultantId &&
          r.status === "confirmed" &&
          (r.discountEndsAt === null || r.discountEndsAt.getTime() > now),
      )
      .sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0))[0];
    if (!redemption) return undefined;
    const coupon = this.coupons.find((c) => c.id === redemption.couponId);
    return { ...redemption, couponCode: coupon?.code ?? "" };
  }

  async getActiveExpiredCouponRedemption(consultantId: number, now: Date): Promise<CouponRedemption | undefined> {
    return this.couponRedemptions.find(
      (r) =>
        r.consultantId === consultantId &&
        r.status === "confirmed" &&
        r.discountEndsAt !== null &&
        r.discountEndsAt.getTime() < now.getTime() &&
        r.priceRevertedAt === null,
    );
  }

  async markCouponRedemptionReverted(id: number): Promise<void> {
    const redemption = this.couponRedemptions.find((r) => r.id === id);
    if (redemption) redemption.priceRevertedAt = new Date();
  }

  async listCouponRedemptionsByCoupon(couponId: number): Promise<CouponRedemptionDetailRow[]> {
    return this.couponRedemptions
      .filter((r) => r.couponId === couponId)
      .sort((a, b) => b.reservedAt.getTime() - a.reservedAt.getTime())
      .map((redemption) => {
        const consultant = this.consultants.find((c) => c.id === redemption.consultantId);
        const user = this.users.find((u) => u.consultantId === redemption.consultantId && u.role === "consultant");
        return {
          redemption,
          consultantId: redemption.consultantId,
          businessName: consultant?.businessName ?? "",
          username: user?.username ?? "",
        };
      });
  }

  async listAdminSubscriptions(): Promise<AdminSubscriptionRow[]> {
    return this.consultants
      .map((c): AdminSubscriptionRow | null => {
        const user = this.users.find((u) => u.consultantId === c.id && u.role === "consultant");
        if (!user) return null; // consultants sin user real no debería pasar, se ignora
        const subscription = this.subscriptions.find((s) => s.consultantId === c.id) ?? null;
        const lastPayment = subscription?.lastPaymentId
          ? (this.payments.find((p) => p.id === subscription.lastPaymentId) ?? null)
          : null;
        return { consultantId: c.id, businessName: c.businessName, username: user.username, email: c.email, subscription, lastPayment };
      })
      .filter((row): row is AdminSubscriptionRow => row !== null)
      .sort((a, b) => a.businessName.localeCompare(b.businessName));
  }

  async listAllPayments(filters?: AdminPaymentFilters): Promise<AdminPaymentRow[]> {
    return this.payments
      .filter((p) => {
        if (filters?.status && p.status !== filters.status) return false;
        if (filters?.consultantId && p.consultantId !== filters.consultantId) return false;
        if (filters?.from && p.createdAt.getTime() < filters.from.getTime()) return false;
        if (filters?.to && p.createdAt.getTime() >= filters.to.getTime()) return false;
        return true;
      })
      .map((p) => ({ ...p, businessName: this.consultants.find((c) => c.id === p.consultantId)?.businessName ?? "" }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private getDefaultThresholdMem(consultantId: number): number | null {
    return this.consultants.find((c) => c.id === consultantId)?.defaultLowStockThreshold ?? null;
  }

  async getAllProducts(consultantId: number): Promise<Product[]> {
    const defaultThreshold = this.getDefaultThresholdMem(consultantId);
    return this.products
      .filter((p) => p.consultantId === null || p.consultantId === consultantId)
      .sort((a, b) =>
        [a.seccion, a.linea ?? "", a.producto].join(" ").localeCompare(
          [b.seccion, b.linea ?? "", b.producto].join(" "),
        ),
      )
      .map((p) =>
        withStockDefaults(p, this.productStock.find((s) => s.consultantId === consultantId && s.productId === p.id), defaultThreshold),
      );
  }

  async getProductsByIds(consultantId: number, ids: number[]): Promise<Product[]> {
    return this.products
      .filter((p) => ids.includes(p.id) && (p.consultantId === null || p.consultantId === consultantId))
      .map((p) => withStockDefaults(p, this.productStock.find((s) => s.consultantId === consultantId && s.productId === p.id)));
  }

  /** Admin-only: catálogo GLOBAL — dedupe por código entre los productos globales (consultantId
   * null), nunca toca el stock de ninguna consultora. */
  async bulkInsertProducts(items: InsertProduct[]): Promise<number> {
    let changed = 0;

    for (const item of items) {
      const existing = this.products.find((product) => product.codigo === item.codigo && product.consultantId === null);
      if (existing) {
        Object.assign(existing, {
          seccion: item.seccion,
          linea: item.linea ?? null,
          producto: item.producto,
          variante: item.variante ?? "Estándar",
          puntos: item.puntos ?? 0,
          precio: item.precio,
          imagen: item.imagen ?? null,
        });
      } else {
        this.products.push({
          id: this.nextProductId++,
          consultantId: null,
          seccion: item.seccion,
          linea: item.linea ?? null,
          producto: item.producto,
          variante: item.variante ?? "Estándar",
          codigo: item.codigo ?? `producto-${this.nextProductId}`,
          puntos: item.puntos ?? 0,
          precio: item.precio,
          imagen: item.imagen ?? null,
          source: "import",
        });
      }
      changed++;
    }

    return changed;
  }

  /** Catálogo de prueba de UNA consultora — productos privados (no globales), con su propio
   * stock sembrado en la misma pasada. Idempotente, igual que bulkInsertProducts. */
  async seedOwnProducts(consultantId: number, items: CreateProductInput[]): Promise<number> {
    let changed = 0;

    for (const item of items) {
      const variante = item.variante ?? "Estándar";
      const codigo = item.codigo ?? slugify(`${item.seccion}-${item.linea ?? ""}-${item.producto}-${variante}-${Date.now()}`);
      let product = this.products.find((p) => p.codigo === codigo && p.consultantId === consultantId);

      if (product) {
        Object.assign(product, {
          seccion: item.seccion,
          linea: item.linea ?? null,
          producto: item.producto,
          variante,
          puntos: item.puntos,
          precio: item.precio,
          imagen: item.imagen ?? null,
        });
      } else {
        product = {
          id: this.nextProductId++,
          consultantId,
          seccion: item.seccion,
          linea: item.linea ?? null,
          producto: item.producto,
          variante,
          codigo,
          puntos: item.puntos,
          precio: item.precio,
          imagen: item.imagen ?? null,
          source: "manual",
        };
        this.products.push(product);
      }

      const stock = this.getOrCreateStock(consultantId, product.id);
      stock.unidades = item.unidades;
      changed++;
    }

    return changed;
  }

  async getLowStockProducts(consultantId: number): Promise<Product[]> {
    const defaultThreshold = this.getDefaultThresholdMem(consultantId);
    return this.productStock
      .filter(
        (s) => s.consultantId === consultantId && s.unidades < resolveLowStockThreshold(s.stockMinimo, defaultThreshold),
      )
      .sort((a, b) => a.unidades - b.unidades)
      .map((s) => {
        const product = this.products.find((p) => p.id === s.productId)!;
        return withStockDefaults(product, s, defaultThreshold);
      });
  }

  async applyProductDiscount(consultantId: number, productId: number, discountPercent: number): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.selectedDiscount = discountPercent;
    stock.costPrice = Math.round(product.precio * (1 - discountPercent / 100));
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async createProduct(consultantId: number, input: CreateProductInput): Promise<Product> {
    const variante = input.variante ?? "Estándar";
    const codigo = input.codigo ?? slugify(`${input.seccion}-${input.linea ?? ""}-${input.producto}-${variante}-${Date.now()}`);
    const product: ProductRow = {
      id: this.nextProductId++,
      consultantId,
      seccion: input.seccion,
      linea: input.linea ?? null,
      producto: input.producto,
      variante,
      codigo,
      puntos: input.puntos,
      precio: input.precio,
      imagen: input.imagen ?? null,
      source: "manual",
    };
    this.products.push(product);
    const stock = this.getOrCreateStock(consultantId, product.id);
    stock.unidades = input.unidades;
    stock.stockMinimo = input.stockMinimo ?? null;
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async updateProduct(consultantId: number, id: number, input: UpdateProductInput): Promise<Product | undefined> {
    const product = this.products.find((p) => p.id === id && p.consultantId === consultantId);
    if (!product) return undefined;

    if (input.codigo !== undefined) {
      const duplicate = this.products.some((p) => p.id !== id && p.consultantId === consultantId && p.codigo === input.codigo);
      if (duplicate) {
        throw new ProductConflictError("Ya existe otro producto tuyo con ese código");
      }
    }

    Object.assign(product, input);
    const stock = this.productStock.find((s) => s.consultantId === consultantId && s.productId === id);
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async deleteProduct(consultantId: number, id: number): Promise<"deleted" | "not_found" | "has_relations"> {
    const product = this.products.find((p) => p.id === id && p.consultantId === consultantId);
    if (!product) return "not_found";

    const hasSaleItems = this.saleItems.some((i) => i.productId === id);
    if (hasSaleItems) return "has_relations";

    this.products = this.products.filter((p) => p.id !== id);
    this.productStock = this.productStock.filter((s) => !(s.consultantId === consultantId && s.productId === id));
    return "deleted";
  }

  async setProductDiscontinued(consultantId: number, productId: number, discontinued: boolean): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.discontinued = discontinued;
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async setProductPriceOverride(consultantId: number, productId: number, priceOverride: number | null): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    if (product.consultantId !== null) {
      throw new ProductValidationError("El precio de un producto cargado a mano se edita en el producto, no con un precio propio");
    }
    const effectiveOverride = priceOverride === product.precio ? null : priceOverride;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.priceOverride = effectiveOverride;
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async setProductCost(consultantId: number, productId: number, costPrice: number): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    const hadNoRealCost = stock.costPrice === null;
    stock.costPrice = costPrice;
    stock.selectedDiscount = null;
    if (hadNoRealCost) {
      await this.recalculateEstimatedSalesForProduct(consultantId, productId, costPrice);
    }
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async setProductStock(
    consultantId: number,
    productId: number,
    unidades: number,
    stockMinimo?: number | null,
  ): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.unidades = unidades;
    if (stockMinimo !== undefined) stock.stockMinimo = stockMinimo;
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async incrementProductStock(consultantId: number, productId: number, delta: number): Promise<Product | undefined> {
    if (delta === 0) {
      throw new SaleValidationError("El delta de stock no puede ser 0");
    }
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    // Misma semántica que la versión atómica de Postgres: `actual = actual + delta`, y si el
    // resultado da negativo se rechaza SIN tocar la fila (no hay "commit parcial" que deshacer,
    // simplemente no se asigna hasta después de validar).
    const nextUnidades = stock.unidades + delta;
    if (nextUnidades < 0) {
      throw new SaleValidationError(`Stock insuficiente: quedarían ${nextUnidades} unidades`);
    }
    stock.unidades = nextUnidades;
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async incrementProductStockBatch(
    consultantId: number,
    lines: { productId: number; delta: number }[],
    discountPercent?: number,
  ): Promise<{ updated: number }> {
    if (lines.length === 0) {
      throw new SaleValidationError("El lote no puede estar vacío");
    }

    const deltaByProductId = new Map<number, number>();
    for (const line of lines) {
      if (!Number.isInteger(line.delta) || line.delta <= 0) {
        throw new SaleValidationError(`Delta inválido para el producto ${line.productId}: tiene que ser un entero positivo`);
      }
      deltaByProductId.set(line.productId, (deltaByProductId.get(line.productId) ?? 0) + line.delta);
    }

    const orderedProductIds = Array.from(deltaByProductId.keys()).sort((a, b) => a - b);

    // Lógicamente atómico sin transacción real (no hay DB acá): DOS pasadas. La primera valida
    // TODO (visibilidad + resultado no negativo) sin escribir nada; recién si las N líneas
    // pasan, la segunda pasada aplica todas. Si cualquiera falla en la primera pasada, no se
    // mutó ni una sola fila — nunca queda "línea por línea, aborta a la mitad" (Etapa 7.2,
    // sección 17).
    // Prompt 2: un pedido NUNCA dispara `recalculateEstimatedSalesForProduct` — la ganancia de
    // una venta vieja no cambia cuando entra un pedido nuevo. El producto toma el costo
    // promedio ponderado; las ventas viejas siguen "estimadas". La única puerta para
    // recalcularlas es la carga manual de costo desde "Editar producto" (Prompt 4).
    const planned: { stock: ProductStock; nextUnidades: number; nextCostPrice?: number }[] = [];
    for (const productId of orderedProductIds) {
      const product = this.findVisibleProduct(consultantId, productId);
      if (!product) {
        throw new SaleValidationError(`Producto ${productId} no encontrado`);
      }
      const stock = this.getOrCreateStock(consultantId, productId);
      const delta = deltaByProductId.get(productId)!;
      const nextUnidades = stock.unidades + delta;
      if (nextUnidades < 0) {
        throw new SaleValidationError(`Stock insuficiente para el producto ${productId}: quedarían ${nextUnidades} unidades`);
      }
      if (discountPercent === undefined) {
        planned.push({ stock, nextUnidades });
        continue;
      }
      // Prompt 2 — mismo criterio que DatabaseStorage: promedio ponderado por unidades,
      // redondeado a pesos enteros; sin costo previo o con 0 unidades, el costo nuevo es
      // directamente el de esta compra.
      const lineCost = Math.round(product.precio * (1 - discountPercent / 100));
      const hadNoRealCost = stock.costPrice === null || stock.unidades <= 0;
      const nextCostPrice = hadNoRealCost
        ? lineCost
        : Math.round((stock.unidades * stock.costPrice! + delta * lineCost) / (stock.unidades + delta));
      planned.push({ stock, nextUnidades, nextCostPrice });
    }

    for (const { stock, nextUnidades, nextCostPrice } of planned) {
      stock.unidades = nextUnidades;
      if (nextCostPrice !== undefined) {
        stock.costPrice = nextCostPrice;
        stock.selectedDiscount = discountPercent!;
      }
    }

    return { updated: orderedProductIds.length };
  }

  async recalculateEstimatedSalesForProduct(consultantId: number, productId: number, newCostPrice: number): Promise<void> {
    const saleIdsByConsultant = new Set(this.sales.filter((s) => s.consultantId === consultantId).map((s) => s.id));
    const estimatedItems = this.saleItems.filter(
      (i) => saleIdsByConsultant.has(i.saleId) && i.productId === productId && i.costIsEstimated === true,
    );
    if (estimatedItems.length === 0) return;

    for (const item of estimatedItems) {
      item.costPrice = newCostPrice;
      item.costIsEstimated = false;
    }

    const affectedSaleIds = Array.from(new Set(estimatedItems.map((i) => i.saleId)));
    for (const saleId of affectedSaleIds) {
      const sale = this.sales.find((s) => s.id === saleId);
      if (!sale) continue;
      const items = this.saleItems.filter((i) => i.saleId === saleId);
      const productCost = computeHistoricalProductCost(items.map((i) => ({ quantity: i.quantity, costPrice: i.costPrice })));
      if (productCost === null) continue;
      sale.profit = computeSaleProfit({
        total: sale.total,
        productCost,
        shippingCost: sale.shippingCost,
        ingresosBrutos: sale.ingresosBrutos,
      });
    }
  }

  async countProductsWithoutCost(consultantId: number): Promise<number> {
    return this.productStock.filter((s) => s.consultantId === consultantId && s.costPrice === null && s.unidades > 0).length;
  }

  async setProductStockReminder(consultantId: number, productId: number, remindAt: string | null): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.remindStockAt = remindAt;
    return withStockDefaults(product, stock, this.getDefaultThresholdMem(consultantId));
  }

  async listGlobalProducts(): Promise<ProductRow[]> {
    return this.products
      .filter((p) => p.consultantId === null)
      .sort((a, b) =>
        [a.seccion, a.linea ?? "", a.producto].join(" ").localeCompare(
          [b.seccion, b.linea ?? "", b.producto].join(" "),
        ),
      );
  }

  async setProductImage(productId: number, imagen: string | null): Promise<SetProductImageResult> {
    const product = this.products.find((p) => p.id === productId && p.consultantId === null);
    if (!product) return { product: undefined, previousImage: null };
    const previousImage = product.imagen;
    product.imagen = imagen;
    return { product, previousImage };
  }

  async getUpcomingAppointments(consultantId: number, limit = 10): Promise<Appointment[]> {
    const now = new Date();
    const nowDate = toDateStr(now);
    const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    return this.appointments
      .filter(
        (a) =>
          a.consultantId === consultantId &&
          (a.date > nowDate || (a.date === nowDate && a.time >= nowTime)) &&
          UPCOMING_APPOINTMENT_STATUSES.includes(a.status as AppointmentStatus),
      )
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
      .slice(0, limit);
  }

  async getAppointmentsInRange(consultantId: number, start: string, end: string): Promise<Appointment[]> {
    return this.appointments
      .filter((a) => a.consultantId === consultantId && a.date >= start && a.date < end)
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  }

  async getAppointmentCustomTypes(consultantId: number): Promise<string[]> {
    const knownValues = new Set(KNOWN_EVENT_TYPES.map((t) => t.value));
    const custom = new Set(
      this.appointments
        .filter((a) => a.consultantId === consultantId && !knownValues.has(a.type))
        .map((a) => a.type),
    );
    return Array.from(custom).sort((a, b) => a.localeCompare(b));
  }

  private async resolveEventType(consultantId: number, rawType: string): Promise<string> {
    if (isKnownEventType(rawType)) return rawType;
    const existingCustomTypes = await this.getAppointmentCustomTypes(consultantId);
    return normalizeCustomEventTypeName(rawType, existingCustomTypes);
  }

  /** Espejo de DatabaseStorage.findConflictingAppointment — sin lock explícito (Node es
   * single-threaded, no hay ventana de interleaving entre este chequeo y el push/mutación de
   * más abajo, mismo criterio que el resto de MemoryStorage). */
  private hasConflictingAppointment(consultantId: number, date: string, time: string, excludeId?: number): boolean {
    return this.appointments.some(
      (a) =>
        a.consultantId === consultantId &&
        a.date === date &&
        a.time === time &&
        a.status !== "cancelada" &&
        a.id !== excludeId,
    );
  }

  async createAppointment(consultantId: number, input: CreateAppointmentInput): Promise<Appointment | undefined> {
    const client = this.clients.find((c) => c.id === input.clientId && c.consultantId === consultantId);
    if (!client) return undefined;
    const clientName = client.name ?? client.phone;
    const type = await this.resolveEventType(consultantId, input.type);

    if (this.hasConflictingAppointment(consultantId, input.date, input.time)) {
      throw new AppointmentConflictError("Ya existe un turno en ese horario");
    }

    const appointment: Appointment = {
      id: this.nextAppointmentId++,
      consultantId,
      clientId: client.id,
      clientName,
      date: input.date,
      time: input.time,
      type,
      location: input.location ?? null,
      notes: input.notes ?? null,
      status: "pendiente",
    };
    this.appointments.push(appointment);
    return appointment;
  }

  async updateAppointment(consultantId: number, id: number, input: UpdateAppointmentInput): Promise<Appointment | undefined> {
    const existing = this.appointments.find((a) => a.id === id && a.consultantId === consultantId);
    if (!existing) return undefined;

    const client = this.clients.find((c) => c.id === input.clientId && c.consultantId === consultantId);
    if (!client) throw new AppointmentValidationError("Clienta no encontrada");
    const clientName = client.name ?? client.phone;
    const type = input.type === existing.type ? existing.type : await this.resolveEventType(consultantId, input.type);

    if (this.hasConflictingAppointment(consultantId, input.date, input.time, id)) {
      throw new AppointmentConflictError("Ya existe un turno en ese horario");
    }

    existing.clientId = client.id;
    existing.clientName = clientName;
    existing.date = input.date;
    existing.time = input.time;
    existing.type = type;
    existing.location = input.location ?? null;
    existing.notes = input.notes ?? null;
    return existing;
  }

  async updateAppointmentStatus(consultantId: number, id: number, status: AppointmentStatus): Promise<Appointment | undefined> {
    const appointment = this.appointments.find((a) => a.id === id && a.consultantId === consultantId);
    if (!appointment) return undefined;
    appointment.status = status;
    return appointment;
  }

  async deleteAppointment(consultantId: number, id: number): Promise<boolean> {
    const before = this.appointments.length;
    this.appointments = this.appointments.filter((a) => !(a.id === id && a.consultantId === consultantId));
    return this.appointments.length < before;
  }

  async getTopClients(consultantId: number, limit = 5, start?: string, end?: string): Promise<TopClient[]> {
    const range = start && end ? { monthStart: start, monthEnd: end } : getCurrentMonthRange();
    const monthSales = this.sales.filter(
      (s) =>
        s.consultantId === consultantId &&
        s.clientId !== null &&
        s.date >= range.monthStart &&
        s.date < range.monthEnd &&
        s.status !== "cancelada",
    );

    const byClient = new Map<number, { clientName: string; purchaseCount: number; totalAmount: number }>();
    for (const sale of monthSales) {
      const key = sale.clientId as number;
      const entry = byClient.get(key) ?? { clientName: sale.clientName, purchaseCount: 0, totalAmount: 0 };
      entry.purchaseCount += 1;
      entry.totalAmount += sale.total;
      byClient.set(key, entry);
    }

    const saleClientById = new Map(monthSales.map((s) => [s.id, s.clientId]));
    const productCountByClient = new Map<number, number>();
    for (const item of this.saleItems) {
      const clientId = saleClientById.get(item.saleId);
      if (clientId === undefined || clientId === null) continue;
      productCountByClient.set(clientId, (productCountByClient.get(clientId) ?? 0) + item.quantity);
    }

    return Array.from(byClient.entries())
      .map(([clientId, entry]) => ({
        clientId,
        clientName: entry.clientName,
        purchaseCount: entry.purchaseCount,
        totalAmount: entry.totalAmount,
        productCount: productCountByClient.get(clientId) ?? 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, limit);
  }

  async getClientById(consultantId: number, id: number): Promise<Client | undefined> {
    return this.clients.find((c) => c.id === id && c.consultantId === consultantId);
  }

  private matchClients(consultantId: number, query: string): Client[] {
    const term = query.trim().toLowerCase();
    const ownClients = this.clients.filter((c) => c.consultantId === consultantId);
    if (!term) return ownClients;
    return ownClients.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(term) ||
        c.phone.includes(term) ||
        (c.email ?? "").toLowerCase().includes(term) ||
        (c.address ?? "").toLowerCase().includes(term) ||
        (c.notes ?? "").toLowerCase().includes(term),
    );
  }

  /** Espejo de DatabaseStorage.computeClientStats. */
  private computeClientStatsMemory(clientIds: number[]): { statsByClient: Map<number, { totalAmount: number; lastDate: string | null }>; balanceByClient: Map<number, number> } {
    const idSet = new Set(clientIds);
    const statsByClient = new Map<number, { totalAmount: number; lastDate: string | null }>();
    const balanceByClient = new Map<number, number>();

    for (const clientId of Array.from(idSet)) {
      const clientSales = this.sales.filter((s) => s.clientId === clientId && s.status !== "cancelada");
      const totalAmount = clientSales.reduce((sum, s) => sum + s.total, 0);
      const lastDate = clientSales.length ? clientSales.map((s) => s.date).sort().slice(-1)[0] : null;
      statsByClient.set(clientId, { totalAmount, lastDate });

      // Misma condición que getPendingInstallments (cuota "pendiente" de una venta no cancelada).
      const clientSaleIds = new Set(clientSales.map((s) => s.id));
      const pendingBalance = this.saleInstallments
        .filter((i) => i.status === "pendiente" && clientSaleIds.has(i.saleId))
        .reduce((sum, i) => sum + i.amount, 0);
      balanceByClient.set(clientId, pendingBalance);
    }

    return { statsByClient, balanceByClient };
  }

  private static sortClientsDeterministically<T extends { id: number; name: string | null; phone: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const keyA = (a.name?.trim() || a.phone).toLowerCase();
      const keyB = (b.name?.trim() || b.phone).toLowerCase();
      if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      return a.id - b.id;
    });
  }

  async searchClients(consultantId: number, query = "", limit = 20): Promise<ClientWithStats[]> {
    const filtered = MemoryStorage.sortClientsDeterministically(this.matchClients(consultantId, query));
    const page = filtered.slice(0, limit);
    const { statsByClient, balanceByClient } = this.computeClientStatsMemory(page.map((c) => c.id));

    return page.map((c) => ({
      ...c,
      totalPurchases: Number(statsByClient.get(c.id)?.totalAmount ?? 0),
      lastPurchase: statsByClient.get(c.id)?.lastDate ?? null,
      pendingBalance: balanceByClient.get(c.id) ?? 0,
    }));
  }

  async searchClientsPaginated(consultantId: number, params: SearchClientsPaginatedParams): Promise<PaginatedClients> {
    const page = Number.isFinite(params.page) && params.page >= 1 ? Math.floor(params.page) : 1;
    const pageSize = Number.isFinite(params.pageSize)
      ? Math.min(Math.max(Math.floor(params.pageSize), 1), MAX_CLIENTS_PAGE_SIZE)
      : MAX_CLIENTS_PAGE_SIZE;
    const balanceFilter: BalanceFilter = params.balanceFilter ?? "todas";
    const staleFilter: StaleFilter = params.staleFilter ?? "todas";

    const matched = this.matchClients(consultantId, params.query ?? "");
    if (matched.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0, totalRevenue: 0 };
    }

    const { statsByClient, balanceByClient } = this.computeClientStatsMemory(matched.map((c) => c.id));

    let withStats: ClientWithStats[] = matched.map((c) => ({
      ...c,
      totalPurchases: Number(statsByClient.get(c.id)?.totalAmount ?? 0),
      lastPurchase: statsByClient.get(c.id)?.lastDate ?? null,
      pendingBalance: balanceByClient.get(c.id) ?? 0,
    }));

    if (balanceFilter !== "todas") {
      withStats = withStats.filter((c) => matchesBalanceFilter(c.pendingBalance, balanceFilter));
    }

    if (staleFilter !== "todas") {
      const cutoff = toDateStr(new Date(Date.now() - STALE_THRESHOLDS[staleFilter] * 86400000));
      withStats = withStats.filter((c) => matchesStaleFilter(c.lastPurchase, staleFilter, cutoff));
    }

    withStats = MemoryStorage.sortClientsDeterministically(withStats);

    const total = withStats.length;
    const totalPages = Math.ceil(total / pageSize);
    const totalRevenue = withStats.reduce((sum, c) => sum + c.totalPurchases, 0);
    const start = (page - 1) * pageSize;
    const items = withStats.slice(start, start + pageSize);

    return { items, total, page, pageSize, totalPages, totalRevenue };
  }

  async createClient(consultantId: number, input: InsertClient): Promise<Client> {
    const client: Client = {
      id: this.nextClientId++,
      consultantId,
      name: input.name ?? null,
      phone: input.phone,
      email: input.email ?? null,
      birthday: input.birthday ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    };
    this.clients.push(client);
    return client;
  }

  async updateClient(consultantId: number, id: number, input: Partial<InsertClient>): Promise<Client | undefined> {
    const client = this.clients.find((c) => c.id === id && c.consultantId === consultantId);
    if (!client) return undefined;
    Object.assign(client, input);
    return client;
  }

  async findDuplicateClient(consultantId: number, phone: string, email: string | null, excludeId?: number): Promise<Client | undefined> {
    return this.clients.find((c) => {
      if (c.consultantId !== consultantId) return false;
      if (excludeId !== undefined && c.id === excludeId) return false;
      if (c.phone === phone) return true;
      if (email && c.email && c.email.toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
  }

  async deleteClient(consultantId: number, id: number): Promise<"deleted" | "not_found" | "has_relations"> {
    const client = this.clients.find((c) => c.id === id && c.consultantId === consultantId);
    if (!client) return "not_found";

    const hasSales = this.sales.some((s) => s.clientId === id);
    if (hasSales) return "has_relations";

    const hasAppointments = this.appointments.some((a) => a.clientId === id);
    if (hasAppointments) return "has_relations";

    this.clients = this.clients.filter((c) => c.id !== id);
    return "deleted";
  }

  async getSalesByClient(consultantId: number, clientId: number, limit = 100): Promise<SaleWithDetails[]> {
    return this.sales
      .filter((s) => s.clientId === clientId && s.consultantId === consultantId)
      .sort((a, b) => (a.date === b.date ? b.id - a.id : b.date.localeCompare(a.date)))
      .slice(0, limit)
      .map((s) => ({
        ...s,
        items: this.saleItems.filter((i) => i.saleId === s.id),
        installments: this.saleInstallments
          .filter((i) => i.saleId === s.id)
          .sort((a, b) => a.installmentNumber - b.installmentNumber),
      }));
  }

  async getAppointmentsByClient(consultantId: number, clientId: number, limit = 100): Promise<Appointment[]> {
    return this.appointments
      .filter((a) => a.clientId === clientId && a.consultantId === consultantId)
      .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)))
      .slice(0, limit);
  }

  async getTopProductsByCategory(
    consultantId: number,
    category?: string,
    limit?: number,
    start?: string,
    end?: string,
    order: "asc" | "desc" = "desc",
  ): Promise<TopProductByCategory[]> {
    const activeSaleById = new Map(
      this.sales.filter((s) => s.consultantId === consultantId && s.status !== "cancelada").map((s) => [s.id, s]),
    );
    const byProduct = new Map<string, TopProductByCategory>();

    for (const item of this.saleItems) {
      if (category && item.category !== category) continue;
      const sale = activeSaleById.get(item.saleId);
      if (!sale) continue;
      const saleDate = sale.date;
      if (start && saleDate < start) continue;
      if (end && saleDate >= end) continue;

      const key = item.productId !== null ? String(item.productId) : item.productName;
      const existing = byProduct.get(key);
      if (existing) {
        existing.quantitySold += item.quantity;
        existing.totalSales += item.quantity * item.price;
      } else {
        const product = item.productId !== null ? this.products.find((p) => p.id === item.productId) : undefined;
        byProduct.set(key, {
          productId: item.productId,
          productName: item.productName,
          category: item.category,
          imagen: product?.imagen ?? null,
          quantitySold: item.quantity,
          totalSales: item.quantity * item.price,
        });
      }
    }

    const sorted = Array.from(byProduct.values()).sort((a, b) =>
      order === "asc" ? a.quantitySold - b.quantitySold : b.quantitySold - a.quantitySold,
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  private periodKey(dateStr: string, groupBy: ReportGroupBy): string {
    if (groupBy === "day") return dateStr;
    if (groupBy === "month") return dateStr.slice(0, 7);
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diffToMonday);
    return toDateStr(date);
  }

  async getSalesSummary(consultantId: number, start: string, end: string, groupBy: ReportGroupBy = "day"): Promise<SalesSummaryPoint[]> {
    const inRange = this.sales.filter(
      (s) => s.consultantId === consultantId && s.date >= start && s.date < end && s.status !== "cancelada",
    );
    const byPeriod = new Map<string, { totalSales: number; totalProfit: number; salesCount: number }>();

    for (const sale of inRange) {
      const key = this.periodKey(sale.date, groupBy);
      const entry = byPeriod.get(key) ?? { totalSales: 0, totalProfit: 0, salesCount: 0 };
      entry.totalSales += sale.total;
      entry.totalProfit += sale.profit;
      entry.salesCount += 1;
      byPeriod.set(key, entry);
    }

    return Array.from(byPeriod.entries())
      .map(([period, entry]) => ({
        period,
        totalSales: entry.totalSales,
        totalProfit: entry.totalProfit,
        salesCount: entry.salesCount,
        avgTicket: entry.salesCount > 0 ? Math.round(entry.totalSales / entry.salesCount) : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  async getTopCategories(consultantId: number, start?: string, end?: string): Promise<TopCategory[]> {
    const activeSaleById = new Map(
      this.sales.filter((s) => s.consultantId === consultantId && s.status !== "cancelada").map((s) => [s.id, s]),
    );
    const byCategory = new Map<string, TopCategory>();

    for (const item of this.saleItems) {
      const sale = activeSaleById.get(item.saleId);
      if (!sale) continue;
      if (start && sale.date < start) continue;
      if (end && sale.date >= end) continue;

      const existing = byCategory.get(item.category);
      if (existing) {
        existing.quantitySold += item.quantity;
        existing.totalSales += item.quantity * item.price;
      } else {
        byCategory.set(item.category, {
          category: item.category,
          quantitySold: item.quantity,
          totalSales: item.quantity * item.price,
        });
      }
    }

    return Array.from(byCategory.values()).sort((a, b) => b.quantitySold - a.quantitySold);
  }

  async getSalesByPaymentMethod(consultantId: number, start?: string, end?: string): Promise<PaymentMethodBreakdown[]> {
    const inRange = this.sales.filter(
      (s) => s.consultantId === consultantId && (!start || s.date >= start) && (!end || s.date < end) && s.status !== "cancelada",
    );
    const byMethod = new Map<string, PaymentMethodBreakdown>();

    for (const sale of inRange) {
      const existing = byMethod.get(sale.paymentMethod);
      if (existing) {
        existing.salesCount += 1;
        existing.totalSales += sale.total;
      } else {
        byMethod.set(sale.paymentMethod, { paymentMethod: sale.paymentMethod, salesCount: 1, totalSales: sale.total });
      }
    }

    return Array.from(byMethod.values()).sort((a, b) => b.totalSales - a.totalSales);
  }

  async getInstallmentsBreakdown(consultantId: number, start?: string, end?: string): Promise<InstallmentsBreakdown> {
    const inRange = this.sales.filter(
      (s) => s.consultantId === consultantId && (!start || s.date >= start) && (!end || s.date < end) && s.status !== "cancelada",
    );
    const result: InstallmentsBreakdown = {
      singlePayment: { salesCount: 0, totalSales: 0 },
      financed: { salesCount: 0, totalSales: 0 },
    };

    for (const sale of inRange) {
      const bucket = sale.installmentsCount > 1 ? result.financed : result.singlePayment;
      bucket.salesCount += 1;
      bucket.totalSales += sale.total;
    }

    return result;
  }

  async getStockValuation(consultantId: number): Promise<StockValuation> {
    const habitualDiscountPercent = this.resolveHabitualDiscountPercentMem(consultantId);
    let valueAtCost = 0;
    let valueAtPrice = 0;
    let unitCount = 0;
    let productCount = 0;
    let hasEstimatedCost = false;
    for (const stock of this.productStock) {
      if (stock.consultantId !== consultantId) continue;
      const product = this.products.find((p) => p.id === stock.productId);
      if (!product) continue;
      const resolved = resolveLineCost({ costPrice: stock.costPrice, publicPrice: product.precio, habitualDiscountPercent });
      if (resolved.isEstimated && stock.unidades > 0) hasEstimatedCost = true;
      valueAtCost += stock.unidades * resolved.costPrice;
      // Prompt 4: respeta el precio propio de la consultora, nunca para el costo (arriba).
      valueAtPrice += stock.unidades * (stock.priceOverride ?? product.precio);
      unitCount += stock.unidades;
      productCount++;
    }
    return {
      valueAtCost,
      valueAtPrice,
      potentialProfit: valueAtPrice - valueAtCost,
      productCount,
      unitCount,
      hasEstimatedCost,
    };
  }

  async getInactiveClients(consultantId: number, days: number): Promise<InactiveClient[]> {
    const cutoff = toDateStr(new Date(Date.now() - days * 86400000));
    const today = new Date();

    const results = this.clients
      .filter((client) => client.consultantId === consultantId)
      .map((client) => {
      const clientSales = this.sales.filter((s) => s.clientId === client.id && s.status !== "cancelada");
      const lastPurchase = clientSales.length
        ? clientSales.map((s) => s.date).sort().slice(-1)[0]
        : null;
      const totalPurchased = clientSales.reduce((sum, s) => sum + s.total, 0);
      return {
        clientId: client.id,
        name: client.name,
        phone: client.phone,
        lastPurchase,
        daysSinceLastPurchase: lastPurchase ? daysBetween(parseDateStr(lastPurchase), today) : null,
        totalPurchased,
      };
    });

    return results
      .filter((r) => r.lastPurchase === null || r.lastPurchase < cutoff)
      .sort((a, b) => {
        if (a.lastPurchase === null && b.lastPurchase === null) return 0;
        if (a.lastPurchase === null) return -1;
        if (b.lastPurchase === null) return 1;
        return a.lastPurchase.localeCompare(b.lastPurchase);
      });
  }

  async getUpcomingBirthdays(consultantId: number, days: number): Promise<UpcomingBirthday[]> {
    const today = new Date();
    return this.clients
      .filter((c): c is Client & { birthday: string } => c.consultantId === consultantId && !!c.birthday)
      .map((c) => ({
        clientId: c.id,
        name: c.name,
        phone: c.phone,
        birthday: c.birthday,
        daysUntil: daysUntilNextBirthday(c.birthday, today),
      }))
      .filter((r) => r.daysUntil <= days)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }

  async getAppointmentsSummary(consultantId: number, start: string, end: string): Promise<AppointmentsSummary> {
    const inRange = this.appointments.filter((a) => a.consultantId === consultantId && a.date >= start && a.date < end);
    const result: Record<string, number> = { pendiente: 0, confirmada: 0, completada: 0, cancelada: 0 };
    for (const apt of inRange) {
      if (apt.status in result) {
        result[apt.status] += 1;
      }
    }
    return result as unknown as AppointmentsSummary;
  }

  async getPendingInstallments(consultantId: number, limit = 20): Promise<PendingInstallmentRow[]> {
    const today = toDateStr(new Date());
    const saleById = new Map(this.sales.filter((s) => s.consultantId === consultantId).map((s) => [s.id, s]));

    return this.saleInstallments
      .filter((i) => i.status === "pendiente" && saleById.get(i.saleId) !== undefined && saleById.get(i.saleId)?.status !== "cancelada")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, limit)
      .map((i) => ({
        saleId: i.saleId,
        clientName: saleById.get(i.saleId)?.clientName ?? "—",
        installmentNumber: i.installmentNumber,
        amount: i.amount,
        dueDate: i.dueDate,
        isOverdue: i.dueDate < today,
      }));
  }

  /** Espejo de DatabaseStorage.getProductCostSummary. */
  async getProductCostSummary(consultantId: number, start?: string, end?: string): Promise<ProductCostSummary> {
    const activeSaleById = new Map(
      this.sales.filter((s) => s.consultantId === consultantId && s.status !== "cancelada").map((s) => [s.id, s]),
    );
    let productCost = 0;
    let hasIncompleteCostData = false;
    for (const item of this.saleItems) {
      const sale = activeSaleById.get(item.saleId);
      if (!sale) continue;
      if (start && sale.date < start) continue;
      if (end && sale.date >= end) continue;
      // Prompt 2: igual que DatabaseStorage — "incompleto" incluye las líneas estimadas, no
      // solo las legacy sin costPrice.
      if (item.costIsEstimated) hasIncompleteCostData = true;
      if (item.costPrice === null) {
        hasIncompleteCostData = true;
        continue;
      }
      productCost += item.quantity * item.costPrice;
    }
    return { productCost, hasIncompleteCostData };
  }

  /** Espejo de DatabaseStorage.getCollectedPayments. */
  async getCollectedPayments(consultantId: number): Promise<CollectedPayments> {
    const saleById = new Map(this.sales.filter((s) => s.consultantId === consultantId).map((s) => [s.id, s]));
    let totalCollected = 0;
    for (const inst of this.saleInstallments) {
      const sale = saleById.get(inst.saleId);
      if (!sale || sale.status === "cancelada" || inst.status !== "pagado") continue;
      totalCollected += inst.amount;
    }
    return { totalCollected };
  }

  /** Espejo de DatabaseStorage.getPendingInstallmentsTotals. */
  async getPendingInstallmentsTotals(consultantId: number): Promise<PendingInstallmentsTotals> {
    const today = toDateStr(new Date());
    const saleById = new Map(this.sales.filter((s) => s.consultantId === consultantId).map((s) => [s.id, s]));
    let totalPendingAmount = 0;
    let totalPendingCount = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    for (const inst of this.saleInstallments) {
      const sale = saleById.get(inst.saleId);
      if (!sale || sale.status === "cancelada" || inst.status !== "pendiente") continue;
      totalPendingAmount += inst.amount;
      totalPendingCount += 1;
      if (inst.dueDate < today) {
        overdueAmount += inst.amount;
        overdueCount += 1;
      }
    }
    return { totalPendingAmount, totalPendingCount, overdueAmount, overdueCount };
  }

  async getAllSales(consultantId: number): Promise<SaleWithItemCount[]> {
    return this.sales
      .filter((s) => s.consultantId === consultantId)
      .sort((a, b) => (a.date === b.date ? b.id - a.id : b.date.localeCompare(a.date)))
      .map((s) => {
        const items = this.saleItems.filter((i) => i.saleId === s.id);
        // Prompt 6: mismo criterio que DatabaseStorage.getAllSales — cancelada nunca debe nada.
        const pendingInstallments = s.status === "cancelada" ? [] : this.saleInstallments.filter((i) => i.saleId === s.id && i.status === "pendiente");
        const pendingAmount = pendingInstallments.reduce((sum, i) => sum + i.amount, 0);
        const nextDueDate = pendingInstallments.length > 0
          ? pendingInstallments.map((i) => i.dueDate).sort()[0]
          : null;
        return {
          ...s,
          itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
          hasEstimatedCost: items.some((i) => i.costIsEstimated === true || i.costPrice === null),
          paymentStatus: pendingAmount > 0 ? "te_debe" : "cobrada",
          pendingAmount,
          nextDueDate,
        };
      });
  }

  async getSaleDetails(consultantId: number, id: number): Promise<SaleWithDetails | undefined> {
    const sale = this.sales.find((s) => s.id === id && s.consultantId === consultantId);
    if (!sale) return undefined;

    return {
      ...sale,
      items: this.saleItems.filter((i) => i.saleId === id),
      installments: this.saleInstallments
        .filter((i) => i.saleId === id)
        .sort((a, b) => a.installmentNumber - b.installmentNumber),
    };
  }

  /** Misma semántica que `DatabaseStorage.resolveExistingSaleByClientRequestId` (Etapa I-B.6),
   * sin necesidad de manejar una carrera real: `MemoryStorage` no tiene ningún `await` entre
   * este chequeo y el `push` que registra la venta, así que no hay ventana de interleaving
   * posible (Node es single-threaded) — no hace falta un UNIQUE ni capturar su violación. */
  private resolveExistingSaleByClientRequestId(consultantId: number, input: CreateSaleInput): Sale | undefined {
    if (!input.clientRequestId) return undefined;
    const existing = this.sales.find((s) => s.consultantId === consultantId && s.clientRequestId === input.clientRequestId);
    if (!existing) return undefined;

    const existingItems = this.saleItems
      .filter((i) => i.saleId === existing.id)
      .map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price }));

    if (saleRequestMatchesExisting(input, existing, existingItems)) {
      return existing;
    }
    throw new SaleRequestConflictError("El clientRequestId ya fue utilizado para otra venta");
  }

  async createSale(consultantId: number, input: CreateSaleInput): Promise<Sale> {
    const earlyMatch = this.resolveExistingSaleByClientRequestId(consultantId, input);
    if (earlyMatch) return earlyMatch;

    const productIds = input.items.map((i) => i.productId);
    const productById = new Map((await this.getProductsByIds(consultantId, productIds)).map((p) => [p.id, p]));
    const habitualDiscountPercent = this.resolveHabitualDiscountPercentMem(consultantId);

    const lines = input.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) throw new SaleValidationError(`Producto ${item.productId} no encontrado`);
      // Etapa 7.4: mismo criterio que DatabaseStorage — un producto discontinuado no es
      // vendible en una venta nueva.
      if (product.discontinued) {
        throw new SaleValidationError(`"${product.producto}" está discontinuado y no está disponible para nuevas ventas`);
      }
      if (product.unidades < item.quantity) {
        throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${product.unidades})`);
      }
      const resolvedCost = resolveLineCost({ costPrice: product.costPrice, publicPrice: product.precio, habitualDiscountPercent });
      return {
        product,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? product.precio,
        costPrice: resolvedCost.costPrice,
        costIsEstimated: resolvedCost.isEstimated,
      };
    });

    const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
    const totals = computeSaleTotals({
      subtotal,
      orderDiscount: input.orderDiscount ?? null,
      orderSurcharge: input.orderSurcharge ?? null,
      shippingCharged: input.shippingCharged ?? null,
    });

    const installmentAmounts = input.installments.map((i) => i.amount);
    if (!installmentsSumMatches(installmentAmounts, totals.total)) {
      throw new SaleValidationError("La suma de las cuotas no coincide con el total de la venta");
    }

    // Prompt 6: clienta opcional ("Completar después") — mismo criterio que DatabaseStorage.
    let client: Client | undefined;
    let clientName: string;
    if (input.clientId !== undefined) {
      client = this.clients.find((c) => c.id === input.clientId && c.consultantId === consultantId);
      if (!client) throw new SaleValidationError("Clienta no encontrada");
      clientName = client.name ?? client.phone;
    } else {
      clientName = "Sin clienta";
    }

    // Prompt 6: mismo criterio que DatabaseStorage.createSale.
    const paidNow = input.paidNow ?? false;
    const firstDueDate = paidNow ? null : input.firstDueDate ?? input.date;
    const installmentPlans = buildInstallmentPlans({
      amounts: installmentAmounts,
      saleDate: input.date,
      paymentMethod: input.paymentMethod,
      paidNow,
      firstDueDate,
    });
    if (client === undefined && installmentPlans.some((p) => p.status === "pendiente")) {
      throw new SaleValidationError("Para dejar una venta pendiente de cobro tenés que elegir la clienta");
    }

    // Prompt 2: costo siempre real o explícitamente estimado — ver shared/saleCalculations.ts.
    const productCost = computeProductCost(lines.map((l) => ({ quantity: l.quantity, costPrice: l.costPrice })));
    const consultant = this.consultants.find((c) => c.id === consultantId);
    const grossIncomeTaxPercentTenths = consultant?.grossIncomeTaxPercentTenths ?? null;
    const ingresosBrutosAmount = computeGrossIncomeTax(totals.total, grossIncomeTaxPercentTenths);
    const profit = computeSaleProfit({
      total: totals.total,
      productCost,
      shippingCost: input.shippingCost ?? null,
      ingresosBrutos: ingresosBrutosAmount,
    });

    const sale: Sale = {
      id: this.nextSaleId++,
      consultantId,
      clientId: client?.id ?? null,
      clientName,
      date: input.date,
      subtotal,
      orderDiscountType: input.orderDiscount?.type ?? null,
      orderDiscountValue: input.orderDiscount?.value ?? null,
      orderSurchargeType: input.orderSurcharge?.type ?? null,
      orderSurchargeValue: input.orderSurcharge?.value ?? null,
      shippingCharged: input.shippingCharged ?? null,
      shippingCost: input.shippingCost ?? null,
      ingresosBrutos: ingresosBrutosAmount,
      grossIncomeTaxPercentTenths,
      total: totals.total,
      profit,
      paymentMethod: input.paymentMethod,
      installmentsCount: input.installments.length,
      installmentFrequency: input.installments.length > 1 ? input.installmentFrequency ?? null : null,
      status: "pendiente",
      deliveryStatus: "entregada",
      notes: input.notes ?? null,
      clientRequestId: input.clientRequestId ?? null,
    };
    this.sales.push(sale);

    for (const line of lines) {
      this.saleItems.push({
        id: this.nextSaleItemId++,
        saleId: sale.id,
        productId: line.product.id,
        productName: line.product.producto,
        category: line.product.seccion,
        quantity: line.quantity,
        originalPrice: line.product.precio,
        price: line.unitPrice,
        // Misma fuente que computeProductCost más arriba.
        costPrice: line.costPrice,
        costIsEstimated: line.costIsEstimated,
      });
      const stock = this.getOrCreateStock(consultantId, line.product.id);
      stock.unidades -= line.quantity;
    }

    installmentPlans.forEach((plan, index) => {
      this.saleInstallments.push({
        id: this.nextSaleInstallmentId++,
        saleId: sale.id,
        installmentNumber: index + 1,
        amount: plan.amount,
        dueDate: plan.dueDate,
        status: plan.status,
      });
    });

    return sale;
  }

  async updateSale(consultantId: number, id: number, input: UpdateSaleInput): Promise<Sale | undefined> {
    const existingSale = this.sales.find((s) => s.id === id && s.consultantId === consultantId);
    if (!existingSale) return undefined;
    if (existingSale.status === "cancelada") {
      throw new SaleValidationError("No se puede editar una venta cancelada");
    }

    // Prompt 6 — "edición inteligente": mismo criterio que DatabaseStorage.updateSale. Una
    // cuota ya cobrada se preserva tal cual; solo se recalculan las que seguían pendientes,
    // sobre el saldo que falta después de lo ya cobrado. Sin lock especial: no hay ningún
    // `await` entre este chequeo y las mutaciones de más abajo (Node es single-threaded).
    const existingInstallments = this.saleInstallments.filter((i) => i.saleId === id);
    const paidInstallments = existingInstallments.filter((i) => i.status === "pagado");
    const alreadyPaidAmount = paidInstallments.reduce((sum, i) => sum + i.amount, 0);

    const existingItems = this.saleItems.filter((i) => i.saleId === id);

    // Etapa 7.4: mismo criterio que DatabaseStorage — un producto discontinuado que ya era
    // parte de esta venta sigue siendo histórico válido; solo se rechaza si es NUEVO en esta
    // edición.
    const existingProductIds = new Set(
      existingItems.map((i) => i.productId).filter((pid): pid is number => pid !== null),
    );

    const involvedIds = Array.from(
      new Set([
        ...existingItems.map((i) => i.productId).filter((pid): pid is number => pid !== null),
        ...input.items.map((i) => i.productId),
      ]),
    );
    const productById = new Map((await this.getProductsByIds(consultantId, involvedIds)).map((p) => [p.id, p]));
    const stockById = new Map<number, number>();
    productById.forEach((p) => stockById.set(p.id, p.unidades));

    // 1) Restaurar el stock que esta venta tenía reservado (como si se hubiera eliminado).
    for (const item of existingItems) {
      if (item.productId !== null) {
        stockById.set(item.productId, (stockById.get(item.productId) ?? 0) + item.quantity);
      }
    }

    // 2) Validar y reservar stock para la nueva composición, sobre el stock ya restaurado.
    const habitualDiscountPercent = this.resolveHabitualDiscountPercentMem(consultantId);
    const lines = input.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) throw new SaleValidationError(`Producto ${item.productId} no encontrado`);
      if (product.discontinued && !existingProductIds.has(item.productId)) {
        throw new SaleValidationError(`"${product.producto}" está discontinuado y no está disponible para nuevas ventas`);
      }
      const available = stockById.get(item.productId) ?? 0;
      if (available < item.quantity) {
        throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${available})`);
      }
      stockById.set(item.productId, available - item.quantity);
      const resolvedCost = resolveLineCost({ costPrice: product.costPrice, publicPrice: product.precio, habitualDiscountPercent });
      return {
        product,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? product.precio,
        costPrice: resolvedCost.costPrice,
        costIsEstimated: resolvedCost.isEstimated,
      };
    });

    const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
    const totals = computeSaleTotals({
      subtotal,
      orderDiscount: input.orderDiscount ?? null,
      orderSurcharge: input.orderSurcharge ?? null,
      shippingCharged: input.shippingCharged ?? null,
    });

    // Prompt 6: `input.installments` describe el SALDO que falta, no el total de la venta,
    // cuando ya se cobró algo antes de esta edición.
    const installmentAmounts = input.installments.map((i) => i.amount);
    const remainingTotal = totals.total - alreadyPaidAmount;
    if (remainingTotal < 0) {
      throw new SaleValidationError(`El nuevo total no puede ser menor que lo que ya se cobró (${alreadyPaidAmount})`);
    }
    if (!installmentsSumMatches(installmentAmounts, remainingTotal)) {
      throw new SaleValidationError("La suma de las cuotas no coincide con el saldo pendiente de la venta");
    }

    const paidNow = input.paidNow ?? false;
    const firstDueDate = paidNow ? null : input.firstDueDate ?? existingSale.date;
    const installmentPlans = buildInstallmentPlans({
      amounts: installmentAmounts,
      saleDate: existingSale.date,
      paymentMethod: input.paymentMethod,
      paidNow,
      firstDueDate,
    }).filter((plan) => plan.amount > 0);
    if (existingSale.clientId === null && installmentPlans.some((p) => p.status === "pendiente")) {
      throw new SaleValidationError("Para dejar una venta pendiente de cobro tenés que elegir la clienta");
    }

    // Prompt 2: misma fórmula que DatabaseStorage.updateSale.
    const productCost = computeProductCost(lines.map((l) => ({ quantity: l.quantity, costPrice: l.costPrice })));
    const consultant = this.consultants.find((c) => c.id === consultantId);
    const grossIncomeTaxPercentTenths = consultant?.grossIncomeTaxPercentTenths ?? null;
    const ingresosBrutosAmount = computeGrossIncomeTax(totals.total, grossIncomeTaxPercentTenths);
    const profit = computeSaleProfit({
      total: totals.total,
      productCost,
      shippingCost: input.shippingCost ?? null,
      ingresosBrutos: ingresosBrutosAmount,
    });

    // A partir de acá ya está todo validado: recién ahora se muta estado.
    stockById.forEach((newStock, productId) => {
      const stock = this.getOrCreateStock(consultantId, productId);
      stock.unidades = newStock;
    });

    this.saleItems = this.saleItems.filter((i) => i.saleId !== id);
    // Prompt 6: solo se borran las cuotas PENDIENTES — las ya cobradas quedan intactas.
    this.saleInstallments = this.saleInstallments.filter((i) => i.saleId !== id || i.status === "pagado");

    for (const line of lines) {
      this.saleItems.push({
        id: this.nextSaleItemId++,
        saleId: id,
        productId: line.product.id,
        productName: line.product.producto,
        category: line.product.seccion,
        quantity: line.quantity,
        originalPrice: line.product.precio,
        price: line.unitPrice,
        // Costo vigente al momento de esta edición — misma fuente que computeProductCost más
        // arriba. La composición se reemplaza por completo.
        costPrice: line.costPrice,
        costIsEstimated: line.costIsEstimated,
      });
    }

    installmentPlans.forEach((plan, index) => {
      this.saleInstallments.push({
        id: this.nextSaleInstallmentId++,
        saleId: id,
        installmentNumber: paidInstallments.length + index + 1,
        amount: plan.amount,
        dueDate: plan.dueDate,
        status: plan.status,
      });
    });

    existingSale.subtotal = subtotal;
    existingSale.orderDiscountType = input.orderDiscount?.type ?? null;
    existingSale.orderDiscountValue = input.orderDiscount?.value ?? null;
    existingSale.orderSurchargeType = input.orderSurcharge?.type ?? null;
    existingSale.orderSurchargeValue = input.orderSurcharge?.value ?? null;
    existingSale.shippingCharged = input.shippingCharged ?? null;
    existingSale.shippingCost = input.shippingCost ?? null;
    existingSale.ingresosBrutos = ingresosBrutosAmount;
    existingSale.grossIncomeTaxPercentTenths = grossIncomeTaxPercentTenths;
    existingSale.total = totals.total;
    existingSale.profit = profit;
    existingSale.paymentMethod = input.paymentMethod;
    // Prompt 6: ya cobradas + nuevas — mismo criterio que DatabaseStorage.updateSale.
    const installmentsCount = paidInstallments.length + installmentAmounts.filter((a) => a > 0).length;
    existingSale.installmentsCount = installmentsCount;
    existingSale.installmentFrequency = installmentsCount > 1 ? input.installmentFrequency ?? null : null;
    existingSale.notes = input.notes ?? null;

    return existingSale;
  }

  async cancelSale(consultantId: number, id: number): Promise<Sale | undefined> {
    const existingSale = this.sales.find((s) => s.id === id && s.consultantId === consultantId);
    if (!existingSale) return undefined;
    if (existingSale.status === "cancelada") {
      throw new SaleValidationError("La venta ya está cancelada");
    }

    const items = this.saleItems.filter((i) => i.saleId === id);
    for (const item of items) {
      if (item.productId !== null) {
        const stock = this.getOrCreateStock(consultantId, item.productId);
        stock.unidades += item.quantity;
      }
    }

    existingSale.status = "cancelada";
    return existingSale;
  }

  async updateInstallmentStatus(consultantId: number, saleId: number, installmentId: number, status: "pendiente" | "pagado"): Promise<SaleInstallment | undefined> {
    const sale = this.sales.find((s) => s.id === saleId && s.consultantId === consultantId);
    if (!sale) return undefined;
    if (sale.status === "cancelada") {
      throw new SaleValidationError("No se puede modificar una cuota de una venta cancelada");
    }

    const installment = this.saleInstallments.find((i) => i.id === installmentId && i.saleId === saleId);
    if (!installment) return undefined;

    installment.status = status;
    return installment;
  }

  async setSaleDeliveryStatus(consultantId: number, saleId: number, deliveryStatus: "entregada" | "pendiente_entrega"): Promise<Sale | undefined> {
    const sale = this.sales.find((s) => s.id === saleId && s.consultantId === consultantId);
    if (!sale) return undefined;
    if (sale.status === "cancelada") {
      throw new SaleValidationError("No se puede cambiar la entrega de una venta cancelada");
    }
    sale.deliveryStatus = deliveryStatus;
    return sale;
  }

}

function createStorage(): IStorage {
  const mode = resolveStorageMode();
  return mode === "memory" ? new MemoryStorage() : new DatabaseStorage();
}

export const storage = createStorage();
