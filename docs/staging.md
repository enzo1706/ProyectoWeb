# Staging — plan y runbook

Este documento define cómo se prueba cada Prompt antes de llegar a producción real, sin
arriesgar datos ni plata reales. No ejecuta nada por sí solo: es la referencia para armar el
entorno de staging en Railway/Supabase y para operarlo día a día. Nada de lo de acá se corrió
todavía contra Railway, Supabase ni Mercado Pago — es documentación y código, a la espera de
que decidas cuándo levantarlo de verdad.

## Por qué hace falta staging ahora

El Prompt 8 (notificaciones push) necesita HTTPS real y un teléfono físico para probarse en
serio — eso no se puede validar en `localhost`. Hasta no tener staging andando, el Prompt 8
queda pausado (ver `docs/prompts-mejoras.md`).

## El flujo: prompt → staging → main

```
prompt-N-xxx  ──(PR + review)──>  staging  ──(probado en staging, OK explícito)──>  main
```

1. Cada Prompt se desarrolla en su propia rama (`prompt-N-xxx`), igual que hasta ahora —
   commiteado, testeado y buildeado localmente antes de cualquier paso siguiente.
2. La rama del Prompt se mergea a la rama `staging` (no a `main` directo). Railway tiene un
   servicio separado (`marykaymanager-staging`, o el nombre que se elija) con auto-deploy
   apuntando a esa rama — cada push a `staging` dispara un deploy a ese servicio, nunca al de
   producción.
3. Contra staging se corre el checklist de pruebas correspondiente (`docs/pruebas-prompt-*.md`)
   y cualquier prueba manual que necesite HTTPS real (push notifications, el flujo completo de
   Mercado Pago con tarjetas de prueba, etc.).
4. Recién con eso probado y tu OK explícito, se mergea `staging` a `main` y se publica a
   producción — mismo runbook que ya se usa hoy (`docs/migracion-deploy-2.md` y el paquete 1),
   sin cambios.
5. Si algo se rompe en staging, se corrige en la rama del Prompt y se vuelve a mergear a
   `staging` — `main` nunca recibe código que no pasó por staging primero.

**Regla dura, sin excepciones:** nadie (yo incluido) hace `git push origin main`, `railway up`
contra el servicio de producción, ni toca la base o las variables de entorno de producción sin
tu OK explícito en ese momento puntual — un OK de una tarea anterior no cuenta para la
siguiente.

## Infraestructura de staging

### Railway

- Un servicio nuevo dentro del mismo proyecto de Railway (o uno aparte, lo que prefieras
  administrar), con su propio dominio (`*.up.railway.app` alcanza, no hace falta un dominio
  propio) — ese dominio HTTPS es justamente lo que el Prompt 8 necesita para las notificaciones
  push.
- Variables de entorno propias, **nunca compartidas con producción**:
  - `DATABASE_URL`: apunta a la base de staging (ver sección Supabase abajo), nunca a la de
    producción.
  - `NODE_ENV=production`: sí, igual que en producción real — es lo que hace que
    `server/app.ts` sirva los archivos estáticos ya buildeados (`serveStatic`) en vez de correr
    el servidor de desarrollo de Vite. Bajarlo a otro valor rompería el deploy de staging de
    una forma que no reproduce el comportamiento real que se quiere probar.
  - `APP_ENV=staging`: variable nueva, **exclusiva de este plan**, separada de `NODE_ENV` a
    propósito (porque `NODE_ENV` tiene que quedar en `"production"` por el punto de arriba).
    Es la que usa `script/seed-staging.ts` para saber que tiene permiso de tocar la base —
    nunca se setea en el servicio de producción real.
  - `SESSION_SECRET`: propio de staging, distinto al de producción.
  - Credenciales de Mercado Pago: las **TEST** (`TEST-...`), nunca las de producción — ver
    sección siguiente.
  - `RESEND_API_KEY` / `EMAIL_FROM`: si se quiere probar el flujo de recuperación de
    contraseña en staging, o una clave de test de Resend si existe, o dejarlas sin setear
    (el envío de mail simplemente no va a andar, sin romper el resto de la app).
  - **`TEST_DATABASE_URL`: NUNCA tiene que existir en ningún servicio de Railway, ni en
    staging ni en producción.** Es exclusiva de los tests que corren en la máquina local
    (`vitest`, que fija `NODE_ENV=test` antes de usarla). `storage.ts`/`session.ts`/`app.ts`
    exigen `NODE_ENV=test` ADEMÁS de esta variable para elegir la base de test
    (`shouldUseTestDatabase()`, ver `server/test-db-guard.ts`) — como `NODE_ENV` en Railway
    siempre es `production` (ver el punto de arriba), esta segunda señal ya alcanza para que
    agregarla ahí por error no tenga ningún efecto. Aun así, antes de cada deploy conviene
    confirmarla ausente en el panel de variables del servicio.
