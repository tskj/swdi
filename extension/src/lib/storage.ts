import {
  DEFAULT_SETTINGS,
  PageRecord,
  PageSummary,
  Settings,
  pageRecordSchema,
  pageSummarySchema,
  settingsSchema,
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

/** The full local dataset, for user-initiated export. Data captivity is never the lock-in. */
export async function exportAll(): Promise<Record<string, unknown>> {
  return chrome.storage.local.get(null);
}
