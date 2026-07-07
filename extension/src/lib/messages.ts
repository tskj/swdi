import { z } from "zod";

// Messages between the extension's own contexts (content script, popup, service
// worker). They cross a runtime boundary, so they are parsed, never cast.

export const badgeMessageSchema = z.object({
  type:  z.literal("swdi:badge"),
  read:  z.number(),
  total: z.number(),
});

export const getStateMessageSchema = z.object({
  type: z.literal("swdi:get-state"),
});

export const setOverlayMessageSchema = z.object({
  type:  z.literal("swdi:set-overlay"),
  value: z.boolean(),
});

export const setSitePausedMessageSchema = z.object({
  type:  z.literal("swdi:set-site-paused"),
  value: z.boolean(),
});

export const setPagePausedMessageSchema = z.object({
  type:  z.literal("swdi:set-page-paused"),
  value: z.boolean(),
});

export const pageFlushedMessageSchema = z.object({
  type: z.literal("swdi:page-flushed"),
});

export const markPageReadMessageSchema = z.object({
  type: z.literal("swdi:mark-page-read"),
});

export const readUpToHereMessageSchema = z.object({
  type: z.literal("swdi:read-up-to-here"),
});

export const scrollFurthestMessageSchema = z.object({
  type: z.literal("swdi:scroll-furthest"),
});

export const scrollGapMessageSchema = z.object({
  type: z.literal("swdi:scroll-gap"),
  up:   z.boolean(), // step to the previous skipped spot (up) or the next one (down)
});

// The reply to a scroll-gap step: which arrows still have somewhere to go.
export const gapNavSchema = z.object({ canUp: z.boolean(), canDown: z.boolean() });

export const setBackfillMessageSchema = z.object({
  type:  z.literal("swdi:set-backfill"),
  value: z.boolean(),
});

export const syncNowMessageSchema = z.object({
  type: z.literal("swdi:sync-now"),
});

export const syncResultSchema = z.union([
  z.object({ ok: z.literal(true), at: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

// What the content script tells the popup about the current page. A page is either
// tracked, silently ignored for lacking readable text, or on the user's paused list.
export const popupStateSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("tracking"),
    host:  z.string(),
    hostPaused: z.boolean(),
    pagePaused: z.boolean(),

    title:   z.string(),
    total:   z.number(),
    read:    z.number(),
    changed: z.number(),
    overlay: z.boolean(),
    canResume:  z.boolean(),
    canGapUp:   z.boolean(),
    canGapDown: z.boolean(),
    badges:  z.object({ read: z.number(), reading: z.number() }),
  }),
  z.object({ phase: z.literal("unsuitable"), host: z.string(), hostPaused: z.boolean(), pagePaused: z.boolean() }),
  z.object({ phase: z.literal("paused"),     host: z.string(), hostPaused: z.boolean(), pagePaused: z.boolean() }),
  z.object({ phase: z.literal("starting"),   host: z.string(), hostPaused: z.boolean(), pagePaused: z.boolean() }),
]);

export type BadgeMessage = z.infer<typeof badgeMessageSchema>;
export type PopupState   = z.infer<typeof popupStateSchema>;
export type SyncResult   = z.infer<typeof syncResultSchema>;
