# LEEME — próximos pasos (para el programador)

Una página, en el orden real en que hay que hacer las cosas. Cada paso dice qué documento
seguir, cuándo frenar y avisar, y qué NO hacer. Nada de esto se ejecutó todavía contra Railway,
Supabase ni Mercado Pago reales — salvo donde se indica explícitamente lo contrario (paso 1).

Reescrito el 2026-10-25, al cerrar el Prompt 16 y ensayar el camino completo de deploy (ver
`docs/migracion-deploy-3.md`): el ensayo (base con el esquema real de producción +
`migracion-produccion-pendiente.md` + `migracion-deploy-2.md` + `migracion-deploy-3.md`,
comparado con `drizzle-kit push` contra `prompt-16-velocidad`) dio **"No changes detected"** —
confirma que los deploys 2 y 3 se pueden aplicar juntos, en una sola ventana.

**Sobre el flake de `auth-anti-enumeration.test.ts`** (el `beforeAll`/`createApp()` que a veces
tarda de más): corrida la suite completa (`npm test`, las 785 pruebas) dentro de un contenedor
Linux limpio (`node:22-slim`, Postgres aparte en otro contenedor, sin nada más corriendo ahí) —
**66/66 archivos y 785/785 pruebas verdes, incluido ese archivo**, en 278s. Confirma que el
flake es de esta máquina de desarrollo cargada (muchos procesos de Docker/build corridos en la
misma sesión), no un problema real ni portable — no bloquea nada del deploy.

