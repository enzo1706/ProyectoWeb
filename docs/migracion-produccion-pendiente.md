# Migraciones pendientes en producción (al 2026-10-06)

## Antes que nada: por qué esto es urgente, no solo prolijo

**El código nuevo (ya commiteado localmente, Prompts U, 1 y 2) rompe funcionalidad básica si se
publica ANTES de correr estas migraciones — no es una degradación elegante, es un error 500.**

La razón técnica: Drizzle (el ORM) arma el `SELECT`/`RETURNING` de cada consulta a partir de las
columnas que **el código** dice que tiene la tabla, no de las que tiene la base de verdad. Si el
código ya conoce una columna que la base todavía no tiene, Postgres devuelve
`column "x" does not exist` — y esto no pasa solo en la pantalla que usa esa columna puntual,
pasa en **cualquier consulta sin lista explícita de columnas sobre esa tabla**, aunque esa
consulta no tenga nada que ver con lo nuevo.

Ejemplos concretos de lo que se rompería, con la lista completa de abajo sin aplicar:

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

## Supuesto de partida (verificar antes de confiar en esto)

Esta lista asume que la última vez que alguien corrió una migración contra producción fue antes
del commit `e569568` (12/9) — es lo último confirmado con evidencia real (Etapa 8.1, logs de
Railway). Desde ahí hasta hoy nadie volvió a correr `drizzle-kit push`/`migrate` contra
producción (no hay rastro de eso en este proyecto). Si alguien corrió algo manual que yo no sé,
avisen antes de aplicar nada — las sentencias de abajo usan `IF NOT EXISTS`/`IF EXISTS` para que
sea seguro re-correrlas igual, pero mejor confirmarlo.

## Proceso (seguir en este orden, sin saltear pasos)

1. **Backup de la base de producción** (Supabase → Database → Backups, o `pg_dump`). Esto lo
   hace el equipo con acceso a Supabase — no yo.
2. **Restaurar ese backup en una base de prueba** (un proyecto Supabase aparte, o un Postgres
   local/Railway nuevo — cualquier cosa que NO sea producción).
3. Contra esa base de prueba, en este orden:
   a. Correr el SQL completo de la sección "Migraciones de schema" de más abajo.
   b. Correr `npx tsx script/check-cost-equals-price.ts` apuntando `TEST_DATABASE_URL` a esa
      base restaurada (ver nota de conexión más abajo) — es de solo lectura, no escribe nada.
   c. Correr `npx tsx script/migrate-estimated-sale-costs.ts` de la misma forma — también de
      solo lectura por defecto.
   d. Revisar los dos resultados.
4. **Pasame los resultados de 3b y 3c** (cuántas filas encontró cada uno, los ejemplos que
   imprime). Los reviso con ustedes antes de decidir si aplicar las dos migraciones de datos
   (que si hace falta, se aplican aparte, nunca junto con el dry-run).
5. Recién ahí, con todo probado y revisado: aplicar el mismo SQL + las migraciones de datos (si
   correspondía) contra producción, coordinado con el deploy del código nuevo.

### Nota de conexión para los scripts

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
estaba aplicada, así que correr todo el archivo de una es seguro aunque alguna parte ya exista.

```sql
-- ============================================================
-- 1. Etapa previa a e569568 (12/9) — confirmado faltante en
--    producción por logs reales de error (Etapa 8.1).
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
-- ============================================================

-- 2a. Dos citas de la misma consultora no pueden chocar en el mismo día+hora (una cita
--     cancelada no cuenta, no bloquea ese horario para una nueva).
CREATE UNIQUE INDEX IF NOT EXISTS appointments_consultant_active_slot_unique_idx
  ON appointments(consultant_id, date, time) WHERE status != 'cancelada';

-- ============================================================
-- 3. Prompt U (4/10) — precio de suscripción editable y cupones.
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
--    habitual, Ingresos Brutos (%).
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
-- 5. Prompt 2 (6/10) — Costos y ganancia.
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
