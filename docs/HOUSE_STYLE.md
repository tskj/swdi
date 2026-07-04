# House style

How code in this repo is *structured* — formatting, logging, DB-query cardinality, assertions, and
boundary validation. These are intentional and enforced (eslint where mechanizable, convention
otherwise).

> **Before finalizing any code, re-read the relevant section below.** The natural urge is to produce
> one long uniform run of lines with a `console.log` and a `.limit(1)`; these conventions actively
> counteract that.

---

## 1. Formatting (no Prettier, no auto-format)

The style would fight a formatter, so there isn't one. One principle drives all of it: **whitespace
shows structure, in both directions**. Horizontal whitespace (padding to shared columns) says "these
lines are rows of one table — read the differences". Vertical whitespace (blank lines) says "a
different thing starts here". Alignment is never about the tokens (`=`, `:`, `return`) — it's about
**parallel structure**: when adjacent lines do the same kind of thing, pad so their identical parts
sit in identical columns and the differences pop out like a diff. When adjacent lines do *different*
things, separate them with a blank line — never share padding across the gap; that's a fake table.
Apply the rules *together* — a wall of evenly-spaced lines with no grouping is the wrong shape even
when each line is individually correct.

Mechanics underneath: **2-space indentation, never tabs** (the column rules assume a fixed grid),
and **no trailing whitespace**, including on blank lines.

- **Align within a contiguous block.** Where consecutive lines share structure, line up the `=`
  signs, object-literal `:` values, `return`s of parallel guards, and the repeated arguments of
  parallel calls:

  ```ts
  const RESUME_PURPOSE = "provisional-resume";
  const RESUME_TTL_MS  = PROVISIONAL_RESUME_COOKIE_MAX_AGE * 1000;
  ```

  ```ts
  if (timer === 0) return `${rest} min`;
  if (rest === 0)  return `${timer} t`;
  ```

- **Parallel `if`/`else` branches are one table**, even though a `} else {` sits between the rows.
  When the two bodies are the same operation, align the mirrored parts *across* the branch boundary:

  ```ts
  if (arg3 === undefined) {
    emit({ e: SYSTEM_ENTITY, a: arg1,           v: arg2, ts: nowDate() });
  } else {
    emit({ e: arg1,          a: arg2 as string, v: arg3, ts: nowDate() });
  }
  ```

  Aligned, you *see* which argument moved slots without parsing either line. Short paired
  `if`/`else` bodies go on one line each for the same reason — the eye scans the branches as rows:

  ```ts
  if (keyboardOpen) section.style.height = `${Math.round(vv.height - TOPNAV_HEIGHT_PX)}px`;
  else              section.style.removeProperty("height");
  ```

  A chain of one-line bodies can go full decision-table — keyword column, condition column, body
  column:

  ```ts
  let text: string;
  if       (level === "read")    text = "✓";
  else if  (level === "partial") text = `${pct}%`;
  else                           text = "";
  ```

  The condition column is optional taste; aligning the *bodies* is the part that matters.

- **Know when to stop.** Alignment is for small variance — if padding would push the value column
  more than ~6–8 chars past the shortest line, *don't* align; split the block with a blank line
  instead. Don't re-pad a naturally-aligned group to match a wider neighbouring group (blank line
  between them, each group reads as its own table). And don't align adjacent lines that merely look
  alike but do different things:

  ```ts
  let value = 0;
  let bits  = 0;

  const result: number[] = [];
  ```

  `value`/`bits` are one thing (the rolling bit-window); `result` is another (the output
  accumulator). The `const`/`let` keyword-width mismatch would also fight the `=` column — mixed
  keywords are themselves a signal to split, unless a coincidental width offset lands the `=` at
  the same column anyway.

- **Blank lines as grouping.** Inside any non-trivial function body, separate sub-tasks with blank
  lines. Canonical progression: read inputs / set up refs → derive constants → define inner fns /
  build payloads → wire events / fetch / commit → return cleanup. Each chunk is its own alignment
  block.
