import session from "express-session";
import type { Express } from "express";
import type { Store } from "express-session";
import MemoryStoreFactory from "memorystore";
import connectPgSimple from "connect-pg-simple";
import { storage } from "./storage";
import { resolveStorageMode } from "./storage-mode";

const MemoryStore = MemoryStoreFactory(session);

if (!process.env.SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET must be set. Did you forget to set it in your environment variables?",
  );
}

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

/**
 * Import perezoso de ./db: ese módulo tira si falta DATABASE_URL, y no queremos que
 * cargarlo rompa el arranque en DATABASE_MODE=memory (mismo criterio que ya usa
 * DatabaseStorage.getDb() en storage.ts).
 */
async function createPostgresSessionStore(): Promise<Store> {
  const { pool } = await import("./db");
  const PgSession = connectPgSimple(session);
  return new PgSession({ pool, tableName: "session", createTableIfMissing: true });
}

export async function setupSession(app: Express) {
  const mode = resolveStorageMode();
  const store = mode === "postgres" ? await createPostgresSessionStore() : new MemoryStore({ checkPeriod: 86400000 });

  app.use(
    session({
      secret: process.env.SESSION_SECRET as string,
      resave: false,
      saveUninitialized: false,
      store,
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
