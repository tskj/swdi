import { installCardinality } from "@/lib/cardinality";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

// DATABASE_URL is provided by the environment directly (the local shell in dev, Railway in prod).
// Migrations run via scripts/migrate.mjs, not from this module.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const queryClient = postgres(process.env.DATABASE_URL, {
  // Single connection in production (one long-lived container); a pool locally.
  max: process.env.NODE_ENV === "production" ? 1 : undefined,
});
export const db = drizzle(queryClient, { schema });

// Install the .single()/.maybeSingle()/… cardinality helpers (src/lib/cardinality.ts) onto the exact
// QueryPromise class this db's queries use. The sample must be a LIVE query off the real `db` —
// a production bundler can emit more than one copy of drizzle-orm, and a statically-imported
// QueryPromise isn't necessarily the class these builders extend; deriving the prototype from a
// real query patches whichever copy is actually in play. With no tables in the schema yet, a raw
// `select 1` serves as the sample — it shares the same thenable base class, and constructing it
// executes nothing (the query only runs when awaited).
installCardinality(db.execute(sql`select 1`));
