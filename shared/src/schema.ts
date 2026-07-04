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
  read:    z.record(z.string(), z.object({ at: z.string(), dwellMs: z.number() })),
  seen:    z.record(z.string(), z.string()),                               // hash -> first sighting on this page

  furthestReadHash: z.string().nullable(),
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
});

export const settingsSchema = z.object({
  overlay: z.boolean(),
});

export const DEFAULT_SETTINGS: Settings = { overlay: true };

export type OutlineEntry = z.infer<typeof outlineEntrySchema>;
export type PageRecord   = z.infer<typeof pageRecordSchema>;
export type SectionStats = z.infer<typeof sectionStatsSchema>;
export type PageSummary  = z.infer<typeof pageSummarySchema>;
export type Settings     = z.infer<typeof settingsSchema>;
