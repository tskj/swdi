import "server-only";
import { nowMs } from "@/lib/clock";

// Fixed-window in-memory rate limiter. The app runs as one instance, so local state
// is the whole truth; a restart forgiving everyone is an acceptable failure mode for
// this tier. The sync API needs this because a brought-text sync key makes guessing
// online-verifiable: every candidate phrase is one GET.

const WINDOW_MS   = 60_000;
const MAX_BUCKETS = 10_000;

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();

export function rateLimited(key: string, limit: number): boolean {
  const now    = nowMs();
  const bucket = buckets.get(key);

  if (bucket === undefined || now - bucket.windowStart >= WINDOW_MS) {
    // Crude memory cap: dropping every window is kinder than growing without bound,
    // and it errs toward letting requests through.
    if (buckets.size >= MAX_BUCKETS) buckets.clear();

    buckets.set(key, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded === null) return "unknown";

  return forwarded.split(",")[0]?.trim() ?? "unknown";
}
