import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { nowDate } from "./clock";
import { report } from "./report";

// EAV-shaped structured event logger.
//
// One fact = one tuple [e, a, v, ts]:
//   e — entity (a UUID, or one of the pinned constants below)
//   a — attribute, a ":namespace/name" string from `Attr`
//   v — value (string | number | boolean | null | Date | object)
//   ts — server clock at emission
//
// Facts that belong together share an `e`: a request carries its own entity, anything it touches is
// asserted back onto that entity, and so on. Parent→child links are themselves facts, not a separate
// table. Sinks for now: stdout JSON lines per fact + one canonical line per task/request on close.
// The logger is request/task-scoped via AsyncLocalStorage; the ambient `log` proxy delegates to
// whichever scope is current, falling through to a system logger outside one.

// "System" is the implicit entity for facts emitted outside a request/task scope (module init,
// the boot sequence, scripts). The UUID is fixed so it queries cleanly later.
export const SYSTEM_ENTITY = "00000000-0000-4000-8000-000000000001";

// --- Attribute vocabulary ---
// All attributes used by the EAV log live here, not invented at call sites — the constants give
// grep-ability and let TS catch typos. Add new domain attributes to this table as you wire logging
// into routes/actions (e.g. REGISTRY_ENTRY_CREATED: ":registry/entry-created"). The ones below are
// the generic lifecycle attributes the logger machinery itself emits.
export const Attr = {
  // generic scope lifecycle (auto-emitted by .scope() and its disposer)
  SCOPE_STARTED_AT: ":scope/started-at",
  SCOPE_ENDED_AT:   ":scope/ended-at",

  // background-task entity (one per withBackgroundTask invocation)
  TASK_NAME:       ":task/name",
  TASK_STARTED_AT: ":task/started-at",
  TASK_ENDED_AT:   ":task/ended-at",
  TASK_LATENCY_MS: ":task/latency-ms",
  TASK_ERROR:      ":task/error",

  // request lifecycle (one entity per withRequest invocation)
  REQUEST_STARTED_AT: ":request/started-at",
  REQUEST_ENDED_AT:   ":request/ended-at",
  REQUEST_METHOD:     ":request/method",
  REQUEST_PATH:       ":request/path",
  REQUEST_STATUS:     ":request/status",
  REQUEST_LATENCY_MS: ":request/latency-ms",
  REQUEST_ERROR:      ":request/error",

  // DB transaction retries — emitted on SERIALIZABLE failure before each retry so contention is queryable.
  DB_TX_RETRIED: ":db-tx/retried", // value: { name, attempt, code }
} as const;

export type Attr = (typeof Attr)[keyof typeof Attr];

// What can live in V. Date is allowed for ergonomics; serialised to an ISO string at emit time.
export type FactValue =
  | string
  | number
  | boolean
  | null
  | Date
  | { [k: string]: unknown };

// Public Logger contract.
//
// `info` has two overloads: zero-E (assert on the current scope's entity) and explicit-E (assert a
// fact about a different entity — e.g. a registry entry's id). Both record one fact.
//
// `warn` / `error` route through report() — the operator-notification sink — keyed by `kind` (the
// per-kind dedup bucket). They do NOT emit an EAV fact; they're for "a human should know," whereas
// `info` is for "this happened, make it queryable."
export interface Logger {
  info(a: Attr | string, v: FactValue): void;
  info(e: string, a: Attr | string, v: FactValue): void;

  scope(a: Attr | string, newE: string): ScopedLogger;

  warn(kind: string, message: string, context?: Record<string, unknown>): void;
  error(kind: string, message: string, context?: Record<string, unknown>): void;

  readonly entity:    string;
  readonly requestId: string;
}

export interface ScopedLogger extends Logger, Disposable {}

// --- Internals ---

type Fact = { e: string; a: string; v: FactValue; ts: Date };

type RequestState = {
  requestId: string;
  facts:     Fact[];
  stack:     LoggerImpl[];
};

const als = new AsyncLocalStorage<RequestState>();

class LoggerImpl implements ScopedLogger {
  constructor(
    private readonly state:     RequestState,
    public  readonly entity:    string,
    private readonly closeFact: { e: string; a: string } | null,
  ) {}

  get requestId(): string {
    return this.state.requestId;
  }

  info(arg1: string, arg2: FactValue, arg3?: FactValue): void {
    if (arg3 === undefined) {
      // (a, v) — the current entity is the E
      this.assert(this.entity, arg1,           arg2);
    } else {
      // (e, a, v) — explicit E
      this.assert(arg1,        arg2 as string, arg3);
    }
  }

  scope(a: string, newE: string): ScopedLogger {
    const ts = nowDate();
    this.assert(this.entity, a, newE, ts);
    this.assert(newE, Attr.SCOPE_STARTED_AT, ts.toISOString(), ts);

    const child = new LoggerImpl(this.state, newE, { e: newE, a: Attr.SCOPE_ENDED_AT });
    this.state.stack.push(child);
    return child;
  }

