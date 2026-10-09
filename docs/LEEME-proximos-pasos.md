# LEEME — próximos pasos (para el programador)

Una página, en el orden real en que hay que hacer las cosas. Cada paso dice qué documento
seguir, cuándo frenar y avisar, y qué NO hacer. Nada de esto se ejecutó todavía contra Railway,
Supabase ni Mercado Pago reales.

**Nota sobre esta copia**: este archivo vive en `main` Y en la rama `staging` (con el mismo
contenido). Los pasos 2, 3 y 5 referencian documentos (`docs/staging.md`,
`docs/migracion-deploy-2.md`, `docs/pruebas-prompt-4-5-6-7-y-9.md`) que solo existen en la
rama `staging` — si estás parado en `main`, no los vas a ver en `docs/` hasta que hagas
`git checkout staging` (o los mires directo en GitHub en esa rama). `docs/migracion-produccion-pendiente.md`
(paso 4) sí vive en ambas ramas, porque el deploy 1 sale de `main`.

## 1. Resend — arreglar "Recuperar contraseña" (independiente de todo lo demás)

- **Seguir**: la sección "Arreglar Recuperar contraseña" de
  `docs/migracion-produccion-pendiente.md`.
- **Qué es**: cargar `RESEND_API_KEY` y `EMAIL_FROM` en Railway. No toca la base, no toca
  código, no depende de ningún otro paso de este documento — se puede hacer hoy mismo.
- **Cuándo frenar y avisar**: si Resend rechaza el dominio o la verificación DNS no termina de
  propagar después de unas horas.
- **Qué NO hacer**: no mezclar esto con ningún otro paso — es la única parte de todo este plan
  que ya toca producción directamente (variables de entorno), y es intencionalmente
  independiente del resto.

## 2. Armar staging

- **Seguir**: `docs/staging.md` (rama `staging`), de punta a punta (infraestructura de
  Railway/Supabase, el marcador `ops.staging_marker`, las cuentas de prueba de Mercado Pago,
  `seed:staging`).
- **Qué es**: levantar el servicio de staging en Railway apuntando a la rama `staging` (ya
  pusheada), con su propia base (restaurada con `pg_restore` o un branch de Supabase, según el
  plan vigente), sus propias variables (`APP_ENV=staging`, credenciales TEST de Mercado Pago,
  etc.). `TEST_DATABASE_URL` nunca va en las variables de ese servicio (ver
  `docs/migracion-produccion-pendiente.md`).
- **Cuándo frenar y avisar**: si el plan de Supabase resultó distinto al asumido en
  `docs/staging.md` (Free vs Pro cambia cómo se origina la base de staging), o si falta algún
  dato para crear las cuentas de prueba de Mercado Pago.
- **Qué NO hacer**: no mergear `staging` a `main` todavía. No correr `seed:staging` sin el
  marcador puesto (se va a negar solo, pero no pierdas tiempo tratando de forzarlo). No usar
  `pg_dump`/`pg_restore` contra producción sin que sea específicamente para ARMAR esta copia de
  staging (nunca al revés).

## 3. Probar en staging

- **Seguir**: `docs/pruebas-prompt-4-5-6-7-y-9.md` (rama `staging`), completo, contra el
  dominio de staging (nunca `localhost`) — es la primera vez que se puede probar con HTTPS
  real.
- **Qué es**: correr todo el checklist manual, más cualquier cosa que específicamente necesite
  HTTPS real o un teléfono físico.
- **Cuándo frenar y avisar**: cualquier ítem del checklist que no coincida con lo descripto —
  pantalla, pasos para reproducirlo, y la consola del navegador si hay algo en rojo (igual
  criterio que indica el propio checklist al final).
- **Qué NO hacer**: no saltar directo a "deploy 1" aunque staging se vea bien a simple vista —
  el checklist existe para encontrar lo que no se ve a simple vista. Si `npm test` tira un fallo
  de timing en `auth-anti-enumeration.test.ts`, volver a correr ese archivo solo antes de
  preocuparse (está documentado en el propio checklist, es un archivo que no se tocó en todo
  este trabajo).

### Si en este paso aparece algo para arreglar

