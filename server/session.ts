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
  // Igual criterio que DatabaseStorage.getDb() (Etapa I-B.5.1): si TEST_DATABASE_URL está
  // seteada (solo pasa en los tests de Postgres real, después de pasar el guard de
  // test-db-guard.ts), la tabla "session" de esos tests vive en la base de test, aislada de
  // la real — producción nunca tiene esa variable, así que este branch nunca se activa ahí.
  const pool = process.env.TEST_DATABASE_URL
    ? (await import("./test-db")).testPool
    : (await import("./db")).pool;
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

/**
 * Etapa 3 — después de un reset de contraseña exitoso, cualquier sesión vieja (otro
 * navegador/dispositivo con la contraseña anterior) debe dejar de servir. Best-effort: un
 * fallo acá no debe romper el reset en sí (la contraseña ya cambió, que es lo que importa
 * de verdad) — mismo criterio que `deleteProductImage` en image-storage.ts.
 *
 * Solo implementado para DATABASE_MODE=postgres (lo que corre en producción real): la tabla
 * `session` de connect-pg-simple guarda `sess` como JSON con `userId` adentro, así que un
 * DELETE con el operador `->>'userId'` de Postgres alcanza — connect-pg-simple no implementa
 * el método opcional `Store.all()`, así que no hay forma limpia de listar sus sesiones sin
 * pegarle directo a la tabla.
 *
 * LIMITACIÓN DOCUMENTADA: en DATABASE_MODE=memory (memorystore, solo para desarrollo local sin
 * Postgres) esto es un no-op — memorystore SÍ expone `.all()`/`.destroy()`, pero implementar
 * esa rama solo para un modo que ya es exclusivamente de desarrollo (sesiones en memoria de
 * proceso, se pierden en cada reinicio igual) no se justifica frente al riesgo de un bug ahí.
 * Si en el futuro hace falta cubrir ese modo también, la solución correcta es iterar
 * `store.all()` y filtrar por `sess.userId`, llamando `store.destroy(sid)` por cada match.
 */
export async function invalidateUserSessions(userId: number): Promise<void> {
  if (resolveStorageMode() !== "postgres") return;

  try {
    const pool = process.env.TEST_DATABASE_URL ? (await import("./test-db")).testPool : (await import("./db")).pool;
    await pool.query(`DELETE FROM "session" WHERE (sess->>'userId')::int = $1`, [userId]);
  } catch (err) {
    console.error("No se pudieron invalidar las sesiones anteriores tras el reset de contraseña:", err);
  }
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