- Auto-deploy desde la rama `staging` de este mismo repo (configurable en el servicio de
  Railway, igual que ya está configurado el de producción apuntando a `main`).

### Supabase — chequeo del plan (pendiente de confirmar a mano)

No tengo acceso al dashboard de Supabase desde acá, así que este chequeo lo tenés que hacer
vos — pero dejo clara la lógica para que sea un chequeo de 2 minutos, no una investigación:

1. Entrá a tu proyecto de Supabase → **Settings → Billing** (o el ícono del plan arriba a la
   izquierda) y confirmá en qué plan está la base de **producción**.
2. **Si está en el plan Free**: Supabase Free no tiene "branching" (bases paralelas a partir de
   producción) ni backups automáticos restaurables con un clic. En ese caso, staging usa una
   base de Supabase **separada** (otro proyecto, también Free, no cuesta nada extra) poblada a
   partir de un `pg_dump` de producción:
   ```bash
   # Backup completo de producción (correr una sola vez para armar staging, y cada vez que
   # quieras refrescar los datos de staging con datos reales recientes — nunca al revés).
   pg_dump "$PRODUCTION_DATABASE_URL" --no-owner --no-privileges -Fc -f prod-backup.dump

   # Restaurar ese backup en el proyecto de Supabase de STAGING (nunca contra producción).
   pg_restore --no-owner --no-privileges -d "$STAGING_DATABASE_URL" --clean --if-exists prod-backup.dump
   ```
   Mismo criterio que ya se usa en `docs/migracion-deploy-2.md` para migrar producción: nunca
   se opera en vivo, siempre sobre una copia.
3. **Si está en el plan Pro (o superior)**: Supabase sí ofrece branching real (una base nueva,
   aislada, creada a partir de un snapshot de producción, con su propia connection string) —
   en ese caso usá esa función en vez del `pg_dump` manual de arriba; es más rápido y Supabase
   la mantiene actualizada por vos. El resto de este documento (variables de entorno, flujo,
   seed) no cambia, solo cambia cómo se originan los datos de la base de staging.
4. Cualquiera sea el plan: la base de staging **nunca** debe ser la misma instancia que la de
   producción, ni siquiera "por ahora" — <strong>ver `server/db.ts`</strong>, que ya tiene un
   aviso en el código justamente porque esto pasó una vez de verdad (Etapa I-C.1).

## Usuarios de prueba de Mercado Pago

Verificado contra la documentación oficial de Mercado Pago Developers (Argentina) antes de
escribir esto, no es de memoria — ver fuentes al final.

