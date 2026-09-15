import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { CUSTOM_EVENT_TYPE_MAX_LENGTH } from "./eventTypes";

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
  // Umbral de stock bajo predeterminado para toda la consultora (Configuración). Nullable:
  // sin configurar, se usa el default global de la app (ver DEFAULT_LOW_STOCK_THRESHOLD).
  defaultLowStockThreshold: integer("default_low_stock_threshold"),
  // Nullable: hasta la Etapa 3 solo se completaba al iniciar una suscripción (Mercado Pago
  // exige payer_email). Desde la Etapa 3 también se completa al registrarse — en ambos casos
  // SIEMPRE normalizado (ver shared/email.ts normalizeEmail, storage.setConsultantEmail) antes
  // de guardarse, nunca tal cual lo tipeó la consultora.
  email: text("email"),
}, (table) => ({
  // Etapa 3: único (parcial — Postgres nunca considera dos NULL "iguales" para UNIQUE, así
  // que las consultoras sin email todavía, la mayoría histórica, no chocan entre sí) — evita
  // que dos cuentas se registren con el mismo email normalizado. No se migran/normalizan
  // masivamente los emails históricos existentes (los pocos que ya se completaron vía
  // Mercado Pago) — si alguno choca en el futuro, es una situación real a revisar a mano, no
  // algo para "arreglar" con una migración silenciosa.
  emailUnique: uniqueIndex("consultants_email_unique_idx").on(table.email).where(sql`${table.email} IS NOT NULL`),
}));

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
  // Sigue sirviendo para deduplicar productos MANUALES entre sí (por consultora). NO protege
  // los globales: en Postgres dos filas con consultant_id NULL nunca son "iguales" para un
  // UNIQUE normal (NULL <> NULL), así que este constraint jamás dispara entre dos globales con
  // el mismo código — ver globalCodigoUnique más abajo, que sí cubre ese caso.
  consultantCodigoUnique: unique("products_consultant_codigo_unique").on(table.consultantId, table.codigo),
  // Etapa I-B.8-D: índice único PARCIAL — unicidad de `codigo` SOLO entre productos globales
  // (consultant_id IS NULL). Resuelve el TOCTOU de `bulkInsertProducts` (hallazgo F3, auditoría
  // I-B.8-A): dos imports concurrentes que verifican "no existe" y después insertan podían
  // crear dos filas globales con el mismo código, porque el UNIQUE de arriba no las alcanzaba.
  // Deliberadamente NO es `unique(codigo)` a secas — eso rompería la semántica multi-tenant
  // (cada consultora puede tener su propio producto manual con el mismo código que otra, o que
  // el catálogo global). Solo aplica cuando consultant_id es NULL.
  globalCodigoUnique: uniqueIndex("products_global_codigo_unique_idx")
    .on(table.codigo)
    .where(sql`${table.consultantId} IS NULL`),
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
  // Nullable: NULL = sin umbral propio, usa la cascada (ver resolveLowStockThreshold en
  // shared/stockAlerts.ts) — perfil de la consultora, y si tampoco existe, el default de la app.
  stockMinimo: integer("stock_minimo"),
  costPrice: integer("cost_price"),
  selectedDiscount: integer("selected_discount"),
  discontinued: boolean("discontinued").notNull().default(false),
  // Fecha (YYYY-MM-DD) hasta la que se pospone la alerta de stock bajo de este producto —
  // "Recordarme comprar" en Inicio/Productos. NULL = sin recordatorio activo.
  remindStockAt: text("remind_stock_at"),
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

