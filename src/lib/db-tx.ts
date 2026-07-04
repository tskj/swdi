import "server-only";
import { db } from "@/lib/db";
import { Attr, log } from "@/lib/log";

// SERIALIZABLE by default with bounded retry on serialization failure / deadlock. For a
// low-contention app this is the cheapest correct concurrency story: stop reasoning about
// interleavings and let Postgres referee.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected
const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 10;

// postgres-js throws PostgresError with .code; drizzle sometimes wraps it under .cause.
export function pgErrorCode(err: unknown): string | null {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  if (e && typeof e.code === "string") return e.code;
  if (e && e.cause && typeof e.cause.code === "string") return e.cause.code;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransaction<T>(
  opts: { name?: string; maxAttempts?: number },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await db.transaction(fn, { isolationLevel: "serializable" });
    } catch (err) {
      lastErr = err;
      const code = pgErrorCode(err);
      const retryable = code !== null && RETRYABLE_SQLSTATES.has(code);
      if (!retryable || attempt === maxAttempts) throw err;

      log.info(Attr.DB_TX_RETRIED, { name: opts.name ?? null, attempt, code: code ?? null });
      const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(base + Math.random() * base); // jitter
    }
  }
  throw lastErr; // unreachable; satisfies the return type
}
