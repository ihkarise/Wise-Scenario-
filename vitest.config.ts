import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    alias: { "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)) },
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Integration tests need a database and run via `npm run test:integration`.
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
