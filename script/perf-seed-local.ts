/**
 * Seed de volumen SOLO para medir rendimiento en local (Prompt 16) — nunca correr contra
 * staging/producción. Usa SQL directo (no pasa por storage.ts) porque el objetivo es volumen
 * de filas, no corrección de negocio. Idempotente a medias: borra lo que ya tenía este
 * consultantId antes de volver a insertar, para poder correrlo varias veces.
 */
import "../server/load-env";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const CONSULTANT_ID = Number(process.env.PERF_CONSULTANT_ID ?? 6);
const NUM_PRODUCTS = Number(process.env.PERF_PRODUCTS ?? 300);
const NUM_CLIENTS = Number(process.env.PERF_CLIENTS ?? 150);
const NUM_SALES = Number(process.env.PERF_SALES ?? 300);
const NUM_GLOBAL_CATALOG = Number(process.env.PERF_GLOBAL_CATALOG ?? 0);

async function main() {
  if (process.env.APP_ENV === "staging" || process.env.NODE_ENV === "production" && !process.env.DATABASE_URL?.includes("55432")) {
    console.error("Guarda de seguridad: este script es solo para la base de dev local (puerto 55432). Abortado.");
    process.exitCode = 1;
    return;
  }

  console.log(`Sembrando para consultantId=${CONSULTANT_ID}: ${NUM_PRODUCTS} productos, ${NUM_CLIENTS} clientas, ${NUM_SALES} ventas...`);

  await db.execute(sql`DELETE FROM sale_installments WHERE sale_id IN (SELECT id FROM sales WHERE consultant_id = ${CONSULTANT_ID})`);
  await db.execute(sql`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE consultant_id = ${CONSULTANT_ID})`);
  await db.execute(sql`DELETE FROM sales WHERE consultant_id = ${CONSULTANT_ID}`);
  await db.execute(sql`DELETE FROM client_payments WHERE consultant_id = ${CONSULTANT_ID}`);
  await db.execute(sql`DELETE FROM clients WHERE consultant_id = ${CONSULTANT_ID}`);
  await db.execute(sql`DELETE FROM product_stock WHERE consultant_id = ${CONSULTANT_ID}`);
  await db.execute(sql`DELETE FROM products WHERE consultant_id = ${CONSULTANT_ID}`);

  // Productos manuales (del consultant) con stock e imagen de prueba (misma URL repetida, no
  // importa para medir tiempo de servidor/SQL).
  await db.execute(sql`
    INSERT INTO products (consultant_id, seccion, producto, variante, codigo, puntos, precio, imagen, source)
    SELECT ${CONSULTANT_ID}, 'Perf', 'Producto perf ' || gs, 'Estandar', 'perf-' || gs, 0, 500000,
           'https://via.placeholder.com/600x600.png?text=P' || gs, 'manual'
    FROM generate_series(1, ${NUM_PRODUCTS}) gs
  `);
  await db.execute(sql`
    INSERT INTO product_stock (consultant_id, product_id, unidades)
    SELECT ${CONSULTANT_ID}, id, 20 FROM products WHERE consultant_id = ${CONSULTANT_ID}
  `);

  await db.execute(sql`
    INSERT INTO clients (consultant_id, name, phone)
    SELECT ${CONSULTANT_ID}, 'Clienta perf ' || gs, '26155' || lpad(gs::text, 5, '0')
    FROM generate_series(1, ${NUM_CLIENTS}) gs
  `);

  // Ventas repartidas entre las clientas sembradas, con 1 ítem y 1 cuota cada una, fechas
  // distribuidas en los últimos ~90 días para que entren en reportes/filtros por fecha.
  await db.execute(sql`
    INSERT INTO sales (consultant_id, client_id, client_name, date, subtotal, total, profit, payment_method, status, delivery_status)
    SELECT ${CONSULTANT_ID},
           c.id,
           c.name,
           to_char(current_date - ((gs % 90))::int, 'YYYY-MM-DD'),
           5000,
           5000,
           1500,
           'efectivo',
           'pendiente',
           'entregada'
    FROM generate_series(1, ${NUM_SALES}) gs
    JOIN clients c ON c.consultant_id = ${CONSULTANT_ID} AND c.id = (
      SELECT id FROM clients WHERE consultant_id = ${CONSULTANT_ID} ORDER BY id LIMIT 1 OFFSET (gs % ${NUM_CLIENTS})
    )
  `);

  await db.execute(sql`
    INSERT INTO sale_items (sale_id, product_id, product_name, category, quantity, price, original_price, quantity_pending, quantity_delivered)
    SELECT s.id, p.id, p.producto, p.seccion, 1, 5000, 5000, 0, 1
    FROM sales s
    JOIN products p ON p.consultant_id = ${CONSULTANT_ID} AND p.id = (
      SELECT id FROM products WHERE consultant_id = ${CONSULTANT_ID} ORDER BY id LIMIT 1 OFFSET (s.id % ${NUM_PRODUCTS})
    )
    WHERE s.consultant_id = ${CONSULTANT_ID}
  `);

  await db.execute(sql`
    INSERT INTO sale_installments (sale_id, installment_number, amount, due_date, status, amount_paid)
    SELECT id, 1, 5000, date, 'pagado', 5000
    FROM sales WHERE consultant_id = ${CONSULTANT_ID}
  `);

  // Catálogo GLOBAL (consultant_id NULL) — opcional, solo para medir el tamaño real de
  // /api/products cuando trae el catálogo completo (Prompt 16, punto 2). Identificado con el
  // prefijo "perf-global-" en el código, para poder borrarlo sin tocar ningún dato real si
  // algún día este mismo dev DB tiene un catálogo cargado de verdad.
  if (NUM_GLOBAL_CATALOG > 0) {
    await db.execute(sql`DELETE FROM product_stock WHERE product_id IN (SELECT id FROM products WHERE codigo LIKE 'perf-global-%')`);
    await db.execute(sql`DELETE FROM products WHERE codigo LIKE 'perf-global-%'`);
    await db.execute(sql`
      INSERT INTO products (consultant_id, seccion, producto, variante, codigo, puntos, precio, imagen, source)
      SELECT NULL, 'Catálogo', 'Producto catálogo ' || gs, 'Estandar', 'perf-global-' || gs, 10, 450000,
             'https://via.placeholder.com/600x600.png?text=G' || gs, 'import'
      FROM generate_series(1, ${NUM_GLOBAL_CATALOG}) gs
    `);
    const [{ count: globalCount }] = (await db.execute(sql`SELECT count(*)::int FROM products WHERE codigo LIKE 'perf-global-%'`)).rows as any;
    console.log(`Catálogo global de prueba: ${globalCount} productos.`);
  }

  const [{ count: productCount }] = (await db.execute(sql`SELECT count(*)::int FROM products WHERE consultant_id = ${CONSULTANT_ID}`)).rows as any;
  const [{ count: clientCount }] = (await db.execute(sql`SELECT count(*)::int FROM clients WHERE consultant_id = ${CONSULTANT_ID}`)).rows as any;
  const [{ count: saleCount }] = (await db.execute(sql`SELECT count(*)::int FROM sales WHERE consultant_id = ${CONSULTANT_ID}`)).rows as any;
  console.log(`Listo: ${productCount} productos, ${clientCount} clientas, ${saleCount} ventas.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