// El tipo de evento ya no es un enum cerrado: además de los tipos fijos (ver
// shared/eventTypes.ts), una consultora puede crear tipos personalizados con nombre libre.
// La columna en la base siempre fue texto libre, así que esto no requiere migración.
export const appointmentTypeSchema = z
  .string()
  .trim()
  .min(1, "El tipo de evento es obligatorio")
  .max(CUSTOM_EVENT_TYPE_MAX_LENGTH, `El nombre no puede superar los ${CUSTOM_EVENT_TYPE_MAX_LENGTH} caracteres`);

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
  // Etapa 7.5: el modelo actual de turno es un PUNTO en el tiempo (date+time), sin campo de
  // fin/duración en ningún lugar de la app (ni schema, ni UI) — así que "conflicto" acá
  // significa choque EXACTO de horario, no solapamiento de intervalos (eso exigiría agregar
  // un campo de duración, fuera de alcance de esta etapa). Índice único PARCIAL, mismo patrón
  // que `products_global_codigo_unique_idx` (Etapa I-B.8-D): resuelve el TOCTOU real de dos
  // creaciones/ediciones concurrentes que verifican "sin conflicto" y después escriben — acá
  // la garantía la da Postgres al validar la constraint de forma atómica en el INSERT/UPDATE,
  // sin necesitar ninguna transacción ni lock explícito nuevo. Parcial porque un turno
  // cancelado (`status = 'cancelada'`) nunca debe bloquear ese horario para uno nuevo.
  activeSlotUnique: uniqueIndex("appointments_consultant_active_slot_unique_idx")
    .on(table.consultantId, table.date, table.time)
    .where(sql`${table.status} != 'cancelada'`),
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
  // Etapa I-B.7-D-C: importe de envío COBRADO a la clienta — siempre suma al `total` que paga.
  // Antes de esta etapa, esto era lo que se guardaba en la columna `shipping_cost` (que en la
  // práctica siempre representó lo cobrado, nunca un costo real — ver auditoría I-B.7-D-A). El
  // backfill de esta etapa copió los valores históricos de `shipping_cost` acá y los dejó en
  // `shipping_cost = NULL` — ningún valor fue inventado, ver `script/backfill-shipping-charged.ts`.
  shippingCharged: integer("shipping_charged"),
  // Etapa I-B.7-D-C: costo REAL del envío para la consultora — nullable porque no siempre se
  // conoce (si no se informa, el cálculo de `profit` lo trata como 0, pero el dato en sí queda
  // `NULL`, nunca se inventa un valor). Ventas anteriores a esta etapa quedan con `NULL` acá —
  // ese costo histórico no es reconstruible con la información que existía entonces.
  shippingCost: integer("shipping_cost"),
  // Etapa 4: Ingresos Brutos — importe MANUAL que la consultora informa por venta (impuesto
  // provincial que ELLA afronta, no un cargo a la clienta). Mismo tratamiento nullable que
  // shippingCost: resta de `profit`, nunca de `total` — ver shared/saleCalculations.ts para
  // la decisión de diseño completa. NULL = no informado (ventas anteriores a esta etapa, o
  // ventas donde la consultora simplemente no lo cargó) — nunca se inventa un valor.
  ingresosBrutos: integer("ingresos_brutos"),
  total: integer("total").notNull(),
  profit: integer("profit").notNull(),
  paymentMethod: text("payment_method").notNull().default("efectivo"),
  installmentsCount: integer("installments_count").notNull().default(1),
  installmentFrequency: text("installment_frequency"),
  status: text("status").notNull().default("pendiente"),
  notes: text("notes"),
  // Nullable: ventas históricas y cualquier cliente que no lo mande siguen funcionando igual.
  // UUID generado por el frontend (un valor por intento lógico de venta, ver NewSaleDialog) —
  // permite reintentar el mismo POST /api/sales (doble pestaña, retry tras perder la
  // respuesta) sin crear una segunda venta ni descontar stock dos veces (Etapa I-B.6).
  // UNIQUE compuesto con consultantId, nunca solo: cada navegador genera sus propios UUID de
  // forma independiente, así que dos consultoras distintas pueden coincidir en el mismo valor
  // sin que eso sea un conflicto real. Postgres no exige unicidad entre NULLs, así que las
  // ventas legacy (sin este campo) nunca chocan entre sí.
  clientRequestId: text("client_request_id"),
}, (table) => ({
  consultantDateIdx: index("sales_consultant_id_date_idx").on(table.consultantId, table.date),
  consultantClientIdx: index("sales_consultant_id_client_id_idx").on(table.consultantId, table.clientId),
  consultantClientRequestIdUnique: unique("sales_consultant_id_client_request_id_unique").on(
    table.consultantId,
    table.clientRequestId,
  ),
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
  // Etapa I-B.7-D-D: costo unitario histórico del producto en el momento de crear o
  // recalcular esta línea (misma fuente que ya usa `profit`: `productStock.costPrice ??
  // product.precio`) — resuelve F4 (auditoría I-B.7-D-A): antes de esta etapa solo existía
  // `sales.profit` como agregado de toda la venta, sin forma de reconstruir cuánto costó cada
  // producto específico. Nullable: líneas de ventas anteriores a esta etapa quedan en NULL —
  // ese costo histórico por ítem nunca fue registrado y no se inventa retroactivamente.
  costPrice: integer("cost_price"),
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

export const paymentStatuses = ["pending", "approved", "rejected", "cancelled", "in_process"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

/**
 * Ledger de pagos de Mercado Pago — una fila por cobro individual (nace en "pending" al crear
 * el intento, se confirma o rechaza cuando llega el webhook). Nunca se pisa: `amount`
 * guarda el monto REALMENTE cobrado, no una referencia al precio actual — un cambio de precio
 * futuro no altera pagos viejos. Único punto de idempotencia real: `mpPaymentId` (el id del
 * recurso `payment` de Mercado Pago, no el del preapproval ni el externalReference) — eso es
 * lo que impide procesar dos veces la misma notificación de webhook duplicada.
 *
 * `mpPreapprovalId` identifica a qué suscripción (preapproval) de Mercado Pago pertenece este
 * cobro — es una entidad distinta de `mpPaymentId`, nunca se mezclan: un preapproval es la
 * suscripción recurrente en sí, un payment es cada cobro individual que genera.
 *
 * Única excepción a la convención de fechas del resto del schema (texto "YYYY-MM-DD"): acá se
 * usa `timestamp` real porque el cálculo de vencimiento necesita hora exacta, no solo fecha.
 */
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").notNull().references(() => consultants.id),
  externalReference: text("external_reference").notNull().unique(),
  mpPreapprovalId: text("mp_preapproval_id"),
  mpPaymentId: text("mp_payment_id").unique(),
  status: text("status").notNull().default(paymentStatuses[0]),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("ARS"),
  periodDaysGranted: integer("period_days_granted").notNull().default(30),
  mpStatusDetail: text("mp_status_detail"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => ({
  consultantIdx: index("payments_consultant_id_idx").on(table.consultantId),
  statusIdx: index("payments_status_idx").on(table.status),
}));

export const subscriptionStatuses = ["trial", "active", "expired", "canceled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

/**
 * Estado de acceso de UNA consultora — una fila 1:1 que se actualiza in-place (no una fila
 * por período: el historial completo ya vive en `payments`). `status` es solo caché de
 * lectura para el admin — la fuente de verdad real del acceso siempre se calcula al vuelo a
 * partir de las fechas (ver server/subscription.ts), nunca se confía en esta columna sola.
 */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id").notNull().unique().references(() => consultants.id),
  status: text("status").notNull().default(subscriptionStatuses[0]),
  trialStartAt: timestamp("trial_start_at", { withTimezone: true }).notNull().defaultNow(),
  trialEndAt: timestamp("trial_end_at", { withTimezone: true }).notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  lastPaymentId: integer("last_payment_id").references(() => payments.id),
  // Id del preapproval (suscripción) de Mercado Pago vigente/más reciente de esta consultora —
  // durable mientras la suscripción exista, no solo mientras está "pendiente" (a diferencia de
  // una preferencia de Checkout Pro, que es de un solo uso). También sirve para no crear un
  // segundo preapproval por doble click: si ya hay uno reciente sin resolver, se reutiliza.
  mpPreapprovalId: text("mp_preapproval_id"),
  mpPreapprovalCreatedAt: timestamp("mp_preapproval_created_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
}, (table) => ({
  statusIdx: index("subscriptions_status_idx").on(table.status),
  currentPeriodEndIdx: index("subscriptions_current_period_end_idx").on(table.currentPeriodEnd),
}));

/**
 * Etapa 3 — código de recuperación de contraseña (6 dígitos, un solo uso). Nunca se guarda el
 * código en texto plano, solo su hash bcrypt (mismo mecanismo que ya usa `users.password` —
 * no se inventa un hashing nuevo). `userId` y no `consultantId`: lo que cambia al resetear es
 * `users.password`, y el admin (sin `consultantId`) también podría eventualmente necesitar
 * este flujo si algún día tiene email — no hay motivo para atarlo a la existencia de un tenant.
 *
 * Única excepción a la convención de fechas del resto del schema (texto "YYYY-MM-DD"), mismo
 * criterio ya documentado en `payments`/`subscriptions`: acá se necesita hora exacta para la
 * expiración de 10 minutos, no alcanza con una fecha.
 */
export const passwordResetCodes = pgTable("password_reset_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Intentos de verificación fallidos sobre ESTE código puntual — al llegar al máximo
  // (ver MAX_RESET_ATTEMPTS en server/auth-reset.ts) el código queda inutilizable aunque
  // todavía no haya vencido, sin importar cuántas requests nuevas lleguen.
  attempts: integer("attempts").notNull().default(0),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Para encontrar rápido "el código activo de este usuario" (siempre el más reciente sin usar).
  userIdIdx: index("password_reset_codes_user_id_idx").on(table.userId),
}));

export type PasswordResetCode = typeof passwordResetCodes.$inferSelect;
export type InsertPasswordResetCode = typeof passwordResetCodes.$inferInsert;

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
  Pick<ProductStock, "unidades" | "stockMinimo" | "costPrice" | "selectedDiscount" | "discontinued" | "remindStockAt"> & {
    /** Umbral de stock bajo ya resuelto (propio del producto, si no el de la consultora, si no
     * el default de la app) — ver `resolveLowStockThreshold` en `shared/stockAlerts.ts`. */
    effectiveStockMinimo: number;
  };
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
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertProductSchema = createInsertSchema(products);
export const selectProductSchema = createSelectSchema(products);
export const insertClientSchema = createInsertSchema(clients).omit({ id: true }).extend({
  phone: z.string().regex(PHONE_REGEX, PHONE_ERROR_MESSAGE),
  // Etapa I-B.8-E (F6): el frontend ya validaba el FORMATO de email (ClientDialog.tsx), el
  // backend no lo espejaba — aceptaba cualquier string. Se preserva exactamente el mismo
  // conjunto de valores ya aceptados (string vacío, null, undefined) — solo se rechaza un
  // string NO VACÍO con formato inválido. No se vuelve obligatorio, no se toca la detección de
  // duplicados (findDuplicateClient), no se convierte "" a null.
  email: z.union([z.literal(""), z.string().trim().email("Ingresá un email válido")]).nullable().optional(),
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
  type: appointmentTypeSchema,
  location: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

// Deliberadamente separado de createAppointmentSchema: crear y editar son operaciones
// distintas y pueden divergir con el tiempo (ej. qué campos se permiten tocar en cada caso).
export const updateAppointmentSchema = z.object({
  clientId: z.number().int().positive(),
  date: z.string().min(1),
  time: z.string().min(1),
  type: appointmentTypeSchema,
  location: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export const updateAppointmentStatusSchema = z.object({
  status: z.enum(appointmentStatuses),
});
export const insertSaleSchema = createInsertSchema(sales).omit({ id: true });
export const insertSaleItemSchema = createInsertSchema(saleItems).omit({ id: true });
export const insertSaleInstallmentSchema = createInsertSchema(saleInstallments).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true });

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
  stockMinimo: z.number().int().positive().optional(),
});

// Etapa I-B.8-C: edición de los campos CORE de un producto MANUAL ya creado (resuelve F2 de
// la auditoría I-B.8-A). Deliberadamente NO incluye: id/consultantId (ownership, lo deriva el
// backend de la sesión, nunca el body — mismo criterio que clientWriteSchema), imagen/puntos/
// variante (no pedidos, fuera de este alcance), costPrice/selectedDiscount/discontinued/
// unidades/stockMinimo (se administran por sus propios endpoints ya existentes — /discount,
// /discontinued, /stock, /stock/increment, /stock-reminder — nunca se mezclan acá). Todos los
// campos son opcionales (PATCH parcial), pero al menos uno debe venir.
export const updateProductSchema = z
  .object({
    seccion: z.string().trim().min(1, "La categoría es obligatoria").optional(),
    linea: z.string().trim().optional(),
    producto: z.string().trim().min(1, "El nombre del producto es obligatorio").optional(),
    precio: z.number().int().nonnegative().optional(),
    codigo: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No hay campos para actualizar" });

export const toggleProductDiscontinuedSchema = z.object({
  discontinued: z.boolean(),
});

export const setProductStockSchema = z.object({
  unidades: z.number().int().nonnegative(),
  // Opcional: si viene, actualiza también el umbral propio del producto. `null` explícito lo
  // borra (vuelve a usar la cascada: perfil de la consultora, si no el default de la app).
  stockMinimo: z.number().int().positive().nullable().optional(),
});

export const incrementProductStockSchema = z.object({
  // Etapa I-B.8-B: delta atómico, nunca un valor absoluto — positivo entra mercadería, negativo
  // sale. 0 no tiene ningún caso de uso identificado (no movería stock), así que se rechaza acá,
  // antes de llegar a la base de datos.
  delta: z.number().int().refine((d) => d !== 0, "El delta no puede ser 0"),
});

// Etapa 7.2: confirmación de un pedido/importación completo en una sola operación atómica
// (todo o nada) — reemplaza el loop de PATCH /stock/increment por línea que podía dejar una
// importación aplicada a medias si una línea intermedia fallaba. A diferencia del incremento
// de a un producto, acá el delta SIEMPRE es positivo: este batch representa exclusivamente
// "entrada de mercadería" (carga manual o importada), nunca una salida — mismo criterio que
// ya usa LoadOrderDialog.tsx, que solo genera cantidades positivas.
export const incrementProductStockBatchSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        delta: z.number().int().positive(),
      }),
    )
    .min(1, "El lote no puede estar vacío"),
});

