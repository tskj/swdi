import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { EMPTY_DONATION_DOC, applyDonationPatch, donationDocSchema, donationPatchSchema } from "@swdi/shared";
import { nowDate } from "@/lib/clock";
import { db } from "@/lib/db";
import { donationConfigs } from "@/lib/db/schema";
import { withTransaction } from "@/lib/db-tx";
import { withRequest } from "@/lib/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Donation configuration, plaintext by design (see the schema comment): same
// pseudonymous id and bearer token as the sync blob, registered on first write.
// Last write wins; budgets are edited by one human, not synced continuously.

const SYNC_ID = /^[0-9a-f]{32}$/;

const REQUESTS_PER_MINUTE = 60;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, async () => {
    if (rateLimited(`donations:${clientIp(req)}`, REQUESTS_PER_MINUTE)) return tooMany();

    const { id } = await ctx.params;
    const token  = bearerToken(req);
    if (!SYNC_ID.test(id) || token === null) return notFound();

    const row = await db.select().from(donationConfigs).where(eq(donationConfigs.syncId, id)).maybeSingle("donations.get");
    if (row === null || !hashesMatch(row.authHash, tokenHash(token))) return notFound();

    const doc = donationDocSchema.safeParse(row.doc);
    if (!doc.success) return notFound(); // a corrupted doc reads as absent; the next PUT replaces it

    return NextResponse.json(doc.data);
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, async () => {
    if (rateLimited(`donations:${clientIp(req)}`, REQUESTS_PER_MINUTE)) return tooMany();

    const { id } = await ctx.params;
    const token  = bearerToken(req);
    if (!SYNC_ID.test(id) || token === null) return notFound();

    const parsed = donationDocSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

    const hash   = tokenHash(token);
    const stored = await withTransaction({ name: "donations.put" }, async (tx) => {
      const row = await tx.select().from(donationConfigs).where(eq(donationConfigs.syncId, id)).maybeSingle("donations.put");

      if (row === null) {
        await tx.insert(donationConfigs).values({ syncId: id, authHash: hash, doc: parsed.data, createdAt: nowDate(), updatedAt: nowDate() });
        return true;
      }

      if (!hashesMatch(row.authHash, hash)) return false;

      await tx.update(donationConfigs).set({ doc: parsed.data, updatedAt: nowDate() }).where(eq(donationConfigs.syncId, id));
      return true;
    });

    return stored ? NextResponse.json({ ok: true }) : notFound();
  });
}

// Edits arrive as ops and apply against the doc the server holds RIGHT NOW, inside the
// serializable transaction, so concurrent sessions compose instead of overwriting.
// The response is the updated doc, letting the client reconcile its optimistic copy.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, async () => {
    if (rateLimited(`donations:${clientIp(req)}`, REQUESTS_PER_MINUTE)) return tooMany();

    const { id } = await ctx.params;
    const token  = bearerToken(req);
    if (!SYNC_ID.test(id) || token === null) return notFound();

    const parsed = donationPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

    const hash    = tokenHash(token);
    const outcome = await withTransaction({ name: "donations.patch" }, async (tx) => {
      const row = await tx.select().from(donationConfigs).where(eq(donationConfigs.syncId, id)).maybeSingle("donations.patch");

      if (row === null) {
        const doc = applyDonationPatch(EMPTY_DONATION_DOC, parsed.data);
        await tx.insert(donationConfigs).values({ syncId: id, authHash: hash, doc, createdAt: nowDate(), updatedAt: nowDate() });
        return doc;
      }

      if (!hashesMatch(row.authHash, hash)) return null;

      const current = donationDocSchema.safeParse(row.doc);
      const doc     = applyDonationPatch(current.success ? current.data : EMPTY_DONATION_DOC, parsed.data);
      await tx.update(donationConfigs).set({ doc, updatedAt: nowDate() }).where(eq(donationConfigs.syncId, id));
      return doc;
    });

    return outcome === null ? notFound() : NextResponse.json(outcome);
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
