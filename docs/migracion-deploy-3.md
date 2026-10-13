# Migración pendiente — Tercer deploy (Prompt 14: ingreso, registro y prueba gratis)

Este documento es el paquete de migración para DESPUÉS del segundo deploy
(`docs/migracion-deploy-2.md`). Asume que ese paquete ya está aplicado y publicado. Todo lo de
abajo se calculó leyendo `shared/schema.ts` en la rama `prompt-14-ingreso`.

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

## SQL (de punta a punta, en orden)

Verificado contra una base descartable: `drizzle-kit push --force` con el schema actual
generó exactamente estas columnas y este nombre de índice (`\d consultants`), y una segunda
corrida sin `--force` dio "No changes detected" — nada de esto quedó sin confirmar a mano.

```sql
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
```

Nada más que verificar — no hay backfill, no hay recálculo de ganancias ni de ventas, no hay
ningún dato financiero involucrado en este paquete.
