import {
  users,
  products,
  clients,
  appointments,
  sales,
  saleItems,
  saleInstallments,
  createSaleSchema,
  type User,
  type InsertUser,
  type Product,
  type InsertProduct,
  type Client,
  type InsertClient,
  type Appointment,
  type Sale,
  type SaleItem,
  type SaleInstallment,
} from "@shared/schema";
import {
  computeSubtotal,
  computeSaleTotals,
  installmentsSumMatches,
  computeInstallmentDueDate,
} from "@shared/saleCalculations";
import type { z } from "zod";
import { eq, ne, count, sql, and, gte, lt, asc, desc, isNotNull, inArray, ilike, or } from "drizzle-orm";
import type { db as database } from "./db";

export class SaleValidationError extends Error {}

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

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

export interface TopProductByCategory {
  productId: number | null;
  productName: string;
  category: string;
  imagen: string | null;
  quantitySold: number;
  totalSales: number;
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

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getConsultants(): Promise<User[]>;
  toggleUserStatus(id: number): Promise<User | undefined>;
  getProductCount(): Promise<number>;
  getAllProducts(): Promise<Product[]>;
  getProductsByIds(ids: number[]): Promise<Product[]>;
  bulkInsertProducts(items: InsertProduct[]): Promise<number>;
  getLowStockProducts(): Promise<Product[]>;
  applyProductDiscount(productId: number, discountPercent: number): Promise<Product | undefined>;
  getUpcomingAppointments(limit?: number): Promise<Appointment[]>;
  getTopClients(limit?: number): Promise<TopClient[]>;
  getClientById(id: number): Promise<Client | undefined>;
  searchClients(query?: string, limit?: number): Promise<ClientWithStats[]>;
  createClient(input: InsertClient): Promise<Client>;
  updateClient(id: number, input: Partial<InsertClient>): Promise<Client | undefined>;
  getTopProductsByCategory(category?: string, limit?: number): Promise<TopProductByCategory[]>;
  getAllSales(): Promise<SaleWithItemCount[]>;
  createSale(input: CreateSaleInput): Promise<Sale>;
  seedDashboardDemoData(): Promise<void>;
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
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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

  async getProductCount(): Promise<number> {
    const db = await this.getDb();
    const [result] = await db.select({ value: count() }).from(products);
    return result?.value ?? 0;
  }

  async getAllProducts(): Promise<Product[]> {
    const db = await this.getDb();
    return db.select().from(products).orderBy(products.seccion, products.linea, products.producto);
  }

