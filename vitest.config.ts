import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror Next's "@/..." path alias, and stand in for the "server-only" marker
    // package (which throws outside a React Server context) so server lib modules
    // can be unit-tested in plain node.
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      "@":           fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
