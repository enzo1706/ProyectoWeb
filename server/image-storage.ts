import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "product-images";

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

/** Sube el buffer al bucket fijo `product-images` y devuelve la URL pública. `upsert: true`
 * porque el path incluye un timestamp — nunca pisa una imagen anterior por accidente. */
export async function uploadProductImage(
  productId: number,
  buffer: Buffer,
  mimeType: string,
  extension: string,
): Promise<string> {
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
  return data.publicUrl;
}

/** Best-effort: si la URL no es del bucket esperado (ej. viene de otro origen) no hace nada,
 * en vez de fallar — borrar la imagen vieja nunca debe bloquear guardar la nueva referencia. */
export async function deleteProductImage(url: string): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;

  try {
    const supabase = getClient();
    const path = url.slice(idx + marker.length);
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // No se pudo borrar la imagen anterior (credenciales faltantes, red, etc.) — no es
    // motivo para romper la operación que la llamó.
  }
}
