/**
 * Resuelve qué backend de almacenamiento usar, con la misma regla para storage y sesión:
 * producción y staging nunca pueden arrancar en memoria, ni por accidente (falta DATABASE_URL)
 * ni a propósito (DATABASE_MODE=memory forzado). El modo memoria NUNCA es un default silencioso
 * — solo se activa con DATABASE_MODE=memory puesto a mano, y solo fuera de producción/staging.
 *
 * Encontrado en el ensayo de deploy del 2026-10-25: antes de este fix, si faltaba DATABASE_URL
 * y no había NODE_ENV=production, esta función caía en memoria EN SILENCIO — reproducido de
 * verdad en un contenedor de diagnóstico sin DATABASE_URL, que arrancó la app en memoria sin
 * ningún aviso. En Railway (staging o producción), si alguien se olvida la variable o la
 * escribe mal, esto significa que el servidor arrancaría igual, parecería funcionar, y el
 * primer reinicio borraría todo lo cargado — un incidente real, no solo un caso de test.
 *
 * `APP_ENV=staging` se chequea como señal INDEPENDIENTE de `NODE_ENV`, aunque hoy staging
 * siempre corre con `NODE_ENV=production` igual que producción real (ver docs/staging.md) —
 * mismo criterio de "más de una señal, nunca una sola" que ya usa test-db-guard.ts: si algún
 * día cambia cómo se configura NODE_ENV en el servicio de staging, esto sigue protegido.
 */
export function resolveStorageMode(): "memory" | "postgres" {
  const explicit = process.env.DATABASE_MODE;

  if (explicit && explicit !== "memory" && explicit !== "postgres") {
    throw new Error(`DATABASE_MODE inválido: "${explicit}". Usá "memory" o "postgres".`);
  }

  const requiresRealDatabase = process.env.NODE_ENV === "production" || process.env.APP_ENV === "staging";

  if (explicit === "memory") {
    if (requiresRealDatabase) {
      throw new Error(
        "DATABASE_MODE=memory no está permitido en producción ni en staging. Configurá DATABASE_URL y quitá o cambiá DATABASE_MODE a \"postgres\".",
      );
    }
    return "memory";
  }

  if (explicit === "postgres") {
    return "postgres";
  }

  // Sin DATABASE_MODE explícito: NUNCA se infiere memoria. Con DATABASE_URL presente, Postgres;
  // sin ella, es un error siempre — en producción/staging con el mensaje específico que pide el
  // runbook de deploy, fuera de ahí explicando que memoria existe pero hay que pedirla a mano.
  if (process.env.DATABASE_URL) {
    return "postgres";
  }

  if (requiresRealDatabase) {
    throw new Error("Falta DATABASE_URL: el servidor no arranca sin base de datos.");
  }

  throw new Error(
    "Falta DATABASE_URL. Si querés memoria para desarrollo o tests, seteá DATABASE_MODE=memory explícitamente — ya no es el default.",
  );
}
