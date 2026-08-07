/**
 * Resuelve qué backend de almacenamiento usar, con la misma regla para storage y sesión:
 * producción nunca puede arrancar en memoria, ni por accidente (falta DATABASE_URL) ni a propósito
 * (DATABASE_MODE=memory forzado). Development/test sí pueden usar memoria explícitamente.
 */
export function resolveStorageMode(): "memory" | "postgres" {
  const explicit = process.env.DATABASE_MODE;

  if (explicit && explicit !== "memory" && explicit !== "postgres") {
    throw new Error(`DATABASE_MODE inválido: "${explicit}". Usá "memory" o "postgres".`);
  }

  const isProduction = process.env.NODE_ENV === "production";

  if (explicit === "memory") {
    if (isProduction) {
      throw new Error(
        "DATABASE_MODE=memory no está permitido en producción. Configurá DATABASE_URL y quitá o cambiá DATABASE_MODE a \"postgres\".",
      );
    }
    return "memory";
  }

  if (explicit === "postgres") {
    return "postgres";
  }

  // Sin DATABASE_MODE explícito: se infiere de DATABASE_URL.
  if (process.env.DATABASE_URL) {
    return "postgres";
  }

  if (isProduction) {
    throw new Error(
      "Falta DATABASE_URL. En producción es obligatoria (no se permite arrancar con almacenamiento en memoria).",
    );
  }

  return "memory";
}