export const setProductStockReminderSchema = z.object({
  // Fecha YYYY-MM-DD hasta la que posponer la alerta de este producto, o null para cancelarla.
  remindAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable(),
});

// Hardening post-I-B.8-F: "value" es compartido entre "percent" y "fixed", pero solo el
// primero tiene un techo natural (100%) — un descuento/recargo "fixed" sigue sin límite
// numérico propio (un monto en centavos desproporcionado ya queda absorbido por el
// `max(0, ...)` de computeSaleTotals, y no es lo que este hardening pidió tocar). Antes de
// esto, un typo como "500" en vez de "50" pasaba sin avisar y silenciosamente dejaba el total
// en $0 — no rompía nada, pero tampoco avisaba del error de carga.
const orderAdjustmentSchema = z
  .object({
    type: z.enum(adjustmentTypes),
    value: z.number().nonnegative(),
  })
  .refine((adjustment) => adjustment.type !== "percent" || adjustment.value <= 100, {
    message: "El porcentaje no puede ser mayor a 100",
    path: ["value"],
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
  // Etapa I-B.7-D-C: importe de envío cobrado a la clienta — reemplaza al viejo campo
  // `shippingCost` del contrato de API (que en realidad siempre significó esto). Opcional:
  // ausente/0 = sin envío.
  shippingCharged: z.number().int().nonnegative().optional(),
  // Costo REAL del envío para la consultora — opcional Y nullable: `undefined`/ausente y
  // `null` se tratan igual (no informado, el cálculo de profit lo trata como 0 sin inventar
  // el dato). Nunca negativo cuando se informa.
  shippingCost: z.number().int().nonnegative().nullable().optional(),
  // Etapa 4: Ingresos Brutos — mismo criterio que shippingCost (opcional Y nullable, nunca
  // negativo, resta de profit sin afectar total). Ver shared/saleCalculations.ts.
  ingresosBrutos: z.number().int().nonnegative().nullable().optional(),
  paymentMethod: z.enum(paymentMethods),
  installments: z.array(z.object({ amount: z.number().int().nonnegative() })).min(1),
  installmentFrequency: z.enum(installmentFrequencies).optional(),
  status: z.enum(["pendiente", "entregado", "pagado"]).default("pendiente"),
  notes: z.string().max(1000).optional(),
  // Opcional (compatibilidad con clientes viejos): clave de idempotencia generada por el
  // frontend — ver `sales.clientRequestId` en el schema de arriba y la Etapa I-B.6.
  clientRequestId: z.string().uuid("clientRequestId debe ser un UUID válido").optional(),
});