1. Entrá a [Mercado Pago Developers](https://www.mercadopago.com.ar/developers) → **Tus
   integraciones** → elegí (o creá) la aplicación de este proyecto.
2. Dentro de la aplicación, andá a la sección **Cuentas de prueba** → **Crear cuenta de
   prueba**.
3. Completá el alta:
   - **País**: el mismo para el usuario Comprador y el Vendedor (no se puede cambiar después).
   - **Etiqueta**: un nombre descriptivo (ej. "Vendedora — staging", "Compradora — staging")
     para distinguirlas en el panel.
   - **Tipo de cuenta**: `Vendedor` (para configurar credenciales/probar que cobrás) o
     `Comprador` (para probar el flujo de pago/suscripción como si fueras una consultora
     pagando). Para probar el flujo completo de este proyecto hacen falta las dos.
   - **Dinero ficticio (opcional)**: cargale saldo simulado al usuario Comprador si querés
     probar un pago que se cubra con saldo en cuenta en vez de tarjeta.
4. Al crear la cuenta, Mercado Pago genera automáticamente: User ID, usuario, contraseña y un
   código de 6 dígitos (por si pide verificación de mail al loguearte con esa cuenta de
   prueba) — quedan visibles en el panel, se pueden volver a consultar ahí.
5. **Límite**: hasta 15 cuentas de prueba simultáneas por aplicación, y **no se pueden
   borrar** — pensar los nombres/etiquetas para no tener que crear de más.
6. En el servicio de staging de Railway, seteá `MERCADOPAGO_ACCESS_TOKEN` con el Access Token
   **TEST** de esta aplicación (nunca el de producción) y `MERCADOPAGO_WEBHOOK_SECRET` con el
   secreto del webhook que configures para ese mismo dominio de staging (nombres confirmados
   contra `server/mercadopago.ts`).
7. Para simular un pago con tarjeta en staging, usá una tarjeta de prueba, por ejemplo (Visa
   débito): número `4002 7686 9439 5619`, código de seguridad `123`, vencimiento `11/30`. El
   **resultado** del pago lo decide el nombre que le pongas al titular de la tarjeta al pagar,
   no la tarjeta en sí — algunos de los más usados: `APRO` (aprobado), `OTHE` (rechazado, error
   general), `CONT` (pendiente), `FUND` (rechazado, fondos insuficientes), `SECU` (rechazado,
   código de seguridad inválido), `EXPI` (rechazado, vencimiento inválido). DNI de prueba para
   Argentina: `12345678`.

Fuentes (Mercado Pago Developers, Argentina):
- [Cuentas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/resources/test-accounts)
- [Tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/test-cards)

## Seed de staging

`script/seed-staging.ts` crea una cuenta de consultora de prueba para poder entrar a la app
recién desplegada en staging sin usar una cuenta ni datos reales. Es el único script de este
plan que puede escribir en una base — por eso tiene **tres** guardas explícitas, las tres
obligatorias (ninguna alcanza por sí sola), y se niega a correr si falta cualquiera:

- `APP_ENV` tiene que ser exactamente `staging` (la variable propia de este plan — ver arriba
  por qué no se usa `NODE_ENV` para esto).
- `SEED_CONFIRM` tiene que ser exactamente `yes` — una confirmación explícita aparte, para que
  nadie lo corra sin querer por tener el comando copiado de otra terminal/sesión.
- **La base misma tiene que decir que es de staging**: una fila en la tabla `staging_marker`
  con `value = 'staging'`. Esta es la guarda más fuerte de las tres, porque no depende de
  ninguna variable de entorno de quien corre el comando (que se puede pisar o copiar mal) sino
  de un dato que vive en la base de destino — si alguien corre el script apuntando por error a
  otra base (por un `DATABASE_URL` mal copiado, por ejemplo), esa base no va a tener la fila y
  el script se va a negar igual, aunque las dos variables de entorno estén bien puestas.

### Marcar la base de staging (una sola vez, a mano)

Al armar el entorno de staging (sea con `pg_restore` o con un branch de Supabase, ver arriba),
antes de poder usar `seed:staging` por primera vez, correr esto UNA sola vez contra esa base:

```sql
CREATE SCHEMA IF NOT EXISTS ops;
CREATE TABLE IF NOT EXISTS ops.staging_marker (
  id serial PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ops.staging_marker (value) VALUES ('staging');
```

**Nunca** agregar `ops.staging_marker` a `shared/schema.ts` ni a ninguna migración de Drizzle
— si quedara declarada ahí, `db:push`/`db:generate` la terminarían creando también contra
producción (donde, por definición, nunca tiene que existir esta tabla). Se crea siempre a mano,
fuera del esquema versionado, exactamente una vez por base de staging.

**Por qué el schema `ops` y no `public`**: lo probé primero en `public` y encontré un problema
real — `drizzle-kit push` por default introspecciona TODO lo que hay en `public`, vea o no una
tabla en `shared/schema.ts`. Con el marcador en `public.staging_marker`, correr `push` (incluso
sin `--force`) proponía **borrarlo** ("You're about to delete staging_marker table"), porque no
está declarado en el esquema versionado — y lo mismo le pasaba a `session` (ver más abajo). La
solución para `session` es excluirla por nombre (`tablesFilter`, ya hecho en
`drizzle.config.ts`); para el marcador, que no necesita vivir junto a las tablas de la app, es
más simple todavía: un schema de Postgres aparte. El `schemaFilter` de `drizzle-kit` por
default solo mira `public`, así que algo en `ops` queda directamente invisible para `push` —
nunca va a aparecer como "sobrante" ni se va a proponer borrarlo, sin necesidad de mantener
ninguna lista de exclusiones. Confirmado probándolo: con el marcador en `ops`, `push` da
"No changes detected".

### `drizzle-kit push` y la tabla `session` — por qué nunca se usa contra producción

Mientras armaba esto encontré otro caso del mismo problema, más serio porque sí puede pasar en
cualquier entorno, no solo en staging: la tabla `session` (la crea `connect-pg-simple` en
tiempo de ejecución — ver `server/session.ts` — nunca vive en `shared/schema.ts` a propósito,
porque Drizzle no tiene nada que decir sobre cómo guarda sesiones una librería de terceros).
Reproducido contra una base local: arranqué la app una vez (quedó creada `session`, con una
sesión real adentro) y corrí `drizzle-kit push` **sin** `--force` — avisó
"You're about to delete session table" antes de pedir confirmación. Con `--force` lo haría
directo, sin preguntar. Borrar `session` en producción cierra la sesión de **todas** las
consultoras de una — no es un error cosmético, es un incidente.

Arreglado en `drizzle.config.ts`/`drizzle.config.test.ts` con `tablesFilter: ["!session"]` —
confirmado de nuevo con el fix puesto: "No changes detected", con `session` y
`ops.staging_marker` presentes en la base. Pero esa protección vive en el **repo**, no en la
base — si alguien corre `push` desde una copia vieja del código, el riesgo vuelve. Por eso la
regla real para producción es más simple y no depende de ningún filtro:
**`drizzle-kit push` (con o sin `--force`) nunca se corre contra producción, bajo ningún
motivo** — ni `docs/migracion-produccion-pendiente.md` ni `docs/migracion-deploy-2.md` lo usan
en ningún paso (confirmado leyendo los dos: son SQL puro de punta a punta), y tiene que seguir
así. `db:push` es una herramienta de desarrollo/test/staging, nunca de producción.

Si alguna vez se recrea la base de staging desde cero (otro `pg_restore`, otro branch de
Supabase), hay que volver a correr este SQL — es intencional: una base "nueva" no debería
heredar el marcador de la vieja sin que alguien confirme a mano que la nueva sigue siendo de
staging y no, por error, una restauración apuntada al lugar equivocado.

```bash
APP_ENV=staging SEED_CONFIRM=yes SEED_USERNAME=consultora_staging SEED_PASSWORD="algo-largo-y-random" npm run seed:staging
```

Es idempotente: si la cuenta ya existe, no crea otra ni rompe nada, solo avisa. Una vez
logueado con esa cuenta en staging, para cargarle un catálogo de productos de prueba alcanza
con usar el botón que ya existe en la app: Stock → "Cargar catálogo de prueba" (no hace falta
que el script lo haga también — es un click, y así se prueba ese botón de paso).

## Checklist antes de promover staging → main

- [ ] El Prompt correspondiente pasó su checklist de pruebas (`docs/pruebas-prompt-*.md`)
      contra staging, no solo contra `localhost`.
- [ ] Si el Prompt toca notificaciones push: probado con HTTPS real y un teléfono físico.
- [ ] Si el Prompt toca pagos/suscripciones: probado con las cuentas y tarjetas de prueba de
      Mercado Pago de esta sección, con al menos un caso aprobado y uno rechazado.
- [ ] Sin errores en la consola del navegador ni en los logs de Railway del servicio de
      staging durante las pruebas.
- [ ] Si el Prompt trae una migración de base: ya se probó el runbook completo contra la base
      de staging (chequeo previo → SQL → chequeo posterior), siguiendo el mismo documento de
      migración que se va a usar después contra producción real.
- [ ] Tu OK explícito, puntual para este merge — no vale un OK de una tarea anterior.
