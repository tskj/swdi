import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  PageRecord,
  PageSummary,
  Settings,
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

/** Add or remove a host from the paused list; takes effect on the next page load. */
export async function savePausedHosts(host: string, paused: boolean): Promise<void> {
  const settings = await loadSettings();
  const without  = settings.blockedHosts.filter((blocked) => blocked !== host);

  settings.blockedHosts = paused ? [...without, host] : without;
  await saveSettings(settings);
}

/** The full local dataset, for user-initiated export. Data captivity is never the lock-in. */
export async function exportAll(): Promise<Record<string, unknown>> {
  return chrome.storage.local.get(null);
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

/** Batch-write merged records with their summaries; one storage call for the whole set. */
export async function writePages(records: PageRecord[]): Promise<void> {
  if (records.length === 0) return;

  const items: Record<string, unknown> = {};
  for (const record of records) {
    items[PAGE_PREFIX + record.url] = record;
    items[IDX_PREFIX + record.url]  = summarize(record);
  }

  await chrome.storage.local.set(items);
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
