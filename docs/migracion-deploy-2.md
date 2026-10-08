# Migración pendiente — Segundo deploy (Prompts 4, 6, 7 y 9)

Este documento es el paquete de migración para DESPUÉS del primer deploy
(`docs/migracion-produccion-pendiente.md`, Prompt U/1/2). Asume que ese paquete ya está
aplicado y publicado — todo lo de abajo se calculó diffeando `shared/schema.ts` entre la punta
de `deploy-paquete-1` (commit `b0fd119`, el que ya está aprobado para el primer deploy) y el
código actual (`prompt-7-borradores`), no de memoria ni de una lista armada a mano.

## ⚠️ Nunca correr `drizzle-kit push` (con o sin `--force`) contra producción

Todo lo de este documento es **SQL puro, aplicado a mano** (`psql` o el panel de Supabase) — no
hay ningún paso que use `drizzle-kit push`, `db:push` ni ningún otro comando de Drizzle contra
producción, y tiene que seguir así. `drizzle-kit push` compara la base real contra
`shared/schema.ts` y propone borrar cualquier tabla que esté en la base pero no en ese archivo
— la tabla `session` (la crea `connect-pg-simple` en tiempo de ejecución, nunca vive en
`shared/schema.ts` a propósito) es exactamente ese caso: confirmado reproduciéndolo contra una
base local, sin `--force` avisa "You're about to delete session table" antes de pedir
confirmación, y con `--force` lo hace directo. Borrar `session` en producción cierra la sesión
de todas las consultoras de una. `drizzle.config.ts` ya la excluye explícitamente
(`tablesFilter: ["!session"]`), pero esa protección vive en el repo, no en la base — la regla
para producción sigue siendo más simple y más dura: nunca `drizzle-kit push` ahí, todo se migra
con SQL explícito como el de este documento.

## Qué prompts entran en este paquete

- **Prompt 4** (Stock: lista, filtros y edición) — 1 columna nueva.
- **Prompt 5** (Cargar desde el catálogo) — **sin cambios de base**, confirmado en el diff: fue
  pura reescritura de frontend sobre endpoints que ya existían.
- **Prompt 6** (Nueva venta y detalle de venta) — 1 columna nueva.
- **Prompt 7** (Borradores de ventas y pedidos) — 1 tabla nueva.
- **Prompt 9** (Clientas: alta, filtros y ficha) — 2 columnas, 3 tablas nuevas, **y 2
  migraciones de datos** (a diferencia de los tres anteriores, que no tenían ninguna). Ver
  sección propia más abajo — este prompt rompe el patrón "100% aditivo sin nada que mirar".

Todo lo demás que aparece en el diff de `shared/schema.ts` entre esos dos puntos es validación
Zod (qué campos acepta cada endpoint) o lógica de aplicación — **nada que Postgres necesite
migrar**. Ejemplos para que quede trazable, no es que me los salté: `createSaleSchema.clientId`
pasa a opcional, se agregan `paidNow`/`firstDueDate`/`draftId` al body de varios endpoints, se
deja de aceptar `status: "entregado"/"pagado"` en el body — todo eso vive en columnas `text`
que ya existen (`sales.status`) o no toca ninguna columna (son campos de un body de request).

## Prompts 4, 6 y 7: 100% aditivos, sin nada que pueda frenar la migración

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

## Prompt 9: estructura aditiva, pero con 2 migraciones de datos reales

Los cambios de estructura (ver el SQL completo más abajo) son igual de seguros que los de
arriba — aflojar un `NOT NULL`, agregar una columna con default, crear 3 tablas nuevas. Lo que
cambia con este prompt es que, DESPUÉS de aplicar la estructura, hacen falta dos pasos que sí
tocan datos existentes (ninguno puede fallar por los motivos de abajo, pero igual son UPDATE/
INSERT reales, no solo DDL):

1. **Backfill de `sale_installments.amount_paid`**: toda cuota que hoy ya está "pagado" nace
   con `amount_paid = 0` (el default de la columna nueva) — sin este paso, el sistema nuevo
   pensaría que esas cuotas no cobraron nada, cuando en realidad están cobradas completas.
   ```sql
   UPDATE sale_installments SET amount_paid = amount WHERE status = 'pagado' AND amount_paid = 0;
   ```
   Idempotente por construcción: en la segunda corrida, las filas que ya se migraron tienen
   `amount_paid = amount` (no 0), así que el `WHERE` ya no las toca — probado dos veces contra
   datos de prueba (abajo).

