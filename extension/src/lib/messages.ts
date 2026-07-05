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

export const pageFlushedMessageSchema = z.object({
  type: z.literal("swdi:page-flushed"),
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

    title:   z.string(),
    total:   z.number(),
    read:    z.number(),
    changed: z.number(),
    overlay: z.boolean(),
    badges:  z.object({ read: z.number(), partial: z.number() }),
  }),
  z.object({ phase: z.literal("unsuitable"), host: z.string() }),
  z.object({ phase: z.literal("paused"),     host: z.string() }),
]);

export type BadgeMessage = z.infer<typeof badgeMessageSchema>;
export type PopupState   = z.infer<typeof popupStateSchema>;
export type SyncResult   = z.infer<typeof syncResultSchema>;
