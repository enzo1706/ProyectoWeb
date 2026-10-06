# Migraciones pendientes en producción (al 2026-10-06)

## Estado real de producción, verificado recién (no es la foto del 15/9)

Antes de armar este documento asumí que nadie había tocado la base desde el 12/9 (último dato
duro que tenía, de la Etapa 8.1). Para no pasarles una suposición vieja, revisé ahora mismo los
logs y variables reales de Railway, y la foto cambió:

**Confirmado roto, ahora mismo, sin relación con ninguna migración de abajo:**
- **Recuperar contraseña no funciona de punta a punta.** `RESEND_API_KEY` y `EMAIL_FROM` siguen
  sin estar configuradas en Railway (lo confirmé ahora, de nuevo). El request responde 200
  (diseño anti-enumeración), pero el email nunca sale. **Esto no lo arregla ninguna migración —
  hace falta cargar esas dos variables en Railway por separado.** Lo marco acá para que no se
  pierda, pero es un pendiente aparte de este paquete.

**Lo que YA NO está roto (corrige lo que decía la Etapa 8.1 del 15/9):**
- `sales.ingresos_brutos` **ya existe** — confirmado con tráfico real: `GET /api/sales` responde
  200/304 ahora mismo, no 500.
- `consultants_email_unique_idx` **ya existe** — confirmado con un error real de los logs del
  3/10 (`duplicate key value violates unique constraint "consultants_email_unique_idx"`, durante
  el bug que después arregló el commit `20c8d83`). Si el índice no existiera, ese error no podría
  haber pasado.

**Sin confirmar en ningún sentido** (no encontré tráfico reciente que lo pruebe ni lo descarte):
- Tabla `password_reset_codes`.
- Índice `appointments_consultant_active_slot_unique_idx`.

**Conclusión práctica: no confío en mi propia reconstrucción del estado de la base — ni ustedes
deberían.** Por eso el primer paso real del proceso (más abajo) ya no es "aplicar el SQL a
ciegas", es correr una consulta de solo lectura que diga, con certeza, qué existe y qué no, antes
de tocar nada. El SQL completo de la sección de abajo sigue siendo correcto y seguro de correr
igual (usa `IF NOT EXISTS`/`IF EXISTS` en todo, así que lo que ya esté aplicado simplemente no
hace nada) — pero ya no es ciego, es verificable.

**Commit real que está corriendo en producción ahora**: `20c8d83` (confirmado vía la API de
Railway, no supuesto, viendo el último deployment con estado SUCCESS del servicio) — es un
commit descendiente de `3b42003` (Etapa 7.1-7.9, 15/9) con dos arreglos puntuales después (el fix
de email de suscripción, assets de marca) pero **sin ningún cambio de schema entre medio**.

Rehice la lista completa de la sección "Migraciones de schema" tomando como base `20c8d83`
directamente (no `e569568` ni `3b42003` por transitividad) — `git diff 20c8d83 HEAD --
shared/schema.ts` — y la comparé bit a bit contra la que ya tenía armada desde `3b42003`:
**salen idénticas** (mismas 255 líneas de diferencia, mismo contenido exacto). No cambia nada de
la lista de abajo. O sea: el código vivo espera exactamente el schema de la sección 1+2 de
abajo, ni más ni menos. Las secciones 3, 4 y 5 (Prompt U, 1 y 2) nunca se desplegaron — están
solo en los commits locales de esta máquina.

## Arreglar "Recuperar contraseña" — se puede hacer HOY, sin esperar el deploy

Esto no tiene nada que ver con la migración de la base — es nada más cargar dos variables en
Railway. No hace falta backup, no hace falta tocar código, no hace falta coordinar con nada de
lo de abajo. Pasos:

1. **Crear una cuenta en Resend** (resend.com) si todavía no existe una para el proyecto.
2. **Agregar el dominio `impulsaweb.ar`** desde el panel de Resend (Domains → Add Domain).
   Resend va a mostrar 2 o 3 registros DNS para agregar (normalmente un `TXT` para SPF, uno o
   más `CNAME` para DKIM, y a veces un `TXT` para DMARC) — son específicos de esa cuenta, Resend
   los genera en el momento, no son valores fijos que yo pueda darles de antemano. Hay que
   cargarlos en el panel de DNS de donde esté registrado `impulsaweb.ar` (el proveedor del
   dominio, no Railway ni Supabase).
