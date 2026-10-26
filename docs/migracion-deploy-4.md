# Migración pendiente — Cuarto deploy (Prompt 8, Parte 4: avisos push)

Rama `prompt-8b-avisos`, creada desde `staging`. **No se mergea a `staging` todavía** — entra
después de la Ronda 2 (ver `docs/LEEME-proximos-pasos.md`), una vez que staging esté levantado
de verdad (esta parte necesita HTTPS real y un teléfono físico para probarse en serio).

## ⚠️ Nunca correr `drizzle-kit push` (con o sin `--force`) contra producción

Mismo criterio que los paquetes anteriores: todo lo de este documento es SQL puro, aplicado a
mano. Los nombres de las dos constraints nuevas están verificados contra `drizzle-kit push`
sobre una base descartable (2026-10-26) — confirmado que coinciden con lo que ya nombra
Drizzle, para no repetir el hallazgo del Prompt 16 (dos constraints mal nombradas en
`migracion-deploy-3.md`).

## Qué entra en este paquete

Dos tablas nuevas, nada que tocar de lo que ya existe — ver `shared/schema.ts`:

- **`push_subscriptions`**: un dispositivo suscripto a avisos push, por consultora. Una
  consultora puede tener varias filas (varios celulares). `endpoint` es único de verdad (lo da
  el navegador) — es la clave de UPSERT: activar avisos en un dispositivo que ya estaba
  suscripto a OTRA consultora (celular compartido) hace que la fila pase a ser de la que lo
  activa ahora, nunca una fila duplicada.
- **`push_notification_log`**: el "ya enviado", por consultora + tipo de aviso + fecha. Es la
  reserva atómica que usa la tarea programada (`server/push-scheduler.ts`) — un
  `INSERT ... ON CONFLICT DO NOTHING` antes de mandar nada. `notice_type` queda en texto libre
  a propósito (hoy solo `"dia_pedido"`) para que sirva también para avisos push futuros, sin
  tocar el esquema de nuevo.

## SQL (de punta a punta, en orden)

```sql
-- Prompt 8, Parte 4 -------------------------------------------------------
-- 1. Dispositivos suscriptos a avisos push.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_consultant_id_consultants_id_fk FOREIGN KEY (consultant_id) REFERENCES consultants(id),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_consultant_idx ON push_subscriptions (consultant_id);

-- 2. "Ya enviado" — la reserva atómica de la tarea programada.
CREATE TABLE IF NOT EXISTS push_notification_log (
  id serial PRIMARY KEY,
  consultant_id integer NOT NULL,
  notice_type text NOT NULL,
  sent_for text NOT NULL,
  sent_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT push_notification_log_consultant_id_consultants_id_fk FOREIGN KEY (consultant_id) REFERENCES consultants(id),
  CONSTRAINT push_notification_log_consultant_notice_sent_for_unique UNIQUE (consultant_id, notice_type, sent_for)
);
```

Verificado el 2026-10-26: los dos bloques se probaron contra una base Postgres descartable —
la primera corrida crea todo limpio, la segunda no hace nada (`IF NOT EXISTS` en todo), y los
nombres de las dos constraints (`push_subscriptions_consultant_id_consultants_id_fk`,
`push_notification_log_consultant_id_consultants_id_fk`, y las dos UNIQUE) coinciden
exactamente con los que genera `drizzle-kit push` desde `shared/schema.ts` — confirmado con
`\d push_subscriptions` / `\d push_notification_log` contra esa misma base, no asumido.

Sin migraciones de datos: las dos tablas nacen vacías, nadie tiene una suscripción todavía.

## Chequeo previo (solo lectura, correr antes de aplicar)

```sql
-- Confirma que las dos tablas todavía NO existen (si alguna ya existe, avisar antes de
-- seguir — no debería pasar, esto nunca se desplegó).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('push_subscriptions', 'push_notification_log');
```

## Chequeo posterior

```sql
-- Tiene que dar 2 filas (las dos tablas, recién creadas y vacías).
SELECT table_name, (SELECT count(*) FROM push_subscriptions) AS filas
FROM information_schema.tables WHERE table_name = 'push_subscriptions'
UNION ALL
SELECT table_name, (SELECT count(*) FROM push_notification_log) AS filas
FROM information_schema.tables WHERE table_name = 'push_notification_log';
```

## Variables de entorno nuevas (Railway)

