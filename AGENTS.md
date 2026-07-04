# Agent guide

**Before making code changes, read `docs/HOUSE_STYLE.md`** and follow the relevant section for the
kind of code you're touching. It is the source of truth for how code here is *structured*:

- **Formatting** — alignment as parallel structure, blank-line grouping, blank line after every
  guard, 2-space indent, no trailing whitespace (no Prettier).
- **Logging** — the EAV logger `src/lib/log.ts` (`log.info/warn/error`, `withRequest`,
  `withBackgroundTask`). **No `console.*` in server app code.**
- **DB cardinality** — express intent with `src/lib/cardinality.ts` helpers
  (`.single()`/`.maybeSingle()`/`.first()`/`.maybeFirst()`/`.exists()`); **`.limit(1)` is eslint-banned.**
- **Transactions** — wrap **two or more reads** (consistent snapshot) or **two or more writes**
  (all-or-nothing) in `withTransaction({ name }, async (tx) => …)` from `src/lib/db-tx.ts`. A single
  statement is already atomic.
- **Assertions** — `ensure`/`fail`/`unreachable` from `@swdi/shared` (re-exported by
  `src/lib/assert.ts`, which adds `shouldNever`).
- **Time** — route through `shared/src/clock.ts`, never `Date.now()` / zero-arg `new Date()`.
- **Boundary validation** — parse untrusted data with zod, don't cast.

Environment, local dev and deployment are documented in `README.md`. Project invariants and
conventions (local-first, the shared-schema contract, extension rules, prose tone) are in `CLAUDE.md`.