3. **Esperar la verificación** (Resend la hace sola una vez que los registros DNS propagan —
   puede tardar de minutos a un par de horas según el proveedor de DNS). El panel de Resend
   muestra el dominio como "Verified" cuando está listo.
4. **Crear una API key** en Resend (API Keys → Create API Key) con permiso de envío.
5. **Cargar las dos variables en Railway** (proyecto `proud-spontaneity` → servicio
   `marykaymanager` → Variables):
   - `RESEND_API_KEY`: la que generó el paso 4.
   - `EMAIL_FROM`: una dirección del dominio ya verificado, en formato
     `Impulsa <no-reply@impulsaweb.ar>` (el código la manda tal cual al SDK de Resend como
     remitente — ver `server/email.ts`). No hace falta que esa casilla reciba nada, es solo el
     remitente.
6. **Railway redeploya solo** al guardar las variables (no hace falta tocar código ni hacer un
   deploy manual).
7. **Probarlo**: desde `impulsaweb.ar/login` → "¿Olvidaste tu contraseña?" → pedirlo con un email
   real de una cuenta que exista → confirmar que el correo llega (revisar spam la primera vez).
   Si Resend rechaza el envío, el error queda en los logs de Railway con el mensaje real de
   Resend (`server/email.ts` lo loguea sin exponer la API key) — fácil de diagnosticar desde ahí
   si algo falla.

Mientras esto no esté hecho, el request a "Olvidé mi contraseña" sigue respondiendo 200 (es
a propósito, para no revelar qué emails existen) pero el código nunca llega — nadie puede
recuperar su cuenta por esta vía hasta que se complete esto.

## Por qué esto es urgente, no solo prolijo

**El código nuevo (Prompts U, 1 y 2, ya commiteado localmente) rompe funcionalidad básica si se
publica ANTES de correr estas migraciones — no es una degradación elegante, es un error 500.**

La razón técnica: Drizzle (el ORM) arma el `SELECT`/`RETURNING` de cada consulta a partir de las
columnas que **el código** dice que tiene la tabla, no de las que tiene la base de verdad. Si el
código ya conoce una columna que la base todavía no tiene, Postgres devuelve
`column "x" does not exist` — y esto no pasa solo en la pantalla que usa esa columna puntual,
pasa en **cualquier consulta sin lista explícita de columnas sobre esa tabla**, aunque esa
consulta no tenga nada que ver con lo nuevo.

Ejemplos concretos de lo que se rompería si se publica el código sin migrar antes:

- **Vender** (`POST /api/sales`): el Prompt 2 agrega una consulta a `consultants` para leer el %
  de Ingresos Brutos — sin la columna `gross_income_tax_percent_tenths`, **toda venta nueva
  fallaría**, no solo las que usan IIBB.
- **Configuración** (`GET/PATCH /api/business-settings`): sin `order_reminder_day1`,
  `order_reminder_day2` y `gross_income_tax_percent_tenths` en `consultants`, la pantalla entera
  deja de cargar.
- **Admin → Suscripción y cupones**: sin las tablas `subscription_price_history`, `coupons` y
  `coupon_redemptions`, esas pantallas rompen enteras.
- **Pagos recurrentes de Mercado Pago**: el código ya no trata `payments.external_reference`
  como único (varios cobros de una misma suscripción comparten ese valor) — si la base TODAVÍA
  tiene la restricción `UNIQUE` vieja, el segundo cobro recurrente de cualquier suscripción
  activa **va a fallar con una violación de constraint real**, no un error cosmético.

**Conclusión: el deploy del código y la migración de la base tienen que ir juntos, migración
primero (o en el mismo instante de mantenimiento) — nunca "subo el código y migro después".**

## Plan de vuelta atrás — ¿se puede volver al deploy anterior si algo sale mal?

**Sí, con una sola salvedad.** Revisé cada cambio de la lista de abajo: todos son aditivos
(columna nueva nullable, tabla nueva, índice nuevo) salvo uno:

- **`ALTER TABLE payments DROP CONSTRAINT payments_external_reference_unique`** es el único
  cambio que no es "sumar algo". Igual es seguro para el código viejo (`20c8d83`, el que está
  vivo hoy): sacar una restricción solo PERMITE más cosas, nunca puede hacer que una consulta que
  antes andaba deje de andar. En el peor caso, el código viejo ya no tendría esa protección
  puntual contra un `external_reference` duplicado — pero el código viejo tampoco dependía de
  ella para funcionar (de hecho esa misma restricción es la que rompía los cobros recurrentes
  reales, el motivo original del fix MP-1).

Con todo lo de arriba aplicado, **el código del commit `20c8d83` (el que está en producción hoy)
sigue funcionando sin cambios contra la base ya migrada.** Si el deploy del código nuevo falla
por cualquier motivo, pueden revertir el deploy en Railway al commit anterior sin tocar la base
de nuevo — no hace falta deshacer ninguna migración.

## Nota aparte: cambio de precio sobre una suscripción ACTIVA, sin probar en real

El cambio de precio "a las actuales" (`appliesTo: "all"`) del Prompt U nunca se probó de punta a
punta contra una suscripción real y activa en Mercado Pago — solo en modo TEST. Hasta que se
pruebe así, en producción usen solo la opción **"Solo a las nuevas suscripciones"** al cambiar el
precio desde el admin. No es parte de la migración de base, pero va en este paquete porque es
una restricción operativa que el programador/equipo tiene que conocer el mismo día del deploy.

## Chequeos de datos antes de migrar (solo lectura, correr en la copia del backup)

La prueba que yo hice (correr el SQL contra una base vacía) confirma que la SINTAXIS es correcta
y que es idempotente — pero NO puede detectar un problema de DATOS reales, porque una base vacía
no tiene datos que choquen con una restricción nueva. Antes de aplicar el SQL de la sección
siguiente contra la copia del backup, corran esto:

```sql
-- 0) Verdad de base: qué existe HOY en esta copia, antes de tocar nada. Corran esto primero y
--    guarden el resultado — es la foto real que reemplaza cualquier supuesto mío o de este doc.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('sales', 'sale_items', 'consultants', 'subscriptions', 'payments', 'appointments')
ORDER BY table_name, column_name;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('password_reset_codes', 'subscription_price_history', 'coupons', 'coupon_redemptions', 'order_discount_log');

SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('consultants_email_unique_idx', 'appointments_consultant_active_slot_unique_idx');

SELECT conname FROM pg_constraint WHERE conname = 'payments_external_reference_unique';

-- 1) ¿Hay emails EXACTAMENTE duplicados en consultants? Esto haría fallar la creación del
--    índice único si no existiera todavía. Si da filas: PARAR, no aplicar el SQL de la sección
--    1c/consultants_email_unique_idx, y mandarme la lista — hay que decidir a mano qué email es
--    el correcto en cada caso antes de poder crear el índice.
SELECT email, count(*), array_agg(id) AS consultant_ids
FROM consultants
WHERE email IS NOT NULL
GROUP BY email
HAVING count(*) > 1;

-- 1b) Informativo, no bloquea nada: emails que son el mismo normalizando mayúsculas/minúsculas
--     pero están guardados distinto (ej. "Maria@x.com" vs "maria@x.com"). No rompe el índice
--     (que es case-sensitive), pero puede confundir a dos consultoras que creen tener cuentas
--     separadas cuando en realidad "son" el mismo email para cualquier humano. Si da filas,
--     avisen y lo revisamos — no es urgente para esta migración puntual.
SELECT lower(email) AS email_normalizado, count(*), array_agg(id) AS consultant_ids
FROM consultants
WHERE email IS NOT NULL
GROUP BY lower(email)
HAVING count(*) > 1;

-- 2) ¿Hay citas activas duplicadas en el mismo horario? Esto haría fallar la creación del
--    índice único de appointments si no existiera todavía. Si da filas: PARAR, no aplicar el
--    SQL de la sección 2a, y mandarme la lista — hay que decidir a mano cuál de las citas
--    duplicadas cancelar antes de poder crear el índice.
SELECT consultant_id, date, time, count(*), array_agg(id) AS appointment_ids
FROM appointments
WHERE status != 'cancelada'
GROUP BY consultant_id, date, time
HAVING count(*) > 1;
```

