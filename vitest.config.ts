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
  },
});
