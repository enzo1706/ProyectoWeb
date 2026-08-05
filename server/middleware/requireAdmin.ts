import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const user = await storage.getUser(userId);

  if (!user || !user.status) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Sesión inválida" });
  }

  if (user.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  next();
}
