import { readLevel } from "@swdi/shared";
import { badgeMessageSchema, pageFlushedMessageSchema, syncNowMessageSchema } from "./lib/messages";
import { loadSettings } from "./lib/storage";
import { syncNow } from "./lib/sync-client";

// The service worker paints the toolbar badge and runs the sync engine; all tracking
// lives in the content script. Sync fires on a slow heartbeat, shortly after a page
// flushes new reading, and on demand from the popup.

const PERIODIC_ALARM = "swdi:sync-periodic";
const DEBOUNCE_ALARM = "swdi:sync-debounce";
const READ_HERE_MENU = "swdi:read-up-to-here";

const PERIODIC_MINUTES = 15;
const DEBOUNCE_MINUTES = 1;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const badge = badgeMessageSchema.safeParse(message);
  if (badge.success) {
    paintBadge(badge.data, sender.tab?.id);
    return;
  }

  if (pageFlushedMessageSchema.safeParse(message).success) {
    void scheduleDebouncedSync();
    return;
  }

  if (syncNowMessageSchema.safeParse(message).success) {
    void syncNow().then((result) => {
      void ensurePeriodicAlarm();
      sendResponse(result);
    });
    return true; // async response
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PERIODIC_ALARM || alarm.name === DEBOUNCE_ALARM) void syncNow();
});

chrome.runtime.onStartup.addListener(() => void ensurePeriodicAlarm());
chrome.runtime.onInstalled.addListener(() => {
  void ensurePeriodicAlarm();
  createReadHereMenu();
});

// The reader right-clicks where they stopped and everything above fills in as read; the
// content script resolves "here" from the click position it captured. Offered on any web
// page, but a no-op unless that page is one SWDI is tracking.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== READ_HERE_MENU || tab?.id === undefined) return;

  void chrome.tabs.sendMessage(tab.id, { type: "swdi:read-up-to-here" }).catch(() => {});
});

function createReadHereMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:                  READ_HERE_MENU,
      title:               "I've read this far",
      contexts:            ["page", "selection", "link"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
}

function paintBadge(msg: { read: number; total: number }, tabId: number | undefined) {
  if (tabId === undefined) return;

  const level = readLevel(msg.total, msg.read);

  let text = "";
  if      (level === "read")    text = "✓";
  else if (level === "partial") text = `${Math.round((msg.read / msg.total) * 100)}%`;

  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: "#5c8a6f" });
}

async function ensurePeriodicAlarm(): Promise<void> {
  const settings = await loadSettings();

  if (settings.syncSecret === null) await chrome.alarms.clear(PERIODIC_ALARM);
  else                              await chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: PERIODIC_MINUTES });
}

async function scheduleDebouncedSync(): Promise<void> {
  const settings = await loadSettings();
  if (settings.syncSecret === null) return;

  await chrome.alarms.create(DEBOUNCE_ALARM, { delayInMinutes: DEBOUNCE_MINUTES });
}
