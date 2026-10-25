import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "product-images";

// Prompt 16, punto 3 — miniatura generada ACÁ, en el servidor, en vez de depender del
// transform de imágenes de Supabase Storage (`?width=`), que solo está disponible desde el
// plan Pro. Esto funciona en cualquier plan, porque la miniatura es un archivo real, no un
// parámetro de URL. 200x200 "cover" (recorta, nunca deforma) alcanza de sobra para la lista
// de Stock (se muestra a 44px, pero se sirve a 200 para que se vea bien en pantallas de alta
// densidad) — la imagen original se sigue usando tal cual en cualquier vista de detalle.
const THUMBNAIL_SIZE = 200;

/** Firma binaria real de cada formato — el `mimetype` que manda multer viene del header
 * `Content-Type` de la parte multipart, que el cliente arma libremente (falsificable con
 * curl/Postman). Esto lee los primeros bytes del archivo de verdad, sin agregar ninguna
 * dependencia nueva: las tres firmas son cortas y estables. */
const MAGIC_BYTE_CHECKS: Record<string, (buf: Buffer) => boolean> = {
  "image/jpeg": (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  "image/png": (buf) =>
    buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (buf) =>
    buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP",
};

/** true solo si el contenido real del archivo coincide con el `mimetype` declarado. */
export function isValidImageBuffer(buffer: Buffer, declaredMimeType: string): boolean {
  const check = MAGIC_BYTE_CHECKS[declaredMimeType];
  return check ? check(buffer) : false;
}

let client: SupabaseClient | null = null;
let bucketReady = false;

/** Distinto de DATABASE_URL: estas son las credenciales de la API de Supabase Storage,
 * no de Postgres. La service role key nunca debe llegar al navegador — solo se usa acá. */
function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. Son las credenciales de Supabase Storage " +
        "(distintas de DATABASE_URL, que es solo para Postgres) — hace falta configurarlas para subir imágenes.",
    );
  }
  client ??= createClient(url, key);
  return client;
}

/** El bucket debe ser público: getPublicUrl() arma URLs directas sin firmar, y el catálogo
 * las usa tal cual en <img src>. Se verifica una sola vez por proceso (bucketReady). */
async function ensureBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketReady) return;

  const { data: existing, error: getError } = await supabase.storage.getBucket(BUCKET);
  if (getError && !/not found|does not exist/i.test(getError.message)) {
    throw new Error(`No se pudo verificar el bucket de Supabase Storage: ${getError.message}`);
  }

  if (!existing) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: "5MB",
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    if (createError && !/already exists/i.test(createError.message)) {
      throw new Error(`No se pudo crear el bucket de Supabase Storage: ${createError.message}`);
    }
  }

  bucketReady = true;
}

/** Redimensiona a `THUMBNAIL_SIZE`x`THUMBNAIL_SIZE`, recortando (nunca deformando). Siempre
 * jpeg de salida — una miniatura no necesita preservar el formato original (más liviana, y
 * un solo `contentType` sin importar si la original era png/webp). */
async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Sube el original Y la miniatura al bucket fijo `product-images`, devuelve las dos URLs
 * públicas. `upsert: true` porque el path incluye un timestamp — nunca pisa una imagen
 * anterior por accidente. Si falla generar/subir la miniatura, no aborta la subida del
 * original (mejor una imagen sin miniatura todavía que ninguna imagen) — el caller usa
 * `imagen` como respaldo en ese caso (ver `thumbnailUrl: null`). */
export async function uploadProductImage(
  productId: number,
  buffer: Buffer,
  mimeType: string,
  extension: string,
): Promise<{ url: string; thumbnailUrl: string | null }> {
  const supabase = getClient();
  await ensureBucket(supabase);
  const path = `products/${productId}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) {
    throw new Error(`Error al subir la imagen a Supabase Storage: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  let thumbnailUrl: string | null = null;
  try {
    const thumbnailBuffer = await generateThumbnail(buffer);
    const thumbnailPath = `products/${productId}-${Date.now()}-thumb.jpg`;
    const { error: thumbError } = await supabase.storage.from(BUCKET).upload(thumbnailPath, thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (!thumbError) {
      thumbnailUrl = supabase.storage.from(BUCKET).getPublicUrl(thumbnailPath).data.publicUrl;
    } else {
      console.error("No se pudo subir la miniatura (se sigue usando la original):", thumbError.message);
    }
  } catch (err) {
    console.error("No se pudo generar la miniatura (se sigue usando la original):", err);
  }

  return { url: data.publicUrl, thumbnailUrl };
}

/** Prompt 16 — backfill (script/backfill-thumbnails.ts): descarga la imagen ORIGINAL ya
 * subida (por su URL pública, venga de este bucket o no — a diferencia de `uploadProductImage`
 * nunca recibe el buffer de memoria, porque la imagen ya existe de antes), genera la miniatura
 * y la sube. `null` si la descarga o la generación fallan (se loguea el motivo, nunca
 * interrumpe un backfill en lote por una sola imagen rota). */
export async function uploadThumbnailFromExistingImage(productId: number, originalUrl: string): Promise<string | null> {
  const res = await fetch(originalUrl);
  if (!res.ok) {
    console.error(`No se pudo descargar la imagen original (producto ${productId}, HTTP ${res.status}): ${originalUrl}`);
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const supabase = getClient();
  await ensureBucket(supabase);
  const thumbnailBuffer = await generateThumbnail(buffer);
  const thumbnailPath = `products/${productId}-${Date.now()}-thumb.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(thumbnailPath, thumbnailBuffer, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) {
    console.error(`No se pudo subir la miniatura del backfill (producto ${productId}): ${error.message}`);
    return null;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(thumbnailPath).data.publicUrl;
}

/** Todos los archivos ya presentes en el bucket bajo `products/` (donde vive todo lo que
 * sube esta app), con su URL pública ya armada — para el matching por nombre contra
 * productos sin imagen. No sube ni borra nada, solo lista lo que ya existe. */
export async function listProductImageFiles(): Promise<{ path: string; name: string; url: string }[]> {
  const supabase = getClient();
  await ensureBucket(supabase);

  const { data, error } = await supabase.storage.from(BUCKET).list("products", { limit: 1000 });
  if (error) {
    throw new Error(`No se pudo listar las imágenes de Supabase Storage: ${error.message}`);
  }

  // La SDK devuelve tanto archivos como "carpetas" (placeholders) en el mismo listado —
  // un archivo real siempre trae `id` seteado, una carpeta no.
  const files = (data ?? []).filter((entry) => entry.id !== null);

  return files.map((entry) => {
    const path = `products/${entry.name}`;
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { path, name: entry.name, url: urlData.publicUrl };
  });
}

/** De una URL pública del bucket, el path relativo que usan `.remove()`/`.list()` (ej.
 * "products/47-123.jpg"). null si la URL no es de este bucket (otro origen, etc.). */
export function extractStoragePath(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

/** Best-effort: si la URL no es del bucket esperado (ej. viene de otro origen) no hace nada,
 * en vez de fallar — borrar la imagen vieja nunca debe bloquear guardar la nueva referencia. */
export async function deleteProductImage(url: string): Promise<void> {
  const path = extractStoragePath(url);
  if (path === null) return;

  try {
    const supabase = getClient();
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // No se pudo borrar la imagen anterior (credenciales faltantes, red, etc.) — no es
    // motivo para romper la operación que la llamó.
  }
}
