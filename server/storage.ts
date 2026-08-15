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
  createSaleSchema,
  updateSaleSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  updateBusinessSettingsSchema,
  createProductSchema,
  appointmentStatuses,
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
} from "@shared/schema";
import {
  computeSubtotal,
  computeSaleTotals,
  installmentsSumMatches,
  computeInstallmentDueDate,
} from "@shared/saleCalculations";
import type { z } from "zod";
import { eq, ne, count, sql, and, gte, lt, asc, desc, isNotNull, isNull, inArray, ilike, or } from "drizzle-orm";
import type { db as database } from "./db";
import { resolveStorageMode } from "./storage-mode";
import { slugify } from "@shared/slug";
import bcrypt from "bcryptjs";

export class SaleValidationError extends Error {}
export class AppointmentValidationError extends Error {}

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

type ProductRow = typeof products.$inferSelect;
type StockFields = Pick<ProductStock, "unidades" | "stockMinimo" | "costPrice" | "selectedDiscount" | "discontinued">;

/** `previousImage` es el valor que tenía la fila justo antes de este cambio, leído bajo lock
 * — nunca una foto vieja tomada antes de subir el archivo nuevo. Así, si dos reemplazos del
 * mismo producto se pisan, cada uno borra exactamente el archivo que dejó de estar referenciado
 * (nunca el que "ganó"), sin importar el orden en que terminen. */
export interface SetProductImageResult {
  product: ProductRow | undefined;
  previousImage: string | null;
}

/** Combina un producto de catálogo con la fila de stock de la consultora que lo está mirando
 * (o los defaults, si todavía no tiene una) — la forma `Product` que consume el resto de la app. */
