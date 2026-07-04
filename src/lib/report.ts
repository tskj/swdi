// The operator-notification sink: a tiny channel for "this shouldn't happen, but if it does a
// human wants to know." Not a logging framework. Throttled per-kind so a bug loop can't flood
// the inbox (leading edge fires immediately; repeats within the window coalesce into one
// trailing summary). The mailer is attached at startup via a globalThis hook — never a static
// import — so this module stays safe to pull in from client-boundary files. No mailer is wired
// yet, so report() currently just writes the structured line to the console.

import { nowIso, nowMs } from "@swdi/shared";

export type ReportPayload = {
  kind: string; // dedup bucket — pick stable, hierarchical names ("sync.push-rejected")
  severity?: "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
};

export type OperatorMailer = (fields: {
  kind: string;
  severity: string;
  message: string;
  count: number;
  context?: Record<string, unknown>;
}) => Promise<void>;

const NOTIFY_WINDOW_MS = 5 * 60 * 1000;

type Bucket = { count: number; firstAt: number; timer: ReturnType<typeof setTimeout> | null };
const buckets = new Map<string, Bucket>();

const hookHost = globalThis as typeof globalThis & { __swdiOperatorMailer?: OperatorMailer | null };

export function setOperatorMailer(fn: OperatorMailer | null): void {
  hookHost.__swdiOperatorMailer = fn;
}

function mailer(): OperatorMailer | null {
  return hookHost.__swdiOperatorMailer ?? null;
}

function deliver(kind: string, severity: string, message: string, count: number, context?: Record<string, unknown>): void {
  const fn = mailer();
  if (!fn) return;

  fn({ kind, severity, message, count, context }).catch((err) => {
    // Never let the notifier's own failure become an unhandled rejection.
    console.error(`[report] operator mailer threw for kind=${kind}:`, err);
  });
}

export function report(payload: ReportPayload): void {
  const severity = payload.severity ?? "error";

  const line = JSON.stringify({ at: nowIso(), level: severity, kind: payload.kind, message: payload.message, ...payload.context });
  if (severity === "error") console.error(line);
  else console.warn(line);

  // Client side: log only. The operator watches the server stream.
  if (typeof window !== "undefined") return;

  const now = nowMs();
  const existing = buckets.get(payload.kind);

  if (!existing) {
    // Leading edge — notify immediately, then open a window to coalesce repeats.
    const timer = setTimeout(() => {
      const b = buckets.get(payload.kind);
      buckets.delete(payload.kind);
      if (b && b.count > 1) {
        deliver(payload.kind, severity, `${payload.message} (×${b.count} in ${Math.round(NOTIFY_WINDOW_MS / 60000)}m)`, b.count, payload.context);
      }
    }, NOTIFY_WINDOW_MS);
    if (typeof timer.unref === "function") timer.unref();

    buckets.set(payload.kind, { count: 1, firstAt: now, timer });
    deliver(payload.kind, severity, payload.message, 1, payload.context);
    return;
  }

  existing.count += 1;
}
