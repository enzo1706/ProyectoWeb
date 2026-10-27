/**
 * Seed de staging — carga datos de PRUEBA inventados (nunca reales) para poder recorrer los
 * checklists de `docs/pruebas-*.md` contra staging. Ver `docs/staging.md`.
 *
 * Tres guardas obligatorias, ninguna alcanza por sí sola (ninguna de las tres se da en el
 * servicio de producción real, así que ahí este script siempre se niega a correr):
 * - APP_ENV debe ser exactamente "staging".
 * - SEED_CONFIRM debe ser exactamente "yes".
 * - La BASE misma tiene que decir que es de staging: una fila en `ops.staging_marker` con
 *   value = 'staging' (se crea a mano, una sola vez, ver docs/staging.md).
 *
 * Por qué existen dos pasos (`SEED_STEP`) en vez de uno: staging ahora se arma VACÍA y se le
 * aplican los mismos documentos de migración que a producción, en el mismo orden (ver
 * docs/staging.md). Este script usa el código y el `shared/schema.ts` VIGENTES en la rama
 * desde la que se corre — por eso no puede correr ANTES de migracion-produccion-pendiente.md
 * (el código de esta rama ya espera esas columnas; sin ellas, hasta una consulta sin nada que
 * ver con lo nuevo rompería — ver la advertencia de "por qué esto es urgente" en
 * docs/migracion-produccion-pendiente.md). El "esquema de 20c8d83" en sí se materializa aparte,
 * con el código de ESE commit (ver docs/staging.md) — este script entra recién después,
 * cuando ya hay algo que lo sepa leer:
 *
 *   SEED_STEP=baseline       (default) — DESPUÉS de migracion-produccion-pendiente.md, ANTES
 *                            de publicar deploy-paquete-1. Todo lo que ya es posible en ese
 *                            punto: consultora + clientas (todas con celular — `clients.phone`
 *                            sigue NOT NULL hasta el Prompt 9) + cumpleaños + productos con/sin
 *                            stock/costo + ventas a cuotas (vencida/pagada/con pago parcial) +
 *                            el día de pedido (Prompt 1) + una segunda cuenta en el plan
 *                            gratis cerca del límite.
 *   SEED_STEP=after-deploy2 — DESPUÉS de migracion-deploy-2.md, ANTES de publicar la rama
 *                            `staging`. Lo que recién se vuelve posible ahí: una clienta SIN
 *                            celular y una venta SIN clienta (los dos del Prompt 6/9).
 *
 * Es idempotente: cada paso revisa si ya corrió (por nombre fijo de los datos que crea) antes
 * de escribir nada.
 *
 * Uso:
 *   APP_ENV=staging SEED_CONFIRM=yes SEED_USERNAME=... SEED_PASSWORD=... npm run seed:staging
 *   APP_ENV=staging SEED_CONFIRM=yes SEED_STEP=after-deploy2 npm run seed:staging
 */
import "../server/load-env";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";

async function isDatabaseMarkedAsStaging(): Promise<boolean> {
  try {
    const { db } = await import("../server/db");
    const result = await db.execute(sql`SELECT value FROM ops.staging_marker ORDER BY id LIMIT 1`);
    const row = result.rows[0] as { value?: string } | undefined;
    return row?.value === "staging";
  } catch {
    // Tabla inexistente, sin permisos, o cualquier otro error al leerla: nunca se asume "sí es
    // staging" por defecto — negarse de más es el lado seguro.
    return false;
  }
}

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Cumpleaños dentro del mes actual (día fijo 10), para que el checklist de "cumple este mes"
 * tenga algo que mostrar sin importar cuándo se corra el seed. Año fijo 1990 — no importa para
 * nada del negocio, solo para que el campo no quede vacío. */
function birthdayThisMonth(): string {
  const month = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  return `1990-${month}-10`;
}

// ---------------------------------------------------------------------------
// SEED_STEP=baseline — después de migracion-produccion-pendiente.md.
// ---------------------------------------------------------------------------

