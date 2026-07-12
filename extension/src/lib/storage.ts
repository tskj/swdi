import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  PageRecord,
  PageSummary,
  Settings,
  mergePages,
  nowIso,
  pageRecordSchema,
  pageSummarySchema,
  settingsSchema,
  summarize,
} from "@swdi/shared";

// Everything lives in chrome.storage.local. Page records and summaries get one key
// each so lookups stay batched and precise; nothing ever leaves the device from here.

const PAGE_PREFIX  = "swdi:page:";
const IDX_PREFIX   = "swdi:idx:";
const SETTINGS_KEY = "swdi:settings";

export async function loadPageRecord(url: string): Promise<PageRecord | null> {
  const key = PAGE_PREFIX + url;
  const got = await chrome.storage.local.get(key);
  if (got[key] === undefined) return null;

  // A record from an older schema version starts over rather than crashing the page.
  const parsed = pageRecordSchema.safeParse(got[key]);
  return parsed.success ? parsed.data : null;
}

export async function savePage(record: PageRecord, summary: PageSummary): Promise<void> {
  await chrome.storage.local.set({
    [PAGE_PREFIX + record.url]: record,
    [IDX_PREFIX + record.url]:  summary,
  });
}

/**
 * Remove a page on the user's say-so (backfill undo). Leaves a tombstone so the
 * deletion holds through sync: a stale copy on the server or another device stays
 * dead unless the page is actually visited again after this moment.
 */
export async function removePage(url: string): Promise<void> {
  await removePageRecord(url);

  const tombstones = await loadTombstones();
  tombstones[url]  = nowIso();
  await saveTombstones(tombstones);
}

/** Remove a page's stored data without stamping a tombstone (sync applying an existing one). */
export async function removePageRecord(url: string): Promise<void> {
  await chrome.storage.local.remove([PAGE_PREFIX + url, IDX_PREFIX + url]);
}

/** Batched read-state lookup for link badges: one storage call for all targets on a page. */
export async function loadSummaries(urls: string[]): Promise<Map<string, PageSummary>> {
  if (urls.length === 0) return new Map();

  const got = await chrome.storage.local.get(urls.map((url) => IDX_PREFIX + url));

  const summaries = new Map<string, PageSummary>();
  for (const url of urls) {
    const parsed = pageSummarySchema.safeParse(got[IDX_PREFIX + url]);
    if (parsed.success) summaries.set(url, parsed.data);
  }

  return summaries;
}

export async function loadSettings(): Promise<Settings> {
  const got    = await chrome.storage.local.get(SETTINGS_KEY);
  const parsed = settingsSchema.safeParse(got[SETTINGS_KEY]);

  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** Load-modify-save one or more fields, so a partial write can't clobber another context's changes. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await loadSettings()), ...patch };
  await saveSettings(settings);
  return settings;
}

/** Call back with parsed settings whenever they change, e.g. so the popup's edits apply live. */
export function watchSettings(onChange: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    const change = changes[SETTINGS_KEY];
    if (change === undefined) return;

    const parsed = settingsSchema.safeParse(change.newValue);
    if (parsed.success) onChange(parsed.data);
  });
}

/** Add or remove a host from the paused list; takes effect on the next page load. */
export async function savePausedHosts(host: string, paused: boolean): Promise<void> {
  const settings = await loadSettings();
  const without  = settings.blockedHosts.filter((blocked) => blocked !== host);

  settings.blockedHosts = paused ? [...without, host] : without;
  await saveSettings(settings);
}

/** Add or remove a single page from the paused list; takes effect on the next page load. */
export async function savePausedPages(pageUrl: string, paused: boolean): Promise<void> {
  const settings = await loadSettings();
  const without  = settings.blockedPages.filter((blocked) => blocked !== pageUrl);

  settings.blockedPages = paused ? [...without, pageUrl] : without;
  await saveSettings(settings);
}

/**
 * The full local dataset, for user-initiated export. Data captivity is never the
 * lock-in. The sync key is redacted: anyone holding the export file could
 * otherwise derive the keys and read or overwrite the synced copy.
 */
export async function exportAll(): Promise<Record<string, unknown>> {
  const all = await chrome.storage.local.get(null);

  const settings = settingsSchema.safeParse(all[SETTINGS_KEY]);
  if (settings.success) all[SETTINGS_KEY] = { ...settings.data, syncSecret: null };

  return all;
}

/** Every stored page record, for the sync engine. Records from older schemas are skipped. */
export async function loadAllPages(): Promise<PageRecord[]> {
  const all = await chrome.storage.local.get(null);

  const pages: PageRecord[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(PAGE_PREFIX)) continue;

    const parsed = pageRecordSchema.safeParse(value);
    if (parsed.success) pages.push(parsed.data);
  }

  return pages;
}

/**
 * Fold remote records into local storage one page at a time, each with a fresh read of
 * the stored copy immediately before the write. A content-script flush can land at any
 * moment; the per-record read-merge-write keeps the race window to microseconds instead
 * of spanning the whole sync, so a concurrent flush's reads survive via mergeRecords.
 */
export async function foldRemotePages(remote: PageRecord[]): Promise<void> {
  for (const record of remote) {
    const stored = await loadPageRecord(record.url);
    const merged = mergePages(stored === null ? [] : [stored], [record])[0] ?? record;

    await savePage(merged, summarize(merged));
  }
}

// Page tombstones, one map for all of them: url -> when the page was deleted. They ride
// inside the sync payload (v2) so every device applies and re-propagates deletions.
const TOMBSTONES_KEY = "swdi:tombstones";

const tombstonesSchema = z.record(z.string(), z.string());

export async function loadTombstones(): Promise<Record<string, string>> {
  const got    = await chrome.storage.local.get(TOMBSTONES_KEY);
  const parsed = tombstonesSchema.safeParse(got[TOMBSTONES_KEY]);

  return parsed.success ? parsed.data : {};
}

export async function saveTombstones(tombstones: Record<string, string>): Promise<void> {
  await chrome.storage.local.set({ [TOMBSTONES_KEY]: tombstones });
}

/** A visit recreates the page, so its tombstone has nothing left to do. */
export async function clearTombstone(url: string): Promise<void> {
  const tombstones = await loadTombstones();
  if (!(url in tombstones)) return;

  delete tombstones[url];
  await saveTombstones(tombstones);
}

const SYNC_META_KEY = "swdi:sync-meta";

const syncMetaSchema = z.object({
  lastSyncAt: z.string().nullable(),
  lastError:  z.string().nullable(),
});

export type SyncMeta = z.infer<typeof syncMetaSchema>;

export async function loadSyncMeta(): Promise<SyncMeta> {
  const got    = await chrome.storage.local.get(SYNC_META_KEY);
  const parsed = syncMetaSchema.safeParse(got[SYNC_META_KEY]);

  return parsed.success ? parsed.data : { lastSyncAt: null, lastError: null };
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  await chrome.storage.local.set({ [SYNC_META_KEY]: meta });
}
