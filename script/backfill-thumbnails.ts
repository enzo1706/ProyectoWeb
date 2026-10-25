/**
 * Prompt 16, punto 3 — backfill de miniaturas para imágenes del catálogo global que se
 * subieron ANTES de este prompt (tienen `imagen` pero no `imagenMiniatura`). Opcional: Stock
 * ya cae a mostrar la imagen original si todavía no tiene miniatura, así que nada se rompe
 * si este script nunca se corre — solo deja de aprovechar el ahorro de transferencia hasta
 * que se corra.
 *
 * Modo de prueba por DEFECTO: solo lista qué productos le faltaría la miniatura, sin
 * descargar, generar, subir ni escribir nada. Para aplicar de verdad: --apply.
 *
 *   npx tsx script/backfill-thumbnails.ts            (modo de prueba, no escribe nada)
 *   npx tsx script/backfill-thumbnails.ts --apply     (genera y guarda las miniaturas que faltan)
 *
 * Igual que seed-staging.ts: nunca se corrió contra producción ni contra el Storage real
 * todavía — queda documentado en docs/migracion-deploy-3.md como paso OPCIONAL del deploy,
 * para correr a mano cuando el usuario lo decida.
 */
import "../server/load-env";
import { storage } from "../server/storage";
import { uploadThumbnailFromExistingImage } from "../server/image-storage";

async function main() {
  const apply = process.argv.includes("--apply");

  const globalProducts = await storage.listGlobalProducts();
  const pending = globalProducts.filter((p) => p.imagen !== null && p.imagenMiniatura === null);

  if (pending.length === 0) {
    console.log("Ningún producto global necesita backfill de miniatura — todos los que tienen imagen ya tienen miniatura.");
    return;
  }

  console.log(
    `${pending.length} de ${globalProducts.length} productos globales con imagen todavía no tienen miniatura.` +
      (apply ? " Generando..." : " (modo de prueba — no se escribe nada; corré con --apply para generarlas de verdad)"),
  );

  let done = 0;
  let failed = 0;
  for (const product of pending) {
    if (!apply) {
      console.log(`  [prueba] #${product.id} ${product.producto} — ${product.imagen}`);
      continue;
    }

    const thumbnailUrl = await uploadThumbnailFromExistingImage(product.id, product.imagen!);
    if (!thumbnailUrl) {
      failed++;
      console.log(`  ✕ #${product.id} ${product.producto} — no se pudo generar, se deja para otra corrida`);
      continue;
    }

    await storage.setProductImage(product.id, product.imagen, thumbnailUrl);
    done++;
    console.log(`  ✓ #${product.id} ${product.producto}`);
  }

  if (apply) {
    console.log(`Listo: ${done} miniaturas generadas, ${failed} fallaron (quedan pendientes para la próxima corrida).`);
  } else {
    console.log(`Fin del modo de prueba — ${pending.length} producto(s) listo(s) para --apply.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