async function seedBaseline(username: string, password: string): Promise<void> {
  const existing = await storage.getUserByUsername(username);
  if (existing && existing.consultantId) {
    const existingClients = await storage.searchClientsPaginated(existing.consultantId, { page: 1, pageSize: 1 });
    if (existingClients.items.length > 0) {
      console.log(`"${username}" ya tiene datos de prueba cargados (baseline) — no se tocó nada (idempotente).`);
      return;
    }
  }

  const user = existing ?? (await storage.createUser({ username, password, role: "consultant", status: true }));
  const consultantId = user.consultantId!;
  console.log(`Consultora de prueba "${username}" (consultantId=${consultantId}) lista.`);

  // Clientas — todas CON celular (clients.phone sigue NOT NULL en este esquema; "sin celular"
  // se agrega en SEED_STEP=after-deploy2). Una con cumpleaños este mes.
  const clienteConCumple = await storage.createClient(consultantId, {
    name: "Clienta Demo Cumpleaños",
    phone: "2611000001",
    birthday: birthdayThisMonth(),
  } as never);
  const clienteB = await storage.createClient(consultantId, { name: "Clienta Demo B", phone: "2611000002" } as never);
  const clienteC = await storage.createClient(consultantId, { name: "Clienta Demo C", phone: "2611000003" } as never);
  console.log("3 clientas de prueba creadas.");

  // Productos: uno con stock Y costo cargado, uno con stock pero SIN costo, uno SIN stock.
  const productoConCosto = await storage.createProduct(consultantId, {
    seccion: "Maquillaje",
    producto: "Labial Demo (con costo)",
    precio: 2000000, // $20.000 en centavos
    unidades: 10,
  });
  await storage.applyProductDiscount(consultantId, productoConCosto.id, 35);

  const productoSinCosto = await storage.createProduct(consultantId, {
    seccion: "Cuidado de la piel",
    producto: "Crema Demo (sin costo)",
    precio: 1500000,
    unidades: 5,
  });
  void productoSinCosto;

  const productoSinStock = await storage.createProduct(consultantId, {
    seccion: "Fragancias",
    producto: "Perfume Demo (sin stock)",
    precio: 3000000,
    unidades: 0,
  });
  void productoSinStock;
  console.log("3 productos de prueba creados (con costo / sin costo / sin stock).");

  // Venta con una cuota VENCIDA (fecha hace 20 días, 1 sola cuota, queda pendiente).
  await storage.createSale(consultantId, {
    clientId: clienteB.id,
    date: todayMinusDays(20),
    items: [{ productId: productoConCosto.id, quantity: 1 }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments: [{ amount: 2000000 }],
  } as never);

  // Venta con una cuota PAGADA (hoy, 1 sola cuota, se marca pagada después de crearla).
  const salePagada = await storage.createSale(consultantId, {
    clientId: clienteC.id,
    date: todayStr(),
    items: [{ productId: productoSinCosto.id, quantity: 1 }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "transferencia",
    installments: [{ amount: 1500000 }],
  } as never);
  const pagadaDetails = await storage.getSaleDetails(consultantId, salePagada.id);
  if (pagadaDetails?.installments[0]) {
    await storage.updateInstallmentStatus(consultantId, salePagada.id, pagadaDetails.installments[0].id, "pagado");
  }

  // Venta a 3 cuotas con PAGO PARCIAL: fecha hace 50 días + frecuencia mensual -> la 1ª y 2ª
  // cuota caen en el pasado, la 3ª en el futuro. Se marca pagada solo la 1ª -> "le debe" el
  // resto, con una cuota vencida de las que quedan pendientes.
  const saleParcial = await storage.createSale(consultantId, {
    clientId: clienteConCumple.id,
    date: todayMinusDays(50),
    items: [{ productId: productoSinStock.id === productoSinStock.id ? productoConCosto.id : productoConCosto.id, quantity: 1 }],
    orderDiscount: null,
    orderSurcharge: null,
    paymentMethod: "efectivo",
    installments: [{ amount: 666666 }, { amount: 666667 }, { amount: 666667 }],
    installmentFrequency: "mensual",
  } as never);
  const parcialDetails = await storage.getSaleDetails(consultantId, saleParcial.id);
  const firstInstallment = parcialDetails?.installments.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (firstInstallment) {
    await storage.updateInstallmentStatus(consultantId, saleParcial.id, firstInstallment.id, "pagado");
  }
  console.log("3 ventas de prueba creadas (cuota vencida / cuota pagada / venta a cuotas con pago parcial).");

  // Día de pedido (Prompt 1) — la columna ya existe porque este paso corre después de
  // migracion-produccion-pendiente.md.
  const settings = await storage.getBusinessSettings(consultantId);
  if (settings && settings.orderReminderDay1 === null) {
    await storage.updateBusinessSettings(consultantId, {
      businessName: settings.businessName,
      currency: settings.currency,
      orderReminderDay1: new Date().getUTCDate(),
    } as never);
    console.log(`Día de pedido configurado (hoy, día ${new Date().getUTCDate()}).`);
  }

  // Segunda cuenta, aparte: plan gratis cerca del límite de 10 productos (9 con stock).
  const freePlanUsername = `${username}_plangratis`;
  const existingFreePlan = await storage.getUserByUsername(freePlanUsername);
  if (!existingFreePlan) {
    const freePlanUser = await storage.createUser({ username: freePlanUsername, password, role: "consultant", status: true });
    const freePlanConsultantId = freePlanUser.consultantId!;
    for (let i = 1; i <= 9; i++) {
      await storage.createProduct(freePlanConsultantId, {
        seccion: "Maquillaje",
        producto: `Producto plan gratis ${i}`,
        precio: 1000000,
        unidades: 1,
      });
    }
    console.log(`Cuenta "${freePlanUsername}" creada, plan gratis con 9 de 10 productos (cerca del límite).`);
  } else {
    console.log(`"${freePlanUsername}" ya existe — no se tocó (idempotente).`);
  }
}

// ---------------------------------------------------------------------------
// SEED_STEP=after-deploy2 — después de migracion-deploy-2.md (Prompt 6/9: clientId opcional en
// una venta, clients.phone nullable). Las dos líneas marcadas abajo usan un cast a propósito:
// en el esquema de ESTE branch (anterior a esos Prompts) el tipo exige ambos campos, pero este
// paso solo se corre una vez que la base YA tiene la migración aplicada y el código vigente en
// ese momento (de la rama `staging`) ya acepta los dos como opcionales — el cast es seguro
// porque nunca se invoca antes de ese punto del plan (ver docs/staging.md).
// ---------------------------------------------------------------------------

async function seedAfterDeploy2(username: string): Promise<void> {
  const user = await storage.getUserByUsername(username);
  if (!user?.consultantId) {
    console.error(`No existe "${username}" — corré primero SEED_STEP=baseline.`);
    process.exitCode = 1;
    return;
  }
  const consultantId = user.consultantId;

  // Dos chequeos de idempotencia INDEPENDIENTES — no uno solo: si una corrida anterior llegó a
  // crear la clienta pero se cayó antes de crear la venta (pasó de verdad armando este script:
  // la venta sin clienta exige quedar cobrada entera, y faltaba `paidNow` — ver más abajo), una
  // corrida posterior tiene que notar que la venta todavía falta y crearla, no asumir que
  // "ya existe la clienta" significa "ya se hizo todo este paso".
  const { items: clients } = await storage.searchClientsPaginated(consultantId, { page: 1, pageSize: 100 });
  const clientWithoutPhoneExists = clients.some((c) => c.name === "Clienta Demo Sin Celular");
  if (clientWithoutPhoneExists) {
    console.log('"Clienta Demo Sin Celular" ya existe — no se tocó (idempotente).');
  } else {
    await storage.createClient(consultantId, { name: "Clienta Demo Sin Celular", phone: null } as never);
    console.log("Clienta sin celular creada.");
  }

  const existingSales = await storage.getAllSales(consultantId);
  const saleWithoutClientExists = existingSales.some((s) => s.clientId === null);
  if (saleWithoutClientExists) {
    console.log("Ya hay una venta sin clienta — no se tocó (idempotente).");
    return;
  }

  const products = await storage.getAllProducts(consultantId);
  const anyProduct = products.find((p) => p.unidades > 0);
  if (anyProduct) {
    // Prompt 6: una venta sin clienta solo se puede guardar si queda cobrada ENTERA al
    // crearla (nadie a quien reclamarle después) — `paidNow: true` marca la única cuota como
    // "pagado" desde el vamos, no alcanza con crearla pendiente y marcarla pagada después
    // (la validación corre adentro de createSale, antes de que exista la fila — encontrado
    // corriendo esto de verdad contra una base con el esquema completo, 2026-10-27).
    await storage.createSale(consultantId, {
      date: todayStr(),
      items: [{ productId: anyProduct.id, quantity: 1 }],
      orderDiscount: null,
      orderSurcharge: null,
      paymentMethod: "efectivo",
      installments: [{ amount: anyProduct.precio }],
      paidNow: true,
    } as never);
    console.log("Venta sin clienta creada.");
  } else {
    console.log("No había ningún producto con stock para la venta sin clienta — revisar el baseline.");
  }
}

async function main() {
  if (process.env.APP_ENV !== "staging") {
    console.error(
      `Este script solo corre con APP_ENV=staging. No se tocó la base. (APP_ENV actual: ${process.env.APP_ENV ?? "undefined"})`,
    );
    process.exitCode = 1;
    return;
  }

  if (process.env.SEED_CONFIRM !== "yes") {
    console.error("Falta la confirmación explícita: corré de nuevo con SEED_CONFIRM=yes. No se tocó la base.");
    process.exitCode = 1;
    return;
  }

  if (!(await isDatabaseMarkedAsStaging())) {
    console.error(
      'La base no tiene el marcador de staging (tabla "ops.staging_marker" con una fila value=\'staging\'). ' +
        "No se tocó la base. Ver docs/staging.md — \"Marcar la base de staging\" para crearlo a mano, una sola vez.",
    );
    process.exitCode = 1;
    return;
  }

  const step = process.env.SEED_STEP ?? "baseline";
  const username = process.env.SEED_USERNAME ?? "consultora_staging";

  if (step === "baseline") {
    const password = process.env.SEED_PASSWORD;
    if (!password || password.length < 8) {
      console.error("Falta SEED_PASSWORD (al menos 8 caracteres). No se tocó la base.");
      process.exitCode = 1;
      return;
    }
    await seedBaseline(username, password);
    console.log('Para cargarle productos del catálogo global de prueba: Stock → "Cargar catálogo de prueba".');
  } else if (step === "after-deploy2") {
    await seedAfterDeploy2(username);
  } else {
    console.error(`SEED_STEP inválido: "${step}". Usá "baseline" o "after-deploy2".`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("No se pudo correr el seed de staging:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
