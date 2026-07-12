import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One row per sync id: an opaque E2EE blob and the hash of its bearer write-token.
// The server can serve, replace, or withhold the blob; it can never read it. There is
// deliberately no user table: the keyphrase-derived sync id is the whole identity.
// Donation configuration (budget, the one-time share answer) is service data, not
// reading data: plaintext jsonb, keyed by the same pseudonymous sync id and guarded
// by the same write-token hash, registered on first write. Settlements are NOT here:
// whom a budget was paid to is a projection of reading history, so they live inside
// the encrypted blob (old rows may still carry a legacy copy until the dashboard
// adopts it). The doc's shape is donationDocSchema in @swdi/shared, parsed on every
// read since jsonb bytes are whatever was stored.
export const donationConfigs = pgTable("donation_configs", {
  syncId:   text("sync_id").primaryKey(),
  authHash: text("auth_hash").notNull(),

  doc: jsonb("doc").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const syncBlobs = pgTable("sync_blobs", {
  syncId:   text("sync_id").primaryKey(),
  authHash: text("auth_hash").notNull(),      // sha256 hex of the bearer token

  version: integer("version").notNull(),      // optimistic concurrency for pull-merge-push
  iv:      text("iv").notNull(),
  data:    text("data").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