2. **Migración de `clients.notes` (texto único) a `client_notes` (notas múltiples)**: cada
   clienta con una nota vieja no vacía recibe UNA fila en la tabla nueva — **con `created_at`
   en `NULL`**, nunca con la fecha de la migración disfrazada de fecha real (decisión explícita
   del usuario: esa nota migrada se muestra como "Nota anterior" en vez de una fecha inventada).
   ```sql
   INSERT INTO client_notes (consultant_id, client_id, text, created_at)
   SELECT c.consultant_id, c.id, c.notes, NULL
   FROM clients c
   WHERE c.notes IS NOT NULL AND c.notes <> ''
     AND NOT EXISTS (SELECT 1 FROM client_notes cn WHERE cn.client_id = c.id);
   ```
   Idempotente por el `NOT EXISTS`: una clienta que ya recibió su nota migrada (tiene al menos
   una fila en `client_notes`) nunca se vuelve a tocar en una segunda corrida — incluso si para
   entonces ya cargó notas nuevas de verdad, con fecha real, por la ficha.

Ninguno de los dos puede "fallar" por un conflicto de datos (no hay ningún UNIQUE ni CHECK que
pueda chocar) — por eso tampoco hace falta un chequeo previo que frene la migración, pero sí
conviene correr esto antes para saber cuántas filas va a tocar cada uno (puramente informativo):

```sql
SELECT count(*) AS cuotas_a_backfillear FROM sale_installments WHERE status = 'pagado' AND amount_paid = 0;
SELECT count(*) AS notas_a_migrar FROM clients WHERE notes IS NOT NULL AND notes <> '';
```

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
WHERE table_schema = 'public' AND table_name IN ('drafts', 'client_notes', 'client_payments', 'payment_allocations');

SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('clients', 'phone'),
    ('sale_installments', 'amount_paid')
  );
