# Migración pendiente — Tercer deploy (Prompts 14 y 8)

Este documento es el paquete de migración para DESPUÉS del segundo deploy
(`docs/migracion-deploy-2.md`). Asume que ese paquete ya está aplicado y publicado. Acumula dos
prompts porque todavía ninguno de los dos se desplegó: Prompt 14 (ingreso, registro y prueba
gratis, rama `prompt-14-ingreso`) y Prompt 8 (venta sin stock y día de pedido, rama
`prompt-8-pedidos`, creada arriba de `prompt-14-ingreso`). Todo lo de abajo se calculó leyendo
`shared/schema.ts` en cada rama correspondiente.

## ⚠️ Nunca correr `drizzle-kit push` (con o sin `--force`) contra producción

Mismo criterio que los dos paquetes anteriores: esto es **SQL puro, aplicado a mano** (`psql`
o el panel de Supabase). `drizzle-kit push`/`db:push` nunca se usan contra producción, bajo
ningún motivo (ver `docs/staging.md` y `docs/migracion-produccion-pendiente.md` para el
detalle de por qué: puede proponer borrar la tabla `session`, cerrando la sesión de todas las
consultoras de una).

## ⚠️ `TEST_DATABASE_URL` nunca debe existir en las variables de Railway

Mismo chequeo que los paquetes anteriores (ver `docs/migracion-produccion-pendiente.md`) —
nada de este Prompt lo cambia, se repite acá para no dar por sentado que "ya se dijo antes".

## Qué entra en este paquete

**Prompt 14** (Ingreso, registro y prueba gratis) — 100% aditivo, ninguna columna se borra ni
se vuelve obligatoria:

- 5 columnas nuevas en `consultants`, todas nullable: `whatsapp`, `contact_name`, `city`,
  `age`, `job_title`.
- 1 índice único parcial nuevo sobre `consultants.whatsapp` (mismo patrón que el que ya existe
  sobre `email`: no aplica a filas con `whatsapp IS NULL`, así que ninguna consultora
  histórica sin WhatsApp cargado choca con otra).

**Lo que NO cambia** (a propósito, para que no se de por sentado sin leerlo):

- **`subscriptions.trial_start_at`/`trial_end_at` siguen igual** (`NOT NULL`, se siguen
  poblando al crear una cuenta) — la prueba gratis deja de usarlas para bloquear acceso
  (`isFreePlan`, calculado en `server/subscription.ts`, decide todo por `status`, nunca por
  estas fechas), pero la columna en sí no se toca. No hace falta ningún backfill ni ningún
  `UPDATE` sobre cuentas existentes: las fechas viejas quedan ahí, simplemente ya no importan.
- **Ninguna cuenta existente pierde acceso.** Las que estaban en trial, vencidas o
  canceladas pasan automáticamente al plan gratis (acceso a todo, con el límite de productos)
  la primera vez que se calcula su estado después del deploy — es un cambio de código
  (`computeAccess`), no de datos.
- **`users.username` sigue `NOT NULL UNIQUE`**, sin tocar. Las cuentas viejas con su propio
  username siguen entrando con él. Nada que migrar ahí.

**Prompt 8** (Venta sin stock y día de pedido, Partes 1-3 — la Parte 4 de notificaciones push
no se implementó, solo queda el modelo de datos listo) — también 100% aditivo:

- 5 columnas nuevas en `sale_items`: `quantity_pending` (`integer not null default 0`),
  `quantity_delivered` (`integer not null default 0`), `estimated_cost_per_unit` (`integer`,
  nullable), `real_cost_accumulated` (`integer not null default 0`), `real_cost_units`
  (`integer not null default 0`).
- 1 columna nueva en `consultants`: `order_reminder_days_updated_at` (`timestamp`, nullable) —
  cuándo se guardaron por última vez `order_reminder_day1`/`day2`. El recordatorio del día de
  pedido nunca genera un ciclo anterior a esta fecha.