- **Guards are brace-free one-liners, and they end their step.** `if (!x) return;` / `throw` /
  `notFound()` closes "the part where we got x": no blank line between a guard and the line it
  directly validates, a blank line *after* every guard, and never vertically-align a guard's
  `return` with the declarations above it — a guard is the *end* of a step, not a row in their
  table. (A run of *consecutive* short guards is its own table — the `timer`/`rest` example above.)

  ```ts
  const id = parseUuidParam(param);
  if (!id) notFound();

  const data = await fetchData();
  if (!data) return null;
  ```

- **A comment attaches downward.** Blank line *above* a leading comment, none between it and the
  code it documents. A comment with no blank line above clings to the code above it, which is
  wrong — it's there to explain the code *below*.
- **Not a rule: extra spaces after `if (…)`.** Padding before an inline body exists only as a
  *consequence* of aligning parallel bodies — a shorter condition gets padded out to the shared
  column. A lone `if` takes a single space. (Earlier versions of this doc stated "two spaces
  minimum after `if (…)`" as a freestanding rule; that was a mis-distillation of this side-effect.)
- **Tests get the same treatment** as source — readable test code is debuggable test code.

### Worked examples

**Three-column accumulator table.** Spaces go *before* the operator so `=` / `+=` line up, and the
values align too:

```ts
if (outcome === "sent")    result.sent   += 1;
if (outcome === "empty")   result.empty  += 1;
if (outcome === "failed")  result.failed += 1;
```

**Switch as a table.** Cases padded so the `return` column aligns:

```ts
switch (level) {
  case "read":    return "You have read this";
  case "partial": return "You have partly read this";
  case "none":    return "";
}
```

**Split when variance dominates.** `now` is much shorter than the formatters, so aligning all three
forces 10+ spaces of padding for `now`. Break it out, then align the related pair below it:

```ts
const now = nowDate();

const clientToday   = formatDate(now, prefs);
const clientWeekday = formatWeekday(now, prefs);
```

**Three-way subgroup split.** Eight counters spanning 6–25 chars of name length don't go in one
block — split by what they count, align within each group:

```ts
let embedded = 0;
let failed   = 0;
let batches  = 0;

let attachmentCaptioned    = 0;
let attachmentClipEmbedded = 0;
let attachmentFailed       = 0;

let captionParagraphsInserted = 0;
let modelActivityTouched      = false;
```

**The full shape.** Five blank-line-separated chunks: guard → guard → constants → inner handler →
wiring. Each guard sits on its own line followed by a blank line, aligned with nothing; the
constants align at `=`; the paired `if`/`else` inside the handler aligns as branches:

```ts
useEffect(() => {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return;

  const section = editorSectionRef.current;
  if (!section) return;

  const TOPNAV_HEIGHT_PX      = 56;
  const KEYBOARD_THRESHOLD_PX = 150;

  const update = () => {
    const keyboardOpen = (window.innerHeight - vv.height) > KEYBOARD_THRESHOLD_PX;
    if (keyboardOpen) section.style.height = `${Math.round(vv.height - TOPNAV_HEIGHT_PX)}px`;
    else              section.style.removeProperty("height");
  };

  vv.addEventListener("resize", update);
  return () => vv.removeEventListener("resize", update);
}, []);
```

---

## 2. Logging — the EAV logger (`src/lib/log.ts`)

Structured, EAV-shaped event logging. **Don't use `console.*` in server app code.**

- One fact = one tuple `[e, a, v, ts]`. `log.info(attr, value)` asserts on the current scope's
  entity; `log.info(entity, attr, value)` asserts on an explicit entity (e.g. a registry-entry id,
  so that entry's whole history reads as one timeline).
- **Log semantically and liberally.** Prefer a fact describing *what happened* over a freeform
  string. Add new attributes to the `Attr` table in `src/lib/log.ts` — never invent attribute
  strings at call sites (the constants give grep-ability and let TS catch typos). The table
  currently holds the generic lifecycle attributes the logger emits itself; grow it as routes and
  actions land.
- `log.warn(kind, message, ctx)` / `log.error(kind, message, ctx)` route through the operator
  notification sink (`src/lib/report.ts`), keyed by a stable hierarchical `kind`. Use these for
  "a human should know"; use `log.info` for "this happened, make it queryable." (No mailer is wired
  yet, so report() currently just writes a structured line to the console — attach one via
  `setOperatorMailer` when you want notifications.)
- **`withRequest(req, fn)`** wraps a route handler: gives it its own ALS-scoped request entity,
  emits method/path/status/latency facts, writes a `canonical` line on close, and routes any uncaught
  error through `log.error("request.uncaught")` so a bare 500 is never silent.
  ```ts
  export async function POST(req: NextRequest) {
    return withRequest(req, async () => {
      // log.info / log.warn / log.error all correlated to this request's entity
      return NextResponse.json({ ok: true });
    });
  }
  ```
- **`withBackgroundTask(name, fn, ctx?)`** wraps work outside a request's lifetime (a cron tick,
  a boot-time seed): its own entity, started/ended/latency facts, a canonical-task line on close,
  and errors caught + routed to report() (never rethrown — nobody's awaiting it).

**Legitimate `console.*` (do NOT convert):**
- `src/lib/report.ts` — it *is* the operator sink; its console writes are the channel.
- `src/lib/log.ts` — the EAV stdout sink itself.
- Client components (`"use client"`) and extension code — they can't import the `server-only` logger.
- Standalone Node processes (`scripts/*.mjs`) — `console` is their output channel.

---

## 3. DB query cardinality — never `.limit(1)`

`.limit(1)` silently hides a uniqueness bug, so it's **banned by eslint** (`no-restricted-syntax` in
`eslint.config.mjs`). Express the intended cardinality with the fluent helpers in
`src/lib/cardinality.ts`, which read at the *end* of the query. The `maybe` prefix consistently means
"**`null` on zero rows**"; the bare name **fails on zero**.

| Helper | Meaning | On 0 rows | On 2+ rows |
| --- | --- | --- | --- |
| `.single("ctx")` | exactly one — an invariant | **fails loudly** | **fails loudly** |
| `.maybeSingle("ctx")` | zero or one — `null` is legit "not found" | `null` | **fails loudly** |
| `.first("ctx")` | top of ≥1, ordered (pair with `.orderBy`) | **fails loudly** | returns the top row |
| `.maybeFirst("ctx")` | top of 0+, ordered (pair with `.orderBy`) | `null` | returns the top row |
| `.exists()` | does *any* row match? (2+ is fine) | `false` | `true` |

- Use `.single` after `insert(...).returning()` (exactly one affected row guaranteed) and for
  by-id / by-unique-key lookups where a 2nd row is a bug.
- Use `.maybeSingle` for the same lookups when "not found" is normal (a by-id page lookup where the
  row may simply not exist yet).
- Use `.first` / `.maybeFirst` for a **deliberate pick-one-of-many** — the old `ORDER BY … LIMIT 1`
  ("latest", "highest priority"). They return the top row with *no* duplicate check, so pair with
  `.orderBy(...)`; an unordered call returns an arbitrary row. `maybeSingle` can't serve this (it
  throws on the 2nd row). Pick `.first` when there must be at least one, `.maybeFirst` when zero is
  fine.
