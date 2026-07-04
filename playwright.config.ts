import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/artifacts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
});