- 1 tabla nueva, `order_reminders`: `id`, `consultant_id` (FK a `consultants`),
  `reminder_date`/`period_start`/`period_end` (text, `YYYY-MM-DD`), `dismissed_at`
  (`timestamp`, nullable), `created_at` (`timestamp not null default now()`), con un índice
  único compuesto `(consultant_id, reminder_date)` y un índice simple sobre `consultant_id`.
  Solo guarda las fechas del ciclo — ni el criterio (a) (vendido en el período) ni el (b)
  (unidades pendientes) se congelan en la fila, ambos se recalculan en vivo cada vez que se
  muestra el recordatorio abierto.
- `period_end` de un ciclo es el día ANTERIOR a `reminder_date` (nunca `reminder_date` mismo):
  una venta hecha el propio día de pedido entra entera en el ciclo SIGUIENTE, cuyo
  `period_start` es justamente ese `reminder_date` — sin huecos entre un ciclo y el otro, y sin
  que una misma venta pueda contarse en dos.

**Lo que NO cambia** (Prompt 8):

- **`sales.delivery_status` sigue existiendo igual**, mismos dos valores (`entregada`/
  `pendiente_entrega`) — pasa a ser un agregado calculado de los renglones en vez de un valor
  puramente manual, pero es un cambio de código (`server/storage.ts`), no de esquema.
- **Ninguna venta existente queda con unidades pendientes.** Por default, `quantity_pending =
  0` para toda fila ya existente — backfill explícito abajo para `quantity_delivered` y los 3
  campos de costo, para que el día que se lea una venta vieja no aparezca como si tuviera algo
  pendiente o estimado que en realidad no tiene.

## SQL (de punta a punta, en orden)

Verificado contra la base de dev local (`drizzle-kit push`, schema actual con ambas ramas
acumuladas): `information_schema.columns` sobre `order_reminders` confirma exactamente estas
columnas (sin `items`, sacada en el ajuste de período en vivo), y una segunda corrida sin
`--force` dio "No changes detected" — nada de esto quedó sin confirmar a mano.

```sql
-- Prompt 14 --------------------------------------------------------------
-- 1. Columnas nuevas en consultants (todas nullable, sin default — no reescriben filas existentes)
ALTER TABLE consultants ADD COLUMN whatsapp text;
ALTER TABLE consultants ADD COLUMN contact_name text;
ALTER TABLE consultants ADD COLUMN city text;
ALTER TABLE consultants ADD COLUMN age integer;
ALTER TABLE consultants ADD COLUMN job_title text;

-- 2. Índice único parcial sobre whatsapp — mismo patrón que consultants_email_unique_idx.
-- Nombre elegido a mano, IGUAL al que nombra Drizzle (confirmar con `drizzle-kit push`
-- contra una base descartable antes de aplicar esto en producción, mismo criterio que los
-- paquetes anteriores — si no coincide, la PRÓXIMA vez que alguien corra `drizzle-kit push`
-- contra una base de desarrollo/staging, Drizzle no reconocería el nombre e intentaría
-- borrar y recrear el índice).
CREATE UNIQUE INDEX consultants_whatsapp_unique_idx ON consultants (whatsapp) WHERE whatsapp IS NOT NULL;

-- Prompt 8 -----------------------------------------------------------------
-- 3. Columna nueva en consultants (nullable, sin default).
ALTER TABLE consultants ADD COLUMN order_reminder_days_updated_at timestamp;

-- 4. Columnas nuevas en sale_items (con default, para que las filas existentes queden en un
-- estado coherente sin backfill aparte en estas 3 — ver el backfill explícito más abajo para
-- quantity_delivered y los campos de costo).
ALTER TABLE sale_items ADD COLUMN quantity_pending integer NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN quantity_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN estimated_cost_per_unit integer;
ALTER TABLE sale_items ADD COLUMN real_cost_accumulated integer NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN real_cost_units integer NOT NULL DEFAULT 0;

-- 5. Tabla nueva order_reminders.
CREATE TABLE order_reminders (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL REFERENCES consultants(id),
  reminder_date text NOT NULL,
  period_start text NOT NULL,
  period_end text NOT NULL,
  dismissed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX order_reminders_consultant_date_unique ON order_reminders (consultant_id, reminder_date);
CREATE INDEX order_reminders_consultant_idx ON order_reminders (consultant_id);

-- 6. Backfill de las filas de sale_items que ya existen (Prompt 8, ajuste 3): el valor que
-- tenía cada venta ANTES de este prompt no distinguía "pendiente" de "entregado" — se deriva
-- del único dato que había, sales.delivery_status.
UPDATE sale_items si
SET quantity_delivered = si.quantity
FROM sales s
WHERE s.id = si.sale_id AND s.delivery_status = 'entregada';
-- (las que estaban en 'pendiente_entrega' quedan en quantity_delivered = 0, el default de arriba)

-- 7. Backfill de costo: si costIsEstimated es false (costo real), todo lo que ya tenía
-- cargado era real; si es true (estimado), todo lo que tenía era estimado. Ninguna fila
-- vieja tiene quantityPending > 0 (recién empieza a existir con este deploy), así que no hay
-- mezcla real/estimado posible en ninguna fila de antes de este prompt.
UPDATE sale_items
SET real_cost_accumulated = cost_price * quantity, real_cost_units = quantity
WHERE cost_is_estimated = false AND cost_price IS NOT NULL;

UPDATE sale_items
SET estimated_cost_per_unit = cost_price
WHERE cost_is_estimated = true AND cost_price IS NOT NULL;

-- 8. Para las consultoras que YA tienen día de pedido configurado, la fecha de referencia pasa
-- a ser el momento de este deploy (no hace falta elegir una fecha a mano) — así nadie ve de
-- golpe un aviso de un ciclo de hace semanas apenas se despliega esto (ajuste 1). El OR cubre
-- también a quien configuró SOLO el día 2 (day1 null, day2 no) — day1 NOT NULL solo no alcanza.
UPDATE consultants
SET order_reminder_days_updated_at = now()
WHERE order_reminder_day1 IS NOT NULL OR order_reminder_day2 IS NOT NULL;
```