- Use `.exists()` for **existence probes** — where more than one matching row is legitimately
  possible and you only care whether *any* exists. This is the correct home for the old
  `.limit(1) … .length > 0` pattern.
- Count-based checks that intentionally read many rows (`rows.length >= N`) are fine as-is — they
  aren't `.limit(1)` and the rule doesn't touch them.

The helpers are installed by `installCardinality(...)` in `src/lib/db/index.ts`, which patches the
QueryPromise base reached from a *live query off `db`*. It's done this way (rather than patching a
statically-imported `QueryPromise`) because Next's production bundle can emit a second copy of
drizzle-orm; patching the imported copy would miss the one the page's queries actually extend and make
`.single()` "not a function" in production. Deriving the prototype from a real query patches the exact
class — whichever copy `db` uses.

---

## 4. Invariants & assertions (`@swdi/shared`, extended by `src/lib/assert.ts`)

Make "this can't happen" executable. Reach for the narrowest helper that fits — each documents a
different shape of expectation, and the wrong silence (a bare `!`, a swallowed branch) is how an
invariant violation becomes a confusing downstream crash.

| Helper | Use when | On violation |
| --- | --- | --- |
| `ensure(v, msg)` | a value can't be null/undefined *here* (narrows the type) | throws |
| `fail(msg)` | a hard invariant break, incl. `x ?? fail("…")` chains | reports + throws |
| `unreachable(v)` | exhaustiveness — a discriminated-union `switch` default | throws (compile-time too) |
| `shouldNever(cond, [sub,] msg)` | an "impossible" branch you'd rather **recover** from than crash in prod | see below |

