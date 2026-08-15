import express, { type Express, type Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { setupSession, ensureDefaultAdmin } from "./session";
import { resolveStorageMode } from "./storage-mode";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/** Construye la app completa (sesión, rutas, manejo de errores, estático/vite) sin poner
 * el servidor a escuchar — separado de `index.ts` para que el arranque real (`.listen`,
 * graceful shutdown) sea lo único con efectos secundarios, y así los tests puedan levantar
 * la app en un puerto efímero propio sin duplicar toda esta configuración. */
export async function createApp(): Promise<{ app: Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);

  // Railway (como Replit Autoscale antes) coloca exactamente un proxy propio delante de
  // la app. "1" confía solo en ese hop para X-Forwarded-For/-Proto — necesario para que
  // express-rate-limit vea la IP real de cada usuario en vez de agrupar a todos bajo la IP
  // del proxy. Si el hosting cambia a uno con otra cantidad de hops, este valor hay que
  // revisarlo.
  app.set("trust proxy", 1);

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        log(logLine);
      }
    });

    next();
  });

  // Público, sin auth — Railway/Render lo golpean para saber si el proceso está vivo.
  // No revela credenciales, connection strings, ni detalle técnico del error.
  app.get("/api/health", async (_req: Request, res: Response) => {
    const mode = resolveStorageMode();
    if (mode === "memory") {
      return res.json({ status: "ok", database: "memory" });
    }
    try {
      const { pool } = await import("./db");
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "connected" });
    } catch (error) {
      console.error("Health check: no se pudo consultar Postgres —", error);
      res.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  await setupSession(app);

  // El admin de desarrollo (admin/admin123) nunca debe crearse en producción:
  // es una credencial conocida, no una forma válida de aprovisionar un admin real.
  if (process.env.NODE_ENV !== "production") {
    await ensureDefaultAdmin();
  }
  await registerRoutes(httpServer, app);

  // Red de seguridad para lo que ninguna ruta llegó a capturar con su propio try/catch
  // (ej. JSON malformado del body-parser, un throw en un middleware). Nunca reenvía
  // err.message: puede traer detalle técnico, SQL, paths internos o texto en inglés.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Error no controlado:", err);
    const hasKnownStatus = typeof err?.status === "number" || typeof err?.statusCode === "number";
    const status = hasKnownStatus ? (err.status ?? err.statusCode) : 500;
    const message = status < 500 ? "Solicitud inválida." : "Ocurrió un problema en el servidor. Intentá nuevamente en unos minutos.";
    res.status(status).json({ error: message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else if (process.env.NODE_ENV !== "test") {
    // En tests no hace falta servir nada estático ni levantar el dev server de Vite
    // (watchers de filesystem, websocket de HMR) — los tests solo golpean /api/*.
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  return { app, httpServer };
}
