import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assertTestDatabaseAuthorized } from "../test-db-guard";

/**
 * Etapa I-B.5.1 — prueba el guard en sí, en aislamiento total: nunca crea un pg.Pool real,
 * nunca requiere Docker corriendo. Manipula process.env directamente y lo restaura después
 * de cada caso — no toca ninguna base de datos, ni real ni de test.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.TEST_DATABASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("assertTestDatabaseAuthorized", () => {
  it("1. rechaza si TEST_DATABASE_URL no está seteada", () => {
    expect(() => assertTestDatabaseAuthorized()).toThrow(/Falta TEST_DATABASE_URL/);
  });

  it("2. rechaza una URL con formato inválido", () => {
    process.env.TEST_DATABASE_URL = "esto-no-es-una-url";
    expect(() => assertTestDatabaseAuthorized()).toThrow(/no es una URL válida/);
  });

  it("3. rechaza un host remoto — simula 'apuntar a producción por error'", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    expect(() => assertTestDatabaseAuthorized()).toThrow(/host remoto/);
  });

  it("4. rechaza localhost si el nombre de la base no termina en '_test'", () => {
    process.env.TEST_DATABASE_URL = "postgresql://test:test@localhost:5433/marykaymanager_dev";
    expect(() => assertTestDatabaseAuthorized()).toThrow(/_test/);
  });

  it("5. acepta una configuración de test válida (localhost + sufijo _test)", () => {
    process.env.TEST_DATABASE_URL = "postgresql://test:test@localhost:5433/marykaymanager_test";
    const result = assertTestDatabaseAuthorized();
    expect(result.url.hostname).toBe("localhost");
  });

  it("6. acepta 127.0.0.1 igual que localhost", () => {
    process.env.TEST_DATABASE_URL = "postgresql://test:test@127.0.0.1:5433/marykaymanager_test";
    expect(() => assertTestDatabaseAuthorized()).not.toThrow();
  });

  it("7. NODE_ENV=test por sí solo no alcanza: sin TEST_DATABASE_URL, rechaza igual aunque NODE_ENV sea 'test'", () => {
    process.env.NODE_ENV = "test";
    expect(() => assertTestDatabaseAuthorized()).toThrow(/Falta TEST_DATABASE_URL/);
  });

  it("8. NODE_ENV=test + TEST_DATABASE_URL apuntando a host remoto: rechaza igual (NODE_ENV nunca es suficiente)", () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@db.supabase.co:5432/postgres";
    expect(() => assertTestDatabaseAuthorized()).toThrow(/host remoto/);
  });
});

describe("MemoryStorage no requiere TEST_DATABASE_URL", () => {
  it("9. resolveStorageMode() da 'memory' sin ninguna variable de Postgres presente", async () => {
    const saved = { DATABASE_MODE: process.env.DATABASE_MODE, DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: process.env.NODE_ENV };
    delete process.env.DATABASE_MODE;
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    process.env.NODE_ENV = "test";

    vi.resetModules();
    const { resolveStorageMode } = await import("../storage-mode");
    expect(resolveStorageMode()).toBe("memory");

    process.env.DATABASE_MODE = saved.DATABASE_MODE;
    process.env.DATABASE_URL = saved.DATABASE_URL;
    process.env.NODE_ENV = saved.NODE_ENV;
  });
});

describe("El pool de Postgres de test nunca se abre sin pasar el guard", () => {
  it("10. importar ../test-db sin TEST_DATABASE_URL rechaza antes de crear ningún pg.Pool", async () => {
    delete process.env.TEST_DATABASE_URL;
    vi.resetModules();
    await expect(import("../test-db")).rejects.toThrow(/Falta TEST_DATABASE_URL/);
  });

  it("11. importar ../test-db con host remoto también rechaza antes de conectar", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    vi.resetModules();
    await expect(import("../test-db")).rejects.toThrow(/host remoto/);
  });
});
