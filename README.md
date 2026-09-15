# MaryKayManager

Aplicación web de gestión para consultoras independientes de venta directa (inventario, clientas, ventas, agenda, reportes financieros y suscripción del servicio). Multi-tenant: cada consultora es un tenant aislado (`consultantId`), con un rol de administrador separado para gestión del catálogo global y las suscripciones.

## Estado actual

- Etapas funcionales 7.1 a 7.9 cerradas y en producción (commit `3b42003`).
- Backend real sobre PostgreSQL (Supabase en producción), no hay datos mock.
- Autenticación por sesión, roles `admin`/`consultant`, multi-tenant.
- Suscripciones mensuales con Mercado Pago (PreApproval) ya implementadas y en uso.
- WhatsApp (link directo `wa.me` a la clienta) implementado y funcionando.
- Recuperación de contraseña implementada a nivel de código; el envío real de email (Resend) todavía no está configurado en producción — pendiente de definir el dominio de envío. Ver sección [Recuperación de contraseña](#recuperación-de-contraseña).
- PWA (instalable, manifest + iconos) sin service worker — no funciona offline.
- Suite de tests: 520/520 al momento de este commit, combinando `MemoryStorage` y PostgreSQL real.

## Stack tecnológico

**Frontend**: React 18 + TypeScript + Vite, Tailwind CSS + shadcn/ui (Radix), TanStack Query, wouter (routing), Recharts (gráficos de Reportes).

**Backend**: Node.js + Express + TypeScript, Drizzle ORM sobre PostgreSQL, `express-session` (store en Postgres vía `connect-pg-simple` en producción, en memoria en desarrollo), `bcryptjs`, `multer` (uploads), SDK oficial de `mercadopago`, SDK de `resend`.

**Testing**: Vitest. Dos modos: `MemoryStorage` (rápido, sin Postgres) y PostgreSQL real (para concurrencia, transacciones, constraints, tenant isolation).

**Infraestructura**: Railway (hosting), Supabase (PostgreSQL de producción), Docker (Postgres local de desarrollo y de test).

## Arquitectura general

Monolito: Express sirve tanto la API (`/api/*`) como el build estático del frontend (en producción). No hay CORS configurado porque todo es same-origin.

- **Multi-tenant**: casi toda entidad de negocio (`products`, `clients`, `sales`, `appointments`, etc.) tiene `consultantId`. Un usuario `admin` no tiene `consultantId` — administra el catálogo global y las suscripciones, nunca datos de una consultora puntual.
- **Storage**: interfaz `IStorage` con dos implementaciones — `DatabaseStorage` (Postgres real, la que corre en producción) y `MemoryStorage` (para tests rápidos y desarrollo sin Docker). `resolveStorageMode()` (`server/storage-mode.ts`) decide cuál se usa, y **bloquea explícitamente** que producción arranque en modo memoria.
- **Sesión**: cookie `httpOnly`, `secure` en producción, `sameSite: lax`, 7 días de duración.
- **Suscripción como gate**: middleware `requireActiveSubscription` (después de `requireAuth` + `requireConsultant`) protege los módulos de negocio (`/api/products`, `/api/clients`, `/api/sales`, `/api/appointments`, `/api/reports`, `/api/dashboard`). Nunca se aplica a `/api/auth/*`, `/api/subscription/*`, `/api/health` ni `/api/admin/*`.

## Estructura principal de carpetas

```
client/src/
  pages/          Una página por ruta (Dashboard, Productos, Clientas, Ventas, Agenda, Reportes, Subscription, auth/*, admin/*)
  components/     Componentes reutilizables (dialogs, cards, UI compartida)
  hooks/          React Query hooks, auth, carrito de venta, etc.
  lib/            Utilidades de cliente (fechas, moneda, queryClient)

server/
  routes.ts       Todos los endpoints HTTP (un solo archivo, por diseño del proyecto)
  storage.ts      DatabaseStorage + MemoryStorage, implementan IStorage
  db.ts           Pool de Postgres de PRODUCCIÓN/desarrollo (lee DATABASE_URL)
  test-db.ts      Pool de Postgres EXCLUSIVO de tests (lee TEST_DATABASE_URL, con guard)
  test-db-guard.ts  Guard que impide que un test toque la base real
  subscription.ts Cálculo de acceso (trial/activo/vencido) — única fuente de verdad
  mercadopago.ts  Integración con la API de Mercado Pago (PreApproval, webhook)
  email.ts        Abstracción de envío de email (Resend, con fallback de consola en dev)
  auth-reset.ts   Lógica de recuperación de contraseña
  middleware/     requireAuth, requireAdmin, requireActiveSubscription
  tests/          Suite completa (memoria + Postgres real)

shared/
  schema.ts       Definición de tablas Drizzle + schemas Zod de validación (fuente de verdad del modelo de datos)
  saleCalculations.ts  Fórmulas financieras (subtotal, descuento, recargo, profit, COGS)
  clientFilters.ts, phone.ts, stockAlerts.ts, etc.  Lógica compartida cliente/servidor

script/    Scripts one-off (bootstrap de admin, backfills históricos, build, push de schema a test)
docs/      Documentación técnica puntual (ver docs/TESTING_POSTGRES.md)
drizzle/   Migraciones generadas por `drizzle-kit generate` — ver advertencia en la sección de Base de Datos
```

## Requisitos previos

- Node.js ≥ 22 (ver `engines` en `package.json`)
- Docker Desktop (para Postgres local de desarrollo y de test)
- Una cuenta de Supabase solo si vas a tocar producción (no hace falta para desarrollar)

## Instalación local

```bash
npm install
```

Después configurá tu `.env` (ver siguiente sección) y levantá el Postgres local:

```bash
npm run db:dev:up      # levanta el contenedor de Postgres de desarrollo (puerto 55432)
npm run db:push        # aplica el schema actual (drizzle-kit push) contra ese Postgres
npm run dev             # levanta la app en http://localhost:5000
```

## Variables de entorno

`.env.example` está trackeado en el repo como referencia de nombres — **nunca contiene valores reales**. Esta lista sale de una revisión directa del código (`process.env.*`), no del contenido de `.env.example` (no se pudo confirmar en esta etapa si está completo, ver advertencia al final de esta sección).

| Variable | Para qué sirve | ¿Obligatoria? |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production`. Controla guards de seguridad reales (ver más abajo) — no es solo informativa. | Sí |
| `PORT` | Puerto HTTP. Railway lo asigna solo; local default `5000` si no está seteada. | No (default 5000) |
| `DATABASE_URL` | Conexión a Postgres de desarrollo/producción. En producción es Supabase; en local, tu contenedor Docker de `docker-compose.dev.yml`. **Nunca debe ser la misma base entre tu máquina y producción** (ver advertencia histórica más abajo). | Sí (salvo `DATABASE_MODE=memory`) |
| `DATABASE_MODE` | `memory` o `postgres`. Fuerza el backend de storage. **Bloqueado a `postgres` en producción** — no se puede arrancar producción en memoria ni por error. | No (se infiere de `DATABASE_URL` si falta) |
| `TEST_DATABASE_URL` | Conexión al Postgres DEDICADO de test (contenedor aparte, puerto `55433`). Nunca la misma base que `DATABASE_URL`. | Solo para correr los tests que usan Postgres real |
| `SESSION_SECRET` | Secreto de firma de las cookies de sesión (`express-session`). El proceso no arranca sin esto. | Sí |
| `SUPABASE_URL` | URL del proyecto Supabase, usada para subir imágenes de producto a Supabase Storage. | Sí (para el módulo de imágenes) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase, mismo propósito que la anterior. | Sí (para el módulo de imágenes) |
| `MERCADOPAGO_ACCESS_TOKEN` | Access token de la cuenta de Mercado Pago que cobra las suscripciones. | Sí (para que funcione el módulo de suscripciones) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secreto para validar la firma HMAC del webhook de Mercado Pago. | Sí (para que funcione el módulo de suscripciones) |
| `RESEND_API_KEY` | API key de Resend, para enviar el email de recuperación de contraseña. **No configurada todavía en producción** — sin ella, el envío falla explícitamente (nunca en silencio) y el resto de la app sigue funcionando normal. | No (la app funciona sin ella; solo afecta recuperación de contraseña) |
| `EMAIL_FROM` | Dirección remitente para Resend — debe ser de un dominio verificado en la cuenta de Resend. Obligatoria únicamente si `RESEND_API_KEY` está configurada. | No (ver arriba) |

**Advertencia sobre esta lista**: no pude leer el contenido real de `.env.example` en esta etapa (restricción de permisos del entorno de trabajo, no del proyecto). Si falta documentar alguna variable ahí, o si tiene nombres que no coinciden con esta tabla, avisen para corregirlo — esta tabla está armada contra el código real (`process.env.*` en `server/`), que es la fuente de verdad más confiable.

## Desarrollo, tests y producción — diferencias clave

| | Desarrollo | Tests | Producción |
|---|---|---|---|
| `NODE_ENV` | `development` (o sin setear) | `test` | `production` |
| Base de datos | Postgres local, `docker-compose.dev.yml`, puerto `55432` | Postgres local dedicado, `docker-compose.test.yml`, puerto `55433` — o `MemoryStorage` | Supabase (Postgres real) |
| Variable de DB | `DATABASE_URL` | `TEST_DATABASE_URL` (nunca `DATABASE_URL`) | `DATABASE_URL` |
| Admin por defecto | Se crea automático (`admin`/`admin123`) si no existe | Se crea automático (mismos tests lo usan) | **Nunca se crea** — bloqueado explícitamente por `NODE_ENV==="production"` |
| Cookies | `secure: false` | — | `secure: true` |

## Base de datos

### Local (desarrollo)

Contenedor Docker dedicado (`docker-compose.dev.yml`, container `marykaymanager-dev-db`, puerto `55432`, datos persistentes en un volumen nombrado). Existe específicamente porque, en el pasado, el `DATABASE_URL` local y el de producción en Railway llegaron a ser la misma base — este contenedor es la separación real, no solo una recomendación.

```bash
npm run db:dev:up      # levanta el contenedor
npm run db:push        # aplica shared/schema.ts contra DATABASE_URL (drizzle-kit push)
npm run db:dev:down    # lo apaga (los datos quedan, hay volumen)
```

### De tests

Contenedor Docker completamente aparte (`docker-compose.test.yml`, puerto `55433`, datos efímeros — no hace falta "limpiarlo"). Protegido por `server/test-db-guard.ts`, que exige `TEST_DATABASE_URL` (nunca `DATABASE_URL`) y dos señales estructurales independientes sobre esa variable: host loopback (`localhost`/`127.0.0.1`) y nombre de base terminado en `_test`. Si falta o no cumple esas condiciones, los tests que necesitan Postgres real fallan de inmediato con un error claro, antes de intentar conectarse a nada.

```bash
npm run db:test:up      # levanta el contenedor
npm run db:test:push    # aplica el schema contra TEST_DATABASE_URL
npm run db:test:down    # lo apaga
```

Ver `docs/TESTING_POSTGRES.md` para más detalle.

### Estrategia de schema — importante

El proyecto usa **`drizzle-kit push`** (diff directo contra la base, sin archivos de migración) como flujo real y vigente — es lo que corren `npm run db:push` y `npm run db:test:push`. `package.json` también tiene `db:generate`/`db:migrate` (que sí generan archivos en `drizzle/`), pero esa carpeta quedó desactualizada respecto al schema actual — no reflejes cambios recientes de `shared/schema.ts` ahí sin confirmar primero que es el flujo que se va a seguir usando.

**Producción no tiene migración automática en el pipeline de deploy** — Railway solo hace `npm run build` + `node dist/index.cjs`, nunca corre `db:push` ni nada de Drizzle. Cualquier cambio de schema necesita aplicarse a Supabase producción **manualmente y por separado**, después de confirmar que coincide exactamente con `shared/schema.ts`.

## Cómo ejecutar la aplicación

```bash
npm run dev      # desarrollo, con recarga (tsx + Vite)
npm run build    # build de producción (frontend con Vite, backend con esbuild vía script/build.ts)
npm start        # corre el build de producción (node dist/index.cjs) — requiere haber corrido build antes
```

## Cómo ejecutar tests

```bash
npm test
```

Corre toda la suite (Vitest): los tests de `MemoryStorage` no necesitan nada más; los que requieren Postgres real (concurrencia, tenant isolation profundo, sesión real) necesitan `TEST_DATABASE_URL` seteada y el contenedor de test levantado (ver sección de Base de Datos). Si falta, esos tests puntuales fallan con un mensaje explícito — el resto de la suite sigue corriendo igual.

## Cómo ejecutar typecheck

```bash
npm run check
```

## Cómo ejecutar build

```bash
npm run build
```

## Railway (producción)

- Servicio conectado al repo de GitHub, rama `main` — cada push a `main` dispara un deploy.
- Build command: `npm run build`. Start command: `node dist/index.cjs`.
- Health check: `GET /api/health` (verifica conexión real a Postgres, público, sin credenciales expuestas en la respuesta).
- Variables de entorno configuradas directamente en Railway (nunca en el repo) — ver tabla de la sección anterior para saber cuáles son.
- El proceso maneja `SIGTERM`/`SIGINT` con cierre controlado (deja de aceptar conexiones nuevas, espera las que están en curso, recién ahí cierra el pool de Postgres) — compatible con cómo Railway redeploya.

## Supabase (producción)

- Postgres real de producción, accedido vía `DATABASE_URL`.
- También se usa como storage de archivos (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) para las imágenes de producto.
- **El schema de Supabase producción se mantiene sincronizado manualmente** con `shared/schema.ts` — no hay ningún paso automático que lo haga. Antes de asumir que una columna/tabla nueva ya existe en producción, confirmarlo explícitamente (por ejemplo contra `information_schema`, nunca asumiendo que el deploy del código ya implica el cambio de base).

## Sistema de autenticación

Sesión de servidor (`express-session`), passwords con `bcryptjs`. Login, registro público, recuperación de contraseña por código de 6 dígitos (hash bcrypt, expira a los 10 minutos, un solo uso, máximo 5 intentos), y protecciones anti-enumeración (mismo tiempo de respuesta y mismo mensaje genérico exista o no la cuenta, tanto en login como en recuperación).

## Roles

- **`consultant`**: dueña de un tenant (`consultantId` propio). Ve y opera solo sus propios datos.
- **`admin`**: sin `consultantId`. Administra el catálogo global de productos y el panel de suscripciones/pagos de todas las consultoras. Nunca pasa por `requireActiveSubscription`.

## Multi-tenancy

El aislamiento es por `consultantId` en cada tabla de negocio, derivado siempre de la sesión autenticada — nunca aceptado desde el body/query de un request. Verificado extensamente en la suite de tests (aislamiento cruzado entre tenants, IDOR, agregados).

## Principales módulos funcionales

### Importación de productos/pedidos

Carga desde Excel/CSV (catálogo) y PDF (pedidos, con matching de nombres fragmentados). La confirmación de stock de un pedido completo es una única operación transaccional (todo o nada) — nunca queda una importación aplicada a medias.

### Sistema de stock

`product_stock` por consultora y producto (separado del catálogo, que puede ser compartido). Descuenta/restaura con locks (`FOR UPDATE`) en creación, edición y cancelación de ventas. Productos discontinuados: bloquean venta nueva, pero permiten seguir recibiendo stock (reponer ≠ vender) y siguen siendo válidos en ventas históricas ya registradas.

### Ventas / cuotas

Fórmula financiera fija: `total = max(0, subtotal - descuento + recargo + envío cobrado)`, `profit = total - COGS - costo real de envío`. El costo (COGS) de cada línea de venta es un snapshot histórico (`sale_items.costPrice`) — nunca se reconstruye con el costo actual del producto. Una venta con alguna cuota ya pagada no puede editarse.

### Reportes

Mismas fuentes de verdad que Ventas/SaleDetail (nunca una fórmula financiera paralela). Diferencia explícitamente facturación (lo vendido) de dinero efectivamente cobrado (cuotas pagadas).

### Suscripciones / Mercado Pago

Un único plan mensual, 10 días de prueba gratis, cobro recurrente vía Mercado Pago PreApproval (no Checkout Pro). El webhook siempre reconsulta el pago real contra la API de Mercado Pago antes de otorgar acceso — nunca confía en el payload recibido. El acceso de cada consultora se recalcula en cada request a partir de las fechas guardadas, nunca de un valor cacheado.

### Recuperación de contraseña

Implementada completa a nivel de código (ver Sistema de autenticación). El envío real del email depende de `RESEND_API_KEY`/`EMAIL_FROM`, todavía sin configurar en producción — hasta que se configure, el pedido de recuperación responde igual (por diseño anti-enumeración) pero el email nunca llega. No es un bug de código, es una pieza de infraestructura pendiente.

### WhatsApp

Botón que arma un link `wa.me` a partir del teléfono de la clienta (normalizado) y abre la conversación en una pestaña nueva. No usa ninguna API de WhatsApp Business ni manda mensajes automáticos — es exclusivamente para que la consultora contacte a su propia clienta, no un canal de soporte del producto.

### PWA

Manifest + set de íconos + metadata para instalarse como app en el celular (`display: standalone`). No tiene service worker — no funciona offline, es solo instalabilidad.

## Consideraciones de seguridad importantes

- `NODE_ENV=production` no es solo informativo: controla si se crea el admin por defecto, si las cookies son `secure`, y otros comportamientos reales. Confirmar siempre que esté seteado correctamente en el entorno real.
- `DATABASE_MODE=memory` está bloqueado en producción a nivel de código — no se puede arrancar producción sin Postgres real, ni por error de configuración.
- Los tests de Postgres real nunca pueden tocar la base de producción — `test-db-guard.ts` lo hace estructuralmente imposible (ver sección de Base de Datos), no depende de que alguien recuerde configurarlo bien.
- Ningún log de la aplicación imprime passwords, códigos de recuperación, tokens de sesión, ni el Access Token de Mercado Pago — verificado explícitamente en varias etapas de auditoría.

## Flujo de desarrollo recomendado

1. `npm run db:dev:up` + `npm run db:push` (una vez, o después de tocar `shared/schema.ts`).
2. `npm run dev`.
3. Antes de dar algo por terminado: `npm run check`, `npm test` (con `TEST_DATABASE_URL` seteada si tocaste algo que necesite Postgres real), `npm run build`.
4. Nunca apuntar `DATABASE_URL` local a Supabase de producción — usar siempre el contenedor de `docker-compose.dev.yml`.

## Advertencias sobre producción

- **Nunca** correr `drizzle-kit push`/`db:push` contra el `DATABASE_URL` de producción sin una decisión explícita y controlada — no hay rollback automático de schema.
- **Nunca** usar la base de producción para correr tests, ni siquiera puntualmente.
- Un cambio en `shared/schema.ts` no se refleja solo en producción con el deploy del código — el schema de Supabase necesita actualizarse aparte, a mano, y verificarse antes de asumir que coincide.
- El admin por defecto (`admin`/`admin123`) nunca debe poder crearse en producción — depende de que `NODE_ENV` esté correctamente seteado como `production` en el hosting.

## Scripts adicionales

- `npm run create-admin` — crea un usuario admin de forma segura contra la base a la que apunte tu `DATABASE_URL` (`script/bootstrap-admin.ts`). Distinto del admin por defecto que se autocrea en desarrollo/test (`admin`/`admin123`) — usar este cuando necesites un admin real, con credenciales propias.
- `script/` tiene además otros scripts one-off ya usados en el pasado (backfills históricos, diagnóstico de Mercado Pago) — no forman parte del flujo normal de desarrollo, revisar cada uno antes de correrlo.

## Troubleshooting básico

- **`SESSION_SECRET must be set`** al arrancar: falta esa variable en tu `.env`.
- **`DATABASE_URL must be set`**: falta esa variable, o estás en modo que la requiere (no `DATABASE_MODE=memory`).
- **Tests de Postgres real fallan con `[test-db-guard] Falta TEST_DATABASE_URL...`**: seteá esa variable apuntando al contenedor de test (puerto `55433`), y confirmá que el contenedor esté levantado (`npm run db:test:up`).
- **`ECONNREFUSED` al correr tests o la app contra Postgres**: el contenedor Docker correspondiente no está levantado — `npm run db:dev:up` o `npm run db:test:up` según el caso.
- **Error de columna/tabla inexistente contra Postgres real**: el schema de esa base no está sincronizado con `shared/schema.ts` — correr `npm run db:push` (desarrollo) o `npm run db:test:push` (test). **Nunca** contra producción sin confirmarlo explícitamente antes.
- **La recuperación de contraseña "no llega"**: esperado mientras `RESEND_API_KEY`/`EMAIL_FROM` no estén configuradas — ver sección de Recuperación de contraseña.
