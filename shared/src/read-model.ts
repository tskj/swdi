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
  const sections: Record<string, SectionStats> = {};
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
