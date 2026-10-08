# Migración pendiente — Segundo deploy (Prompts 4, 6 y 7)

Este documento es el paquete de migración para DESPUÉS del primer deploy
(`docs/migracion-produccion-pendiente.md`, Prompt U/1/2). Asume que ese paquete ya está
aplicado y publicado — todo lo de abajo se calculó diffeando `shared/schema.ts` entre la punta
de `deploy-paquete-1` (commit `b0fd119`, el que ya está aprobado para el primer deploy) y el
código actual (`prompt-7-borradores`), no de memoria ni de una lista armada a mano.

## Qué prompts entran en este paquete

- **Prompt 4** (Stock: lista, filtros y edición) — 1 columna nueva.
- **Prompt 5** (Cargar desde el catálogo) — **sin cambios de base**, confirmado en el diff: fue
  pura reescritura de frontend sobre endpoints que ya existían.
- **Prompt 6** (Nueva venta y detalle de venta) — 1 columna nueva.
- **Prompt 7** (Borradores de ventas y pedidos) — 1 tabla nueva.

Todo lo demás que aparece en el diff de `shared/schema.ts` entre esos dos puntos es validación
Zod (qué campos acepta cada endpoint) o lógica de aplicación — **nada que Postgres necesite
migrar**. Ejemplos para que quede trazable, no es que me los salté: `createSaleSchema.clientId`
pasa a opcional, se agregan `paidNow`/`firstDueDate`/`draftId` al body de varios endpoints, se
deja de aceptar `status: "entregado"/"pagado"` en el body — todo eso vive en columnas `text`
que ya existen (`sales.status`) o no toca ninguna columna (son campos de un body de request).

## A diferencia del primer paquete: este es 100% aditivo

Reviso los 3 cambios uno por uno — ninguno puede romper por datos existentes, así que **no hay
ningún chequeo que pueda devolver "parar"** (a diferencia del paquete 1, que tenía dos índices
únicos que sí podían chocar con duplicados reales):

- `product_stock.price_override`: columna nueva, `nullable`, sin default. Agregarla no toca
  ninguna fila existente — todas quedan en `NULL` (que es exactamente "sin override", el
  comportamiento de hoy).
- `sales.delivery_status`: columna nueva, `NOT NULL DEFAULT 'entregada'`. Postgres 11+ (la
  versión que usa este proyecto) completa el default para las filas existentes como parte de la
  misma sentencia `ALTER TABLE`, sin reescribir la tabla entera ni bloquearla — no hace falta un
  `UPDATE` separado ni dejarla nullable "por las dudas".
- `drafts`: tabla nueva. No puede chocar con nada porque nace vacía.

## ¿Hace falta coordinar el orden con el código, como en el paquete 1?

No con la misma urgencia. En el paquete 1, el código VIEJO rompía si se publicaba antes de
migrar (ej. toda venta nueva fallaba sin `gross_income_tax_percent_tenths`). Acá reviso lo
mismo para este paquete: el código que corre inmediatamente después del primer deploy (Prompt
U/1/2) **no lee ni escribe** `price_override`, `delivery_status` ni `drafts` — esas columnas y
esa tabla las usa recién el código de los Prompts 4/6/7. Así que:

- Se puede migrar la base de este paquete **antes** de publicar el código de los Prompts 4/6/7,
  sin que eso rompa nada de lo que esté corriendo en ese momento (son columnas/tabla que ese
  código ni mira).
- Igual recomiendo el mismo orden de siempre (migrar primero, código después) por prolijidad y
  porque es el mismo runbook ya probado — pero acá no es una condición de "se rompe si no", es
  una preferencia operativa.

## Plan de vuelta atrás

Los 3 cambios son aditivos (columna nueva nullable, columna nueva con default, tabla nueva) —
ninguno quita ni aprieta algo que el código viejo necesite. Si el deploy de los Prompts 4/6/7
falla por cualquier motivo, se puede revertir el deploy en Railway al commit anterior sin tocar
la base de nuevo, exactamente igual que en el paquete 1 — no hace falta deshacer esta migración
para que el código de antes siga funcionando.

## Chequeo previo (solo lectura, correr en la copia del backup)

No hay ningún chequeo de datos que pueda frenar esta migración (ver arriba), pero igual conviene
partir de la foto real en vez de asumir — corran esto primero y guarden el resultado:

```sql
-- Confirma que las columnas/tabla de este paquete todavía NO existen (si alguna ya existe,
-- avisen antes de seguir — puede significar que esta migración ya se aplicó antes, o que hay
-- un cambio local no documentado acá).
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('product_stock', 'price_override'),
    ('sales', 'delivery_status')
  );

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'drafts';
```

