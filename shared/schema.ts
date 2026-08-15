import { pgTable, serial, text, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * La consultora es la entidad de negocio (tenant). Separada de `users` para que la
 * configuración (nombre, moneda, objetivo) tenga un hogar propio y no quede pegada a
 * una credencial de login — hoy siempre nace 1:1 con el primer usuario consultora,
 * pero el modelo no obliga a que sea así para siempre.
 */
export const consultants = pgTable("consultants", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull().default(""),
  currency: text("currency").notNull().default("ARS"),
  monthlyGoal: integer("monthly_goal"),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("consultant"),
  status: boolean("status").notNull().default(true),
  // Nullable: null únicamente para admin (rol cross-tenant, no pertenece a ninguna consultora).
  consultantId: integer("consultant_id").references(() => consultants.id),
});

/**
 * Catálogo puro — nombre, precio público, código, etc. `consultantId`:
 * `NULL` = producto GLOBAL (cargado por el admin, visible para todas las consultoras);
 * con valor = producto MANUAL, privado de esa única consultora (como antes).
 * El stock/costo/descuento de cada consultora sobre un producto vive aparte, en `productStock`
 * — nunca se copia ni se mezcla entre consultoras (ver `productStock` más abajo).
 */
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").references(() => consultants.id),
  seccion: text("seccion").notNull(),
  // Nullable: varios catálogos reales (ej. Mary Kay) no tienen un segundo nivel de
  // categorización — no se inventa un valor cuando el archivo de origen no lo trae.
  linea: text("linea"),
  producto: text("producto").notNull(),
  variante: text("variante").notNull().default("Estándar"),
  codigo: text("codigo").notNull(),
  puntos: integer("puntos").notNull().default(0),
  precio: integer("precio").notNull(),
  imagen: text("imagen"),
  // "import": catálogo global cargado por el admin (consultantId siempre null acá).
  // "manual": la consultora lo cargó ella misma (consultantId siempre el suyo).
  source: text("source").notNull().default("import"),
}, (table) => ({
  // Sigue sirviendo para deduplicar productos MANUALES entre sí (por consultora). Los
  // globales (consultantId null) se dedupean aparte en el import — ver bulkInsertProducts.
  consultantCodigoUnique: unique("products_consultant_codigo_unique").on(table.consultantId, table.codigo),
  consultantIdx: index("products_consultant_id_idx").on(table.consultantId),
}));

/** El inventario de UNA consultora sobre UN producto (global o manual propio): cuántas
 * unidades tiene, a qué costo lo compró, si sigue vendiéndolo. Separado de `products` para
 * que el catálogo sea compartido y el stock nunca se copie ni se mezcle entre consultoras. */
export const productStock = pgTable("product_stock", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").notNull().references(() => consultants.id),
  productId: integer("product_id").notNull().references(() => products.id),
  unidades: integer("unidades").notNull().default(0),
  stockMinimo: integer("stock_minimo").notNull().default(5),
  costPrice: integer("cost_price"),
  selectedDiscount: integer("selected_discount"),
  discontinued: boolean("discontinued").notNull().default(false),
}, (table) => ({
  consultantProductUnique: unique("product_stock_consultant_product_unique").on(table.consultantId, table.productId),
  consultantIdx: index("product_stock_consultant_id_idx").on(table.consultantId),
  productIdx: index("product_stock_product_id_idx").on(table.productId),
}));

export const PHONE_REGEX = /^\d{10}$/;
export const PHONE_ERROR_MESSAGE = "El teléfono debe tener exactamente 10 dígitos, sin espacios, guiones ni código de país (ej: 2616570560)";

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").references(() => consultants.id),
  name: text("name"),
  phone: text("phone").notNull(),
  email: text("email"),
  birthday: text("birthday"),
  address: text("address"),
  notes: text("notes"),
}, (table) => ({
  consultantIdx: index("clients_consultant_id_idx").on(table.consultantId),
}));

