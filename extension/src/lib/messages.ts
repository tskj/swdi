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

export const popupStateSchema = z.object({
  title:   z.string(),
  total:   z.number(),
  read:    z.number(),
  changed: z.number(),
  overlay: z.boolean(),
  badges:  z.object({ read: z.number(), partial: z.number() }),
});

export type BadgeMessage      = z.infer<typeof badgeMessageSchema>;
export type GetStateMessage   = z.infer<typeof getStateMessageSchema>;
export type SetOverlayMessage = z.infer<typeof setOverlayMessageSchema>;
export type PopupState        = z.infer<typeof popupStateSchema>;
