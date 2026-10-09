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

/**
 * Señal independiente de la de arriba — esta no valida a qué apunta TEST_DATABASE_URL, sino
 * si corresponde elegirla. Antes de esto, storage.ts/session.ts/app.ts decidían la base SOLO
 * por la presencia de la variable: "producción nunca tiene TEST_DATABASE_URL" era un supuesto,
 * no algo que el código garantizara. Si alguien la agregara por error en las variables de
 * Railway, producción pasaría a leer/escribir en la base de test en silencio.
 *
 * `vitest run` fija `NODE_ENV=test` por defecto (confirmado en vivo, no es solo lo que ponen
 * algunos archivos de server/tests a mano) — ni `npm run dev` ni Railway lo setean nunca.
 * Combinado con el guard de arriba (loopback + "_test"), ahora hacen falta DOS señales
 * independientes, no una, para que un entorno real use la base de test por accidente.
 *
 * Caso inverso, igual de real (reproducido: así terminó un usuario de test en la base de
 * desarrollo real) — NODE_ENV=test pero TEST_DATABASE_URL ausente (por ejemplo, si alguien la
 * sacó del .env a mano para algo puntual y se olvidó de volver a ponerla antes de correr los
 * tests): un storage que caiga de vuelta a la base real en silencio es tan peligroso como el
 * caso de arriba. Por eso esto tira en vez de devolver `false` — un test de Postgres que no
 * tiene su base dedicada configurada tiene que romper fuerte, nunca escribir callado en otro
 * lado.
 */
export function shouldUseTestDatabase(): boolean {
  if (process.env.NODE_ENV !== "test") return false;

  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "[test-db-guard] NODE_ENV=test pero falta TEST_DATABASE_URL. Un storage de Postgres en " +
        "un test nunca debe caer de vuelta a la base real en silencio — configurá " +
        "TEST_DATABASE_URL (ver docs/TESTING_POSTGRES.md) o corré este test en DATABASE_MODE=memory.",
    );
  }

  return true;
}
