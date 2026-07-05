import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One row per sync id: an opaque E2EE blob and the hash of its bearer write-token.
// The server can serve, replace, or withhold the blob; it can never read it. There is
// deliberately no user table: the keyphrase-derived sync id is the whole identity.
export const syncBlobs = pgTable("sync_blobs", {
  syncId:   text("sync_id").primaryKey(),
  authHash: text("auth_hash").notNull(),      // sha256 hex of the bearer token

  version: integer("version").notNull(),      // optimistic concurrency for pull-merge-push
  iv:      text("iv").notNull(),
  data:    text("data").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