- **`ensure` over `!`.** A non-null assertion (`rows[0]!`) is a silent claim; `ensure(rows[0], "…")`
  is a checked one that names the invariant and fails loudly if wrong. Use the cardinality helpers
  (`.single`/`.first`) for query rows — they already assert. Reserve `!` for genuinely hot/math paths
  where the index is locally proven, and add a comment.
- **`fail` for `??` fallbacks** that should never be taken: `const id = session.user?.id ?? fail("session has no user id")`. It reports through the operator sink *and* throws, and returns `never` so it composes inside expressions.
- **`unreachable` in `switch` defaults** over a union — the compiler then errors if a new variant is
  added without a case, and it throws at runtime if a type-system escape hatch slips through.
- **`shouldNever(cond, "sub-kind", msg)`** is the soft assert: the call site believes `cond` is
  always false. It returns the *effective* boolean so a recovery branch reads inline
  (`if (shouldNever(…)) return fallback;`). A truthy predicate reports the `should-never[:sub]` kind
  and — in dev/test — **throws**; in prod it returns `true` so the recovery runs. Tests that exercise
  the recovery on purpose wrap the call in `withShouldNeverAllowed(…)`. Setting
  `FAULT_INJECT_IMPOSSIBLE_STATE` (a 1–100 percentage) deliberately forces the recovery branch. Use
  `shouldNever` only where there's a *real* recover-in-prod branch — for pure narrowing or
  no-recovery invariants, the hard asserts (`ensure`/`fail`/`unreachable`) are the right tool.

---

## 5. Time & transactions (`shared/src/clock.ts`, `src/lib/db-tx.ts`)

- **Route all time through `shared/src/clock.ts`** (`nowMs()` / `nowDate()` / `nowIso()`), never
  `Date.now()` or zero-arg `new Date()` — tests drive a synthetic clock via `withClock(...)`.
- **Wrap multi-statement DB work in `withTransaction({ name }, async (tx) => …)`** — and use `tx`, not
  `db`, for every query inside. It runs `SERIALIZABLE` with bounded retry on serialization-failure /
  deadlock, so you stop reasoning about interleavings and let Postgres referee. Wrap whenever an
  endpoint does:
  - **two or more reads** — so they observe one consistent snapshot (no row appearing, vanishing, or
    changing between queries). This is not optional: any handler/loader issuing ≥2 selects belongs in
    a transaction.
  - **two or more writes**, or a read-then-write that must stay consistent — so they commit
    all-or-nothing.

  A *single* statement is already atomic — leave it on the plain `db` call. Don't wrap a single
  statement just to wrap it.

---

## 6. Validate untrusted data at the boundary (zod)

Data crossing a trust boundary **into** the app is **parsed** (zod), never **cast** (`as`). A cast is a
lie the type-checker believes; a parse is a check the runtime enforces. The boundaries:

- **The wire** — HTTP request bodies/params, and responses a client reads back off the network.
- **The database's untyped escape hatches** — `jsonb` columns (drizzle types the column with `$type`,
  but the bytes are whatever's stored; an old or hand-edited row is untrusted on read). Plain typed
  columns are already guaranteed by drizzle — don't re-validate those.
- **The browser** — `localStorage` / `chrome.storage` / query params / `postMessage`, and the
  extension's runtime messages between its own contexts.
- **Process env** and **external APIs**.

Rules:

- **Make the schema the source of truth where the shape is non-trivial.** `z.infer` the TS type *from*
  the schema so the two can't drift. The shared data model lives as zod schemas in
  `shared/src/schema.ts`; table-adjacent schemas belong next to the tables in `src/lib/db/schema.ts`.
  Export and reuse them rather than declaring parallel types.
- **Fail safe for presentational / optional data; throw for genuine bad input.** A malformed stored
  blob should degrade, not crash a page — use `schema.catch(fallback)` or `safeParse`. Reserve a
  throwing `.parse` for a boundary where *rejecting* is the correct response (a bad request body).
- **A trivial scalar boundary doesn't need a schema.** Reach for zod once the boundary value has
  *structure* (objects/arrays/enums).
