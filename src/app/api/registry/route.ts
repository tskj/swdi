import { NextResponse } from "next/server";
import { registrySchema } from "@swdi/shared";
import { withRequest } from "@/lib/log";
import registryJson from "../../../../registry/registry.json";

export const runtime = "nodejs";

// The registry interface is a URL the dashboard can be pointed at; this is the default
// one. v0 serves the versioned JSON from the repo. The file is hand-edited (and later
// community-edited), so it is parsed at the boundary rather than trusted; a broken edit
// fails loudly at module load instead of serving garbage.
const registry = registrySchema.parse(registryJson);

export async function GET(req: Request) {
  return withRequest(req, async () => {
    return NextResponse.json(registry, {
      headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  });
}