export const appointmentTypes = ["seguimiento", "venta", "demostracion", "entrega"] as const;
export type AppointmentType = (typeof appointmentTypes)[number];

export const appointmentStatuses = ["pendiente", "confirmada", "completada", "cancelada"] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").references(() => consultants.id),
  clientId: integer("client_id").references(() => clients.id),
  clientName: text("client_name").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  type: text("type").notNull().default("seguimiento"),
  location: text("location"),
  notes: text("notes"),
  status: text("status").notNull().default(appointmentStatuses[0]),
}, (table) => ({
  // Reemplaza el índice solo-por-fecha: toda consulta de agenda ahora filtra primero
  // por consultantId (getAppointmentsInRange/getUpcomingAppointments).
  consultantDateIdx: index("appointments_consultant_id_date_idx").on(table.consultantId, table.date),
}));

export const paymentMethods = ["efectivo", "transferencia", "tarjeta"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const installmentOptions = [1, 2, 3, 4, 5, 6, 12] as const;
export const installmentFrequencies = ["semanal", "mensual"] as const;
export type InstallmentFrequency = (typeof installmentFrequencies)[number];
export const installmentStatuses = ["pendiente", "pagado"] as const;
export type InstallmentStatus = (typeof installmentStatuses)[number];
export const adjustmentTypes = ["percent", "fixed"] as const;
export type AdjustmentType = (typeof adjustmentTypes)[number];

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").references(() => consultants.id),
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
  notes: text("notes"),
}, (table) => ({
  consultantDateIdx: index("sales_consultant_id_date_idx").on(table.consultantId, table.date),
  consultantClientIdx: index("sales_consultant_id_client_id_idx").on(table.consultantId, table.clientId),
}));

export const saleItems = pgTable("sale_items", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name").notNull(),
  category: text("category").notNull(),
  quantity: integer("quantity").notNull(),
  originalPrice: integer("original_price").notNull(),
  price: integer("price").notNull(),
}, (table) => ({
  saleIdIdx: index("sale_items_sale_id_idx").on(table.saleId),
  productIdIdx: index("sale_items_product_id_idx").on(table.productId),
}));

export const saleInstallments = pgTable("sale_installments", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  installmentNumber: integer("installment_number").notNull(),
  amount: integer("amount").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("pendiente"),
}, (table) => ({
  dueDateIdx: index("sale_installments_due_date_idx").on(table.dueDate),
  statusIdx: index("sale_installments_status_idx").on(table.status),
}));

// Tipos para TypeScript
export type Consultant = typeof consultants.$inferSelect;
export type InsertConsultant = typeof consultants.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ProductStock = typeof productStock.$inferSelect;
export type InsertProductStock = typeof productStock.$inferInsert;
/** Forma "hidratada" que consume el resto de la app (frontend, ventas, etc.): catálogo +
 * la fila de stock ya resuelta de la consultora que está mirando, con defaults si todavía
 * no cargó stock para ese producto. Misma forma que el `Product` de antes de esta etapa —
 * no cambia ningún import en el frontend. */
export type Product = typeof products.$inferSelect &
  Pick<ProductStock, "unidades" | "stockMinimo" | "costPrice" | "selectedDiscount" | "discontinued">;
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
/** El `consultantId` de una clienta lo decide siempre el backend a partir de la sesión
 * (nunca el body) — este schema es el que de verdad se usa para crear/editar, así que ni
 * siquiera parsea si alguien manda `consultantId`, sea o no el propio. */
export const clientWriteSchema = insertClientSchema.omit({ consultantId: true });
export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true });