  [Symbol.dispose](): void {
    if (this.closeFact) {
      this.assert(this.closeFact.e, this.closeFact.a, nowDate().toISOString());
    }
    // Pop only if we're on top — out-of-order disposal would mean a child logger outlived its
    // parent's `using` block, a structured-concurrency violation. No-op tolerantly; the emitted
    // facts still tell the truth about lifetime ordering.
    const top = this.state.stack[this.state.stack.length - 1];
    if (top === this) this.state.stack.pop();
  }

  warn(kind: string, message: string, context?: Record<string, unknown>): void {
    report({ kind, severity: "warn", message, context: this.contextWithEntity(context) });
  }

  error(kind: string, message: string, context?: Record<string, unknown>): void {
    report({ kind, severity: "error", message, context: this.contextWithEntity(context) });
  }

  private contextWithEntity(extra?: Record<string, unknown>): Record<string, unknown> {
    return { entity: this.entity, requestId: this.state.requestId, ...extra };
  }

  private assert(e: string, a: string, v: FactValue, ts: Date = nowDate()): void {
    const fact: Fact = { e, a, v, ts };
    this.state.facts.push(fact);
    emit(fact);
  }
}

// Logger used outside a request/task scope. Doesn't accumulate facts (no canonical line will ever
// flush) — just emits and routes warn/error through report(). `scope()` runs in a transient state so
// per-step timing is still queryable, but it does not narrow the ambient `log.entity` — there's no
// ALS frame to mutate, and a shared mutable stack on the singleton would be trampled by parallel
// callers. Wrap work in withBackgroundTask if you need a narrowed ambient entity.
class SystemLogger implements Logger {
  readonly entity    = SYSTEM_ENTITY;
  readonly requestId = SYSTEM_ENTITY;

  info(arg1: string, arg2: FactValue, arg3?: FactValue): void {
    if (arg3 === undefined) {
      emit({ e: SYSTEM_ENTITY, a: arg1,           v: arg2, ts: nowDate() });
    } else {
      emit({ e: arg1,          a: arg2 as string, v: arg3, ts: nowDate() });
    }
  }

  scope(a: string, newE: string): ScopedLogger {
    const transient: RequestState = { requestId: SYSTEM_ENTITY, facts: [], stack: [] };
    const root = new LoggerImpl(transient, SYSTEM_ENTITY, null);
    transient.stack.push(root);
    return root.scope(a, newE);
  }

  warn(kind: string, message: string, context?: Record<string, unknown>): void {
    report({ kind, severity: "warn", message, context });
  }

  error(kind: string, message: string, context?: Record<string, unknown>): void {
    report({ kind, severity: "error", message, context });
  }
}

const SYSTEM_LOGGER = new SystemLogger();

function emit(fact: Fact): void {
  console.log(
    JSON.stringify({
      type: "fact",
      ts:   fact.ts.toISOString(),
      e:    fact.e,
      a:    fact.a,
      v:    valueForJson(fact.v),
    }),
  );
}

function valueForJson(v: FactValue): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

// --- Public API ---

// `log` is an ambient handle to the current scope's logger: a Proxy delegating every property
// access to whichever logger is at the top of the ALS stack right now. So `log.info(...)` inside a
// scoped/task block hits the narrower scope, and `log.info(...)` outside one falls through to the
// system logger. No parens (`log.info`, not `log().info`).
export const log: Logger = new Proxy({} as Logger, {
  get(_target, prop) {
    const current = currentLogger();
    const value = (current as unknown as Record<string | symbol, unknown>)[prop as string];
    if (typeof value === "function") return (value as (...args: unknown[]) => unknown).bind(current);
    return value;
  },
});

function currentLogger(): Logger {
  const state = als.getStore();
  if (!state) return SYSTEM_LOGGER;
  return state.stack[state.stack.length - 1] ?? state.stack[0] ?? SYSTEM_LOGGER;
}

// Wrap an API route handler. Establishes its own ALS frame so every `log.*` call inside the handler
// is correlated to a single request entity. Emits method/path/status/latency facts, writes one
// `canonical` line on close, and routes uncaught errors to report() so a raw 500 never disappears
// silently into the Next.js stderr stream.
//
// Usage: return withRequest(req, async () => { ... })
export async function withRequest(
  req:  Request,
  fn:   () => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const state: RequestState = { requestId, facts: [], stack: [] };
  const root = new LoggerImpl(state, requestId, null);
  state.stack.push(root);

  return als.run(state, async () => {
    const path      = redactedPath(new URL(req.url).pathname);
    const startedAt = nowDate();

    root.info(Attr.REQUEST_STARTED_AT, startedAt.toISOString());
    root.info(Attr.REQUEST_METHOD,     req.method);
    root.info(Attr.REQUEST_PATH,       path);

    try {
      const result = await fn();
      root.info(Attr.REQUEST_STATUS, result.status);
      finalizeRequest(state, startedAt);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      root.info(Attr.REQUEST_ERROR, message);
      log.error("request.uncaught", message, { method: req.method, path });
      finalizeRequest(state, startedAt);
      throw err;
    }
  });
}

