import { readLevel, summarize, type PageRecord, type PageSummary, type Registry, type RegistryEntry } from "@swdi/shared";

// Pure derivations and formatters behind the dashboard views. Read/summary semantics
// come from the shared read-model helpers; nothing here reinvents them.

export type PageStats = {
  record:  PageRecord;
  summary: PageSummary;
  host:    string;
  dwellMs: number;
};

export type Overview = {
  visited:        number;
  finished:       number;
  paragraphsRead: number;
  dwellMs:        number;
};

export type SiteStats = {
  host:           string;
  pages:          number;
  paragraphsRead: number;
  dwellMs:        number;
};

export type AuthorMatch = {
  entry:          RegistryEntry;
  pagesRead:      number;
  paragraphsRead: number;
};

export function pageStats(record: PageRecord): PageStats {
  const summary = summarize(record);
  const host    = hostOf(record.url);
  const dwellMs = Object.values(record.read).reduce((sum, entry) => sum + entry.dwellMs, 0);

  return { record, summary, host, dwellMs };
}

export function overview(pages: PageStats[]): Overview {
  const totals: Overview = { visited: pages.length, finished: 0, paragraphsRead: 0, dwellMs: 0 };

  for (const page of pages) {
    if (readLevel(page.summary.total, page.summary.read) === "read") totals.finished += 1;

    totals.paragraphsRead += page.summary.read;
    totals.dwellMs        += page.dwellMs;
  }

  return totals;
}

export function bySite(pages: PageStats[]): SiteStats[] {
  const sites = new Map<string, SiteStats>();

  for (const page of pages) {
    const site = sites.get(page.host) ?? { host: page.host, pages: 0, paragraphsRead: 0, dwellMs: 0 };

    site.pages          += 1;
    site.paragraphsRead += page.summary.read;
    site.dwellMs        += page.dwellMs;

    sites.set(page.host, site);
  }

  return [...sites.values()].sort((a, b) => b.dwellMs - a.dwellMs);
}

/** Registry entries with any of the reader's pages under their site prefixes, most-read first. */
export function matchAuthors(registry: Registry, pages: PageStats[]): AuthorMatch[] {
  const matches: AuthorMatch[] = [];

  for (const entry of registry.entries) {
    const mine = pages.filter((page) => entry.sites.some((site) => urlUnderSite(page.record.url, site)));
    if (mine.length === 0) continue;

    const pagesRead      = mine.filter((page) => page.summary.read > 0).length;
    const paragraphsRead = mine.reduce((sum, page) => sum + page.summary.read, 0);
    matches.push({ entry, pagesRead, paragraphsRead });
  }

  return matches.sort((a, b) => b.paragraphsRead - a.paragraphsRead);
}

// A bare prefix test would let "https://a.co" claim "https://a.com/..." and
// "https://a.co.evil.example/...", steering donations at the wrong person. The
// character after the prefix must be a path/query/fragment boundary.
function urlUnderSite(url: string, site: string): boolean {
  const prefix = site.replace(/\/+$/, "");
  if (url === prefix) return true;
  if (!url.startsWith(prefix)) return false;

  const next = url[prefix.length];
  return next === "/" || next === "?" || next === "#";
}

export function percentRead(summary: PageSummary): number {
  if (summary.total === 0) return 0;

  return Math.round((summary.read / summary.total) * 100);
}

const countFormat = new Intl.NumberFormat("en");
const dateFormat  = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** A stored ISO timestamp as "Mar 4, 2026"; the raw string when unparsable. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return dateFormat.format(date);
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours   = Math.floor(minutes / 60);
  const rest    = minutes % 60;

  if (hours === 0) return `${rest} min`;
  if (rest === 0)  return `${hours} h`;

  return `${hours} h ${rest} min`;
}

export function pluralize(count: number, noun: string): string {
  return `${formatCount(count)} ${count === 1 ? noun : `${noun}s`}`;
}

export function hostOf(url: string): string {
  try   { return new URL(url).hostname; }
  catch { return url; }
}

/** The plain address out of either a bare bitcoin address or a bitcoin: URI. */
export function bitcoinAddress(raw: string): string {
  const bare  = raw.startsWith("bitcoin:") ? raw.slice("bitcoin:".length) : raw;
  const query = bare.indexOf("?");

  return query === -1 ? bare : bare.slice(0, query);
}
