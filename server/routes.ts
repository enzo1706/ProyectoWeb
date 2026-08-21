import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import type { z } from "zod";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { storage, SaleValidationError, AppointmentValidationError, isBcryptHash } from "./storage";
import { uploadProductImage, deleteProductImage, isValidImageBuffer } from "./image-storage";
import {
  bulkProductSchema,
  createConsultantSchema,
  loginSchema,
  applyDiscountSchema,
  clientWriteSchema,
  createSaleSchema,
  updateSaleSchema,
  updateInstallmentStatusSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  updateAppointmentStatusSchema,
  updateBusinessSettingsSchema,
  adminBulkImportSchema,
  createProductSchema,
  toggleProductDiscontinuedSchema,
  setProductStockSchema,
  setProductStockReminderSchema,
  type InsertProduct,
} from "@shared/schema";
import { requireAdmin } from "./middleware/requireAdmin";
import { requireAuth } from "./middleware/requireAuth";
import { slugify } from "@shared/slug";

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesión. Probá de nuevo en unos minutos." },
});

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Memoria, nunca disco: el buffer va directo a Supabase Storage — el server no debe depender
// de un disco persistente (los contenedores de hosting como Railway no lo garantizan entre
// reinicios/redeploys).
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      return cb(new Error("Formato no permitido. Usá JPG, PNG o WebP."));
    }
    cb(null, true);
  },
});

/**
 * Corre después de requireAuth en las rutas de negocio: un admin está autenticado pero
 * no pertenece a ninguna consultora (consultantId null por diseño), así que nunca debe
 * poder tocar datos scopeados por tenant a través de estos endpoints.
 */
function requireConsultant(req: Request, res: Response, next: NextFunction) {
  if (req.consultantId === null || req.consultantId === undefined) {
    return res.status(403).json({ error: "Esta acción es exclusiva de cuentas consultora" });
  }
  next();
}

function toInsertProduct(item: z.infer<typeof bulkProductSchema>[number]): InsertProduct {
  const variante = item.variante ?? "Estándar";
  return {
    seccion: item.seccion,
    linea: item.linea ?? null,
    producto: item.producto,
    precio: item.precio,
    codigo: item.codigo ?? slugify(`${item.seccion}-${item.linea ?? ""}-${item.producto}-${variante}`),
    variante,
    puntos: item.puntos ?? 0,
    imagen: item.imagen ?? null,
  };
}

const SEED_PRODUCTS = [
  {
    seccion: "Cuidado Facial",
    linea: "TimeWise 3D",
    producto: "Set Milagroso TimeWise 3D",
    codigo: "MK-TW3D-SET-001",
    precio: 12500,
    unidades: 24,
    puntos: 120,
    variante: "Estándar",
  },
  {
    seccion: "Maquillaje",
    linea: "Mary Kay",
    producto: "Base Líquida Mate",
    codigo: "MK-BASE-MATE-001",
    precio: 4800,
    unidades: 36,
    puntos: 48,
    variante: "Ivory",
  },
  {
    seccion: "Maquillaje",
    linea: "Ultimate",
    producto: "Labial en Gel Semi-Mate",
    codigo: "MK-LAB-GEL-001",
    precio: 2200,
    unidades: 50,
    puntos: 22,
    variante: "Berry Nude",
  },
  {
    seccion: "Cuidado Facial",
    linea: "TimeWise",
    producto: "Crema Hidratante Day Cream SPF 30",
    codigo: "MK-TW-DAY-001",
    precio: 5200,
    unidades: 18,
    puntos: 52,
    variante: "Normal/Seca",
  },
  {
    seccion: "Maquillaje",
    linea: "Mary Kay",
    producto: "Máscara de Pestañas Lash Love",
    codigo: "MK-LASH-001",
    precio: 1600,
    unidades: 42,
    puntos: 16,
    variante: "Negro",
  },
  {
    seccion: "Fragancias",
    linea: "Believe",
    producto: "Eau de Parfum Believe",
    codigo: "MK-BELIEVE-EDP-001",
    precio: 4500,
    unidades: 15,
    puntos: 45,
    variante: "50 ml",
  },
] as const;

