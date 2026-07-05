import {
  PageRecord,
  decryptPayload,
  deriveSyncKeys,
  encryptPayload,
  mergePages,
  nowIso,
  syncEnvelopeSchema,
} from "@swdi/shared";
import { SyncResult } from "./messages";
import { loadAllPages, loadSettings, loadSyncMeta, saveSyncMeta, writePages } from "./storage";

// Pull, merge, push. The server never sees plaintext: everything here derives from the
// keyphrase on this device, and only ciphertext plus the bearer token cross the wire.
// A 409 means another device pushed since our pull; one pull-merge-retry resolves it.

type Remote = { version: number; pages: PageRecord[] } | { version: 0; pages: null } | "unreadable";

export async function syncNow(): Promise<SyncResult> {
  const settings = await loadSettings();
  if (settings.syncSecret === null) return failure("sync is not enabled");

  const keys = await deriveSyncKeys(settings.syncSecret);
  if (keys === null) return failure("the stored keyphrase is invalid");

  const url  = `${settings.syncBaseUrl.replace(/\/+$/, "")}/api/sync/${keys.syncId}`;
  const auth = { authorization: `Bearer ${keys.authToken}` };

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remote = await fetchRemote(url, auth, keys.encKey);
      if (remote === "unreadable") return failure("the remote data does not match this keyphrase");

      let pages = await loadAllPages();
      if (remote.pages !== null && remote.pages.length > 0) {
        pages = mergePages(pages, remote.pages);
        await writePages(pages);
      }

      const envelope = await encryptPayload(keys.encKey, { v: 1, exportedAt: nowIso(), pages });
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

async function fetchRemote(url: string, auth: Record<string, string>, encKey: CryptoKey): Promise<Remote> {
  const response = await fetch(url, { headers: auth });
  if (response.status === 404) return { version: 0, pages: null };
  if (!response.ok) throw new Error(`the sync store answered ${response.status}`);

  const envelope = syncEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!envelope.success) return "unreadable";

  const payload = await decryptPayload(encKey, envelope.data.iv, envelope.data.data);
  if (payload === null) return "unreadable";

  return { version: envelope.data.version, pages: payload.pages };
}

async function failure(error: string): Promise<SyncResult> {
  const { lastSyncAt } = await loadSyncMeta();
  await saveSyncMeta({ lastSyncAt, lastError: error });

  return { ok: false, error };
}
