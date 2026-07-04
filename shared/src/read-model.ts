import { PageRecord, PageSummary, SectionStats } from "./schema";

// Pure read-state logic, shared verbatim by the extension and the future dashboard.

export const READING_WPM      = 260;
export const READ_DWELL_MIN_MS = 2_000;
export const READ_DWELL_MAX_MS = 60_000;

/** How long a paragraph must sit in view before it counts as read: its own reading time, bounded. */
export function readThresholdMs(words: number): number {
  const readingMs = (words / READING_WPM) * 60_000;

  return Math.min(READ_DWELL_MAX_MS, Math.max(READ_DWELL_MIN_MS, readingMs));
}

// A page counts as read at 90%: hypertext pages keep footnotes and asides a
// reader legitimately skips, so demanding 100% would make "read" unreachable.
export const PAGE_READ_RATIO = 0.9;

export type ReadLevel = "none" | "partial" | "read";

export function readLevel(total: number, read: number): ReadLevel {
  if (total === 0 || read === 0)                  return "none";
  if (read >= Math.ceil(total * PAGE_READ_RATIO)) return "read";

  return "partial";
}

/** The link-badge state for a link target: the whole page, or one section of it. */
export function targetReadLevel(summary: PageSummary, fragment: string | null): ReadLevel {
  if (fragment === null) return readLevel(summary.total, summary.read);

  const section = summary.sections[fragment];
  if (section === undefined) return readLevel(summary.total, summary.read);

  return readLevel(section.total, section.read);
}

export function summarize(record: PageRecord): PageSummary {
  // Null prototype: section ids are page-controlled strings, and a key like
  // "__proto__" on a plain object would silently corrupt the accumulator.
  const sections: Record<string, SectionStats> = Object.create(null);
  let read = 0;

  for (const entry of record.outline) {
    const isRead = entry.h in record.read;
    if (isRead) read += 1;

    if (entry.s === null) continue;

    const section = (sections[entry.s] ??= { total: 0, read: 0 });
    section.total += 1;
    if (isRead) section.read += 1;
  }

  return { v: 1, title: record.title, total: record.outline.length, read, lastReadAt: record.lastReadAt, sections };
}

/**
 * Fold a concurrently-stored copy of the same page record into `mine` before saving.
 * Every tab of a page holds its own full record and flushes it whole, so without this
 * union the last flush wins and silently drops the other tab's reads. Reads and
 * sightings union (earliest timestamp wins per hash), lastReadAt takes the latest,
 * and the furthest position resolves against mine's outline order.
 */
export function mergeRecords(mine: PageRecord, stored: PageRecord): void {
  for (const [hash, read] of Object.entries(stored.read)) {
    const existing = mine.read[hash];
    if (existing === undefined || read.at < existing.at) mine.read[hash] = read;
  }

  for (const [hash, seenAt] of Object.entries(stored.seen)) {
    const existing = mine.seen[hash];
    if (existing === undefined || seenAt < existing) mine.seen[hash] = seenAt;
  }

  if (stored.lastReadAt !== null && (mine.lastReadAt === null || stored.lastReadAt > mine.lastReadAt)) {
    mine.lastReadAt = stored.lastReadAt;
  }

  if (mine.firstSeenAt > stored.firstSeenAt) mine.firstSeenAt = stored.firstSeenAt;

  const index = new Map(mine.outline.map((entry, i) => [entry.h, i] as const));
  const ours   = mine.furthestReadHash   === null ? -1 : index.get(mine.furthestReadHash)   ?? -1;
  const theirs = stored.furthestReadHash === null ? -1 : index.get(stored.furthestReadHash) ?? -1;
  if (theirs > ours) mine.furthestReadHash = stored.furthestReadHash;
}

/**
 * Paragraph hashes on the page now that the reader has not read and had never seen
 * before their last reading session. Computed against the record as it was loaded,
 * before this visit merges its own sightings into `seen`.
 */
export function newSinceLastRead(record: PageRecord, currentHashes: string[]): Set<string> {
  const lastReadAt = record.lastReadAt;
  if (lastReadAt === null) return new Set();

  const changed = new Set<string>();
  for (const hash of currentHashes) {
    if (hash in record.read) continue;

    const seenAt = record.seen[hash];
    if (seenAt === undefined || seenAt > lastReadAt) changed.add(hash);
  }

  return changed;
}
