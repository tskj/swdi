import { defineConfig } from "drizzle-kit";

// DATABASE_URL comes straight from the environment (the local shell in dev, Railway in prod) —
// there is no dotenv layer yet. Migrations are applied by scripts/migrate.mjs, not from here.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