function withStockDefaults(product: ProductRow, stock?: StockFields | null): Product {
  return {
    ...product,
    unidades: stock?.unidades ?? 0,
    stockMinimo: stock?.stockMinimo ?? 5,
    costPrice: stock?.costPrice ?? null,
    selectedDiscount: stock?.selectedDiscount ?? null,
    discontinued: stock?.discontinued ?? false,
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
}

export interface SaleWithItemCount extends Sale {
  itemCount: number;
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
  toggleUserStatus(id: number): Promise<User | undefined>;
  /** Para el bootstrap del primer admin: si ya existe alguno, el script no debe crear otro. */
  hasAdminAccount(): Promise<boolean>;
  getProductCount(): Promise<number>;
  /** Admin-only: lista de consultoras existentes. */
  listConsultantAccounts(): Promise<Consultant[]>;
  getBusinessSettings(consultantId: number): Promise<Consultant | undefined>;
  updateBusinessSettings(consultantId: number, input: UpdateBusinessSettingsInput): Promise<Consultant | undefined>;
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
  setProductDiscontinued(consultantId: number, productId: number, discontinued: boolean): Promise<Product | undefined>;
  /** La consultora fija su propio stock sobre un producto (global o manual propio). */
  setProductStock(consultantId: number, productId: number, unidades: number): Promise<Product | undefined>;
  /** Admin-only: catálogo global completo (sin stock, eso es por consultora) para la pantalla de imágenes. */
  listGlobalProducts(): Promise<ProductRow[]>;
  /** Admin-only: solo aplica a productos globales — las imágenes de productos manuales las
   * gestiona cada consultora dueña, no el admin. */
  setProductImage(productId: number, imagen: string | null): Promise<SetProductImageResult>;
  getUpcomingAppointments(consultantId: number, limit?: number): Promise<Appointment[]>;
  getAppointmentsInRange(consultantId: number, start: string, end: string): Promise<Appointment[]>;
  createAppointment(consultantId: number, input: CreateAppointmentInput): Promise<Appointment | undefined>;
  updateAppointment(consultantId: number, id: number, input: UpdateAppointmentInput): Promise<Appointment | undefined>;
  updateAppointmentStatus(consultantId: number, id: number, status: AppointmentStatus): Promise<Appointment | undefined>;
  deleteAppointment(consultantId: number, id: number): Promise<boolean>;
  getTopClients(consultantId: number, limit?: number, start?: string, end?: string): Promise<TopClient[]>;
  getClientById(consultantId: number, id: number): Promise<Client | undefined>;
  searchClients(consultantId: number, query?: string, limit?: number): Promise<ClientWithStats[]>;
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
  seedDashboardDemoData(consultantId: number): Promise<void>;
  getSalesSummary(consultantId: number, start: string, end: string, groupBy?: ReportGroupBy): Promise<SalesSummaryPoint[]>;
  getTopCategories(consultantId: number, start?: string, end?: string): Promise<TopCategory[]>;
  getSalesByPaymentMethod(consultantId: number, start?: string, end?: string): Promise<PaymentMethodBreakdown[]>;
  getInstallmentsBreakdown(consultantId: number, start?: string, end?: string): Promise<InstallmentsBreakdown>;
  getStockValuation(consultantId: number): Promise<StockValuation>;
  getInactiveClients(consultantId: number, days: number): Promise<InactiveClient[]>;
  getUpcomingBirthdays(consultantId: number, days: number): Promise<UpcomingBirthday[]>;
  getAppointmentsSummary(consultantId: number, start: string, end: string): Promise<AppointmentsSummary>;
  getPendingInstallments(consultantId: number, limit?: number): Promise<PendingInstallmentRow[]>;
}

type Database = typeof database;

export class DatabaseStorage implements IStorage {
  private dbPromise: Promise<Database> | undefined;

  private async getDb(): Promise<Database> {
    this.dbPromise ??= import("./db").then((module) => module.db);
    return this.dbPromise;
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

    // Toda cuenta consultora nace con su propia consultora — nunca comparte tenant con otra.
    let consultantId = insertUser.consultantId ?? null;
    if (insertUser.role === "consultant" && consultantId === null) {
      const [consultant] = await db
        .insert(consultants)
        .values({ businessName: insertUser.username, currency: "ARS", monthlyGoal: null })
        .returning();
      consultantId = consultant.id;
    }

    const [user] = await db
      .insert(users)
      .values({ ...insertUser, password: hashedPassword, consultantId })
      .returning();
    return user;
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

  async toggleUserStatus(id: number): Promise<User | undefined> {
    const existing = await this.getUser(id);
    if (!existing) return undefined;

    const db = await this.getDb();
    const [updated] = await db
      .update(users)
      .set({ status: !existing.status })
      .where(eq(users.id, id))
      .returning();
    return updated;
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

  async updateBusinessSettings(consultantId: number, input: UpdateBusinessSettingsInput): Promise<Consultant | undefined> {
    const db = await this.getDb();
    const [updated] = await db
      .update(consultants)
      .set({ businessName: input.businessName, currency: input.currency, monthlyGoal: input.monthlyGoal ?? null })
      .where(eq(consultants.id, consultantId))
      .returning();
    return updated;
  }

  /** Catálogo visible para la consultora: lo global (consultantId null) + lo manual propio,
   * con su stock resuelto (o defaults si todavía no cargó stock para ese producto). */
  async getAllProducts(consultantId: number): Promise<Product[]> {
    const db = await this.getDb();
    const rows = await db
      .select({ product: products, stock: productStock })
      .from(products)
      .leftJoin(productStock, and(eq(productStock.productId, products.id), eq(productStock.consultantId, consultantId)))
      .where(or(isNull(products.consultantId), eq(products.consultantId, consultantId)))
      .orderBy(products.seccion, products.linea, products.producto);
    return rows.map((r) => withStockDefaults(r.product, r.stock));
  }

  async getProductsByIds(consultantId: number, ids: number[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const db = await this.getDb();
    const rows = await db
      .select({ product: products, stock: productStock })
      .from(products)
      .leftJoin(productStock, and(eq(productStock.productId, products.id), eq(productStock.consultantId, consultantId)))
      .where(and(inArray(products.id, ids), or(isNull(products.consultantId), eq(products.consultantId, consultantId))));
    return rows.map((r) => withStockDefaults(r.product, r.stock));
  }

  /** Admin-only: carga/actualiza el catálogo GLOBAL. `unique(consultantId, codigo)` no alcanza
   * para deduplicar filas globales (dos NULL nunca son "iguales" en SQL), así que en vez de un
   * ON CONFLICT con índice parcial (no verificable contra Postgres real en este entorno) se hace
   * un select-then-upsert explícito por código — mismo resultado, portable a MemoryStorage. */
  async bulkInsertProducts(items: InsertProduct[]): Promise<number> {
    if (items.length === 0) return 0;

    const db = await this.getDb();
    let changed = 0;
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
   * "stock bajo" de todo el catálogo global que todavía no tocó. */
  async getLowStockProducts(consultantId: number): Promise<Product[]> {
    const db = await this.getDb();
    const rows = await db
      .select({ product: products, stock: productStock })
      .from(productStock)
      .innerJoin(products, eq(products.id, productStock.productId))
      .where(and(eq(productStock.consultantId, consultantId), sql`${productStock.unidades} <= ${productStock.stockMinimo}`))
      .orderBy(asc(productStock.unidades));
    return rows.map((r) => withStockDefaults(r.product, r.stock));
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
    return withStockDefaults(product, stock);
  }

  async createProduct(consultantId: number, input: CreateProductInput): Promise<Product> {
    const db = await this.getDb();
    const variante = input.variante ?? "Estándar";
    const codigo = input.codigo ?? slugify(`${input.seccion}-${input.linea ?? ""}-${input.producto}-${variante}-${Date.now()}`);
    return db.transaction(async (tx) => {
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
          stockMinimo: input.stockMinimo ?? 5,
        })
        .returning();
      return withStockDefaults(created, stock);
    });
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
    return withStockDefaults(product, stock);
  }

  async setProductStock(consultantId: number, productId: number, unidades: number): Promise<Product | undefined> {
    const db = await this.getDb();
    const product = await this.findVisibleProduct(db, consultantId, productId);
    if (!product) return undefined;

    const [stock] = await db
      .insert(productStock)
      .values({ consultantId, productId, unidades })
      .onConflictDoUpdate({
        target: [productStock.consultantId, productStock.productId],
        set: { unidades },
      })
      .returning();
    return withStockDefaults(product, stock);
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
          sql`(${appointments.date} > ${nowDate}) OR (${appointments.date} = ${nowDate} AND ${appointments.time} >= ${nowTime})`,
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

  async createAppointment(consultantId: number, input: CreateAppointmentInput): Promise<Appointment | undefined> {
    const db = await this.getDb();
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.consultantId, consultantId)));
    if (!client) return undefined;
    const clientName = client.name ?? client.phone;

    const [appointment] = await db
      .insert(appointments)
      .values({
        consultantId,
        clientId: client.id,
        clientName,
        date: input.date,
        time: input.time,
        type: input.type,
        location: input.location ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return appointment;
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

    const [updated] = await db
      .update(appointments)
      .set({
        clientId: client.id,
        clientName,
        date: input.date,
        time: input.time,
        type: input.type,
        location: input.location ?? null,
        notes: input.notes ?? null,
      })
      .where(eq(appointments.id, id))
      .returning();
    return updated;
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
          .limit(limit)
      : await db.select().from(clients).where(eq(clients.consultantId, consultantId)).limit(limit);

    if (rows.length === 0) return [];

    const clientIds = rows.map((r) => r.id);
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

    return rows.map((row) => ({
      ...row,
      totalPurchases: Number(statsByClient.get(row.id)?.totalAmount ?? 0),
      lastPurchase: statsByClient.get(row.id)?.lastDate ?? null,
    }));
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

    await db.delete(clients).where(eq(clients.id, id));
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
    const [row] = await db
      .select({
        valueAtCost: sql<number>`coalesce(sum(${productStock.unidades} * coalesce(${productStock.costPrice}, ${products.precio})), 0)`,
        valueAtPrice: sql<number>`coalesce(sum(${productStock.unidades} * ${products.precio}), 0)`,
        productCount: count(products.id),
        unitCount: sql<number>`coalesce(sum(${productStock.unidades}), 0)`,
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

  async getAllSales(consultantId: number): Promise<SaleWithItemCount[]> {
    const db = await this.getDb();
    const salesRows = await db.select().from(sales).where(eq(sales.consultantId, consultantId)).orderBy(desc(sales.date), desc(sales.id));
    if (salesRows.length === 0) return [];

    const saleIds = salesRows.map((s) => s.id);
    const counts = await db
      .select({ saleId: saleItems.saleId, itemCount: sql<number>`coalesce(sum(${saleItems.quantity}), 0)` })
      .from(saleItems)
      .where(inArray(saleItems.saleId, saleIds))
      .groupBy(saleItems.saleId);
    const countBySale = new Map(counts.map((c) => [c.saleId, Number(c.itemCount)]));

    return salesRows.map((s) => ({ ...s, itemCount: countBySale.get(s.id) ?? 0 }));
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

  async createSale(consultantId: number, input: CreateSaleInput): Promise<Sale> {
    const db = await this.getDb();

    const productIds = Array.from(new Set(input.items.map((i) => i.productId)));

    // Catálogo (nombre/precio/sección): no lo toca ninguna venta concurrente, se puede leer
    // sin lock. El stock sí — se relee y se bloquea recién dentro de la transacción, más abajo.
    const catalogRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, productIds), or(isNull(products.consultantId), eq(products.consultantId, consultantId))));
    const catalogById = new Map(catalogRows.map((p) => [p.id, p]));

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.consultantId, consultantId)));
    if (!client) throw new SaleValidationError("Clienta no encontrada");
    const clientName = client.name ?? client.phone;

    return db.transaction(async (tx) => {
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
        const available = stock?.unidades ?? 0;
        if (available < item.quantity) {
          throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${available})`);
        }
        return {
          product,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? product.precio,
          costPrice: stock?.costPrice ?? null,
          remainingAfterSale: available - item.quantity,
        };
      });

      const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
      const totals = computeSaleTotals({
        subtotal,
        orderDiscount: input.orderDiscount ?? null,
        orderSurcharge: input.orderSurcharge ?? null,
        shippingCost: input.shippingCost ?? null,
      });

      const installmentAmounts = input.installments.map((i) => i.amount);
      if (!installmentsSumMatches(installmentAmounts, totals.total)) {
        throw new SaleValidationError("La suma de las cuotas no coincide con el total de la venta");
      }

      const profit = lines.reduce((sum, l) => {
        const cost = l.costPrice ?? l.product.precio;
        return sum + (l.unitPrice - cost) * l.quantity;
      }, 0);

      const [sale] = await tx
        .insert(sales)
        .values({
          consultantId,
          clientId: client.id,
          clientName,
          date: input.date,
          subtotal,
          orderDiscountType: input.orderDiscount?.type ?? null,
          orderDiscountValue: input.orderDiscount?.value ?? null,
          orderSurchargeType: input.orderSurcharge?.type ?? null,
          orderSurchargeValue: input.orderSurcharge?.value ?? null,
          shippingCost: input.shippingCost ?? null,
          total: totals.total,
          profit,
          paymentMethod: input.paymentMethod,
          installmentsCount: input.installments.length,
          installmentFrequency: input.installments.length > 1 ? input.installmentFrequency ?? null : null,
          status: input.status,
          notes: input.notes ?? null,
        })
        .returning();

      await tx.insert(saleItems).values(
        lines.map((l) => ({
          saleId: sale.id,
          productId: l.product.id,
          productName: l.product.producto,
          category: l.product.seccion,
          quantity: l.quantity,
          originalPrice: l.product.precio,
          price: l.unitPrice,
        })),
      );

      await tx.insert(saleInstallments).values(
        installmentAmounts.map((amount, index) => ({
          saleId: sale.id,
          installmentNumber: index + 1,
          amount,
          dueDate: computeInstallmentDueDate(input.date, input.installmentFrequency, index),
          status: "pendiente",
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
  }

  /**
   * Reemplaza por completo productos/cuotas de una venta existente y recalcula todo,
   * exactamente como si se eliminara la venta y se volviera a crear con los nuevos datos,
   * pero conservando el mismo registro (para auditoría e historial).
   * Todo o nada: reutiliza el mismo `db.transaction` que ya usa `createSale`.
   */
  async updateSale(consultantId: number, id: number, input: UpdateSaleInput): Promise<Sale | undefined> {
    const db = await this.getDb();

    return db.transaction(async (tx) => {
      const [existingSale] = await tx.select().from(sales).where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)));
      if (!existingSale) return undefined;
      if (existingSale.status === "cancelada") {
        throw new SaleValidationError("No se puede editar una venta cancelada");
      }

      const existingItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));

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
        const available = stockById.get(item.productId) ?? 0;
        if (available < item.quantity) {
          throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${available})`);
        }
        stockById.set(item.productId, available - item.quantity);
        const costPrice = stockRowById.get(item.productId)?.costPrice ?? null;
        return { product, quantity: item.quantity, unitPrice: item.unitPrice ?? product.precio, costPrice };
      });

      const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
      const totals = computeSaleTotals({
        subtotal,
        orderDiscount: input.orderDiscount ?? null,
        orderSurcharge: input.orderSurcharge ?? null,
        shippingCost: input.shippingCost ?? null,
      });

      const installmentAmounts = input.installments.map((i) => i.amount);
      if (!installmentsSumMatches(installmentAmounts, totals.total)) {
        throw new SaleValidationError("La suma de las cuotas no coincide con el total de la venta");
      }

      const profit = lines.reduce((sum, l) => {
        const cost = l.costPrice ?? l.product.precio;
        return sum + (l.unitPrice - cost) * l.quantity;
      }, 0);

      // A partir de acá ya está todo validado: recién ahora se escribe.
      for (const productId of involvedIds) {
        await tx
          .update(productStock)
          .set({ unidades: stockById.get(productId)! })
          .where(and(eq(productStock.consultantId, consultantId), eq(productStock.productId, productId)));
      }

      await tx.delete(saleItems).where(eq(saleItems.saleId, id));
      await tx.delete(saleInstallments).where(eq(saleInstallments.saleId, id));

      await tx.insert(saleItems).values(
        lines.map((l) => ({
          saleId: id,
          productId: l.product.id,
          productName: l.product.producto,
          category: l.product.seccion,
          quantity: l.quantity,
          originalPrice: l.product.precio,
          price: l.unitPrice,
        })),
      );

      await tx.insert(saleInstallments).values(
        installmentAmounts.map((amount, index) => ({
          saleId: id,
          installmentNumber: index + 1,
          amount,
          dueDate: computeInstallmentDueDate(existingSale.date, input.installmentFrequency, index),
          status: "pendiente",
        })),
      );

      const [updated] = await tx
        .update(sales)
        .set({
          subtotal,
          orderDiscountType: input.orderDiscount?.type ?? null,
          orderDiscountValue: input.orderDiscount?.value ?? null,
          orderSurchargeType: input.orderSurcharge?.type ?? null,
          orderSurchargeValue: input.orderSurcharge?.value ?? null,
          shippingCost: input.shippingCost ?? null,
          total: totals.total,
          profit,
          paymentMethod: input.paymentMethod,
          installmentsCount: installmentAmounts.length,
          installmentFrequency: installmentAmounts.length > 1 ? input.installmentFrequency ?? null : null,
          notes: input.notes ?? null,
        })
        .where(eq(sales.id, id))
        .returning();

      return updated;
    });
  }

  /** No elimina la venta: la conserva para auditoría, solo cambia su estado y devuelve el stock. */
  async cancelSale(consultantId: number, id: number): Promise<Sale | undefined> {
    const db = await this.getDb();

    return db.transaction(async (tx) => {
      const [existingSale] = await tx.select().from(sales).where(and(eq(sales.id, id), eq(sales.consultantId, consultantId)));
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

      const [updated] = await tx.update(sales).set({ status: "cancelada" }).where(eq(sales.id, id)).returning();
      return updated;
    });
  }

  async updateInstallmentStatus(consultantId: number, saleId: number, installmentId: number, status: "pendiente" | "pagado"): Promise<SaleInstallment | undefined> {
    const db = await this.getDb();
    const [sale] = await db.select().from(sales).where(and(eq(sales.id, saleId), eq(sales.consultantId, consultantId)));
    if (!sale) return undefined;
    if (sale.status === "cancelada") {
      throw new SaleValidationError("No se puede modificar una cuota de una venta cancelada");
    }

    const [installment] = await db
      .select()
      .from(saleInstallments)
      .where(and(eq(saleInstallments.id, installmentId), eq(saleInstallments.saleId, saleId)));
    if (!installment) return undefined;

    const [updated] = await db
      .update(saleInstallments)
      .set({ status })
      .where(eq(saleInstallments.id, installmentId))
      .returning();
    return updated;
  }

  async seedDashboardDemoData(consultantId: number): Promise<void> {
    const db = await this.getDb();
    const existingProducts = await this.getAllProducts(consultantId);
    if (existingProducts.length === 0) return;

    const [c1] = await db
      .insert(clients)
      .values({ consultantId, name: "María García López", phone: "5551234567", email: "maria.garcia@email.com" })
      .returning();
    const [c2] = await db
      .insert(clients)
      .values({ consultantId, name: "Ana Martínez Ruiz", phone: "5552345678", email: "ana.martinez@email.com" })
      .returning();
    const c1Name = c1.name ?? c1.phone;
    const c2Name = c2.name ?? c2.phone;

    const now = new Date();
    const inDays = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

    await db.insert(appointments).values([
      {
        consultantId,
        clientId: c1.id,
        clientName: c1Name,
        date: toDateStr(inDays(3)),
        time: "17:00",
        type: "demostracion",
        location: "Colonia Roma",
        status: "confirmada",
      },
      {
        consultantId,
        clientId: c2.id,
        clientName: c2Name,
        date: toDateStr(inDays(5)),
        time: "10:30",
        type: "entrega",
        notes: "Traer catálogo nuevo",
        status: "pendiente",
      },
    ]);

    const p1 = existingProducts[0];
    const p2 = existingProducts[1] ?? existingProducts[0];
    const today = toDateStr(now);

    const [sale1] = await db
      .insert(sales)
      .values({
        consultantId,
        clientId: c1.id,
        clientName: c1Name,
        date: today,
        subtotal: p1.precio * 2,
        total: p1.precio * 2,
        profit: Math.round(p1.precio * 0.4),
        status: "pagado",
      })
      .returning();
    await db.insert(saleItems).values({
      saleId: sale1.id,
      productId: p1.id,
      productName: p1.producto,
      category: p1.seccion,
      quantity: 2,
      originalPrice: p1.precio,
      price: p1.precio,
    });

    const [sale2] = await db
      .insert(sales)
      .values({
        consultantId,
        clientId: c1.id,
        clientName: c1Name,
        date: today,
        subtotal: p2.precio,
        total: p2.precio,
        profit: Math.round(p2.precio * 0.4),
        status: "entregado",
      })
      .returning();
    await db.insert(saleItems).values({
      saleId: sale2.id,
      productId: p2.id,
      productName: p2.producto,
      category: p2.seccion,
      quantity: 1,
      originalPrice: p2.precio,
      price: p2.precio,
    });

    const [sale3] = await db
      .insert(sales)
      .values({
        consultantId,
        clientId: c2.id,
        clientName: c2Name,
        date: today,
        subtotal: p1.precio,
        total: p1.precio,
        profit: Math.round(p1.precio * 0.4),
        status: "pagado",
      })
      .returning();
    await db.insert(saleItems).values({
      saleId: sale3.id,
      productId: p1.id,
      productName: p1.producto,
      category: p1.seccion,
      quantity: 1,
      originalPrice: p1.precio,
      price: p1.precio,
    });
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
  private nextUserId = 1;
  private nextConsultantId = 1;
  private nextProductId = 1;
  private nextProductStockId = 1;
  private nextClientId = 1;
  private nextAppointmentId = 1;
  private nextSaleId = 1;
  private nextSaleItemId = 1;
  private nextSaleInstallmentId = 1;

  /** Fila de stock de la consultora sobre un producto, creándola con defaults si no existe. */
  private getOrCreateStock(consultantId: number, productId: number): ProductStock {
    let stock = this.productStock.find((s) => s.consultantId === consultantId && s.productId === productId);
    if (!stock) {
      stock = {
        id: this.nextProductStockId++,
        consultantId,
        productId,
        unidades: 0,
        stockMinimo: 5,
        costPrice: null,
        selectedDiscount: null,
        discontinued: false,
      };
      this.productStock.push(stock);
    }
    return stock;
  }

  /** Producto visible para la consultora (global o manual propio) o undefined si no aplica. */
  private findVisibleProduct(consultantId: number, productId: number): ProductRow | undefined {
    return this.products.find((p) => p.id === productId && (p.consultantId === null || p.consultantId === consultantId));
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
      };
      this.consultants.push(consultant);
      consultantId = consultant.id;
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

  async toggleUserStatus(id: number): Promise<User | undefined> {
    const user = await this.getUser(id);
    if (!user) return undefined;

    user.status = !user.status;
    return user;
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
    return consultant;
  }

  async getAllProducts(consultantId: number): Promise<Product[]> {
    return this.products
      .filter((p) => p.consultantId === null || p.consultantId === consultantId)
      .sort((a, b) =>
        [a.seccion, a.linea ?? "", a.producto].join(" ").localeCompare(
          [b.seccion, b.linea ?? "", b.producto].join(" "),
        ),
      )
      .map((p) => withStockDefaults(p, this.productStock.find((s) => s.consultantId === consultantId && s.productId === p.id)));
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
    return this.productStock
      .filter((s) => s.consultantId === consultantId && s.unidades <= s.stockMinimo)
      .sort((a, b) => a.unidades - b.unidades)
      .map((s) => {
        const product = this.products.find((p) => p.id === s.productId)!;
        return withStockDefaults(product, s);
      });
  }

  async applyProductDiscount(consultantId: number, productId: number, discountPercent: number): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.selectedDiscount = discountPercent;
    stock.costPrice = Math.round(product.precio * (1 - discountPercent / 100));
    return withStockDefaults(product, stock);
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
    stock.stockMinimo = input.stockMinimo ?? 5;
    return withStockDefaults(product, stock);
  }

  async setProductDiscontinued(consultantId: number, productId: number, discontinued: boolean): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.discontinued = discontinued;
    return withStockDefaults(product, stock);
  }

  async setProductStock(consultantId: number, productId: number, unidades: number): Promise<Product | undefined> {
    const product = this.findVisibleProduct(consultantId, productId);
    if (!product) return undefined;
    const stock = this.getOrCreateStock(consultantId, productId);
    stock.unidades = unidades;
    return withStockDefaults(product, stock);
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

  async createAppointment(consultantId: number, input: CreateAppointmentInput): Promise<Appointment | undefined> {
    const client = this.clients.find((c) => c.id === input.clientId && c.consultantId === consultantId);
    if (!client) return undefined;
    const clientName = client.name ?? client.phone;

    const appointment: Appointment = {
      id: this.nextAppointmentId++,
      consultantId,
      clientId: client.id,
      clientName,
      date: input.date,
      time: input.time,
      type: input.type,
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

    existing.clientId = client.id;
    existing.clientName = clientName;
    existing.date = input.date;
    existing.time = input.time;
    existing.type = input.type;
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

  async searchClients(consultantId: number, query = "", limit = 20): Promise<ClientWithStats[]> {
    const term = query.trim().toLowerCase();
    const ownClients = this.clients.filter((c) => c.consultantId === consultantId);
    const filtered = term
      ? ownClients.filter(
          (c) =>
            (c.name ?? "").toLowerCase().includes(term) ||
            c.phone.includes(term) ||
            (c.email ?? "").toLowerCase().includes(term) ||
            (c.address ?? "").toLowerCase().includes(term) ||
            (c.notes ?? "").toLowerCase().includes(term),
        )
      : ownClients;

    return filtered.slice(0, limit).map((c) => {
      const clientSales = this.sales.filter((s) => s.clientId === c.id && s.status !== "cancelada");
      const totalPurchases = clientSales.reduce((sum, s) => sum + s.total, 0);
      const lastPurchase = clientSales.length
        ? clientSales.map((s) => s.date).sort().slice(-1)[0]
        : null;
      return { ...c, totalPurchases, lastPurchase };
    });
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
    let valueAtCost = 0;
    let valueAtPrice = 0;
    let unitCount = 0;
    let productCount = 0;
    for (const stock of this.productStock) {
      if (stock.consultantId !== consultantId) continue;
      const product = this.products.find((p) => p.id === stock.productId);
      if (!product) continue;
      const cost = stock.costPrice ?? product.precio;
      valueAtCost += stock.unidades * cost;
      valueAtPrice += stock.unidades * product.precio;
      unitCount += stock.unidades;
      productCount++;
    }
    return {
      valueAtCost,
      valueAtPrice,
      potentialProfit: valueAtPrice - valueAtCost,
      productCount,
      unitCount,
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

  async getAllSales(consultantId: number): Promise<SaleWithItemCount[]> {
    return this.sales
      .filter((s) => s.consultantId === consultantId)
      .sort((a, b) => (a.date === b.date ? b.id - a.id : b.date.localeCompare(a.date)))
      .map((s) => ({
        ...s,
        itemCount: this.saleItems.filter((i) => i.saleId === s.id).reduce((sum, i) => sum + i.quantity, 0),
      }));
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

  async createSale(consultantId: number, input: CreateSaleInput): Promise<Sale> {
    const productIds = input.items.map((i) => i.productId);
    const productById = new Map((await this.getProductsByIds(consultantId, productIds)).map((p) => [p.id, p]));

    const lines = input.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) throw new SaleValidationError(`Producto ${item.productId} no encontrado`);
      if (product.unidades < item.quantity) {
        throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${product.unidades})`);
      }
      return { product, quantity: item.quantity, unitPrice: item.unitPrice ?? product.precio };
    });

    const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
    const totals = computeSaleTotals({
      subtotal,
      orderDiscount: input.orderDiscount ?? null,
      orderSurcharge: input.orderSurcharge ?? null,
      shippingCost: input.shippingCost ?? null,
    });

    const installmentAmounts = input.installments.map((i) => i.amount);
    if (!installmentsSumMatches(installmentAmounts, totals.total)) {
      throw new SaleValidationError("La suma de las cuotas no coincide con el total de la venta");
    }

    const client = this.clients.find((c) => c.id === input.clientId && c.consultantId === consultantId);
    if (!client) throw new SaleValidationError("Clienta no encontrada");
    const clientName = client.name ?? client.phone;

    const profit = lines.reduce((sum, l) => {
      const cost = l.product.costPrice ?? l.product.precio;
      return sum + (l.unitPrice - cost) * l.quantity;
    }, 0);

    const sale: Sale = {
      id: this.nextSaleId++,
      consultantId,
      clientId: client.id,
      clientName,
      date: input.date,
      subtotal,
      orderDiscountType: input.orderDiscount?.type ?? null,
      orderDiscountValue: input.orderDiscount?.value ?? null,
      orderSurchargeType: input.orderSurcharge?.type ?? null,
      orderSurchargeValue: input.orderSurcharge?.value ?? null,
      shippingCost: input.shippingCost ?? null,
      total: totals.total,
      profit,
      paymentMethod: input.paymentMethod,
      installmentsCount: input.installments.length,
      installmentFrequency: input.installments.length > 1 ? input.installmentFrequency ?? null : null,
      status: input.status,
      notes: input.notes ?? null,
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
      });
      const stock = this.getOrCreateStock(consultantId, line.product.id);
      stock.unidades -= line.quantity;
    }

    installmentAmounts.forEach((amount, index) => {
      this.saleInstallments.push({
        id: this.nextSaleInstallmentId++,
        saleId: sale.id,
        installmentNumber: index + 1,
        amount,
        dueDate: computeInstallmentDueDate(input.date, input.installmentFrequency, index),
        status: "pendiente",
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

    const existingItems = this.saleItems.filter((i) => i.saleId === id);

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
    const lines = input.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) throw new SaleValidationError(`Producto ${item.productId} no encontrado`);
      const available = stockById.get(item.productId) ?? 0;
      if (available < item.quantity) {
        throw new SaleValidationError(`Stock insuficiente para "${product.producto}" (disponible: ${available})`);
      }
      stockById.set(item.productId, available - item.quantity);
      return { product, quantity: item.quantity, unitPrice: item.unitPrice ?? product.precio };
    });

    const subtotal = computeSubtotal(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })));
    const totals = computeSaleTotals({
      subtotal,
      orderDiscount: input.orderDiscount ?? null,
      orderSurcharge: input.orderSurcharge ?? null,
      shippingCost: input.shippingCost ?? null,
    });

    const installmentAmounts = input.installments.map((i) => i.amount);
    if (!installmentsSumMatches(installmentAmounts, totals.total)) {
      throw new SaleValidationError("La suma de las cuotas no coincide con el total de la venta");
    }

    const profit = lines.reduce((sum, l) => {
      const cost = l.product.costPrice ?? l.product.precio;
      return sum + (l.unitPrice - cost) * l.quantity;
    }, 0);

    // A partir de acá ya está todo validado: recién ahora se muta estado.
    stockById.forEach((newStock, productId) => {
      const stock = this.getOrCreateStock(consultantId, productId);
      stock.unidades = newStock;
    });

    this.saleItems = this.saleItems.filter((i) => i.saleId !== id);
    this.saleInstallments = this.saleInstallments.filter((i) => i.saleId !== id);

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
      });
    }

    installmentAmounts.forEach((amount, index) => {
      this.saleInstallments.push({
        id: this.nextSaleInstallmentId++,
        saleId: id,
        installmentNumber: index + 1,
        amount,
        dueDate: computeInstallmentDueDate(existingSale.date, input.installmentFrequency, index),
        status: "pendiente",
      });
    });

    existingSale.subtotal = subtotal;
    existingSale.orderDiscountType = input.orderDiscount?.type ?? null;
    existingSale.orderDiscountValue = input.orderDiscount?.value ?? null;
    existingSale.orderSurchargeType = input.orderSurcharge?.type ?? null;
    existingSale.orderSurchargeValue = input.orderSurcharge?.value ?? null;
    existingSale.shippingCost = input.shippingCost ?? null;
    existingSale.total = totals.total;
    existingSale.profit = profit;
    existingSale.paymentMethod = input.paymentMethod;
    existingSale.installmentsCount = installmentAmounts.length;
    existingSale.installmentFrequency = installmentAmounts.length > 1 ? input.installmentFrequency ?? null : null;
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

  async seedDashboardDemoData(consultantId: number): Promise<void> {
    // Catálogo visible completo (global + manual propio) — la mayoría de sus productos van a
    // ser globales ahora, filtrar solo por consultantId nunca encontraría nada.
    const ownProducts = await this.getAllProducts(consultantId);
    if (ownProducts.length === 0) return;

    const c1: Client = {
      id: this.nextClientId++,
      consultantId,
      name: "María García López",
      phone: "5551234567",
      email: "maria.garcia@email.com",
      birthday: null,
      address: null,
      notes: null,
    };
    const c2: Client = {
      id: this.nextClientId++,
      consultantId,
      name: "Ana Martínez Ruiz",
      phone: "5552345678",
      email: "ana.martinez@email.com",
      birthday: null,
      address: null,
      notes: null,
    };
    this.clients.push(c1, c2);
    const c1Name = c1.name ?? c1.phone;
    const c2Name = c2.name ?? c2.phone;

    const now = new Date();
    const inDays = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

    this.appointments.push(
      {
        id: this.nextAppointmentId++,
        consultantId,
        clientId: c1.id,
        clientName: c1Name,
        date: toDateStr(inDays(3)),
        time: "17:00",
        type: "demostracion",
        location: "Colonia Roma",
        notes: null,
        status: "confirmada",
      },
      {
        id: this.nextAppointmentId++,
        consultantId,
        clientId: c2.id,
        clientName: c2Name,
        date: toDateStr(inDays(5)),
        time: "10:30",
        type: "entrega",
        location: null,
        notes: "Traer catálogo nuevo",
        status: "pendiente",
      },
    );

    const p1 = ownProducts[0];
    const p2 = ownProducts[1] ?? ownProducts[0];
    const today = toDateStr(now);

    const sale1: Sale = {
      id: this.nextSaleId++,
      consultantId,
      clientId: c1.id,
      clientName: c1Name,
      date: today,
      subtotal: p1.precio * 2,
      orderDiscountType: null,
      orderDiscountValue: null,
      orderSurchargeType: null,
      orderSurchargeValue: null,
      shippingCost: null,
      total: p1.precio * 2,
      profit: Math.round(p1.precio * 0.4),
      paymentMethod: "efectivo",
      installmentsCount: 1,
      installmentFrequency: null,
      status: "pagado",
      notes: null,
    };
    const sale2: Sale = {
      id: this.nextSaleId++,
      consultantId,
      clientId: c1.id,
      clientName: c1Name,
      date: today,
      subtotal: p2.precio,
      orderDiscountType: null,
      orderDiscountValue: null,
      orderSurchargeType: null,
      orderSurchargeValue: null,
      shippingCost: null,
      total: p2.precio,
      profit: Math.round(p2.precio * 0.4),
      paymentMethod: "efectivo",
      installmentsCount: 1,
      installmentFrequency: null,
      status: "entregado",
      notes: null,
    };
    const sale3: Sale = {
      id: this.nextSaleId++,
      consultantId,
      clientId: c2.id,
      clientName: c2Name,
      date: today,
      subtotal: p1.precio,
      orderDiscountType: null,
      orderDiscountValue: null,
      orderSurchargeType: null,
      orderSurchargeValue: null,
      shippingCost: null,
      total: p1.precio,
      profit: Math.round(p1.precio * 0.4),
      paymentMethod: "efectivo",
      installmentsCount: 1,
      installmentFrequency: null,
      status: "pagado",
      notes: null,
    };
    this.sales.push(sale1, sale2, sale3);

    this.saleItems.push(
      {
        id: this.nextSaleItemId++,
        saleId: sale1.id,
        productId: p1.id,
        productName: p1.producto,
        category: p1.seccion,
        quantity: 2,
        originalPrice: p1.precio,
        price: p1.precio,
      },
      {
        id: this.nextSaleItemId++,
        saleId: sale2.id,
        productId: p2.id,
        productName: p2.producto,
        category: p2.seccion,
        quantity: 1,
        originalPrice: p2.precio,
        price: p2.precio,
      },
      {
        id: this.nextSaleItemId++,
        saleId: sale3.id,
        productId: p1.id,
        productName: p1.producto,
        category: p1.seccion,
        quantity: 1,
        originalPrice: p1.precio,
        price: p1.precio,
      },
    );
  }
}

function createStorage(): IStorage {
  const mode = resolveStorageMode();
  return mode === "memory" ? new MemoryStorage() : new DatabaseStorage();
}

export const storage = createStorage();