export const createAppointmentSchema = z.object({
  clientId: z.number().int().positive(),
  date: z.string().min(1),
  time: z.string().min(1),
  type: z.enum(appointmentTypes),
  location: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

// Deliberadamente separado de createAppointmentSchema: crear y editar son operaciones
// distintas y pueden divergir con el tiempo (ej. qué campos se permiten tocar en cada caso).
export const updateAppointmentSchema = z.object({
  clientId: z.number().int().positive(),
  date: z.string().min(1),
  time: z.string().min(1),
  type: z.enum(appointmentTypes),
  location: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export const updateAppointmentStatusSchema = z.object({
  status: z.enum(appointmentStatuses),
});
export const insertSaleSchema = createInsertSchema(sales).omit({ id: true });
export const insertSaleItemSchema = createInsertSchema(saleItems).omit({ id: true });
export const insertSaleInstallmentSchema = createInsertSchema(saleInstallments).omit({ id: true });

// Carga masiva de admin = catálogo GLOBAL puro, sin stock (el stock es de cada consultora,
// se carga aparte — ver setProductStockSchema). Por eso no lleva unidades/stockMinimo.
export const bulkProductSchema = z.array(
  z.object({
    seccion: z.string().min(1),
    linea: z.string().optional(),
    producto: z.string().min(1),
    precio: z.number().int().nonnegative(),
    codigo: z.string().optional(),
    variante: z.string().optional(),
    puntos: z.number().int().nonnegative().optional(),
    imagen: z.string().optional(),
  }),
);

export const discountOptions = [35, 40, 45] as const;

export const applyDiscountSchema = z.object({
  discountPercent: z.number().int().refine((v) => (discountOptions as readonly number[]).includes(v), {
    message: "El descuento debe ser uno de los valores permitidos",
  }),
});

// Alta manual de un producto suelto desde Productos (fuera de la carga masiva por Excel/CSV).
// consultantId, source y discontinued los pone el servidor, nunca el cliente.
export const createProductSchema = z.object({
  seccion: z.string().trim().min(1, "La categoría es obligatoria"),
  linea: z.string().trim().optional(),
  producto: z.string().trim().min(1, "El nombre del producto es obligatorio"),
  variante: z.string().trim().min(1).optional(),
  precio: z.number().int().nonnegative(),
  unidades: z.number().int().nonnegative().default(0),
  puntos: z.number().int().nonnegative().default(0),
  codigo: z.string().trim().min(1).optional(),
  imagen: z.string().trim().min(1).optional(),
  stockMinimo: z.number().int().nonnegative().optional(),
});

export const toggleProductDiscontinuedSchema = z.object({
  discontinued: z.boolean(),
});

export const setProductStockSchema = z.object({
  unidades: z.number().int().nonnegative(),
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
  notes: z.string().max(1000).optional(),
});

// Edición de una venta ya existente: mismo cuerpo que la creación, salvo clienta/fecha/status
// (no editables por esta vía) y con la posibilidad de agregar observaciones.
export const updateSaleSchema = z.object({
  items: z.array(createSaleItemSchema).min(1, "La venta debe tener al menos un producto"),
  orderDiscount: orderAdjustmentSchema,
  orderSurcharge: orderAdjustmentSchema,
  shippingCost: z.number().int().nonnegative().optional(),
  paymentMethod: z.enum(paymentMethods),
  installments: z.array(z.object({ amount: z.number().int().nonnegative() })).min(1),
  installmentFrequency: z.enum(installmentFrequencies).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateInstallmentStatusSchema = z.object({
  status: z.enum(installmentStatuses),
});

export const createConsultantSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

export const updateBusinessSettingsSchema = z.object({
  businessName: z.string().trim().min(1, "El nombre del negocio no puede estar vacío").max(120),
  currency: z.string().trim().length(3, "Usá un código de moneda ISO de 3 letras (ej. ARS, USD)").toUpperCase(),
  monthlyGoal: z.number().int().nonnegative().nullable().optional(),
});

// Carga masiva de catálogo global — admin-only. No lleva consultantId: el producto queda
// visible para todas las consultoras de una, no se le asigna a ninguna en particular.
export const adminBulkImportSchema = z.object({
  products: bulkProductSchema,
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});