```

Si cualquiera de las consultas de tablas/columnas devuelve algo ya existente, frenar y avisarme
antes de aplicar el SQL de abajo — no debería pasar (nada de esto se desplegó nunca), pero la
regla sigue siendo la misma del primer paquete: verificar antes de asumir.

## Orden del día del deploy

1. Backup de producción (igual que el paquete 1 — aunque este cambio sea aditivo, nunca se migra
   sin backup reciente).
2. Restaurar el backup en una base de prueba.
3. Contra esa base restaurada: correr el chequeo previo de arriba, y después el SQL completo de
   la sección siguiente.
4. Confirmar con el chequeo previo (de nuevo) que las 2 columnas y la tabla ya existen.
5. Aplicar el mismo SQL contra producción real.
4b. Correr las dos migraciones de datos del Prompt 9 (backfill de `amount_paid` y notas) —
   recién después de que el SQL de estructura de la sección siguiente ya esté aplicado (las
   dos tablas/columna nuevas tienen que existir antes).
5. **Mandarme los resultados de las consultas informativas de "cuántas filas va a tocar"** del
   Prompt 9 antes de aplicar nada contra producción real — no porque puedan fallar, sino para
   confirmar que los números tienen sentido (cuotas pagadas de siempre, notas viejas reales).
6. Con todo revisado: aplicar el mismo SQL de estructura + las 2 migraciones de datos contra
   producción real.
6b. Correr el "Chequeo posterior" (más abajo) contra producción real. Las dos primeras
   consultas tienen que dar 0 — si alguna no da 0, FRENAR y avisarme antes de publicar el
   código; no seguir al paso 7.
7. Publicar el código de los Prompts 4, 5, 6, 7 y 9 en Railway.
8. Probar en la app real:
   - Stock: editar un producto del catálogo global y cargarle un precio propio (Prompt 4),
     confirmar que el precio de venta cambia sin tocar el precio del catálogo.
   - Nueva venta: confirmar una venta con "la clienta paga en el momento" tildado y ver que NO
     aparezca vencida al día siguiente (el bug que arregló el Prompt 6); cambiar el estado de
     entrega desde el detalle de la venta.
   - Nueva venta: empezarla, cerrar sin confirmar, volver a entrar y confirmar que aparece en
     "Ventas sin terminar" (Prompt 7); retomarla y confirmarla.
   - Clientas: crear una clienta solo con el nombre (sin celular); cargarle un cumpleaños
     (confirmar que no pide año); abrir su ficha y confirmar que una cuota vieja "pagada" sigue
     mostrándose cobrada; si tenía una nota vieja, confirmar que aparece como "Nota anterior".
9. Si algo falla: revertir el deploy del código en Railway al commit anterior — la base ya
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
--     Nombre de la FK puesto a mano, IGUAL al que nombra Drizzle (no el default de Postgres)
--     — confirmado comparando pg_dump --schema-only de una base armada con este SQL contra una
--     pusheada con `drizzle-kit push` desde el código actual: sin esto, "drafts_consultant_id_
--     fkey" (Postgres) no coincidía con "drafts_consultant_id_consultants_id_fk" (Drizzle), y
--     la próxima vez que alguien correra `drizzle-kit push` contra la base real, Drizzle no
--     reconocería el nombre viejo e intentaría borrar y recrear la constraint. Mismo criterio
--     aplicado a TODAS las FK nuevas de esta sección (4c, 4d, 4e más abajo).
CREATE TABLE IF NOT EXISTS drafts (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL,
  client_draft_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drafts_consultant_id_client_draft_id_unique UNIQUE (consultant_id, client_draft_id),
  CONSTRAINT drafts_consultant_id_consultants_id_fk FOREIGN KEY (consultant_id) REFERENCES consultants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS drafts_consultant_id_updated_at_idx ON drafts(consultant_id, updated_at);

-- ============================================================
-- 4. Prompt 9 (Clientas: alta, filtros y ficha)
-- ============================================================

-- 4a. El celular pasa a ser opcional (antes NOT NULL). findDuplicateClient ya no trata dos
--     celulares NULL como duplicados entre sí (mismo criterio que ya tenía el email).
ALTER TABLE clients ALTER COLUMN phone DROP NOT NULL;

-- 4b. Cuánto se cobró de esta cuota hasta ahora — puede ser menor al monto total si hubo un
--     pago parcial. El status sigue siendo binario a propósito (pendiente/pagado): pasa a
--     "pagado" recién cuando amount_paid cubre el monto completo.
ALTER TABLE sale_installments ADD COLUMN IF NOT EXISTS amount_paid integer NOT NULL DEFAULT 0;

-- 4c. Notas múltiples de una clienta (reemplaza el texto único de clients.notes, que queda sin
--     usarse — nunca se borra). created_at es NULLABLE a propósito: las notas migradas desde
--     el campo viejo no tienen fecha real (ver migración de datos más abajo).
CREATE TABLE IF NOT EXISTS client_notes (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL,
  client_id integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz,
  CONSTRAINT client_notes_consultant_id_consultants_id_fk FOREIGN KEY (consultant_id) REFERENCES consultants(id),
  CONSTRAINT client_notes_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS client_notes_consultant_id_client_id_idx ON client_notes(consultant_id, client_id);

-- 4d. Un pago real (fecha + forma de pago). client_id es NULLABLE: una venta "Sin clienta"
--     (Prompt 6) también puede cobrarse por una cuota puntual, sin que exista una clienta.
CREATE TABLE IF NOT EXISTS client_payments (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL,
  client_id integer,
  amount integer NOT NULL,
  date text NOT NULL,
  payment_method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_payments_consultant_id_consultants_id_fk FOREIGN KEY (consultant_id) REFERENCES consultants(id),
  CONSTRAINT client_payments_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX IF NOT EXISTS client_payments_consultant_id_client_id_idx ON client_payments(consultant_id, client_id);
CREATE INDEX IF NOT EXISTS client_payments_consultant_id_date_idx ON client_payments(consultant_id, date);

-- 4e. Cómo se repartió un pago entre una o más cuotas (puede cubrir cuotas de más de una
--     venta de la misma clienta) — nunca se infiere, queda guardado para poder reconstruir
--     "a qué cuota fue cada peso" y para que "Total cobrado" sume por fecha real de pago.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL,
  installment_id integer NOT NULL,
  amount_applied integer NOT NULL,
  CONSTRAINT payment_allocations_payment_id_client_payments_id_fk FOREIGN KEY (payment_id) REFERENCES client_payments(id) ON DELETE CASCADE,
  CONSTRAINT payment_allocations_installment_id_sale_installments_id_fk FOREIGN KEY (installment_id) REFERENCES sale_installments(id)
);
CREATE INDEX IF NOT EXISTS payment_allocations_installment_id_idx ON payment_allocations(installment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_payment_id_idx ON payment_allocations(payment_id);
```

