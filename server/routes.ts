import type { Express, Request, Response } from "express";
import { type Server } from "http";
import type { z } from "zod";
import { storage, SaleValidationError } from "./storage";
import {
  bulkProductSchema,
  createConsultantSchema,
  loginSchema,
  applyDiscountSchema,
  insertClientSchema,
  createSaleSchema,
  type InsertProduct,
} from "@shared/schema";
import { requireAdmin } from "./middleware/requireAdmin";

const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;

function stripDiacritics(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARKS_START || code > COMBINING_MARKS_END;
    })
    .join("");
}

function slugify(value: string): string {
  return stripDiacritics(value)
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function toInsertProduct(item: z.infer<typeof bulkProductSchema>[number]): InsertProduct {
  const variante = item.variante ?? "Estándar";
  return {
    seccion: item.seccion,
    linea: item.linea,
    producto: item.producto,
    precio: item.precio,
    unidades: item.unidades ?? 0,
    codigo: item.codigo ?? slugify(`${item.seccion}-${item.linea}-${item.producto}-${variante}`),
    variante,
    puntos: item.puntos ?? 0,
    imagen: item.imagen ?? null,
    stockMinimo: item.stockMinimo ?? 5,
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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos" });
      }

      const user = await storage.getUserByUsername(parsed.data.username);
      if (!user || user.password !== parsed.data.password) {
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

  app.get("/api/products", async (_req: Request, res: Response) => {
    try {
      const list = await storage.getAllProducts();
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener productos" });
    }
  });

  app.post("/api/products/seed", async (_req: Request, res: Response) => {
    try {
      const count = await storage.bulkInsertProducts([...SEED_PRODUCTS]);
      const list = await storage.getAllProducts();
      res.json({ message: "Catálogo de prueba cargado", count, products: list });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al cargar productos de prueba" });
    }
  });

  app.get("/api/products/low-stock", async (_req: Request, res: Response) => {
    try {
      const list = await storage.getLowStockProducts();
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener productos con bajo stock" });
    }
  });

  app.get("/api/appointments/upcoming", async (_req: Request, res: Response) => {
    try {
      const list = await storage.getUpcomingAppointments();
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener próximas citas" });
    }
  });

  app.get("/api/clients/top", async (_req: Request, res: Response) => {
    try {
      const list = await storage.getTopClients();
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
      const list = await storage.getTopProductsByCategory(category, limit && !isNaN(limit) ? limit : undefined);
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
      const list = await storage.searchClients(search, limit && !isNaN(limit) ? limit : undefined);
      res.json(list);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al buscar clientas" });
    }
  });

  app.post("/api/clients", async (req: Request, res: Response) => {
    try {
      const parsed = insertClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }
      const client = await storage.createClient(parsed.data);
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

      const parsed = insertClientSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const updated = await storage.updateClient(id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Clienta no encontrada" });
      }
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar clienta" });
    }
  });

  app.get("/api/sales", async (_req: Request, res: Response) => {
    try {
      const list = await storage.getAllSales();
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

      const sale = await storage.createSale(parsed.data);
      res.status(201).json(sale);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "Error al crear la venta" });
    }
  });

  app.post("/api/dashboard/seed-demo", async (_req: Request, res: Response) => {
    try {
      await storage.seedDashboardDemoData();
      res.json({ message: "Datos de demostración cargados" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al cargar datos de demostración" });
    }
  });

  app.post("/api/products/import", async (req: Request, res: Response) => {
    try {
      const parsed = bulkProductSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const items = parsed.data.map(toInsertProduct);

      const count = await storage.bulkInsertProducts(items);
      res.json({ message: "Catálogo actualizado", count });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al importar" });
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

      const updated = await storage.applyProductDiscount(id, parsed.data.discountPercent);
      if (!updated) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al aplicar el descuento" });
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

  app.post("/api/admin/products/bulk", async (req: Request, res: Response) => {
    try {
      const parsed = bulkProductSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const items = parsed.data.map(toInsertProduct);

      const count = await storage.bulkInsertProducts(items);
      res.json({ message: "Catálogo cargado correctamente", count });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error en carga masiva" });
    }
  });

  return httpServer;
}