  async getProductsByIds(ids: number[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const db = await this.getDb();
    return db.select().from(products).where(inArray(products.id, ids));
  }

  async bulkInsertProducts(items: InsertProduct[]): Promise<number> {
    if (items.length === 0) return 0;

    const db = await this.getDb();
    const inserted = await db
      .insert(products)
      .values(items)
      .onConflictDoUpdate({
        target: products.codigo,
        set: {
          seccion: sql`EXCLUDED.seccion`,
          linea: sql`EXCLUDED.linea`,
          producto: sql`EXCLUDED.producto`,
          precio: sql`EXCLUDED.precio`,
          unidades: sql`EXCLUDED.unidades`,
          imagen: sql`EXCLUDED.imagen`,
          stockMinimo: sql`EXCLUDED.stock_minimo`,
        },
      })
      .returning();

    return inserted.length;
  }

  async getLowStockProducts(): Promise<Product[]> {
    const db = await this.getDb();
    return db
      .select()
      .from(products)
      .where(sql`${products.unidades} <= ${products.stockMinimo}`)
      .orderBy(asc(products.unidades));
  }

  async applyProductDiscount(productId: number, discountPercent: number): Promise<Product | undefined> {
    const db = await this.getDb();
    const [updated] = await db
      .update(products)
      .set({
        selectedDiscount: discountPercent,
        costPrice: sql`ROUND(${products.precio} * (1 - ${discountPercent} / 100.0))`,
      })
      .where(eq(products.id, productId))
      .returning();
    return updated;
  }

  async getUpcomingAppointments(limit = 10): Promise<Appointment[]> {
    const db = await this.getDb();
    const now = new Date();
    const nowDate = toDateStr(now);
    const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    return db
      .select()
      .from(appointments)
      .where(
        sql`(${appointments.date} > ${nowDate}) OR (${appointments.date} = ${nowDate} AND ${appointments.time} >= ${nowTime})`,
      )
      .orderBy(asc(appointments.date), asc(appointments.time))
      .limit(limit);
  }

  async getTopClients(limit = 5): Promise<TopClient[]> {
    const db = await this.getDb();
    const { monthStart, monthEnd } = getCurrentMonthRange();

    const salesAgg = await db
      .select({
        clientId: sales.clientId,
        clientName: sales.clientName,
        purchaseCount: count(sales.id),
        totalAmount: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(sales)
      .where(and(gte(sales.date, monthStart), lt(sales.date, monthEnd), isNotNull(sales.clientId)))
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
          .where(inArray(sales.clientId, clientIds))
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

  async getClientById(id: number): Promise<Client | undefined> {
    const db = await this.getDb();
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async searchClients(query = "", limit = 20): Promise<ClientWithStats[]> {
    const db = await this.getDb();
    const term = query.trim();

    const rows = term
      ? await db
          .select()
          .from(clients)
          .where(or(ilike(clients.name, `%${term}%`), ilike(clients.phone, `%${term}%`), ilike(clients.email, `%${term}%`)))
          .limit(limit)
      : await db.select().from(clients).limit(limit);

    if (rows.length === 0) return [];

    const clientIds = rows.map((r) => r.id);
    const statsRows = await db
      .select({
        clientId: sales.clientId,
        totalAmount: sql<number>`coalesce(sum(${sales.total}), 0)`,
        lastDate: sql<string | null>`max(${sales.date})`,
      })
      .from(sales)
      .where(inArray(sales.clientId, clientIds))
      .groupBy(sales.clientId);

    const statsByClient = new Map(statsRows.map((s) => [s.clientId, s]));

    return rows.map((row) => ({
      ...row,
      totalPurchases: Number(statsByClient.get(row.id)?.totalAmount ?? 0),
      lastPurchase: statsByClient.get(row.id)?.lastDate ?? null,
    }));
  }

  async createClient(input: InsertClient): Promise<Client> {
    const db = await this.getDb();
    const [client] = await db.insert(clients).values(input).returning();
    return client;
  }

  async updateClient(id: number, input: Partial<InsertClient>): Promise<Client | undefined> {
    const db = await this.getDb();
    const [updated] = await db.update(clients).set(input).where(eq(clients.id, id)).returning();
    return updated;
  }

  async getTopProductsByCategory(category?: string, limit?: number): Promise<TopProductByCategory[]> {
    const db = await this.getDb();

    const query = db
      .select({
        productId: saleItems.productId,
        productName: saleItems.productName,
        category: saleItems.category,
        quantitySold: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
        totalSales: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.price}), 0)`,
      })
      .from(saleItems)
      .where(category ? eq(saleItems.category, category) : undefined)
      .groupBy(saleItems.productId, saleItems.productName, saleItems.category)
      .orderBy(desc(sql`sum(${saleItems.quantity})`));

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

  async getAllSales(): Promise<SaleWithItemCount[]> {
    const db = await this.getDb();
    const salesRows = await db.select().from(sales).orderBy(desc(sales.date), desc(sales.id));
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

  async createSale(input: CreateSaleInput): Promise<Sale> {
    const db = await this.getDb();

    const productIds = input.items.map((i) => i.productId);
    const foundProducts = await db.select().from(products).where(inArray(products.id, productIds));
    const productById = new Map(foundProducts.map((p) => [p.id, p]));

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

    const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId));
    if (!client) throw new SaleValidationError("Clienta no encontrada");
    const clientName = client.name ?? client.phone;

    const profit = lines.reduce((sum, l) => {
      const cost = l.product.costPrice ?? l.product.precio;
      return sum + (l.unitPrice - cost) * l.quantity;
    }, 0);

    return db.transaction(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
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
          .update(products)
          .set({ unidades: line.product.unidades - line.quantity })
          .where(eq(products.id, line.product.id));
      }

      return sale;
    });
  }

  async seedDashboardDemoData(): Promise<void> {
    const db = await this.getDb();
    const existingProducts = await this.getAllProducts();
    if (existingProducts.length === 0) return;

    const [c1] = await db
      .insert(clients)
      .values({ name: "María García López", phone: "5551234567", email: "maria.garcia@email.com" })
      .returning();
    const [c2] = await db
      .insert(clients)
      .values({ name: "Ana Martínez Ruiz", phone: "5552345678", email: "ana.martinez@email.com" })
      .returning();
    const c1Name = c1.name ?? c1.phone;
    const c2Name = c2.name ?? c2.phone;

    const now = new Date();
    const inDays = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

    await db.insert(appointments).values([
      {
        clientId: c1.id,
        clientName: c1Name,
        date: toDateStr(inDays(3)),
        time: "17:00",
        type: "demostracion",
        location: "Colonia Roma",
        status: "confirmada",
      },
      {
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
  private products: Product[] = [];
  private clients: Client[] = [];
  private appointments: Appointment[] = [];
  private sales: Sale[] = [];
  private saleItems: SaleItem[] = [];
  private saleInstallments: SaleInstallment[] = [];
  private nextUserId = 1;
  private nextProductId = 1;
  private nextClientId = 1;
  private nextAppointmentId = 1;
  private nextSaleId = 1;
  private nextSaleItemId = 1;
  private nextSaleInstallmentId = 1;

  async getUser(id: number): Promise<User | undefined> {
    return this.users.find((user) => user.id === id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.users.find((user) => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = {
      id: this.nextUserId++,
      username: insertUser.username,
      password: insertUser.password,
      role: insertUser.role ?? "consultant",
      status: insertUser.status ?? true,
    };
    this.users.push(user);
    return user;
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

  async getProductCount(): Promise<number> {
    return this.products.length;
  }

  async getAllProducts(): Promise<Product[]> {
    return [...this.products].sort((a, b) =>
      [a.seccion, a.linea, a.producto].join(" ").localeCompare(
        [b.seccion, b.linea, b.producto].join(" "),
      ),
    );
  }

  async getProductsByIds(ids: number[]): Promise<Product[]> {
    return this.products.filter((p) => ids.includes(p.id));
  }

  async bulkInsertProducts(items: InsertProduct[]): Promise<number> {
    let changed = 0;

    for (const item of items) {
      const existing = this.products.find((product) => product.codigo === item.codigo);
      if (existing) {
        Object.assign(existing, {
          seccion: item.seccion,
          linea: item.linea,
          producto: item.producto,
          variante: item.variante ?? "Estándar",
          puntos: item.puntos ?? 0,
          precio: item.precio,
          unidades: item.unidades ?? 0,
          imagen: item.imagen ?? null,
          stockMinimo: item.stockMinimo ?? 5,
        });
      } else {
        this.products.push({
          id: this.nextProductId++,
          seccion: item.seccion,
          linea: item.linea,
          producto: item.producto,
          variante: item.variante ?? "Estándar",
          codigo: item.codigo ?? `producto-${this.nextProductId}`,
          puntos: item.puntos ?? 0,
          precio: item.precio,
          unidades: item.unidades ?? 0,
          imagen: item.imagen ?? null,
          stockMinimo: item.stockMinimo ?? 5,
          costPrice: null,
          selectedDiscount: null,
        });
      }
      changed++;
    }

    return changed;
  }

  async getLowStockProducts(): Promise<Product[]> {
    return [...this.products]
      .filter((p) => p.unidades <= p.stockMinimo)
      .sort((a, b) => a.unidades - b.unidades);
  }

  async applyProductDiscount(productId: number, discountPercent: number): Promise<Product | undefined> {
    const product = this.products.find((p) => p.id === productId);
    if (!product) return undefined;
    product.selectedDiscount = discountPercent;
    product.costPrice = Math.round(product.precio * (1 - discountPercent / 100));
    return product;
  }

  async getUpcomingAppointments(limit = 10): Promise<Appointment[]> {
    const now = new Date();
    const nowDate = toDateStr(now);
    const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    return [...this.appointments]
      .filter((a) => a.date > nowDate || (a.date === nowDate && a.time >= nowTime))
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
      .slice(0, limit);
  }

  async getTopClients(limit = 5): Promise<TopClient[]> {
    const { monthStart, monthEnd } = getCurrentMonthRange();
    const monthSales = this.sales.filter(
      (s) => s.clientId !== null && s.date >= monthStart && s.date < monthEnd,
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

  async getClientById(id: number): Promise<Client | undefined> {
    return this.clients.find((c) => c.id === id);
  }

  async searchClients(query = "", limit = 20): Promise<ClientWithStats[]> {
    const term = query.trim().toLowerCase();
    const filtered = term
      ? this.clients.filter(
          (c) =>
            (c.name ?? "").toLowerCase().includes(term) ||
            c.phone.includes(term) ||
            (c.email ?? "").toLowerCase().includes(term),
        )
      : this.clients;

    return filtered.slice(0, limit).map((c) => {
      const clientSales = this.sales.filter((s) => s.clientId === c.id);
      const totalPurchases = clientSales.reduce((sum, s) => sum + s.total, 0);
      const lastPurchase = clientSales.length
        ? clientSales.map((s) => s.date).sort().slice(-1)[0]
        : null;
      return { ...c, totalPurchases, lastPurchase };
    });
  }

  async createClient(input: InsertClient): Promise<Client> {
    const client: Client = {
      id: this.nextClientId++,
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

  async updateClient(id: number, input: Partial<InsertClient>): Promise<Client | undefined> {
    const client = this.clients.find((c) => c.id === id);
    if (!client) return undefined;
    Object.assign(client, input);
    return client;
  }

  async getTopProductsByCategory(category?: string, limit?: number): Promise<TopProductByCategory[]> {
    const byProduct = new Map<string, TopProductByCategory>();

    for (const item of this.saleItems) {
      if (category && item.category !== category) continue;
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

    const sorted = Array.from(byProduct.values()).sort((a, b) => b.quantitySold - a.quantitySold);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  async getAllSales(): Promise<SaleWithItemCount[]> {
    return [...this.sales]
      .sort((a, b) => (a.date === b.date ? b.id - a.id : b.date.localeCompare(a.date)))
      .map((s) => ({
        ...s,
        itemCount: this.saleItems.filter((i) => i.saleId === s.id).reduce((sum, i) => sum + i.quantity, 0),
      }));
  }

  async createSale(input: CreateSaleInput): Promise<Sale> {
    const productById = new Map(this.products.map((p) => [p.id, p]));

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

    const client = this.clients.find((c) => c.id === input.clientId);
    if (!client) throw new SaleValidationError("Clienta no encontrada");
    const clientName = client.name ?? client.phone;

    const profit = lines.reduce((sum, l) => {
      const cost = l.product.costPrice ?? l.product.precio;
      return sum + (l.unitPrice - cost) * l.quantity;
    }, 0);

    const sale: Sale = {
      id: this.nextSaleId++,
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
      line.product.unidades -= line.quantity;
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

  async seedDashboardDemoData(): Promise<void> {
    if (this.products.length === 0) return;

    const c1: Client = {
      id: this.nextClientId++,
      name: "María García López",
      phone: "5551234567",
      email: "maria.garcia@email.com",
      birthday: null,
      address: null,
      notes: null,
    };
    const c2: Client = {
      id: this.nextClientId++,
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

    const p1 = this.products[0];
    const p2 = this.products[1] ?? this.products[0];
    const today = toDateStr(now);

    const sale1: Sale = {
      id: this.nextSaleId++,
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
    };
    const sale2: Sale = {
      id: this.nextSaleId++,
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
    };
    const sale3: Sale = {
      id: this.nextSaleId++,
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
  const mode = process.env.DATABASE_MODE ?? (process.env.DATABASE_URL ? "postgres" : "memory");

  if (mode === "memory") {
    return new MemoryStorage();
  }

  if (mode !== "postgres") {
    throw new Error(`Unsupported DATABASE_MODE "${mode}". Use "memory" or "postgres".`);
  }

  return new DatabaseStorage();
}

export const storage = createStorage();
