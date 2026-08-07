import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

declare global {
  namespace Express {
    interface Request {
      /** Rol del usuario autenticado. Solo presente si pasó por requireAuth/requireAdmin. */
      userRole?: string;
      /** Tenant del usuario autenticado. `null` para admin (cross-tenant por diseño). */
      consultantId?: number | null;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const user = await storage.getUser(userId);

  if (!user || !user.status) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Sesión inválida" });
  }

  req.userRole = user.role;
  req.consultantId = user.consultantId;
  next();
}