**Si CUALQUIERA de las consultas 1 o 2 devuelve filas: frenar TODO — ni el resto de la
migración, ni el deploy del código — y mandarme el resultado antes de seguir con cualquier otra
cosa.** (Técnicamente probé que el resto del SQL se puede aplicar igual, porque son bloques
independientes entre sí — pero la regla acá es pararlo todo de una, no ir decidiendo parte por
parte el mismo día del deploy. Más simple, menos margen de error humano.)

### ¿El código nuevo depende de que estos índices únicos existan?

Sí, de dos formas distintas — reviso el código, no es una suposición:

- **`coupon_redemptions_coupon_consultant_unique`** (Prompt U, tabla nueva): el código de
  reserva de cupón usa literalmente `ON CONFLICT (coupon_id, consultant_id) DO NOTHING` (ver
  `server/storage.ts`, reserva de cupón). Esto es más grave que "silenciosamente deja pasar un
  duplicado": si ese índice único no existe, Postgres **rechaza la consulta entera** con el
  error `there is no unique or exclusion constraint matching the ON CONFLICT specification` —
  cualquier intento de aplicar un cupón al suscribirse rompería con un 500, no solo dejaría de
  protegerse contra el duplicado. Ya está cubierto por la sección 3 de la migración (la tabla
  completa, con esa constraint incluida) — lo marco para que quede explícito el motivo.
- **`consultants_email_unique_idx`** y **`appointments_consultant_active_slot_unique_idx`**: acá
  es distinto, el código NO usa `ON CONFLICT` — hace un `INSERT`/`UPDATE` normal y después
  atrapa la excepción de Postgres (código `23505`) **por el nombre exacto de la constraint**
  (`isUniqueViolationOn`, en `server/storage.ts`) para convertirla en un mensaje claro
  ("Ya existe una cuenta con ese email" / "Ya existe un turno en ese horario"). Si el índice no
  existiera, no habría ningún error que atrapar: el registro duplicado o el turno duplicado se
  guardarían igual, sin aviso — un hueco de integridad silencioso, no un 500. (El de email ya
  está confirmado presente en producción; el de turnos sigue sin confirmar, ver arriba.)

---

## Orden del día del deploy (para el programador, paso a paso)

1. Elegir un horario de poco uso (de madrugada, hora Argentina).
2. **Backup de producción** (Supabase → Database → Backups, o `pg_dump`).
3. **Restaurar el backup en una base de prueba** (nunca producción).
4. Contra esa base restaurada, en este orden:
   a. Correr las consultas de "Chequeos de datos" de arriba (incluida la de verdad de base, la
      primera). Guardar los resultados.
   b. Si CUALQUIERA de las consultas 1 o 2 dio filas: PARAR TODO ACÁ — ni el resto de la
      migración, ni el deploy del código — y mandarme el resultado. No seguir a 4c/4d hasta
      resolverlo conmigo.
   c. Correr el SQL completo de "Migraciones de schema" de más abajo.
   d. Correr `npx tsx script/check-cost-equals-price.ts` y
      `npx tsx script/migrate-estimated-sale-costs.ts` (ver nota de conexión más abajo) — los
      dos son de solo lectura por default.
5. **Mandarme los resultados de 4a y 4d.** Los reviso con ustedes antes de decidir si aplicar las
   dos migraciones de datos del Prompt 2 (que, si hace falta, se aplican aparte — nunca junto con
   el dry-run).
6. Con todo revisado y aprobado: aplicar el mismo SQL (más las migraciones de datos, si
   correspondía) contra producción real.
7. **Verificación rápida en producción** con las mismas consultas del punto 0 de "Chequeos de
   datos" (la de `information_schema`) — confirmar que todo lo nuevo existe antes de publicar
   código.
8. Publicar (deploy) el código nuevo en Railway.
9. **Probar en la app real, enseguida**, en este orden:
   - Iniciar sesión con una cuenta de consultora real.
   - Cargar una venta completa (con al menos un producto).
   - Entrar a Configuración, guardar un cambio cualquiera.
   - Entrar a Suscripción, aplicar un cupón de prueba (si hay uno cargado) y ver que el precio
     con descuento se calcule bien — sin completar el pago real todavía.
   - Recuperar contraseña: pedirlo con un email real y confirmar si el correo llega (depende
     también de `RESEND_API_KEY`/`EMAIL_FROM`, ver nota arriba — puede seguir sin andar por eso,
     aparte de esta migración).
   - Ver la lista de Ventas y el detalle de una venta vieja (de antes del deploy) — confirmar que
     se siguen viendo bien.
