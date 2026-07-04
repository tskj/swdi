// Apply committed Drizzle migrations. Uses only runtime deps (drizzle-orm + postgres) and plain
// JS, so it runs in Railway's preDeploy container without dev dependencies.
//
// Connection URL: MIGRATE_DATABASE_URL if set, else DATABASE_URL. On Railway this runs in the
// preDeploy step and connects to the Postgres service over the private *.railway.internal network,
// which can take a couple of seconds to come up — so we retry on transient DNS/connection errors
// (ENOTFOUND / ECONNRESET / …) instead of failing the deploy on the first miss. MIGRATE_DATABASE_URL
// stays supported as an escape hatch (e.g. the public proxy URL) but isn't needed by default.
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// The schema has no tables yet, so no migrations have been generated — the drizzle/ folder (and
// its journal) only appears once `pnpm db:generate` produces one. Until then there is nothing to
// apply; exit green so deploys of the schema-less app don't fail here.
const journalPath = "./drizzle/meta/_journal.json";
if (!existsSync(journalPath)) {
  console.log("migrate: no migrations folder yet — nothing to apply");
  process.exit(0);
}

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
  console.log("migrate: migrations journal is empty — nothing to apply");
  process.exit(0);
}

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: no MIGRATE_DATABASE_URL or DATABASE_URL set");
  process.exit(1);
}

const ATTEMPTS = 10;
const DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (err) =>
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|CONNECT_TIMEOUT|connection|connect/i.test(
    String(err?.code || err?.cause?.code || err?.message || err),
  );

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("migrate: ok");
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err) {
    await sql.end({ timeout: 5 }).catch(() => {});
    if (attempt < ATTEMPTS && isTransient(err)) {
      console.warn(`migrate: attempt ${attempt}/${ATTEMPTS} failed (${err.code || err.message}); retrying in ${DELAY_MS}ms`);
      await sleep(DELAY_MS);
      continue;
    }
    console.error("migrate: failed —", err);
    process.exit(1);
  }
}
