import {
  SYNC_DATA_MAX_CHARS,
  SettlementPatch,
  Settlements,
  SyncKeys,
  SyncPayload,
  applySettlementPatch,
  decryptPayload,
  encryptPayload,
  nowIso,
  syncEnvelopeSchema,
} from "@swdi/shared";

// Settlements live inside the E2EE sync payload: whom you paid is a projection of
// what you read, so the server never sees it in the clear. The dashboard edits them
// by pull-apply-push against the blob's version, the same optimistic concurrency the
// extension uses; a 409 means someone pushed since our pull, and one retry with a
// fresh pull replays the edit on top. Failures return null and the caller keeps its
// optimistic copy; the next successful write carries the truth.

/** Replay one settlement edit onto the blob; the settlements as pushed, or null. */
export function pushSettlementPatch(keys: SyncKeys, patch: SettlementPatch): Promise<Settlements | null> {
  return enqueue(() => reviseSettlements(keys, (current) => applySettlementPatch(current, patch)));
}

/**
 * Fold settlements from the legacy plaintext donation doc into the blob, once. Months
 * already in the blob win: the blob is where edits land now, the doc copy is frozen.
 */
export function adoptLegacySettlements(keys: SyncKeys, legacy: Settlements): Promise<Settlements | null> {
  return enqueue(() => reviseSettlements(keys, (current) => ({ ...legacy, ...current })));
}

// Two in-flight pushes from the same session would each pull, apply their own edit,
// and race to PUT; the loser's retry then lands, silently rebasing away the brief
// window where the winner's edit was missing from its pull. Serializing pushes makes
// same-session edits apply in order; cross-session races stay with the version check.
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.then(() => undefined, () => undefined);
  return next;
}

async function reviseSettlements(keys: SyncKeys, revise: (current: Settlements) => Settlements): Promise<Settlements | null> {
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remote = await fetchPayload(keys);
      if (remote === null) return null;

      const settlements = revise(remote.payload.settlements);
      const envelope    = await encryptPayload(keys.encKey, { ...remote.payload, exportedAt: nowIso(), settlements });
      if (envelope.data.length > SYNC_DATA_MAX_CHARS) return null;

      const response = await fetch(`/api/sync/${keys.syncId}`, {
        method:  "PUT",
        headers: { authorization: `Bearer ${keys.authToken}`, "content-type": "application/json" },
        body:    JSON.stringify({ expectedVersion: remote.version, ...envelope }),
      });

      if (response.status === 409 && attempt === 1) continue;
      if (!response.ok) return null;

      return settlements;
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchPayload(keys: SyncKeys): Promise<{ version: number; payload: SyncPayload } | null> {
  const response = await fetch(`/api/sync/${keys.syncId}`, { headers: { authorization: `Bearer ${keys.authToken}` } });
  if (!response.ok) return null;

  const envelope = syncEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!envelope.success) return null;

  const payload = await decryptPayload(keys.encKey, envelope.data.iv, envelope.data.data);
  if (payload === null) return null;

  return { version: envelope.data.version, payload };
}