10. Si algo falla: revertir el deploy del código en Railway al commit anterior (`20c8d83`) — la
    base ya migrada sigue funcionando con ese código, según "Plan de vuelta atrás" arriba. No
    hace falta deshacer la migración.

### Nota de conexión para los scripts de datos

Los dos scripts (`check-cost-equals-price.ts` y `migrate-estimated-sale-costs.ts`) están
deliberadamente escritos para usar **solo** `TEST_DATABASE_URL` — nunca aceptan apuntar a otra
base por accidente (es la misma protección que ya usa el resto de los scripts de migración del
proyecto). Para correrlos contra la base de prueba restaurada, seteen `TEST_DATABASE_URL` en el
`.env` de esa sesión apuntando a esa base (el nombre de la base tiene que terminar en `_test`,
hay un guard que lo exige — ver `server/test-db-guard.ts`). Si prefieren correrlos distinto,
avisen y los adapto.

---

## Migraciones de schema (SQL completo, en orden)

Cada bloque usa `IF NOT EXISTS`/`IF EXISTS` a propósito: no hace nada si esa parte puntual ya
estaba aplicada (confirmado: al menos las secciones 1a y 1c de abajo YA están aplicadas en
producción — ver "Estado real" arriba), así que correr todo el archivo de una es seguro aunque
partes ya existan. Probado dos veces contra una base Postgres en blanco: la primera corrida
aplica todo limpio, la segunda no hace nada (confirma que es idempotente de verdad).

