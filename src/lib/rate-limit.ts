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
    if (buckets.size >= MAX_BUCKETS) evictExpired(now);

    // Full of live buckets: let this key through untracked. Every existing counter
    // stays intact, which is what matters; the old clear-everything overflow let a
    // key-minting flood reset everyone, and evicting to make room would let it
    // forget victims' counters one by one. The flood itself loses nothing by going
    // untracked, since a fresh identity per request already defeats per-key limits.
    if (buckets.size >= MAX_BUCKETS) return false;

    buckets.set(key, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

function evictExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

// Each proxy hop APPENDS to X-Forwarded-For, so only the rightmost entry was written
// by our own trusted hop (Railway's edge); everything left of it arrived from the
// client and can be forged freely. Taking the leftmost entry let one machine mint a
// fresh rate-limit identity per request. This assumes exactly one trusted hop; see
// KNOWN_ISSUES if the proxy topology ever changes.
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded === null) return "unknown";

  const parts = forwarded.split(",");
  return parts[parts.length - 1]?.trim() || "unknown";
}