// Sync ids ride in request paths (/api/sync/<id>), and logging them verbatim would
// let app logs plus platform HTTP logs (IP + timestamp) re-link a person to their
// blob and its donation config, the exact tie the design promises not to make. Log a
// hash salted per boot instead: the same id still correlates within one deploy's
// logs, and correlates to nothing across restarts or outside them.
const PATH_ID_SALT = crypto.randomUUID();

function redactedPath(pathname: string): string {
  return pathname.replace(/[0-9a-f]{32}/g, (id) =>
    `redacted-${createHash("sha256").update(`${PATH_ID_SALT}:${id}`).digest("hex").slice(0, 12)}`);
}

function finalizeRequest(state: RequestState, startedAt: Date): void {
  const endedAt   = nowDate();
  const latencyMs = endedAt.getTime() - startedAt.getTime();

  pushFact(state, state.requestId, Attr.REQUEST_LATENCY_MS, latencyMs);
  pushFact(state, state.requestId, Attr.REQUEST_ENDED_AT,   endedAt.toISOString());

  const summary: Record<string, unknown> = {
    type:       "canonical",
    ts:         endedAt.toISOString(),
    request_id: state.requestId,
    fact_count: state.facts.length,
    latency_ms: latencyMs,
  };
  for (const f of state.facts) {
    if (f.e !== state.requestId) continue;
    if (f.a === Attr.REQUEST_METHOD) summary.method = f.v;
    if (f.a === Attr.REQUEST_PATH)   summary.path   = f.v;
    if (f.a === Attr.REQUEST_STATUS) summary.status = f.v;
    if (f.a === Attr.REQUEST_ERROR)  summary.error  = f.v;
  }

  console.log(JSON.stringify(summary));
}

// Wrap background work — anything that runs outside a request's lifetime (a cron tick, a boot-time
// seed). Establishes its own top-level entity + ALS frame, emits started/ended/latency facts on it,
// and writes one `canonical-task` line on close. Errors are caught, routed through `log.error`
// (→ report), and NOT rethrown — by the time a background task runs nobody is awaiting it, so an
// unhandled rejection would just be noise.
export async function withBackgroundTask<T = void>(
  name:    string,
  fn:      () => Promise<T>,
  context: Record<string, FactValue> = {},
): Promise<T | undefined> {
  const taskId = crypto.randomUUID();
  const state: RequestState = { requestId: taskId, facts: [], stack: [] };
  const root = new LoggerImpl(state, taskId, null);
  state.stack.push(root);

  return als.run(state, async () => {
    const startedAt = nowDate();
    root.info(Attr.TASK_NAME,       name);
    root.info(Attr.TASK_STARTED_AT, startedAt.toISOString());
    for (const [k, v] of Object.entries(context)) {
      // Context keys share the task namespace so they don't collide with attribute constants.
      root.info(`:task/${k}`, v);
    }

    let errorMessage: string | null = null;
    let value: T | undefined;
    try {
      value = await fn();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      root.info(Attr.TASK_ERROR, errorMessage);
      log.error(`task.${name}.failed`, `background task "${name}" failed`, { taskId, err: errorMessage });
    }

    finalizeTask(state, startedAt, name, errorMessage);
    return value;
  });
}

function finalizeTask(state: RequestState, startedAt: Date, name: string, errorMessage: string | null): void {
  const endedAt   = nowDate();
  const latencyMs = endedAt.getTime() - startedAt.getTime();

  pushFact(state, state.requestId, Attr.TASK_LATENCY_MS, latencyMs);
  pushFact(state, state.requestId, Attr.TASK_ENDED_AT,   endedAt.toISOString());

  // Canonical line: one stdout line projecting every fact on the task entity, so ops queries don't
  // need to join across the per-fact lines. The exclusion set covers facts already promoted to
  // top-level summary fields. Last-write wins on duplicate attributes.
  const summary: Record<string, unknown> = {
    type:       "canonical-task",
    ts:         endedAt.toISOString(),
    task_id:    state.requestId,
    name,
    fact_count: state.facts.length,
    latency_ms: latencyMs,
  };
  if (errorMessage) summary.error = errorMessage;
  for (const f of state.facts) {
    if (f.e !== state.requestId) continue;
    if (TASK_PROJECT_EXCLUDE.has(f.a)) continue;
    summary[f.a] = valueForJson(f.v);
  }

  console.log(JSON.stringify(summary));
}

function pushFact(state: RequestState, e: string, a: string, v: FactValue): void {
  const fact: Fact = { e, a, v, ts: nowDate() };
  state.facts.push(fact);
  emit(fact);
}

const TASK_PROJECT_EXCLUDE = new Set<string>([
  Attr.TASK_NAME,
  Attr.TASK_STARTED_AT,
  Attr.TASK_ENDED_AT,
  Attr.TASK_LATENCY_MS,
  Attr.TASK_ERROR,
]);
