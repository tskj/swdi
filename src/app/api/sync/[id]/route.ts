import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { syncPutRequestSchema } from "@swdi/shared";
import { nowDate } from "@/lib/clock";
import { db } from "@/lib/db";
import { syncBlobs } from "@/lib/db/schema";
import { pgErrorCode, withTransaction } from "@/lib/db-tx";
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, async () => {
    if (rateLimited(`sync:${clientIp(req)}`, REQUESTS_PER_MINUTE)) return tooMany();

    const { id } = await ctx.params;
    const token  = bearerToken(req);
    if (!SYNC_ID.test(id) || token === null) return notFound();

    const row = await db.select().from(syncBlobs).where(eq(syncBlobs.syncId, id)).maybeSingle("sync.get");
    if (row === null || !hashesMatch(row.authHash, tokenHash(token))) return notFound();

    return NextResponse.json({ version: row.version, iv: row.iv, data: row.data });
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
    const hash = tokenHash(token);

    // Read-then-write must be one snapshot: two devices registering or pushing
    // concurrently should resolve into one row and one clean 409, not two truths.
    // Racing first registrations surface as a unique violation rather than a
    // serialization failure, so that case is caught below and mapped to the same
    // 409 the version check produces; the client's pull-merge-retry then resolves it.
    let outcome: { kind: "stored"; version: number } | { kind: "denied" } | { kind: "conflict"; version: number };
    try {
      outcome = await runPut(id, hash, expectedVersion, iv, data);
    } catch (err) {
      if (pgErrorCode(err) !== "23505") throw err;
      outcome = { kind: "conflict", version: 0 };
    }

    if (outcome.kind === "denied")   return notFound();
    if (outcome.kind === "conflict") return NextResponse.json({ error: "version conflict", version: outcome.version }, { status: 409 });

    return NextResponse.json({ version: outcome.version });
  });
}

async function runPut(id: string, hash: string, expectedVersion: number, iv: string, data: string) {
  return withTransaction({ name: "sync.put" }, async (tx) => {
    const row = await tx.select().from(syncBlobs).where(eq(syncBlobs.syncId, id)).maybeSingle("sync.put");

    if (row === null) {
      if (expectedVersion !== 0) return { kind: "conflict" as const, version: 0 };

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
