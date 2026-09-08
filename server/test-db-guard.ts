/**
 * Guard centralizado — única puerta de entrada para autorizar una conexión Postgres de
 * tests. Ningún test debe construir un `pg.Pool` sin pasar primero por acá.
 *
 * Por qué esto y no un simple `if (NODE_ENV === "test")`: NODE_ENV no dice nada sobre a
 * qué base de datos se está apuntando — la Etapa I-B.5 confirmó con evidencia que el
 * DATABASE_URL local y el de producción en Railway son literalmente el mismo. Este guard
 * exige una variable completamente separada (`TEST_DATABASE_URL`, nunca `DATABASE_URL`) y
 * dos señales estructurales independientes sobre ESA variable, no sobre el entorno:
 *
 *   1. El host tiene que ser loopback (localhost/127.0.0.1/::1). Ni Supabase ni Railway
 *      exponen su Postgres en localhost — es estructuralmente imposible que esta condición
 *      la cumpla por accidente la base real, sin importar qué valga NODE_ENV.
 *   2. El nombre de la base tiene que terminar en "_test". Segunda señal independiente,
 *      para el caso de que exista OTRA base local (de desarrollo real) escuchando también
 *      en loopback.
 *
 * Si falta la variable, o no cumple estas dos condiciones, se tira un error claro ANTES de
 * que exista ningún intento de conexión — nunca se abre un pool con datos no autorizados.
 */

export interface AuthorizedTestDatabase {
  url: URL;
}

function fail(message: string): never {
  throw new Error(
    `[test-db-guard] ${message}\n` +
      "Configurá una base de datos de test dedicada — ver docs/TESTING_POSTGRES.md.",
  );
}

export function assertTestDatabaseAuthorized(): AuthorizedTestDatabase {
  const raw = process.env.TEST_DATABASE_URL;

  if (!raw) {
    fail(
      "Falta TEST_DATABASE_URL. Los tests que necesitan Postgres real (client-isolation, " +
        "stock-concurrency, tenant-isolation-deep) requieren una base EXCLUSIVA de test — " +
        "nunca reusan DATABASE_URL, ni siquiera si NODE_ENV=test.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("TEST_DATABASE_URL no es una URL válida.");
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (!isLoopback) {
    // Nunca se imprime el host real — ni siquiera acá hace falta para que el mensaje sea útil.
    fail(
      "TEST_DATABASE_URL apunta a un host remoto. Por seguridad, los tests solo aceptan una " +
        "base LOCAL (localhost/127.0.0.1) — así es estructuralmente imposible que apunte, " +
        "por error de copiar/pegar o de configuración, a la base real de Supabase.",
    );
  }

  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    fail(
      `El nombre de la base en TEST_DATABASE_URL ("${dbName}") no termina en "_test". Es la ` +
        "segunda señal estructural independiente de que es una base dedicada a tests.",
    );
  }

  return { url };
}
