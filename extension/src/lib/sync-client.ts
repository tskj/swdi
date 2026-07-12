import {
  PageRecord,
  SYNC_DATA_MAX_CHARS,
  Settlements,
  SyncPayload,
  applyDeleted,
  decryptPayload,
  deriveSyncKeys,
  encryptPayload,
  mergeDeleted,
  nowIso,
  pageAlive,
  syncEnvelopeSchema,
} from "@swdi/shared";
import { SyncResult } from "./messages";
import {
  foldRemotePages,
  loadAllPages,
  loadSettings,
  loadSyncMeta,
  loadTombstones,
  removePageRecord,
  saveSyncMeta,
  saveTombstones,
} from "./storage";

// Pull, merge, push. The server never sees plaintext: everything here derives from the
// sync key on this device, and only ciphertext plus the bearer token cross the wire.
// A 409 means another device pushed since our pull; one pull-merge-retry resolves it.

type Remote = { version: number; payload: SyncPayload | null } | "unreadable";

export async function syncNow(): Promise<SyncResult> {
  const settings = await loadSettings();
  if (settings.syncSecret === null) return failure("sync is not enabled");

  const keys = await deriveSyncKeys(settings.syncSecret);
  if (keys === null) return failure("the stored sync key is invalid");

  const url  = `${settings.syncBaseUrl.replace(/\/+$/, "")}/api/sync/${keys.syncId}`;
  const auth = { authorization: `Bearer ${keys.authToken}` };

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remote = await fetchRemote(url, auth, keys.encKey);
      if (remote === "unreadable") return failure("the remote data does not match this sync key");

      // Deletions merge first (latest delete-vs-recreate wins), then gate both page
      // sets: dead remote pages never fold in, and dead local pages are removed here,
      // which is how a deletion made on another device lands on this one.
      const deleted = mergeDeleted(await loadTombstones(), remote.payload?.deleted ?? {});

      const remotePages = (remote.payload?.pages ?? []).filter((page) => pageAlive(page, deleted[page.url]));
      if (remotePages.length > 0) await foldRemotePages(remotePages);

      // Read the local set only after folding, so the upload carries the merge result.
      const pages = await loadAllPages();
      for (const page of pages) {
        if (!pageAlive(page, deleted[page.url])) await removePageRecord(page.url);
      }

      const resolved = applyDeleted(pages, deleted);
      await saveTombstones(resolved.deleted);

      // Settlements are the dashboard's data; the extension only carries the remote
      // copy through so its own pushes never drop them.
      const envelope = await sealUnderLimit(keys.encKey, resolved.pages, resolved.deleted, remote.payload?.settlements ?? {});
      if (envelope === null) return failure("your reading history exceeds the sync size limit");

      const response = await fetch(url, {
        method:  "PUT",
        headers: { ...auth, "content-type": "application/json" },
        body:    JSON.stringify({ expectedVersion: remote.version, ...envelope }),
      });

      if (response.status === 409 && attempt === 1) continue;
      if (!response.ok) return failure(`the sync store answered ${response.status}`);

      const at = nowIso();
      await saveSyncMeta({ lastSyncAt: at, lastError: null });
      return { ok: true, at };
    }

    return failure("another device kept winning the race; will retry later");
  } catch (err) {
    return failure(err instanceof Error ? err.message : "network failure");
  }
}

/**
 * Encrypt the payload, trimming the OLDEST-visited pages out of the upload until the
 * ciphertext fits the server's cap. Local storage keeps everything; only the synced
 * copy shrinks. Null when even a single page will not fit.
 */
async function sealUnderLimit(encKey: CryptoKey, pages: PageRecord[], deleted: Record<string, string>, settlements: Settlements): Promise<{ iv: string; data: string } | null> {
  let candidate = [...pages].sort((a, b) => b.lastVisitAt.localeCompare(a.lastVisitAt));

  for (;;) {
    const envelope = await encryptPayload(encKey, { v: 3, exportedAt: nowIso(), pages: candidate, deleted, settlements });
    if (envelope.data.length <= SYNC_DATA_MAX_CHARS) return envelope;
    if (candidate.length <= 1) return null;

    candidate = candidate.slice(0, Math.max(1, Math.floor(candidate.length * 0.9)));
  }
}

async function fetchRemote(url: string, auth: Record<string, string>, encKey: CryptoKey): Promise<Remote> {
  const response = await fetch(url, { headers: auth });
  if (response.status === 404) return { version: 0, payload: null };
  if (!response.ok) throw new Error(`the sync store answered ${response.status}`);

  const envelope = syncEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!envelope.success) return "unreadable";

  const payload = await decryptPayload(encKey, envelope.data.iv, envelope.data.data);
  if (payload === null) return "unreadable";

  return { version: envelope.data.version, payload };
}

async function failure(error: string): Promise<SyncResult> {
  const { lastSyncAt } = await loadSyncMeta();
  await saveSyncMeta({ lastSyncAt, lastError: error });

  return { ok: false, error };
}
