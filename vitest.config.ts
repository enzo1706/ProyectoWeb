import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/tests/**/*.test.ts"],
    // Los tests de concurrencia/aislamiento pegan contra Postgres real con fixtures propias
    // — correrlos en paralelo entre archivos podría enmascarar o duplicar condiciones de
    // carrera que no son las que se están probando. Uno a la vez, más lento pero sin ruido.
    fileParallelism: false,
    testTimeout: 20000,
    // El primer archivo que corre paga el costo de compilar createApp() por primera vez en el
    // proceso (tsx/esbuild) — en esta máquina eso puede superar los 10s por defecto de vitest y
    // hacer que su beforeAll "time out" sin que haya ningún problema real (reproducido de forma
    // consistente: siempre el primer archivo, nunca uno random más adelante).
    hookTimeout: 20000,
  },
});
