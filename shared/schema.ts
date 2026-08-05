import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("consultant"),
  status: boolean("status").notNull().default(true),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  seccion: text("seccion").notNull(),
  linea: text("linea").notNull(),
  producto: text("producto").notNull(),
  variante: text("variante").notNull().default("Estándar"),
  codigo: text("codigo").notNull().unique(),
  puntos: integer("puntos").notNull().default(0),
  precio: integer("precio").notNull(),
  unidades: integer("unidades").notNull().default(0),
  imagen: text("imagen"),
  stockMinimo: integer("stock_minimo").notNull().default(5),
  costPrice: integer("cost_price"),
  selectedDiscount: integer("selected_discount"),
});

export const PHONE_REGEX = /^\d{10}$/;
export const PHONE_ERROR_MESSAGE = "El teléfono debe tener exactamente 10 dígitos, sin espacios, guiones ni código de país (ej: 2616570560)";

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name"),
  phone: text("phone").notNull(),
  email: text("email"),
  birthday: text("birthday"),
  address: text("address"),
  notes: text("notes"),
});

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  clientName: text("client_name").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  type: text("type").notNull().default("seguimiento"),
  location: text("location"),
  notes: text("notes"),
  status: text("status").notNull().default("pendiente"),
});

export const paymentMethods = ["efectivo", "transferencia", "tarjeta"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const installmentOptions = [1, 2, 3, 4, 5, 6, 12] as const;
export const installmentFrequencies = ["semanal", "mensual"] as const;
export type InstallmentFrequency = (typeof installmentFrequencies)[number];
export const adjustmentTypes = ["percent", "fixed"] as const;
export type AdjustmentType = (typeof adjustmentTypes)[number];

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  clientName: text("client_name").notNull(),
  date: text("date").notNull(),
  subtotal: integer("subtotal").notNull(),
  orderDiscountType: text("order_discount_type"),
  orderDiscountValue: integer("order_discount_value"),
  orderSurchargeType: text("order_surcharge_type"),
  orderSurchargeValue: integer("order_surcharge_value"),
  shippingCost: integer("shipping_cost"),
  total: integer("total").notNull(),
  profit: integer("profit").notNull(),
  paymentMethod: text("payment_method").notNull().default("efectivo"),
  installmentsCount: integer("installments_count").notNull().default(1),
  installmentFrequency: text("installment_frequency"),
  status: text("status").notNull().default("pendiente"),
});

export const saleItems = pgTable("sale_items", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name").notNull(),
  category: text("category").notNull(),
  quantity: integer("quantity").notNull(),
  originalPrice: integer("original_price").notNull(),
  price: integer("price").notNull(),
});

export const saleInstallments = pgTable("sale_installments", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  installmentNumber: integer("installment_number").notNull(),
  amount: integer("amount").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("pendiente"),
});

// Tipos para TypeScript
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;
export type Sale = typeof sales.$inferSelect;
export type InsertSale = typeof sales.$inferInsert;
export type SaleItem = typeof saleItems.$inferSelect;
export type InsertSaleItem = typeof saleItems.$inferInsert;
export type SaleInstallment = typeof saleInstallments.$inferSelect;
export type InsertSaleInstallment = typeof saleInstallments.$inferInsert;

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertProductSchema = createInsertSchema(products);
export const selectProductSchema = createSelectSchema(products);
export const insertClientSchema = createInsertSchema(clients).omit({ id: true }).extend({
  phone: z.string().regex(PHONE_REGEX, PHONE_ERROR_MESSAGE),
});
export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true });
export const insertSaleSchema = createInsertSchema(sales).omit({ id: true });
export const insertSaleItemSchema = createInsertSchema(saleItems).omit({ id: true });
export const insertSaleInstallmentSchema = createInsertSchema(saleInstallments).omit({ id: true });

export const bulkProductSchema = z.array(
  z.object({
    seccion: z.string().min(1),
    linea: z.string().min(1),
    producto: z.string().min(1),
    precio: z.number().int().nonnegative(),
    unidades: z.number().int().nonnegative().default(0),
    codigo: z.string().optional(),
    variante: z.string().optional(),
    puntos: z.number().int().nonnegative().optional(),
    imagen: z.string().optional(),
    stockMinimo: z.number().int().nonnegative().optional(),
  }),
);

export const discountOptions = [20, 25, 30, 35, 40, 45, 50] as const;

export const applyDiscountSchema = z.object({
  discountPercent: z.number().int().refine((v) => (discountOptions as readonly number[]).includes(v), {
    message: "El descuento debe ser uno de los valores permitidos",
  }),
});

const orderAdjustmentSchema = z
  .object({
    type: z.enum(adjustmentTypes),
    value: z.number().nonnegative(),
  })
  .nullable()
  .optional();

export const createSaleItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative().optional(),
});

export const createSaleSchema = z.object({
  clientId: z.number().int().positive(),
  date: z.string().min(1),
  items: z.array(createSaleItemSchema).min(1, "La venta debe tener al menos un producto"),
  orderDiscount: orderAdjustmentSchema,
  orderSurcharge: orderAdjustmentSchema,
  shippingCost: z.number().int().nonnegative().optional(),
  paymentMethod: z.enum(paymentMethods),
  installments: z.array(z.object({ amount: z.number().int().nonnegative() })).min(1),
  installmentFrequency: z.enum(installmentFrequencies).optional(),
  status: z.enum(["pendiente", "entregado", "pagado"]).default("pendiente"),
});

export const createConsultantSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});