## Chequeo previo (solo lectura, correr antes de aplicar)

Antes de agregar el índice único de `whatsapp`, confirmar que ninguna consultora existente ya
tiene el mismo WhatsApp normalizado que otra (no debería pasar — nadie carga WhatsApp todavía,
la columna es nueva — pero es gratis confirmarlo):

```sql
SELECT whatsapp, count(*), array_agg(id ORDER BY id)
FROM consultants
WHERE whatsapp IS NOT NULL
GROUP BY whatsapp
HAVING count(*) > 1;
```

Si devuelve filas, el índice único de la sección anterior va a fallar al crearse — hay que
resolver el duplicado a mano antes de seguir (no debería ser posible en la práctica, ya que
esta migración es la que recién habilita guardar WhatsApp).

También vale la pena correr esto (ya con el Prompt 14 en producción, antes de activar la
restricción de email único si todavía no se corrió) para confirmar que no hay emails
duplicados entre consultoras — pedido aparte del usuario, consulta ya entregada:

```sql
SELECT lower(trim(email)) AS email_normalizado, count(*), array_agg(id ORDER BY id) AS consultant_ids
FROM consultants
WHERE email IS NOT NULL AND trim(email) <> ''
GROUP BY lower(trim(email))
HAVING count(*) > 1
ORDER BY count(*) DESC;
```

## Chequeo posterior

```sql
SELECT count(*) FROM consultants WHERE whatsapp IS NOT NULL;  -- esperado: 0 recién después del deploy

-- Prompt 8 — confirma que el backfill de sale_items quedó coherente con delivery_status:
-- cualquier fila acá es un problema real a investigar, no debería devolver nada.
SELECT si.id, si.sale_id, s.delivery_status, si.quantity, si.quantity_delivered
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
WHERE (s.delivery_status = 'entregada' AND si.quantity_delivered <> si.quantity)
   OR (s.delivery_status = 'pendiente_entrega' AND si.quantity_delivered <> 0);
```