Si cualquiera de las dos consultas devuelve filas, frenar y avisarme antes de aplicar el SQL de
abajo — no debería pasar (nada de esto se desplegó nunca), pero la regla sigue siendo la misma
del primer paquete: verificar antes de asumir.

## Orden del día del deploy

1. Backup de producción (igual que el paquete 1 — aunque este cambio sea aditivo, nunca se migra
   sin backup reciente).
2. Restaurar el backup en una base de prueba.
3. Contra esa base restaurada: correr el chequeo previo de arriba, y después el SQL completo de
   la sección siguiente.
4. Confirmar con el chequeo previo (de nuevo) que las 2 columnas y la tabla ya existen.
5. Aplicar el mismo SQL contra producción real.
6. Publicar el código de los Prompts 4, 5, 6 y 7 en Railway.
7. Probar en la app real:
   - Stock: editar un producto del catálogo global y cargarle un precio propio (Prompt 4),
     confirmar que el precio de venta cambia sin tocar el precio del catálogo.
   - Nueva venta: confirmar una venta con "la clienta paga en el momento" tildado y ver que NO
     aparezca vencida al día siguiente (el bug que arregló el Prompt 6); cambiar el estado de
     entrega desde el detalle de la venta.
   - Nueva venta: empezarla, cerrar sin confirmar, volver a entrar y confirmar que aparece en
     "Ventas sin terminar" (Prompt 7); retomarla y confirmarla.
8. Si algo falla: revertir el deploy del código en Railway al commit anterior — la base ya
   migrada sigue funcionando con el código de antes, según "Plan de vuelta atrás" arriba.

---

## Migraciones de schema (SQL completo, en orden)

Mismo criterio que el paquete 1: `IF NOT EXISTS` en todo, así que correr este archivo completo
es seguro aunque alguna parte ya esté aplicada.

```sql
-- ============================================================
-- 1. Prompt 4 (Stock: lista, filtros y edición)
-- ============================================================

-- 1a. Precio de venta PROPIO de la consultora para un producto del catálogo global
--     (products.consultant_id NULL). NULL = usa products.precio tal cual. Nunca se usa para
--     costo — el costo siempre parte del precio real del catálogo, no de lo que la consultora
--     decidió cobrar.
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS price_override integer;

-- ============================================================
-- 2. Prompt 6 (Nueva venta y detalle de venta)
-- ============================================================

-- 2a. Estado de entrega, separado del estado de pago (que ya vive en sale_installments).
--     Default 'entregada': toda venta confirmada hasta ahora se hizo con stock, es decir que ya
--     fue entregada en los hechos — Postgres completa esto solo en las filas existentes al
--     agregar la columna con este default, sin ningún UPDATE manual.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'entregada';

-- ============================================================
-- 3. Prompt 7 (Borradores de ventas y pedidos)
-- ============================================================

-- 3a. Avance sin terminar de "Nueva venta"/"Cargar pedido" — solo ventas/pedidos NUEVOS, nunca
--     la edición de uno existente. payload en jsonb a propósito (mismo criterio que
--     payments.raw_payload): el contenido difiere totalmente entre "sale" y "order".
--     client_draft_id es un UUID generado por el cliente al primer guardado (mismo patrón que
--     sales.client_request_id) — el UNIQUE de abajo es la garantía real contra duplicados: dos
--     guardados casi simultáneos del mismo borrador hacen upsert sobre la misma fila.
CREATE TABLE IF NOT EXISTS drafts (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  client_draft_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drafts_consultant_id_client_draft_id_unique UNIQUE (consultant_id, client_draft_id)
);
CREATE INDEX IF NOT EXISTS drafts_consultant_id_updated_at_idx ON drafts(consultant_id, updated_at);
```

Esta DDL es la misma, verbatim, que generó `drizzle-kit push` contra la base de desarrollo local
(confirmada con `pg_dump --schema-only -t drafts`). Además, probé las 3 sentencias dos veces
contra un Postgres descartable (igual que el paquete 1): la primera corrida, contra tablas base
vacías, crea todo limpio; la segunda, contra el mismo estado ya migrado, no hace nada (solo
`NOTICE: ... already exists, skipping` en cada línea) — confirmado con la salida real de
`psql`, no es una suposición.

No hay migraciones de datos para este paquete (a diferencia del Prompt 2, que sí necesitaba
corregir ventas viejas) — los 3 cambios son estructura nueva, no hay datos históricos que
reclasificar.