function omitPassword<T extends { password?: string }>(user: T) {
  const { password: _, ...safe } = user;
  return safe;
}

function parseDateRange(req: Request): { start?: string; end?: string } {
  const start = typeof req.query.start === "string" && req.query.start ? req.query.start : undefined;
  const end = typeof req.query.end === "string" && req.query.end ? req.query.end : undefined;
  return { start, end };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  app.post("/api/auth/login", loginRateLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos" });
      }

      const user = await storage.getUserByUsername(parsed.data.username);
      if (!user) {
        return res.status(401).json({ error: "Credenciales inválidas" });
      }

      let passwordMatches: boolean;
      if (isBcryptHash(user.password)) {
        passwordMatches = await bcrypt.compare(parsed.data.password, user.password);
      } else {
        // Compatibilidad con cuentas creadas antes de esta etapa (password en texto plano).
        // Si coincide, se migra a hash de forma transparente en este mismo login.
        passwordMatches = user.password === parsed.data.password;
        if (passwordMatches) {
          const newHash = await bcrypt.hash(parsed.data.password, 10);
          await storage.updateUserPassword(user.id, newHash);
        }
      }

      if (!passwordMatches) {
        return res.status(401).json({ error: "Credenciales inválidas" });
      }

      if (!user.status) {
        return res.status(403).json({ error: "Tu acceso ha sido desactivado" });
      }

      req.session.userId = user.id;
      res.json(omitPassword(user));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al iniciar sesión" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Error al cerrar sesión" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Sesión cerrada" });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "No autenticado" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.status) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: "Sesión inválida" });
      }

      res.json(omitPassword(user));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener usuario" });
    }
  });

  app.use("/api/admin", requireAdmin);

  // Mismo patrón que /api/admin: cualquier sesión válida (admin o consultant) puede
  // acceder a los datos de negocio. Sin esto, estas rutas quedan abiertas sin login.
  // requireConsultant además exige que la sesión pertenezca a una consultora (admin
  // nunca debe poder tocar datos de negocio scopeados por tenant a través de estas rutas).
  app.use("/api/products", requireAuth, requireConsultant);
  app.use("/api/clients", requireAuth, requireConsultant);
  app.use("/api/sales", requireAuth, requireConsultant);
  app.use("/api/appointments", requireAuth, requireConsultant);
  app.use("/api/reports", requireAuth, requireConsultant);
  app.use("/api/dashboard", requireAuth, requireConsultant);

  // Sin requireConsultant: admin recibe 404 explícito ("no aplica"), no el 403 genérico.
  app.get("/api/business-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.consultantId === null || req.consultantId === undefined) {
        return res.status(404).json({ error: "La configuración de negocio no aplica para administradores" });
      }
      const settings = await storage.getBusinessSettings(req.consultantId);
      if (!settings) {
        return res.status(404).json({ error: "Configuración no encontrada" });
      }
      res.json(settings);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener la configuración" });
    }
  });

  app.patch("/api/business-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.consultantId === null || req.consultantId === undefined) {
        return res.status(404).json({ error: "La configuración de negocio no aplica para administradores" });
      }
      const parsed = updateBusinessSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }
      const updated = await storage.updateBusinessSettings(req.consultantId, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Configuración no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar la configuración" });
    }
  });

  app.get("/api/products", async (req: Request, res: Response) => {
    try {
      const list = await storage.getAllProducts(req.consultantId!);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener productos" });
    }
  });

  app.post("/api/products/seed", async (req: Request, res: Response) => {
    try {
      // Privado de esta consultora (no global) — es un catálogo de prueba para ella sola.
      const count = await storage.seedOwnProducts(req.consultantId!, [...SEED_PRODUCTS]);
      const list = await storage.getAllProducts(req.consultantId!);
      res.json({ message: "Catálogo de prueba cargado", count, products: list });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al cargar productos de prueba" });
    }
  });

  app.post("/api/products", async (req: Request, res: Response) => {
    try {
      const parsed = createProductSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }
      const created = await storage.createProduct(req.consultantId!, parsed.data);
      res.status(201).json(created);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al crear el producto" });
    }
  });

  app.get("/api/products/low-stock", async (req: Request, res: Response) => {
    try {
      const list = await storage.getLowStockProducts(req.consultantId!);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener productos con bajo stock" });
    }
  });

  app.get("/api/appointments/upcoming", async (req: Request, res: Response) => {
    try {
      const list = await storage.getUpcomingAppointments(req.consultantId!);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener próximas citas" });
    }
  });

  app.get("/api/appointments", async (req: Request, res: Response) => {
    try {
      const start = typeof req.query.start === "string" ? req.query.start : "";
      const end = typeof req.query.end === "string" ? req.query.end : "";
      if (!start || !end) {
        return res.status(400).json({ error: "Los parámetros start y end son requeridos" });
      }
      if (end <= start) {
        return res.status(400).json({ error: "El parámetro end debe ser posterior a start" });
      }
      const list = await storage.getAppointmentsInRange(req.consultantId!, start, end);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener citas" });
    }
  });

  app.post("/api/appointments", async (req: Request, res: Response) => {
    try {
      const parsed = createAppointmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const appointment = await storage.createAppointment(req.consultantId!, parsed.data);
      if (!appointment) {
        return res.status(404).json({ error: "Clienta no encontrada" });
      }
      res.status(201).json(appointment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al crear la cita" });
    }
  });

  app.patch("/api/appointments/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = updateAppointmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.updateAppointment(req.consultantId!, id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Cita no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof AppointmentValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "Error al actualizar la cita" });
    }
  });

  app.patch("/api/appointments/:id/status", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = updateAppointmentStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.updateAppointmentStatus(req.consultantId!, id, parsed.data.status);
      if (!updated) {
        return res.status(404).json({ error: "Cita no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar el estado de la cita" });
    }
  });

  app.delete("/api/appointments/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const deleted = await storage.deleteAppointment(req.consultantId!, id);
      if (!deleted) {
        return res.status(404).json({ error: "Cita no encontrada" });
      }
      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al eliminar la cita" });
    }
  });

  app.get("/api/clients/top", async (req: Request, res: Response) => {
    try {
      const list = await storage.getTopClients(req.consultantId!);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener mejores clientes" });
    }
  });

  app.get("/api/sales/top-products", async (req: Request, res: Response) => {
    try {
      const category = typeof req.query.category === "string" && req.query.category ? req.query.category : undefined;
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
      const list = await storage.getTopProductsByCategory(req.consultantId!, category, limit && !isNaN(limit) ? limit : undefined);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener productos más vendidos" });
    }
  });

  app.get("/api/clients", async (req: Request, res: Response) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : "";
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
      const list = await storage.searchClients(req.consultantId!, search, limit && !isNaN(limit) ? limit : undefined);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al buscar clientas" });
    }
  });

  app.post("/api/clients", async (req: Request, res: Response) => {
    try {
      const parsed = clientWriteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const duplicate = await storage.findDuplicateClient(req.consultantId!, parsed.data.phone, parsed.data.email ?? null);
      if (duplicate) {
        const field = duplicate.phone === parsed.data.phone ? "teléfono" : "email";
        return res.status(409).json({ error: `Ya existe una clienta registrada con ese ${field}` });
      }

      const client = await storage.createClient(req.consultantId!, parsed.data);
      res.status(201).json(client);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al crear clienta" });
    }
  });

  app.patch("/api/clients/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = clientWriteSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      if (parsed.data.phone !== undefined || parsed.data.email !== undefined) {
        const current = await storage.getClientById(req.consultantId!, id);
        if (!current) {
          return res.status(404).json({ error: "Clienta no encontrada" });
        }
        const phone = parsed.data.phone ?? current.phone;
        const email = parsed.data.email !== undefined ? parsed.data.email : current.email;
        const duplicate = await storage.findDuplicateClient(req.consultantId!, phone, email, id);
        if (duplicate) {
          const field = duplicate.phone === phone ? "teléfono" : "email";
          return res.status(409).json({ error: `Ya existe otra clienta registrada con ese ${field}` });
        }
      }

      const updated = await storage.updateClient(req.consultantId!, id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Clienta no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar clienta" });
    }
  });

  app.delete("/api/clients/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const result = await storage.deleteClient(req.consultantId!, id);
      if (result === "not_found") {
        return res.status(404).json({ error: "Clienta no encontrada" });
      }
      if (result === "has_relations") {
        return res.status(409).json({
          error: "No se puede eliminar: la clienta tiene ventas o citas asociadas. Esos registros se conservan para historial.",
        });
      }
      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al eliminar clienta" });
    }
  });

  app.get("/api/clients/:id/sales", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const list = await storage.getSalesByClient(req.consultantId!, id);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener las ventas de la clienta" });
    }
  });

  app.get("/api/clients/:id/appointments", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const list = await storage.getAppointmentsByClient(req.consultantId!, id);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener las citas de la clienta" });
    }
  });

  app.get("/api/sales", async (req: Request, res: Response) => {
    try {
      const list = await storage.getAllSales(req.consultantId!);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener ventas" });
    }
  });

  app.post("/api/sales", async (req: Request, res: Response) => {
    try {
      const parsed = createSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const sale = await storage.createSale(req.consultantId!, parsed.data);
      res.status(201).json(sale);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "Error al crear la venta" });
    }
  });

  app.get("/api/sales/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const sale = await storage.getSaleDetails(req.consultantId!, id);
      if (!sale) {
        return res.status(404).json({ error: "Venta no encontrada" });
      }
      res.json(sale);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener la venta" });
    }
  });

  app.patch("/api/sales/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = updateSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.updateSale(req.consultantId!, id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Venta no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "Error al actualizar la venta" });
    }
  });

  app.post("/api/sales/:id/cancel", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const cancelled = await storage.cancelSale(req.consultantId!, id);
      if (!cancelled) {
        return res.status(404).json({ error: "Venta no encontrada" });
      }
      res.json(cancelled);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "Error al cancelar la venta" });
    }
  });

  app.patch("/api/sales/:id/installments/:installmentId", async (req: Request, res: Response) => {
    try {
      const saleId = parseInt(req.params.id, 10);
      const installmentId = parseInt(req.params.installmentId, 10);
      if (isNaN(saleId) || isNaN(installmentId)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = updateInstallmentStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.updateInstallmentStatus(req.consultantId!, saleId, installmentId, parsed.data.status);
      if (!updated) {
        return res.status(404).json({ error: "Cuota no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "Error al actualizar la cuota" });
    }
  });

  app.post("/api/dashboard/seed-demo", async (req: Request, res: Response) => {
    try {
      await storage.seedDashboardDemoData(req.consultantId!);
      res.json({ message: "Datos de demostración cargados" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al cargar datos de demostración" });
    }
  });

  app.patch("/api/products/:id/discount", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = applyDiscountSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.applyProductDiscount(req.consultantId!, id, parsed.data.discountPercent);
      if (!updated) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al aplicar el descuento" });
    }
  });

  app.patch("/api/products/:id/discontinued", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = toggleProductDiscontinuedSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.setProductDiscontinued(req.consultantId!, id, parsed.data.discontinued);
      if (!updated) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar el producto" });
    }
  });

  app.patch("/api/products/:id/stock", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = setProductStockSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.setProductStock(req.consultantId!, id, parsed.data.unidades, parsed.data.stockMinimo);
      if (!updated) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar el stock" });
    }
  });

  app.patch("/api/products/:id/stock-reminder", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const parsed = setProductStockReminderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.setProductStockReminder(req.consultantId!, id, parsed.data.remindAt);
      if (!updated) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al guardar el recordatorio" });
    }
  });

  app.get("/api/admin/stats", async (_req: Request, res: Response) => {
    try {
      const consultants = await storage.getConsultants();
      const activeProducts = await storage.getProductCount();
      res.json({
        totalConsultants: consultants.length,
        activeConsultants: consultants.filter((u) => u.status).length,
        activeProducts,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener estadísticas" });
    }
  });

  app.get("/api/admin/users", async (_req: Request, res: Response) => {
    try {
      const consultants = await storage.getConsultants();
      res.json(consultants.map(omitPassword));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al listar consultoras" });
    }
  });

  app.post("/api/admin/users", async (req: Request, res: Response) => {
    try {
      const parsed = createConsultantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) {
        return res.status(409).json({ error: "El nombre de usuario ya existe" });
      }

      const user = await storage.createUser({
        username: parsed.data.username,
        password: parsed.data.password,
        role: "consultant",
        status: true,
      });

      res.status(201).json(omitPassword(user));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al crear consultora" });
    }
  });

  app.patch("/api/admin/users/:id/toggle-status", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const updated = await storage.toggleUserStatus(id);
      if (!updated) {
        return res.status(404).json({ error: "Consultora no encontrada" });
      }

      res.json(omitPassword(updated));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar estado" });
    }
  });

  // Para el selector del bulk import: solo admin puede ver la lista de consultoras existentes.
  app.get("/api/admin/consultants", async (_req: Request, res: Response) => {
    try {
      const list = await storage.listConsultantAccounts();
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al listar consultoras" });
    }
  });

  // Carga masiva del catálogo GLOBAL: queda visible para todas las consultoras de una,
  // ninguna se elige como destino — el stock de cada una se configura aparte.
  app.post("/api/admin/products/bulk", async (req: Request, res: Response) => {
    try {
      const parsed = adminBulkImportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const items = parsed.data.products.map(toInsertProduct);
      const count = await storage.bulkInsertProducts(items);
      res.json({ message: "Catálogo cargado correctamente", count });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error en carga masiva" });
    }
  });

  app.get("/api/admin/products", async (_req: Request, res: Response) => {
    try {
      const list = await storage.listGlobalProducts();
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener el catálogo global" });
    }
  });

  function handleImageUpload(req: Request, res: Response, next: NextFunction) {
    imageUpload.single("image")(req, res, (err: unknown) => {
      if (!err) return next();
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "La imagen no puede superar los 5MB."
          : err instanceof Error
            ? err.message
            : "No se pudo procesar el archivo.";
      res.status(400).json({ error: message });
    });
  }

  app.post("/api/admin/products/:id/image", handleImageUpload, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "Falta el archivo de imagen" });
      }

      // El mimetype de multer viene del Content-Type que declaró el cliente — falsificable.
      // Esto confirma que el contenido real del archivo es la imagen que dice ser.
      if (!isValidImageBuffer(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "El archivo no es una imagen válida" });
      }

      const extension = ALLOWED_IMAGE_TYPES[req.file.mimetype];
      const url = await uploadProductImage(id, req.file.buffer, req.file.mimetype, extension);

      let result;
      try {
        result = await storage.setProductImage(id, url);
      } catch (dbError) {
        // La imagen nueva ya se subió a Storage pero Postgres falló después — la borramos
        // para no dejarla huérfana (nadie la referencia todavía) y devolvemos el error.
        console.error("Fallo al guardar la imagen en la base, revirtiendo la subida:", dbError);
        await deleteProductImage(url);
        throw dbError;
      }

      if (!result.product) {
        // El producto no existe (o no es global) — la imagen recién subida queda huérfana
        // si no la borramos, porque nunca se llegó a referenciar desde ningún lado.
        await deleteProductImage(url);
        return res.status(404).json({ error: "Producto global no encontrado" });
      }

      if (result.previousImage) {
        await deleteProductImage(result.previousImage);
      }

      res.json(result.product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al subir la imagen" });
    }
  });

  app.delete("/api/admin/products/:id/image", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const result = await storage.setProductImage(id, null);
      if (!result.product) {
        return res.status(404).json({ error: "Producto global no encontrado" });
      }
      if (result.previousImage) {
        await deleteProductImage(result.previousImage);
      }
      res.json(result.product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al quitar la imagen" });
    }
  });

  app.get("/api/reports/sales-summary", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      if (!start || !end) {
        return res.status(400).json({ error: "Los parámetros start y end son requeridos" });
      }
      const groupByParam = typeof req.query.groupBy === "string" ? req.query.groupBy : "day";
      if (groupByParam !== "day" && groupByParam !== "week" && groupByParam !== "month") {
        return res.status(400).json({ error: "groupBy debe ser day, week o month" });
      }
      const list = await storage.getSalesSummary(req.consultantId!, start, end, groupByParam);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener el resumen de ventas" });
    }
  });

  app.get("/api/reports/top-products", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      const category = typeof req.query.category === "string" && req.query.category ? req.query.category : undefined;
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
      const orderParam = typeof req.query.order === "string" ? req.query.order : "desc";
      if (orderParam !== "asc" && orderParam !== "desc") {
        return res.status(400).json({ error: "order debe ser asc o desc" });
      }
      const list = await storage.getTopProductsByCategory(
        req.consultantId!,
        category,
        limit && !isNaN(limit) ? limit : undefined,
        start,
        end,
        orderParam,
      );
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener productos más vendidos" });
    }
  });

  app.get("/api/reports/top-categories", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      const list = await storage.getTopCategories(req.consultantId!, start, end);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener categorías más vendidas" });
    }
  });

  app.get("/api/reports/top-clients", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
      const list = await storage.getTopClients(req.consultantId!, limit && !isNaN(limit) ? limit : undefined, start, end);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener mejores clientas" });
    }
  });

  app.get("/api/reports/payment-methods", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      const list = await storage.getSalesByPaymentMethod(req.consultantId!, start, end);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener ventas por método de pago" });
    }
  });

  app.get("/api/reports/installments-breakdown", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      const breakdown = await storage.getInstallmentsBreakdown(req.consultantId!, start, end);
      res.json(breakdown);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener ventas por cuotas" });
    }
  });

  app.get("/api/reports/stock-valuation", async (req: Request, res: Response) => {
    try {
      const result = await storage.getStockValuation(req.consultantId!);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener el stock valorizado" });
    }
  });

  app.get("/api/reports/inactive-clients", async (req: Request, res: Response) => {
    try {
      const daysParam = typeof req.query.days === "string" ? parseInt(req.query.days, 10) : 30;
      const days = !isNaN(daysParam) && daysParam > 0 ? daysParam : 30;
      const list = await storage.getInactiveClients(req.consultantId!, days);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener clientas inactivas" });
    }
  });

  app.get("/api/reports/upcoming-birthdays", async (req: Request, res: Response) => {
    try {
      const daysParam = typeof req.query.days === "string" ? parseInt(req.query.days, 10) : 30;
      const days = !isNaN(daysParam) && daysParam > 0 ? daysParam : 30;
      const list = await storage.getUpcomingBirthdays(req.consultantId!, days);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener próximos cumpleaños" });
    }
  });

  app.get("/api/reports/appointments-summary", async (req: Request, res: Response) => {
    try {
      const { start, end } = parseDateRange(req);
      if (!start || !end) {
        return res.status(400).json({ error: "Los parámetros start y end son requeridos" });
      }
      const summary = await storage.getAppointmentsSummary(req.consultantId!, start, end);
      res.json(summary);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener el resumen de citas" });
    }
  });

  app.get("/api/reports/pending-installments", async (req: Request, res: Response) => {
    try {
      const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
      const limit = limitParam !== undefined && !isNaN(limitParam) ? limitParam : undefined;
      const list = await storage.getPendingInstallments(req.consultantId!, limit);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener cuotas pendientes" });
    }
  });

  return httpServer;
}
