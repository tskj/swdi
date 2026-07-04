import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRequest } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Railway's healthcheck (railway.json `healthcheckPath: "/api/health"`) gates a new deploy from
// receiving traffic: a 200 marks the build ready. The probe touches the DB so traffic isn't routed
// until Postgres is reachable over the private network — that mesh can take a couple of seconds to
// come up on a fresh container (the same race scripts/migrate.mjs retries around). No retry loop
// here: Railway re-polls this path until it goes green (within `healthcheckTimeout`), so repeated
// probing IS the retry. A DB failure throws; withRequest logs it and the route returns 500, which
// Railway reads as "not ready yet".
export async function GET(req: Request) {
  return withRequest(req, async () => {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  });
}