// Edición de una venta ya existente: mismo cuerpo que la creación, salvo clienta/fecha/status
// (no editables por esta vía) y con la posibilidad de agregar observaciones.
export const updateSaleSchema = z.object({
  items: z.array(createSaleItemSchema).min(1, "La venta debe tener al menos un producto"),
  orderDiscount: orderAdjustmentSchema,
  orderSurcharge: orderAdjustmentSchema,
  shippingCharged: z.number().int().nonnegative().optional(),
  shippingCost: z.number().int().nonnegative().nullable().optional(),
  ingresosBrutos: z.number().int().nonnegative().nullable().optional(),
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
  // Etapa I-B.8-E (F9): antes solo exigía "3 letras mayúsculas" — cualquier string inventado
  // (ej. "ZZZ") pasaba y después rompía `formatPrice` en TODA la app, porque
  // `Intl.NumberFormat` tira RangeError ante un código ISO 4217 que no existe. Se valida contra
  // el registro real del propio motor JS (`Intl.supportedValuesOf`, sin dependencias externas
  // ni una lista propia hardcodeada que quedaría desactualizada) — sigue soportando cualquier
  // moneda real, no solo ARS, así que no le pone un techo artificial a la app.
  currency: z
    .string()
    .trim()
    .length(3, "Usá un código de moneda ISO de 3 letras (ej. ARS, USD)")
    .toUpperCase()
    .refine(
      (code) => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency").includes(code) : true),
      "Ese código de moneda no existe (ISO 4217) — probá ARS, USD, etc.",
    ),
  monthlyGoal: z.number().int().nonnegative().nullable().optional(),
  defaultLowStockThreshold: z.number().int().positive().nullable().optional(),
});

