import { createHash, timingSafeEqual } from "node:crypto";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { syncPutRequestSchema } from "@swdi/shared";
import { nowDate, nowMs } from "@/lib/clock";
import { syncBlobs } from "@/lib/db/schema";
import { Tx, pgErrorCode, withTransaction } from "@/lib/db-tx";
import { withRequest } from "@/lib/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The sync store: one opaque E2EE blob per sync id, guarded by a bearer write-token of
// which only the sha256 is stored. Wrong token and unknown id both answer 404, so the
// endpoint confirms nothing about which sync ids exist.

const SYNC_ID = /^[0-9a-f]{32}$/;

// A syncing client makes a handful of requests per sync; this is generous for people
// and hostile to key-guessing.
const REQUESTS_PER_MINUTE = 120;

// Registration (expectedVersion 0, no row yet) is the server's only unauthenticated
// write, so it is priced separately: a person registers a device once, an abuser
// mints ids. Updates prove token ownership and ride the per-minute limit alone.
const REGISTRATIONS_PER_HOUR = 30;
const REGISTRATION_WINDOW_MS = 3_600_000;

// The store's global ceiling, sized to the hosting bill rather than to demand; raise
// it deliberately. At capacity, blobs that registered and never synced again are
// swept after two weeks (their owners keep local data, and the next sync simply
// re-uploads and re-registers); refusing new registrations is the last resort, and
// existing users are never affected.
const MAX_SYNC_IDS       = 20_000;
const MAX_STORE_BYTES    = 10_000_000_000;
const ABANDONED_AFTER_MS = 14 * 24 * 3_600_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, async () => {
    if (rateLimited(`sync:${clientIp(req)}`, REQUESTS_PER_MINUTE)) return tooMany();

    const { id } = await ctx.params;
    const token  = bearerToken(req);
    if (!SYNC_ID.test(id) || token === null) return notFound();

    // The token hash is checked before the blob column is ever read, so a wrong-token
    // GET costs the same regardless of blob size; loading megabytes first would hand
    // out a work oracle and an amplification lever for free.
    const row = await withTransaction({ name: "sync.get" }, async (tx) => {
      const auth = await tx.select({ authHash: syncBlobs.authHash }).from(syncBlobs).where(eq(syncBlobs.syncId, id)).maybeSingle("sync.get.auth");
      if (auth === null || !hashesMatch(auth.authHash, tokenHash(token))) return null;

      return tx.select({ version: syncBlobs.version, iv: syncBlobs.iv, data: syncBlobs.data })
        .from(syncBlobs).where(eq(syncBlobs.syncId, id)).single("sync.get.blob");
    });
    if (row === null) return notFound();

    return NextResponse.json(row);
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, async () => {
    if (rateLimited(`sync:${clientIp(req)}`, REQUESTS_PER_MINUTE)) return tooMany();

    const { id } = await ctx.params;
    const token  = bearerToken(req);
    if (!SYNC_ID.test(id) || token === null) return notFound();

    const parsed = syncPutRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

    const { expectedVersion, iv, data } = parsed.data;
    if (expectedVersion === 0 && rateLimited(`sync-register:${clientIp(req)}`, REGISTRATIONS_PER_HOUR, REGISTRATION_WINDOW_MS)) return tooMany();

    const hash = tokenHash(token);

    // Read-then-write must be one snapshot: two devices registering or pushing
    // concurrently should resolve into one row and one clean 409, not two truths.
    // Racing first registrations surface as a unique violation rather than a
    // serialization failure, so that case is caught below and mapped to the same
    // 409 the version check produces; the client's pull-merge-retry then resolves it.
    let outcome: { kind: "stored"; version: number } | { kind: "denied" } | { kind: "conflict"; version: number } | { kind: "full" };
    try {
      outcome = await runPut(id, hash, expectedVersion, iv, data);
    } catch (err) {
      if (pgErrorCode(err) !== "23505") throw err;
      outcome = { kind: "conflict", version: 0 };
    }

    if (outcome.kind === "denied")   return notFound();
    if (outcome.kind === "conflict") return NextResponse.json({ error: "version conflict", version: outcome.version }, { status: 409 });
    if (outcome.kind === "full")     return NextResponse.json({ error: "the sync store is at capacity" }, { status: 503 });

    return NextResponse.json({ version: outcome.version });
  });
}

async function runPut(id: string, hash: string, expectedVersion: number, iv: string, data: string) {
  return withTransaction({ name: "sync.put" }, async (tx) => {
    const row = await tx.select().from(syncBlobs).where(eq(syncBlobs.syncId, id)).maybeSingle("sync.put");

    if (row === null) {
      if (expectedVersion !== 0)         return { kind: "conflict" as const, version: 0 };
      if (!(await roomToRegister(tx)))   return { kind: "full" as const };

      await tx.insert(syncBlobs).values({
        syncId:   id,
        authHash: hash,
        version:  1,
        iv,
        data,
        createdAt: nowDate(),
        updatedAt: nowDate(),
      });
      return { kind: "stored" as const, version: 1 };
    }

    if (!hashesMatch(row.authHash, hash)) return { kind: "denied" as const };
    if (row.version !== expectedVersion)  return { kind: "conflict" as const, version: row.version };

    await tx.update(syncBlobs)
      .set({ version: row.version + 1, iv, data, updatedAt: nowDate() })
      .where(eq(syncBlobs.syncId, id));
    return { kind: "stored" as const, version: row.version + 1 };
  });
}

// The capacity gate, checked only when registering. Under the ceiling: proceed. Over
// it: sweep abandoned registrations (never updated since they were created, two weeks
// old) and re-check. Sweeping and refusal both leave every active user untouched.
async function roomToRegister(tx: Tx): Promise<boolean> {
  if (await underCapacity(tx)) return true;

  await tx.delete(syncBlobs).where(and(eq(syncBlobs.version, 1), lt(syncBlobs.updatedAt, new Date(nowMs() - ABANDONED_AFTER_MS))));
  return underCapacity(tx);
}

async function underCapacity(tx: Tx): Promise<boolean> {
  const usage = await tx.select({
    ids:   count(),
    bytes: sql`coalesce(sum(pg_column_size(${syncBlobs.data})), 0)`.mapWith(Number),
  }).from(syncBlobs).single("sync.capacity");

  return usage.ids < MAX_SYNC_IDS && usage.bytes < MAX_STORE_BYTES;
}

function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

function tooMany() {
  return NextResponse.json({ error: "slow down" }, { status: 429 });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");

  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
