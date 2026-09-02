import type { Request, Response, NextFunction } from "express";
import { hasActiveAccess } from "../subscription";

/**
 * Corre después de requireAuth+requireConsultant en las rutas de negocio. El acceso se
 * recalcula siempre desde storage.getSubscriptionByConsultantId (ver server/subscription.ts)
 * — nunca desde un valor cacheado en el request/sesión, así una consultora que vence a mitad
 * de sesión queda bloqueada en el siguiente request, no recién cuando vuelva a loguearse.
 *
 * NUNCA se monta en: /api/subscription/* (una consultora bloqueada tiene que poder seguir
 * consultando su estado y pagando — eso es justamente lo que la desbloquea), /api/auth/*,
 * /api/health, ni en /api/admin/* (un admin no tiene consultantId, el concepto no le aplica).
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const hasAccess = await hasActiveAccess(req.consultantId!);
  if (!hasAccess) {
    return res.status(403).json({ error: "subscription_required" });
  }
  next();
}
