import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Integration tests against a real PostgreSQL (TEST_DATABASE_URL). Run with `npm run test:integration`. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    alias: { "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)) },
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