```sql
-- ============================================================
-- 1. De antes del 15/9 — password_reset_codes sigue sin confirmar
--    (ver "Estado real" arriba; ingresos_brutos y el índice de
--    email de este mismo bloque YA están en producción).
-- ============================================================

-- 1a. Ingresos Brutos manual por venta (columna vieja, se sigue usando para ventas
--     históricas aunque ya no se escribe desde ventas nuevas).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS ingresos_brutos integer;

-- 1b. Tabla completa de códigos de recuperación de contraseña.
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_codes_user_id_idx ON password_reset_codes(user_id);

-- 1c. Un email no se puede repetir entre consultoras (índice parcial: no cuenta contra
--     las que todavía no tienen email cargado).
CREATE UNIQUE INDEX IF NOT EXISTS consultants_email_unique_idx ON consultants(email)
  WHERE email IS NOT NULL;

-- ============================================================
-- 2. Etapa 7.1-7.9 (15/9, commit 3b42003) — hardening general.
--    El código vivo HOY ya espera esto (ver "Estado real" arriba).
-- ============================================================

-- 2a. Dos citas de la misma consultora no pueden chocar en el mismo día+hora (una cita
--     cancelada no cuenta, no bloquea ese horario para una nueva).
CREATE UNIQUE INDEX IF NOT EXISTS appointments_consultant_active_slot_unique_idx
  ON appointments(consultant_id, date, time) WHERE status != 'cancelada';

-- ============================================================
-- 3. Prompt U (4/10) — precio de suscripción editable y cupones.
--    Nada de acá está desplegado todavía.
-- ============================================================

-- 3a. MP-1: varios cobros recurrentes de una misma suscripción comparten
--     external_reference — ya no puede ser UNIQUE (ver docs de la Etapa MP-1).
--     *** Esta es la que puede cortar pagos recurrentes reales si no se aplica. ***
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_external_reference_unique;

-- 3b. Último cambio de precio "a las actuales" ya aplicado a esta suscripción puntual.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_history_applied_id integer;

-- 3c. Historial de cambios de precio de la suscripción.
CREATE TABLE IF NOT EXISTS subscription_price_history (
  id serial PRIMARY KEY,
  old_price_ars integer,
  new_price_ars integer NOT NULL,
  applies_to text NOT NULL DEFAULT 'new_only',
  effective_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by_admin_id integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS subscription_price_history_changed_at_idx
  ON subscription_price_history(changed_at);

-- 3d. Cupones de descuento (admin).
CREATE TABLE IF NOT EXISTS coupons (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  discount_type text NOT NULL,
  discount_value integer NOT NULL,
  duration text NOT NULL,
  duration_months integer,
  max_uses integer,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_admin_id integer REFERENCES users(id)
);

-- 3e. Usos de cupones (snapshot de condiciones al momento de usarlo).
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id serial PRIMARY KEY,
  coupon_id integer NOT NULL REFERENCES coupons(id),
  consultant_id integer NOT NULL REFERENCES consultants(id),
  status text NOT NULL DEFAULT 'reserved',
  discount_type text NOT NULL,
  discount_value integer NOT NULL,
  duration text NOT NULL,
  duration_months integer,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  discount_ends_at timestamptz,
  price_reverted_at timestamptz,
  CONSTRAINT coupon_redemptions_coupon_consultant_unique UNIQUE (coupon_id, consultant_id)
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_consultant_id_idx ON coupon_redemptions(consultant_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_id_idx ON coupon_redemptions(coupon_id);

-- ============================================================
-- 4. Prompt 1 (5/10) — Configuración: días de pedido, descuento
--    habitual, Ingresos Brutos (%). Nada de acá está desplegado.
-- ============================================================

-- 4a. Hasta 2 días del mes para el recordatorio de pedido (independientes entre sí).
ALTER TABLE consultants ADD COLUMN IF NOT EXISTS order_reminder_day1 integer;
ALTER TABLE consultants ADD COLUMN IF NOT EXISTS order_reminder_day2 integer;

-- 4b. % de Ingresos Brutos, en décimas de punto porcentual (35 = 3,5%).
--     *** Si falta esta columna, TODA venta nueva rompe (ver explicación arriba). ***
ALTER TABLE consultants ADD COLUMN IF NOT EXISTS gross_income_tax_percent_tenths integer;

-- 4c. Historial de pedidos confirmados, para calcular el descuento de compra habitual.
CREATE TABLE IF NOT EXISTS order_discount_log (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL REFERENCES consultants(id),
  discount_percent integer NOT NULL,
  public_value_ars integer NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_discount_log_consultant_confirmed_idx
  ON order_discount_log(consultant_id, confirmed_at);

-- ============================================================
-- 5. Prompt 2 (6/10) — Costos y ganancia. Nada de acá está desplegado.
-- ============================================================

-- 5a. % de Ingresos Brutos vigente en Configuración al confirmar CADA venta (snapshot,
--     no se recalcula si el % cambia después). Mismo nombre de columna que 4b, pero en
--     la tabla sales, no consultants — son conceptos distintos (configuración vs. snapshot).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS gross_income_tax_percent_tenths integer;

-- 5b. Si el costo de una línea de venta se estimó (sin costo real cargado) o es real.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cost_is_estimated boolean;
```

---

## Migraciones de datos (Prompt 2) — SOLO después del SQL de arriba

Estas dos corren como scripts TypeScript, no SQL suelto, porque una de las dos (la de ventas
estimadas) necesita calcular el descuento de compra habitual de cada consultora, que no es una
cuenta que convenga escribir dos veces (una en SQL y otra en el código) — se reusa la misma
lógica que ya corre en la app.

**1. `script/check-cost-equals-price.ts`** — chequea si algún producto quedó con el costo
igual al precio de venta (no debería pasar por el camino normal de la app, pero conviene
confirmarlo). Solo lectura por default; si encuentra filas, hay una función de aplicación
separada (`applyCostEqualsPriceFix`) que las deja en "sin costo" — no se llama sola, hay que
decidirlo después de ver el resultado.

**2. `script/migrate-estimated-sale-costs.ts`** — encuentra ventas viejas cuyo costo quedó
igual al precio (el bug de "ganancia $0" que corrige el Prompt 2) y las marca como estimadas,
con el costo corregido según el descuento habitual de CADA consultora. Mismo criterio: solo
lectura por default (`findEstimatedSaleCostCandidates`), la aplicación real
(`applyEstimatedSaleCostMigration`) es una llamada aparte.

Correr ambos en modo lectura contra la base de prueba restaurada, mandarme los resultados, y
recién después decidimos juntos si aplicar la escritura — ahí sí, contra producción, con el
backup ya hecho.
