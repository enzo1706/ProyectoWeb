import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Prueba resolveStorageMode() en aislamiento total: nunca crea un pg.Pool real, nunca requiere
 * Docker corriendo, solo manipula process.env y lo restaura después de cada caso.
 *
 * Encontrado en el ensayo de deploy del 2026-10-25 (ver docs/LEEME-proximos-pasos.md): sin
 * DATABASE_URL, la versión anterior de esta función caía en memoria EN SILENCIO fuera de
 * NODE_ENV=production — reproducido de verdad en un contenedor de diagnóstico, donde la app
 * arrancó igual, sin avisar nada, usando storage en memoria mientras los tests escribían en
 * Postgres real. En Railway (staging o producción) esto sería un incidente: el servidor
 * arrancaría igual, parecería funcionar, y el primer reinicio borraría todo lo cargado.
 */

const ORIGINAL_ENV = { ...process.env };

async function freshResolveStorageMode() {
  vi.resetModules();
  const { resolveStorageMode } = await import("../storage-mode");
  return resolveStorageMode;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveStorageMode — producción y staging nunca arrancan en memoria", () => {
  it("1. NODE_ENV=production sin DATABASE_URL: tira con el mensaje exacto del runbook de deploy", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENV;
    delete process.env.DATABASE_MODE;
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(() => resolveStorageMode()).toThrow("Falta DATABASE_URL: el servidor no arranca sin base de datos.");
  });

  it("2. APP_ENV=staging sin DATABASE_URL: tira igual, aunque NODE_ENV no sea 'production' (señal independiente)", async () => {
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "staging";
    delete process.env.DATABASE_MODE;
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(() => resolveStorageMode()).toThrow("Falta DATABASE_URL: el servidor no arranca sin base de datos.");
  });

  it("3. NODE_ENV=production + DATABASE_MODE=memory puesto a mano: tira igual (no se puede forzar memoria en producción)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENV;
    process.env.DATABASE_MODE = "memory";
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(() => resolveStorageMode()).toThrow(/no está permitido en producción ni en staging/);
  });

  it("4. APP_ENV=staging + DATABASE_MODE=memory puesto a mano: tira igual (señal independiente, mismo bloqueo)", async () => {
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "staging";
    process.env.DATABASE_MODE = "memory";
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(() => resolveStorageMode()).toThrow(/no está permitido en producción ni en staging/);
  });

  it("5. NODE_ENV=production con DATABASE_URL presente: anda normal, da 'postgres'", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENV;
    delete process.env.DATABASE_MODE;
    process.env.DATABASE_URL = "postgresql://user:pass@db.supabase.co:5432/postgres";
    const resolveStorageMode = await freshResolveStorageMode();
    expect(resolveStorageMode()).toBe("postgres");
  });

  it("6. APP_ENV=staging con DATABASE_URL presente: anda normal, da 'postgres'", async () => {
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "staging";
    delete process.env.DATABASE_MODE;
    process.env.DATABASE_URL = "postgresql://user:pass@staging-db.supabase.co:5432/postgres";
    const resolveStorageMode = await freshResolveStorageMode();
    expect(resolveStorageMode()).toBe("postgres");
  });
});

describe("resolveStorageMode — memoria solo para desarrollo/test, y solo pedida a mano", () => {
  it("7. sin DATABASE_MODE y sin DATABASE_URL, fuera de producción/staging: tira (memoria ya no es el default silencioso)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    delete process.env.DATABASE_MODE;
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(() => resolveStorageMode()).toThrow(/DATABASE_MODE=memory explícitamente/);
  });

  it("8. DATABASE_MODE=memory puesto a mano, en desarrollo: da 'memory'", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.APP_ENV;
    process.env.DATABASE_MODE = "memory";
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(resolveStorageMode()).toBe("memory");
  });

  it("9. DATABASE_MODE=memory puesto a mano, en test: da 'memory' (mismo patrón que ya usan los tests en memoria del proyecto)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    process.env.DATABASE_MODE = "memory";
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(resolveStorageMode()).toBe("memory");
  });

  it("10. DATABASE_MODE=postgres puesto a mano, sin DATABASE_URL: da 'postgres' igual (la validación de la URL en sí es responsabilidad de server/db.ts, no de esta función)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.APP_ENV;
    process.env.DATABASE_MODE = "postgres";
    delete process.env.DATABASE_URL;
    const resolveStorageMode = await freshResolveStorageMode();
    expect(resolveStorageMode()).toBe("postgres");
  });

  it("11. DATABASE_MODE con un valor inválido: tira, sin importar el resto del entorno", async () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_MODE = "memoria"; // en español, no es un valor válido
    const resolveStorageMode = await freshResolveStorageMode();
    expect(() => resolveStorageMode()).toThrow(/DATABASE_MODE inválido/);
  });
});