Ver "Regla de ramas mientras se prueba" más abajo — importa MUCHO de qué parte del código viene
el bug antes de decidir dónde arreglarlo.

## 4. Deploy 1 (paquete 1 — Prompts U/1/2/3)

- **Seguir**: `docs/migracion-produccion-pendiente.md`, de punta a punta — el "Orden del día"
  del final del documento es la lista de pasos exacta, en orden, incluidos el backup, la
  restauración en una base de prueba, los chequeos antes y después.
- **Qué es**: migrar la base de producción real (todo es SQL puro, aplicado a mano) y publicar
  en Railway el código de `main` (el commit tiene que ser el mismo que ya se validó — confirmar
  con quien coordinó este plan cuál es exactamente antes de publicar). La rama
  `deploy-paquete-1` tiene que estar al día con `main` antes de este paso.
- **Cuándo frenar y avisar**: cualquiera de los chequeos de datos del documento devuelve filas
  (hay instrucciones explícitas de PARAR para cada caso); el deploy del código falla por
  cualquier motivo (hay un plan de vuelta atrás documentado, no hace falta deshacer la
  migración).
- **Qué NO hacer**: **no correr `drizzle-kit push` ni `db:push` contra producción, con o sin
  `--force`, bajo ningún motivo** — el documento completo es SQL explícito a propósito (ver la
  advertencia al principio de ese documento). No aplicar las migraciones de datos del Prompt 2
  sin mandar antes los resultados en modo lectura (el documento lo pide explícito).

## 5. Deploy 2 (Prompts 4, 6, 7 y 9 — merge de `staging` a `main`)

- **Seguir**: `docs/migracion-deploy-2.md` (rama `staging`), de punta a punta.
- **Qué es**: con el deploy 1 ya confirmado funcionando en producción, mergear `staging` a
  `main` (trae Prompts 4/5/6/7/9 ya probados juntos — ver la rama `staging`), migrar la base
  (de nuevo, SQL puro a mano) y publicar.
- **Cuándo frenar y avisar**: igual criterio que el deploy 1 — cualquier chequeo de datos con
  resultado inesperado, o el "chequeo posterior" de `amount_paid` (Prompt 9) devolviendo algo
  distinto de 0.
- **Qué NO hacer**: mismo que el deploy 1 — nunca `drizzle-kit push`/`db:push` contra
  producción. No mergear `staging` a `main` hasta que el deploy 1 esté confirmado y estable.

## Regla de ramas mientras se prueba (pasos 2 y 3)

- **Mientras el programador prueba staging, la rama `staging` queda CONGELADA** — no se le
  agrega ningún Prompt nuevo. Solo entran arreglos puntuales de lo que el programador encuentre
  probando.
- **Si el arreglo es de algo que viene del paquete 1** (Prompts U/1/2/3 — por ejemplo algo de
  cupones, suscripciones, Ingresos Brutos, costos): el arreglo va PRIMERO a `main` (local) y
  DESPUÉS se mergea `main` a `staging` — nunca al revés. Si se arreglara solo en `staging`, el
  deploy 1 (que sale de `main`, no de `staging`) saldría igual con el bug.
- **Si el arreglo es de algo de los Prompts 4-9**: va directo a `staging` (o a la rama del
  Prompt correspondiente, después mergeada a `staging` con el mismo método ya usado — merge,
  nunca rebase).
- **Los Prompts nuevos** (ej. el Prompt 8 de notificaciones push, el Prompt 11 de Reportes, el
  Prompt 13 de menú/sesión) se desarrollan en su propia rama a partir de `staging` (ya con los
  Prompts anteriores mergeados), pero **se mergean a `staging` recién después del deploy 2** —
  no antes, para no mezclar código sin probar con el que ya está en camino a producción.

## Qué rama pushear en cada paso

Todo esto ya está pusheado: `staging-plan`, `staging`, y las ramas de Prompt nuevas
(`prompt-11-reportes`, `prompt-13-menu`, etc., a medida que se cierran). **`main` no se
pushea** hasta que se decida explícitamente publicar el deploy 1 — regla fija, con OK explícito
en el momento, no de una conversación anterior.
