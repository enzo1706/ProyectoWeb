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

## Por qué existe este guard

`server/db.ts` (el que usa `npm run dev`/producción) lee `DATABASE_URL` directo, sin pasar
por ningún chequeo de entorno. La Etapa I-B.5 confirmó con evidencia que el `DATABASE_URL`
local y el de Railway producción son el mismo valor — así que cualquier test que hiciera
`import { db } from "../db"` estaba, sin saberlo, escribiendo en la base real. El guard
(`server/test-db-guard.ts`) exige una variable completamente separada y dos señales
estructurales sobre ella (host loopback + nombre de base terminado en `_test`) — nunca
confía solamente en `NODE_ENV=test`.
