import { readLevel } from "@swdi/shared";
import { badgeMessageSchema } from "./lib/messages";

// The service worker only paints the toolbar badge; all tracking lives in the content script.

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const parsed = badgeMessageSchema.safeParse(message);
  if (!parsed.success) return;

  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  const { read, total } = parsed.data;
  const level = readLevel(total, read);

  let text = "";
  if      (level === "read")    text = "✓";
  else if (level === "partial") text = `${Math.round((read / total) * 100)}%`;

  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: "#5c8a6f" });
});