**Actualizado el 2026-10-26**: staging deja de armarse con un `pg_dump`/branch de Supabase a
partir de producción — nunca usa datos reales (ver `docs/staging.md`, "Por qué nunca datos
reales"). Se arma vacía y avanza en el MISMO orden que producción, una Ronda a la vez — el
paso 3 de abajo ya refleja esto. El ensayo con datos reales (restaurar un backup en una base
temporal para los chequeos del deploy 1) sigue existiendo, pero es otra cosa, aparte: se borra
al terminar, incluido el archivo del backup — ver `docs/migracion-produccion-pendiente.md`.

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

## 2. Chequeos de solo lectura en producción (sin tocar nada)

- **Qué es**: dos consultas `SELECT` puras contra la base de producción real, para saber de
  antemano si algo de lo que viene más abajo puede chocar con datos reales. Ninguna de las dos
  escribe nada ni bloquea tablas.
- **Emails duplicados entre consultoras** (ya entregada, ver `docs/migracion-deploy-3.md`):
  ```sql
  SELECT lower(trim(email)) AS email_normalizado, count(*), array_agg(id ORDER BY id) AS consultant_ids
  FROM consultants
  WHERE email IS NOT NULL AND trim(email) <> ''
  GROUP BY lower(trim(email))
  HAVING count(*) > 1
  ORDER BY count(*) DESC;
  ```
  Si da filas: no bloquea nada todavía (el índice único de email ya está en producción desde
  antes de este tramo — ver "Estado real" en `docs/migracion-produccion-pendiente.md`), pero
  avisá antes de seguir — dos consultoras creyendo tener cuentas separadas con, en los hechos,
  el mismo email es una situación a revisar a mano.
- **Usuarios cuyo identificador tiene forma de WhatsApp** (motivo: el ajuste de Prompt 14
  descripto en `docs/prompts-mejoras.md` — una cuenta vieja con `username` literalmente un
  número de teléfono puede quedar atrapada por el orden de búsqueda del login si el WhatsApp
  real de otra cuenta coincidiera; esto ya tiene un fix en `server/storage.ts`, esta consulta es
  solo para confirmar cuántas cuentas así existen hoy):
  ```sql
  SELECT id, username, consultant_id
  FROM users
  WHERE username ~ '^[0-9]{8,13}$';
  ```
  Informativo — no bloquea nada (el fix de Prompt 14 ya cubre este caso en el login), pero si da
  muchas filas conviene saberlo antes de publicar ese Prompt.
- **Cuándo frenar y avisar**: si la consulta de emails da filas — mandar la lista antes de
  seguir con la Ronda 1 o la Ronda 2 (abajo).
- **Qué NO hacer**: no corregir nada todavía a partir de esto — es solo diagnóstico, cualquier
  corrección de datos reales se decide a mano, caso por caso.

## 3. Armar staging

- **Seguir**: `docs/staging.md`, de punta a punta (infraestructura de Railway, cómo se arma la
  base de staging VACÍA en un proyecto de Supabase aparte, las cuentas de prueba de Mercado
  Pago, `seed:staging`, y el ítem del checklist sobre verificar `sharp` en un contenedor Linux
  limpio antes del primer deploy que lo incluya — Prompt 16).
- **Qué es**: levantar el servicio de staging en Railway, con una base propia que arranca
  VACÍA (nunca con un `pg_dump`/branch a partir de producción — ver "Por qué nunca datos
  reales" en `docs/staging.md`) y avanza una Ronda a la vez: esquema de `20c8d83` →
  `migracion-produccion-pendiente.md` → `seed:staging` → publica `deploy-paquete-1` (Ronda 1);
  después `migracion-deploy-2.md` + `migracion-deploy-3.md` → `seed:staging` otra vez
  (`SEED_STEP=after-deploy2`) → publica `staging` (Ronda 2); después `migracion-deploy-4.md` →
  publica `prompt-8b-avisos` (Ronda 3, más abajo). Sus propias variables
  (`APP_ENV=staging`, credenciales TEST de Mercado Pago, etc.). `TEST_DATABASE_URL` nunca va en
  las variables de ese servicio.
- **Cuándo frenar y avisar**: si falta algún dato para crear las cuentas de prueba de Mercado
  Pago, o si la verificación de `sharp` en Linux falla (no debería — ya se probó en
  `node:22-slim`, pero confirmalo en el entorno real de Railway antes de seguir).
- **Qué NO hacer**: no mergear `staging` a `main` todavía. No correr `seed:staging` sin el
  marcador puesto. **No usar nunca un `pg_dump`/`pg_restore`/branch de Supabase a partir de
  producción para armar o refrescar la base de staging** — staging se arma vacía y se puebla
  con `seed:staging`, siempre.

## 4. Ronda 1 — paquete 1 (Prompts U/1/2/3) a producción

1. **Staging publica `deploy-paquete-1`**: apuntar el servicio de staging a esa rama (en vez de
   `staging`) para esta ronda puntual, o crear un segundo servicio de staging si se prefiere no
   pisar el que ya está probando otra cosa. La base de staging, en este punto, ya tiene el
   esquema de `20c8d83` + `migracion-produccion-pendiente.md` + `seed:staging` aplicados (ver
   paso 3).
2. **Probar en staging**: `docs/pruebas-paquete-1.md` (precio y cupones, suscripción con cupón,
   Configuración, costo y ganancia en una venta, carga de un pedido) contra el dominio de
   staging.
3. **Deploy 1 a producción real**: seguir `docs/migracion-produccion-pendiente.md`, de punta a
   punta — el "Orden del día" del final del documento es la lista exacta, en orden, incluidos el
   backup, la restauración en una base de prueba TEMPORAL Y PRIVADA (distinta de staging —
   ver la nota al principio de ese documento), los chequeos antes y después, y el borrado de
   esa base y el archivo del backup al terminar.
- **Cuándo frenar y avisar**: cualquiera de los chequeos de datos de ese documento devuelve
  filas (hay instrucciones explícitas de PARAR para cada caso); el deploy del código falla por
  cualquier motivo (hay plan de vuelta atrás documentado, no hace falta deshacer la migración).
- **Qué NO hacer**: **no correr `drizzle-kit push` ni `db:push` contra producción, con o sin
  `--force`, bajo ningún motivo** — ese documento es SQL explícito a propósito. No aplicar las
  migraciones de datos del Prompt 2 sin mandar antes los resultados en modo lectura. No dejar
  viva la base de prueba temporal del deploy 1 (ni su backup) una vez terminado el chequeo.

## 5. Ronda 2 — toda la cadena (Prompts 4 a 16) a producción

1. **Mergear `prompt-16-velocidad` a `staging`** (si no se hizo ya): trae de punta a punta los
   Prompts 8, 9, 10, 11, 12, 13, 14, 15 y 16 sobre lo que `staging` ya tenía (4, 5, 6 y 7).
2. **Base de staging**: aplicar `migracion-deploy-2.md` + `migracion-deploy-3.md` (en ese
   orden) sobre la base de staging que ya tenía la Ronda 1, y correr
   `seed:staging` con `SEED_STEP=after-deploy2` (agrega la clienta sin celular y la venta sin
   clienta, recién posibles desde este punto — ver `docs/staging.md`).
3. **Staging publica la rama `staging`**: con la cadena completa ya mergeada, el servicio de
   staging vuelve a apuntar a esa rama (o se usa el mismo servicio de siempre).
4. **Probar con el checklist**: `docs/pruebas-prompt-4-5-6-7-y-9.md` (lo que staging ya tenía),
   `docs/pruebas-prompt-11.md` y `docs/pruebas-prompt-8-10-y-12-a-16.md` (lo nuevo de este
   tramo, Prompt 8 Partes 1 a 3 y Prompt 10 incluidos — la Parte 4 del Prompt 8 todavía no está
   mergeada, ver paso 6) — contra el dominio de staging, nunca `localhost`, porque es la
   primera vez que algunas cosas (HTTPS real) se pueden probar en serio.
5. **Deploys 2 y 3 juntos, en una sola ventana**: seguir `docs/migracion-deploy-2.md` completo y
   después `docs/migracion-deploy-3.md` completo, en ese orden, contra producción real — el
   ensayo del 2026-10-25 confirmó que esto es seguro (mismo resultado que aplicar los dos a mano
   y comparar contra el código con `drizzle-kit push`: "No changes detected"). Los dos
   `CREATE INDEX CONCURRENTLY` de `migracion-deploy-3.md` van cada uno en su propia conexión,
   fuera de cualquier transacción — no agruparlos con el resto del SQL. El backfill de
   miniaturas (`script/backfill-thumbnails.ts`) es OPCIONAL y queda para después, a mano — no
   es parte de esta ventana.
6. **Publicar el código** de los Prompts 4 a 16 en Railway (el mismo commit de `staging` que ya
   se probó).
- **Cuándo frenar y avisar**: cualquier ítem de los tres checklists del punto 4 que no coincida
  con lo descripto; cualquier chequeo de datos de `migracion-deploy-2.md` o
  `migracion-deploy-3.md` con resultado inesperado (en particular el "chequeo posterior" de
  `amount_paid` del Prompt 9, y el de `quantity_delivered` del Prompt 8 — los dos tienen que dar
  0 filas).
- **Qué NO hacer**: nunca `drizzle-kit push`/`db:push` contra producción. No mergear `staging` a
  `main` ni publicar código hasta que los tres checklists del punto 4 estén aprobados. No correr
  el backfill de miniaturas contra producción ni contra el Storage real sin decidirlo aparte,
  a mano.

## 6. Ronda 3 — Prompt 8, Parte 4 (notificaciones push)

- **Qué es**: la parte del Prompt 8 que quedó pausada en `docs/prompts-mejoras.md` porque
  necesita HTTPS real y un teléfono físico para probarse — ninguna de las dos cosas existe en
  `localhost`. Con staging ya levantado (paso 3), esto se puede retomar.
1. **Base de staging**: aplicar `migracion-deploy-4.md` sobre la base de staging que ya tenía
   la Ronda 2 (dos tablas nuevas, `push_subscriptions` y `push_notification_log` — ver ese
   documento).
2. **Staging publica `prompt-8b-avisos`**: el servicio de staging apunta a esa rama para esta
   ronda puntual.
3. **Probar con el checklist**: `docs/migracion-deploy-4.md` tiene su propia sección de cómo
   probarlo (Chrome de escritorio para lo que se puede, y qué queda para un teléfono físico con
   staging — iPhone agregado a inicio, Android, el aviso real del día de pedido sin haber
   entrado a la app).
- **Cuándo frenar y avisar**: si el navegador del teléfono de prueba no pide permiso de
  notificaciones, o si el push nunca llega — revisar antes si es un problema del Service Worker,
  de las claves VAPID, o del navegador/SO del teléfono usado. Si el servicio de staging tiene
  activada alguna opción de "dormir" sin tráfico (ver `docs/staging.md`) — en ese caso la tarea
  programada no corre y el aviso nunca sale, aunque todo el resto esté bien.
- **Qué NO hacer**: no intentar probar esto contra `localhost` con un túnel improvisado — usar
  el dominio real de staging, que ya tiene HTTPS por Railway. No mergear `prompt-8b-avisos` a
  `staging` hasta tener el OK explícito de esta ronda.

## Regla de ramas mientras se prueba (pasos 3, 5 y 6)

- **Mientras el programador prueba staging, la rama `staging` queda CONGELADA** — no se le
  agrega ningún Prompt nuevo. Solo entran arreglos puntuales de lo que el programador encuentre
  probando.
- **Si el arreglo es de algo que viene del paquete 1** (Prompts U/1/2/3 — por ejemplo algo de
  cupones, suscripciones, Ingresos Brutos, costos): el arreglo va PRIMERO a `main` (local) y
  DESPUÉS se mergea `main` a `staging` — nunca al revés.
- **Si el arreglo es de algo de los Prompts 4 a 16**: va directo a `staging` (o a la rama del
  Prompt correspondiente, después mergeada a `staging` con el mismo método ya usado — merge,
  nunca rebase).
- **Los Prompts nuevos** (ej. el Prompt 8 Parte 4, o cualquiera después del 16) se desarrollan
  en su propia rama a partir de `staging` (ya con todo lo anterior mergeado), pero se mergean a
  `staging` recién después de la Ronda correspondiente — no antes.

## Qué rama pushear en cada paso

Todo esto ya está pusheado: `staging-plan`, `staging`, `deploy-paquete-1`, `prompt-8b-avisos`,
y las ramas de Prompt (`prompt-11-reportes` ... `prompt-16-velocidad`, a medida que se
cierran). **`main` no se pushea** hasta que se decida explícitamente publicar un deploy — regla
fija, con OK explícito en el momento, no de una conversación anterior.