// Carga masiva de catálogo global — admin-only. No lleva consultantId: el producto queda
// visible para todas las consultoras de una, no se le asigna a ninguna en particular.
export const adminBulkImportSchema = z.object({
  products: bulkProductSchema,
});

// Asignación de imágenes ya presentes en Storage a productos sin imagen, a partir de las
// coincidencias que arma findProductImageMatches (ver shared/imageMatching.ts). El backend
// vuelve a validar cada par antes de escribir — este schema solo exige la forma del body.
export const assignProductImageMatchesSchema = z.object({
  assignments: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        fileUrl: z.string().trim().min(1),
      }),
    )
    .min(1, "No hay ninguna asignación para aplicar"),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Autogestión: la consultora lo carga recién al iniciar su primera suscripción — Mercado
 * Pago exige payer_email para crear el preapproval. Ver POST /api/subscription/start. */
export const startSubscriptionSchema = z.object({
  email: z.string().trim().min(1, "El email es obligatorio").email("Ingresá un email válido"),
});

// ---------------------------------------------------------------------------
// Etapa 3 — registro público + recuperación de contraseña.
// ---------------------------------------------------------------------------

const emailFieldSchema = z.string().trim().min(1, "El email es obligatorio").email("Ingresá un email válido");
// Mismos mínimos que createConsultantSchema (alta de consultora por admin) — una sola regla
// de "qué es una contraseña/usuario válido" en toda la app, nunca dos criterios distintos.
const usernameFieldSchema = z.string().trim().min(3, "El usuario debe tener al menos 3 caracteres");
const passwordFieldSchema = z.string().min(6, "La contraseña debe tener al menos 6 caracteres");
const resetCodeFieldSchema = z.string().regex(/^\d{6}$/, "El código debe tener 6 dígitos");

// Deliberadamente NO incluye role/consultantId/status — el backend los asigna siempre de
// forma autoritativa (ver POST /api/auth/register), nunca los toma del body.
export const registerConsultantSchema = z.object({
  username: usernameFieldSchema,
  email: emailFieldSchema,
  password: passwordFieldSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailFieldSchema,
});

export const verifyResetCodeSchema = z.object({
  email: emailFieldSchema,
  code: resetCodeFieldSchema,
});

export const resetPasswordSchema = z.object({
  email: emailFieldSchema,
  code: resetCodeFieldSchema,
  newPassword: passwordFieldSchema,
});