Tres variables, **una por entorno** (staging y producción con pares DISTINTOS — mismo criterio
que las credenciales de Mercado Pago, nunca compartidas):

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: el par de claves del protocolo Web Push. Se generan
  UNA sola vez por entorno con:
  ```bash
  npx web-push generate-vapid-keys
  ```
  (comando verificado el 2026-10-26, imprime "Public Key" / "Private Key" listas para copiar).
  La clave privada nunca se comparte ni se expone al cliente — solo vive en las variables del
  servicio. La pública no es secreta (el frontend la pide vía `GET /api/push/vapid-public-key`),
  pero igual tiene que ser la misma de CADA par — mezclar la pública de un entorno con la
  privada de otro rompe el envío sin ningún error claro (la firma no coincide).
- `VAPID_SUBJECT`: un `mailto:` de contacto (ej. `mailto:soporte@impulsaweb.ar`) — lo exige el
  protocolo, lo ven los servicios de push (Google/Apple/Mozilla) si necesitan contactar al
  operador por abuso. Puede ser el mismo en staging y producción (no es secreto), pero
  documentado en los dos lugares igual para que quede explícito.

Ver `docs/staging.md` para dónde van exactamente en el panel de Railway.

## Railway — el servicio no puede "dormir"

Si el servicio de Railway tiene activada la opción de bajar a cero instancias sin tráfico
("App Sleeping" en el plan actual de Railway, el nombre puede cambiar), la tarea programada
(`server/push-scheduler.ts`, un `setInterval` DENTRO del proceso) deja de correr apenas el
servicio se duerme — y nadie lo despierta a las 9:00, porque despertar el servicio necesita
tráfico HTTP entrante, y un aviso push no es tráfico HTTP entrante, es lo que el proceso
dormido debería generar. Confirmar esta opción desactivada antes de este deploy, en staging Y
en producción — ver el ítem agregado en el checklist de `docs/staging.md`.

## Qué prueba automatizada ya cubre esto

`server/tests/push-notifications.test.ts` — con el reloj simulado, sin ningún servicio de push
real: la ventana horaria (antes de las 9:00, después de las 21:00), que no duplica envíos
(revisión siguiente, o dos revisiones "simultáneas" con `Promise.all`), que un servidor caído
hasta las 11:00 manda igual a esa hora, que la lista vacía no manda nada, que un error
transitorio reintenta y uno vencido (404/410) borra la suscripción sin reintentar, y las rutas
de activar/reasignar/desactivar (`/api/push/subscribe`, `/unsubscribe`).

## Cómo probarlo en Chrome de escritorio (localhost)

1. `npm run dev`, entrar con una consultora de prueba.
2. Configurar un día de pedido para hoy (Configuración → "¿Qué día del mes hacés tu pedido?") y
   tener al menos una venta que deje un producto con poco stock, o una venta sin stock
   pendiente — así el recordatorio no sale vacío.
3. En Configuración → "Pedidos y stock" → "Activar avisos en este celular". Chrome pide el
   permiso (tratá `localhost` como origen seguro, no hace falta HTTPS para esto) — aceptar.
4. Confirmar que aparece "Avisos activados en este celular ✓".
5. Tocar "Probar aviso" — tiene que aparecer una notificación real del sistema (Windows/Mac) en
   un par de segundos. Tocarla: tiene que enfocar o abrir la pestaña de la app en Inicio.
6. Para probar el aviso real del día de pedido sin esperar al reloj: en una consola de Node con
   el mismo `DATABASE_URL`, importar `runPushSchedulerTick` de `server/push-scheduler.ts` y
   llamarlo directo (la ventana horaria usa la hora real de la máquina — si no son entre las
   9:00 y las 21:00 de Argentina en este momento, no va a mandar nada; ajustarlo o esperar a
   que sea una hora dentro de la ventana).

## Qué queda para staging + un teléfono físico

- **iPhone**: Safari exige HTTPS real para Web Push, y solo funciona con la app agregada a la
  pantalla de inicio (iOS 16.4 o más nuevo) — nada de esto se puede simular en `localhost`.
  Probar: agregar la app a inicio desde Safari, abrirla desde ese ícono, activar los avisos,
  "Probar aviso", y confirmar que llega con la app cerrada (no solo en segundo plano).
- **Android**: confirmar cómo se ve de verdad en la bandeja de notificaciones del sistema (no
  solo que la API funciona — el aspecto/comportamiento real puede diferir de Chrome de
  escritorio).
- **El aviso real del día de pedido** (no el de prueba): con staging publicando esta rama,
  configurar el día de pedido de una cuenta de prueba para HOY, activar los avisos en un
  teléfono, y esperar a que la revisión programada (cada 5 minutos, entre las 9:00 y las 21:00
  hora de Argentina) lo mande solo — sin tocar nada en la app ese día, confirmando que no
  depende de haber entrado.
