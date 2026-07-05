import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/artifacts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,

  // The dashboard spec needs the real app against a throwaway local database; the
  // extension spec ignores it. Requires a prior `pnpm build` and local Postgres.
  webServer: {
    command: "bash e2e/start-server.sh",
    url: "http://localhost:3105/api/health",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
