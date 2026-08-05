import session from "express-session";
import type { Express } from "express";
import MemoryStoreFactory from "memorystore";
import { storage } from "./storage";

const MemoryStore = MemoryStoreFactory(session);

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

export function setupSession(app: Express) {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "mary-kay-dev-secret",
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    }),
  );
}

export async function ensureDefaultAdmin() {
  const admin = await storage.getUserByUsername("admin");
  if (!admin) {
    await storage.createUser({
      username: "admin",
      password: "admin123",
      role: "admin",
      status: true,
    });
  }
}
