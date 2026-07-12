import { z } from "zod";

// The read-state data model. This is the contract between the extension, the future
// dashboard, and the future E2EE sync payloads, so every shape lives here as a zod
// schema and the TS types are inferred from it.

export const outlineEntrySchema = z.object({
  h: z.string(),            // paragraph content hash
  w: z.number(),            // word count
  s: z.string().nullable(), // enclosing section id (heading anchor), null before the first heading
});

export const pageRecordSchema = z.object({
  v: z.literal(1),
  url:   z.string(),
  title: z.string(),

  firstSeenAt: z.string(),
  lastVisitAt: z.string(),
  lastReadAt:  z.string().nullable(),

  outline: z.array(outlineEntrySchema),                                    // structure as of the last visit
  read:    z.record(z.string(), z.object({ at: z.string(), dwellMs: z.number(), words: z.number().default(0) })), // words stamped at read time; pre-existing records default to 0 and self-heal on revisit
  seen:    z.record(z.string(), z.string()),                               // hash -> first sighting on this page

  // Paragraph tombstones: hash -> when the reader un-read it ("I've read this far"
  // clears everything below the click). A read survives a merge only when it happened
  // after the clear, so cleared paragraphs stay cleared across devices.
  cleared: z.record(z.string(), z.string()).default({}),

  furthestReadHash: z.string().nullable(),

  // Backfill: the reader vouches they read this page without dwell evidence. Old
  // records parse via the default; reads materialize on the next real visit.
  // assumedClearedAt revokes the vouch ("I've read this far" supersedes it); a vouch
  // survives a merge only when it happened after the revoke.
  assumedReadAt:    z.string().nullable().default(null),
  assumedClearedAt: z.string().nullable().default(null),
});

export const sectionStatsSchema = z.object({
  total: z.number(),
  read:  z.number(),
});

// The per-page summary is stored under its own key so a page full of links can look up
// its targets' read-state with one batched storage get, without loading full records.
export const pageSummarySchema = z.object({
  v: z.literal(1),
  title: z.string(),
  total: z.number(),
  read:  z.number(),
  lastReadAt: z.string().nullable(),
  sections:   z.record(z.string(), sectionStatsSchema),

  assumedRead: z.boolean().default(false),
});

export const SYNC_DEFAULT_BASE_URL = "https://web-production-23890.up.railway.app";

// New fields carry defaults so settings stored by older extension versions upgrade
// in place instead of being reset.
export const settingsSchema = z.object({
  overlay: z.boolean(),

  syncSecret:   z.string().nullable().default(null),
  syncBaseUrl:  z.string().default(SYNC_DEFAULT_BASE_URL),
  blockedHosts: z.array(z.string()).default([]), // paused sites (host or subdomain match)
  blockedPages: z.array(z.string()).default([]), // paused single pages (normalized url, exact)

  // Words per minute the reader is assumed to read at; the read-dwell threshold derives
  // from it (see readThresholdMs). Bad values stay harmless: the threshold is clamped.
  readingWpm:   z.number().default(260),
});

export const DEFAULT_SETTINGS: Settings = {
  overlay: false, // markers are opt-in; tracking and the popup percent work regardless

  syncSecret:   null,
  syncBaseUrl:  SYNC_DEFAULT_BASE_URL,
  blockedHosts: [],
  blockedPages: [],
  readingWpm:   260,
};

export type OutlineEntry = z.infer<typeof outlineEntrySchema>;
export type PageRecord   = z.infer<typeof pageRecordSchema>;
export type SectionStats = z.infer<typeof sectionStatsSchema>;
export type PageSummary  = z.infer<typeof pageSummarySchema>;
export type Settings     = z.infer<typeof settingsSchema>;
