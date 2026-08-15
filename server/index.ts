import "./load-env";
import type { Server } from "http";
import { createApp, log } from "./app";
import { resolveStorageMode } from "./storage-mode";

/** Cierre controlado: deja de aceptar conexiones nuevas, espera a que terminen los
 * requests en curso, y recién ahí cierra el pool de Postgres. Compatible con cómo
 * Railway/Render redeployan (mandan SIGTERM y esperan un rato antes de matar el proceso
 * a la fuerza) — sin esto, cada deploy corta requests a mitad de camino. */
function setupGracefulShutdown(httpServer: Server) {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} recibido, cerrando el servidor...`);

    // Si algo queda colgado (request eterno, pool que no responde), no nos quedamos
    // esperando para siempre — a los 10s se fuerza la salida igual.
    const forceExitTimer = setTimeout(() => {
      console.error("Cierre forzado: seguían conexiones abiertas después de 10s.");
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    httpServer.close(async (closeErr) => {
      if (closeErr) console.error("Error cerrando el servidor HTTP:", closeErr);

      try {
        if (resolveStorageMode() === "postgres") {
          const { pool } = await import("./db");
          await pool.end();
        }
      } catch (poolErr) {
        console.error("Error cerrando el pool de Postgres:", poolErr);
      }

      clearTimeout(forceExitTimer);
      process.exit(closeErr ? 1 : 0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  const { httpServer } = await createApp();

  // El hosting (Railway) asigna el puerto dinámicamente vía PORT — nunca hardcodear un
  // puerto fijo. 5000 es solo el default para correr local sin setear nada. "0.0.0.0" es
  // obligatorio (no "localhost"): el proxy del hosting necesita poder alcanzar el proceso
  // desde afuera del contenedor.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    log(`serving on port ${port}`);
  });

  setupGracefulShutdown(httpServer);
}

main();