Esta DDL es la misma, verbatim, que generó `drizzle-kit push` contra la base de desarrollo local
(confirmada con `pg_dump --schema-only`). Probé las secciones 1 a 3 dos veces contra un Postgres
descartable (igual que el paquete 1): la primera corrida, contra tablas base vacías, crea todo
limpio; la segunda, contra el mismo estado ya migrado, no hace nada (solo
`NOTICE: ... already exists, skipping` en cada línea) — confirmado con la salida real de
`psql`, no es una suposición. La sección 4 la probé por separado, con el mismo método, el mismo
resultado: crea limpio la primera vez, no hace nada la segunda.

No hay migraciones de datos para los Prompts 4, 6 y 7 (a diferencia del Prompt 2, que sí
necesitaba corregir ventas viejas) — son estructura nueva, no hay datos históricos que
reclasificar. **El Prompt 9 sí tiene dos, y van DESPUÉS del SQL de arriba** (necesitan que
`sale_installments.amount_paid` y `client_notes` ya existan):

```sql
-- Backfill: toda cuota que hoy ya está "pagado" nace con amount_paid = 0 (el default de la
-- columna nueva) — sin esto, el sistema nuevo pensaría que no cobraron nada. Idempotente: en
-- una segunda corrida, las filas ya migradas tienen amount_paid = amount (no 0), así que el
-- WHERE ya no las toca. Probado dos veces contra datos de prueba: primera corrida migra las
-- filas "pagado" reales, segunda corrida no toca ninguna (UPDATE 0).
UPDATE sale_installments SET amount_paid = amount WHERE status = 'pagado' AND amount_paid = 0;

-- Migra el texto único viejo de clients.notes a la tabla nueva, SIN fecha (NULL) — nunca con
-- la fecha de la migración disfrazada de fecha real (decisión explícita: se muestra como
-- "Nota anterior" en la ficha). Idempotente por el NOT EXISTS: una clienta que ya tiene
-- alguna fila en client_notes nunca se vuelve a tocar, ni siquiera si después cargó notas
-- nuevas de verdad con fecha real. Probado dos veces: primera corrida migra las notas no
-- vacías reales, segunda corrida no inserta nada (INSERT 0 0).
INSERT INTO client_notes (consultant_id, client_id, text, created_at)
SELECT c.consultant_id, c.id, c.notes, NULL
FROM clients c
WHERE c.notes IS NOT NULL AND c.notes <> ''
  AND NOT EXISTS (SELECT 1 FROM client_notes cn WHERE cn.client_id = c.id);
```

## Chequeo posterior (correr después de aplicar las migraciones de datos, antes de publicar el código)

Confirma que el backfill de `amount_paid` dejó la base exactamente como el código nuevo la
necesita — que esto dé 0 en ambas filas es la condición para que la deuda de las clientas
actuales se calcule bien desde el primer momento en que corra el código del Prompt 9 (lee
`amount - amount_paid` en todos lados, nunca el monto bruto de la cuota):

```sql
-- Tiene que dar 0: ninguna cuota "pagado" puede tener amount_paid distinto de su propio monto
-- (si el backfill no corrió, o corrió mal, acá aparecerían filas).
SELECT count(*) AS cuotas_pagadas_con_amount_paid_mal
FROM sale_installments
WHERE status = 'pagado' AND amount_paid <> amount;

-- Tiene que dar 0: ninguna cuota "pendiente" puede tener amount_paid distinto de 0 — antes de
-- este prompt no existía el concepto de pago parcial, así que no hay ninguna cuota pendiente
-- que debiera nacer con algo ya cobrado (si diera más de 0, es señal de que el backfill tocó
-- filas que no debía).
SELECT count(*) AS cuotas_pendientes_con_amount_paid_mal
FROM sale_installments
WHERE status = 'pendiente' AND amount_paid <> 0;

-- Informativo, no tiene que dar 0 necesariamente: cuántas notas viejas se migraron a
-- client_notes con created_at NULL — para cotejar contra el conteo de "notas_a_migrar" del
-- chequeo previo (tienen que coincidir).
SELECT count(*) AS notas_migradas_sin_fecha
FROM client_notes
WHERE created_at IS NULL;
```

Si cualquiera de las dos primeras consultas devuelve algo distinto de 0: NO seguir con el
deploy del código — avisarme antes. Significa que alguna cuota quedó con un saldo pendiente
mal calculado, y el código del Prompt 9 (ficha de la clienta, Reportes, "Total cobrado") se
lo mostraría mal a la consultora desde el primer momento.
