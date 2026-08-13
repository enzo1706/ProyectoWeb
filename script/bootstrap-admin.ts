/**
 * Crea el primer administrador real. Pensado para correrse UNA sola vez, a mano, por
 * quien tenga acceso al servidor de producción — nunca por HTTP, para no exponer una
 * ruta que alguien pueda intentar explotar.
 *
 * Uso:
 *   BOOTSTRAP_ADMIN_USERNAME=... BOOTSTRAP_ADMIN_PASSWORD=... npm run create-admin
 *
 * Es idempotente: si ya existe algún administrador, no crea otro y no hace nada.
 */
import "../server/load-env";
import { storage } from "../server/storage";

async function main() {
  const alreadyExists = await storage.hasAdminAccount();
  if (alreadyExists) {
    console.log("Ya existe una cuenta de administrador — no se creó ninguna nueva.");
    return;
  }

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!username || !password) {
    console.error(
      "Faltan BOOTSTRAP_ADMIN_USERNAME y/o BOOTSTRAP_ADMIN_PASSWORD. " +
        "Ejemplo: BOOTSTRAP_ADMIN_USERNAME=enzo BOOTSTRAP_ADMIN_PASSWORD=... npm run create-admin",
    );
    process.exitCode = 1;
    return;
  }
  if (username.trim().length < 3) {
    console.error("El usuario debe tener al menos 3 caracteres.");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exitCode = 1;
    return;
  }

  const existingUser = await storage.getUserByUsername(username);
  if (existingUser) {
    console.error(`Ya existe una cuenta con el usuario "${username}" (no es admin) — elegí otro usuario.`);
    process.exitCode = 1;
    return;
  }

  await storage.createUser({ username, password, role: "admin", status: true });
  console.log(`Administrador "${username}" creado correctamente.`);
}

main()
  .catch((err) => {
    console.error("No se pudo crear el administrador:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
