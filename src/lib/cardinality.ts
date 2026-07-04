import { QueryPromise } from "drizzle-orm";
import { ensure, fail } from "@/lib/assert";

// Fluent cardinality assertions on Drizzle query builders, so the assertion reads at the END of
// the query instead of wrapping it:
//
//   const entry = await db.select().from(entries).where(eq(entries.id, id)).single("lookup");
//   const page  = await db.select().from(pages).where(...).maybeSingle("page.lookup"); // null on miss
//   const row   = await db.insert(entries).values({...}).returning().single("insert");
//   const taken = await db.select({ x: entries.id }).from(entries).where(...).exists();  // boolean
//
// Every Drizzle PG builder (select / insert·update·delete + .returning()) extends the common
// `QueryPromise<T>` base, so augmenting that one prototype covers them all.
//
// The five say DIFFERENT things, and that's the point — picking the right one documents the
// expected cardinality at the call site. Two axes: how many rows are EXPECTED, and whether zero is
// an error. The `maybe` prefix is the consistent marker for "null on zero rows"; the bare name
// asserts at least one and FAILS on zero.
//
//   ≤1 row is an INVARIANT (cap scan at 2 — enough to PROVE a duplicate; a 2nd row fails LOUDLY):
//     • single(ctx)      — exactly one. 0 → fail, 2+ → fail.
//     • maybeSingle(ctx) — zero or one. 0 → null, 2+ → fail.
//   MANY rows may match; take the TOP one (cap scan at 1, NO duplicate check — that's the point).
//   Pair with `.orderBy(...)` so the pick is deterministic ("latest"); unordered, the row is
//   arbitrary and the name is a lie. This is the replacement for `ORDER BY … LIMIT 1`, which
//   single/maybeSingle can't serve (they'd THROW on the 2nd row):
//     • first(ctx)       — top of ≥1. 0 → fail (you asserted there'd be one).
//     • maybeFirst(ctx)  — top of 0+. 0 → null.
//   PRESENCE only:
//     • exists()         — boolean. The home for the old existence-probe `.limit(1)`.
//
// A raw `.limit(1)` is banned (eslint) precisely because it conflates all five — it can't tell you
// whether a 2nd row would be a bug, and silently hides it if so.
//
// RETURNING builders (insert/update/delete) have no `.limit` and already return exactly the affected
// rows, so they're awaited as-is.

declare module "drizzle-orm" {
  interface QueryPromise<T> {
    /** Exactly one row. 0 and 2+ both fail loudly (and distinctly). */
    single(context: string): Promise<T extends readonly (infer R)[] ? R : never>;
    /** Zero or one. null on none (the legitimate "not found"); 2+ still fails — duplicate detection for free. */
    maybeSingle(context: string): Promise<(T extends readonly (infer R)[] ? R : never) | null>;
    /** Top row of ≥1 (pair with `.orderBy`). Fails on zero — you asserted there'd be one. No duplicate check. */
    first(context: string): Promise<T extends readonly (infer R)[] ? R : never>;
    /** Top row of 0+ (pair with `.orderBy`), or null on none. No duplicate check — deliberate pick-one-of-many. */
    maybeFirst(context: string): Promise<(T extends readonly (infer R)[] ? R : never) | null>;
    /** Does at least one row match? Caps the scan at 1 row — use when 2+ matches is expected/fine. */
    exists(): Promise<boolean>;
  }
}

function pickSingle<R>(rows: R[], context: string): R {
  if (rows.length === 0) fail(`single(${context}): expected exactly 1 row, found none`);
  if (rows.length > 1) fail(`single(${context}): expected exactly 1 row, found ${rows.length}`);
  return ensure(rows[0], `single(${context}): unreachable`);
}

function pickMaybe<R>(rows: R[], context: string): R | null {
  if (rows.length === 0) return null;
  if (rows.length > 1) fail(`maybeSingle(${context}): expected 0 or 1 rows, found ${rows.length}`);
  return ensure(rows[0], `maybeSingle(${context}): unreachable`);
}

function pickFirst<R>(rows: R[], context: string): R {
  if (rows.length === 0) fail(`first(${context}): expected at least 1 row, found none`);
  return ensure(rows[0], `first(${context}): unreachable`);
}

// Cap the scan at `n` rows when the builder exposes `.limit` (SELECTs); RETURNING builders don't,
// so they're awaited as-is. single/maybeSingle want 2 (prove-a-duplicate); first/maybeFirst/exists
// want 1 (no duplicate check — by design for first/maybeFirst, irrelevant for exists).
function boundedTo(qp: QueryPromise<unknown>, n: number): PromiseLike<unknown[]> {
  const limit = (qp as unknown as { limit?: (n: number) => PromiseLike<unknown[]> }).limit;
  if (typeof limit === "function") return limit.call(qp, n);
  return qp as unknown as PromiseLike<unknown[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function patch(proto: any): void {
  proto.single = function single(this: QueryPromise<unknown>, context: string) {
    return Promise.resolve(boundedTo(this, 2)).then((rows) => pickSingle(rows as unknown[], context));
  };
  proto.maybeSingle = function maybeSingle(this: QueryPromise<unknown>, context: string) {
    return Promise.resolve(boundedTo(this, 2)).then((rows) => pickMaybe(rows as unknown[], context));
  };
  proto.first = function first(this: QueryPromise<unknown>, context: string) {
    return Promise.resolve(boundedTo(this, 1)).then((rows) => pickFirst(rows as unknown[], context));
  };
  // `context` is required by the type (call-site symmetry with first/single) but unused at runtime —
  // maybeFirst never fails, so there's no message to build. Omit the param to avoid an unused-var lint.
  proto.maybeFirst = function maybeFirst(this: QueryPromise<unknown>) {
    return Promise.resolve(boundedTo(this, 1)).then((rows) => (rows as unknown[])[0] ?? null);
  };
  proto.exists = function exists(this: QueryPromise<unknown>) {
    return Promise.resolve(boundedTo(this, 1)).then((rows) => (rows as unknown[]).length > 0);
  };
}

// Patch the statically-imported QueryPromise. Sufficient when there's a single drizzle-orm copy
// (dev, plain Node, tests).
patch(QueryPromise.prototype as any);

// …but Next's PRODUCTION bundle can emit a SECOND copy of drizzle-orm, and the page's query builders
// extend the QueryPromise from *that* copy — so the static patch above lands on the wrong class and
// `.single()`/`.maybeSingle()` come back "not a function" at runtime. installCardinality() walks a LIVE
// query (off the real `db`) down to its thenable base — the QueryPromise every builder kind shares,
// in whichever copy `db` actually uses — and patches that exact class. Called once from
// src/lib/db/index.ts with a throwaway query that is constructed but never executed.
let installed = false;
export function installCardinality(sampleQuery: object): void {
  if (installed) return;

  let proto: any = Object.getPrototypeOf(sampleQuery);
  let base: any = null;
  while (proto && proto !== Object.prototype) {
    if (typeof proto.then === "function") base = proto; // deepest thenable proto = the QueryPromise base
    proto = Object.getPrototypeOf(proto);
  }
  if (!base) return;

  installed = true;
  if (base !== (QueryPromise.prototype as any)) patch(base);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
