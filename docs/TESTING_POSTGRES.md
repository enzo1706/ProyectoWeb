# Tests que usan Postgres real

Tres archivos necesitan Postgres real (no `MemoryStorage`): `client-isolation.test.ts`,
`stock-concurrency.test.ts`, `tenant-isolation-deep.test.ts` — necesitan el lock `FOR UPDATE`
real y/o el store de sesión real de `connect-pg-simple`, que no existen en memoria.

**Nunca usan `DATABASE_URL`** (la de desarrollo/producción — son la misma base física, ver
Etapa I-B.5). Usan `TEST_DATABASE_URL`, una base completamente aparte, corriendo en un
contenedor Docker local dedicado, protegida por un guard (`server/test-db-guard.ts`) que
rechaza cualquier configuración que no sea explícitamente local y de test.

## Setup (una vez, o después de tocar `shared/schema.ts`)

```bash
npm run db:test:up      # levanta el contenedor Postgres de test (docker-compose.test.yml)
npm run db:test:push    # aplica el schema real (drizzle-kit push, contra TEST_DATABASE_URL)
```

Agregá esto a tu `.env` (nunca a `DATABASE_URL`, que sigue siendo la real):

```
TEST_DATABASE_URL=postgresql://test:test@localhost:55433/marykaymanager_test
```

El puerto es `55433` (no el default 5432 ni 5433) para evitar chocar con cualquier otro
Postgres que ya tengas corriendo localmente — confirmado que eso es un riesgo real, no
teórico, durante la Etapa I-B.5.1.

## Correr los tests

```bash
npm test    # con TEST_DATABASE_URL en tu .env, corre todo (memoria + Postgres real)
```

Los tests de `MemoryStorage` (el resto de `server/tests/`) **no necesitan Docker ni
`TEST_DATABASE_URL`** — siguen funcionando exactamente igual que siempre.

## Si falta `TEST_DATABASE_URL`

Los 3 tests de Postgres real fallan de inmediato con un error claro (`[test-db-guard] Falta
TEST_DATABASE_URL...`) — antes de intentar ninguna conexión. El resto de la suite (memoria)
sigue funcionando igual.

## Apagar

```bash
npm run db:test:down    # los datos son efímeros (tmpfs) — no hace falta "limpiar" nada
```

## ⚠️ Mientras `TEST_DATABASE_URL` esté en tu `.env`, `npm run dev` también se desvía a la base de test

Encontrado haciendo el Prompt 11, armando datos de prueba a mano: la afirmación de la sección
de abajo ("`server/db.ts`... lee `DATABASE_URL` directo, sin pasar por ningún chequeo") es
cierta para ESE archivo, pero **no** para `DatabaseStorage.getDb()` (`server/storage.ts`), que
es lo que `npm run dev`/la app real usan en cada request. Esa función decide así:

```ts
// server/storage.ts
this.dbPromise ??= process.env.TEST_DATABASE_URL
  ? import("./test-db").then((m) => m.testDb)
  : import("./db").then((m) => m.db);
```

Es decir: **la sola presencia de `TEST_DATABASE_URL` en el entorno** (no `NODE_ENV`, no nada
más) hace que `npm run dev` lea y escriba en `marykaymanager_test`, no en `marykaymanager_dev`
— aunque estés corriendo la app normal, no un test. Pasó de verdad: logueé con una cuenta que
sabía que existía en la base de dev y me rechazó con 401, porque `npm run dev` estaba
leyendo la base de test (vacía de esa cuenta) sin ningún aviso.

**Mientras tanto no se ajuste esto**: si tenés `TEST_DATABASE_URL` en tu `.env` para poder
correr `npm test` cómodo, sacala (o comentala) antes de un `npm run dev` en el que te importe
estar viendo datos reales de desarrollo, y volvé a ponerla antes de correr los tests de
Postgres real. Las dos cosas a la vez, con un solo `.env`, hoy no conviven.

## Por qué existe este guard

`server/db.ts` (el que usa `npm run dev`/producción) lee `DATABASE_URL` directo, sin pasar
por ningún chequeo de entorno. La Etapa I-B.5 confirmó con evidencia que el `DATABASE_URL`
local y el de Railway producción son el mismo valor — así que cualquier test que hiciera
`import { db } from "../db"` estaba, sin saberlo, escribiendo en la base real. El guard
(`server/test-db-guard.ts`) exige una variable completamente separada y dos señales
estructurales sobre ella (host loopback + nombre de base terminado en `_test`) — nunca
confía solamente en `NODE_ENV=test`.
