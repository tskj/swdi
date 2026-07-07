import { ensure, generateSyncSecret, deriveSyncKeys, nowIso } from "@swdi/shared";
import { PopupState, gapNavSchema, popupStateSchema, syncResultSchema } from "../lib/messages";
import { exportAll, loadSettings, loadSyncMeta, saveSettings, updateSettings } from "../lib/storage";

// Every handler is wired exactly once at startup; re-renders only change visibility
// and text. Wiring inside a render stacks duplicate listeners across state changes.

const STARTING_RETRY_MS  = 300;
const STARTING_RETRY_MAX = 10;

main().catch(() => showUntracked());

async function main() {
  wireNav();
  wireExport();
  wireSyncHandlers();
  wireMarkersInfo();
  await wireReadingSpeed();
  await renderSyncSection();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId === undefined) { showUntracked(); return; }

  const state = await pageState(tabId);
  if (state === null) { showUntracked(); return; }

  wirePageHandlers(state, tabId);
  renderPage(state);
}

/** The content script answers "starting" while it boots; poll briefly instead of lying. */
async function pageState(tabId: number): Promise<PopupState | null> {
  for (let attempt = 0; attempt < STARTING_RETRY_MAX; attempt++) {
    let state: PopupState;
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "swdi:get-state" });
      state = popupStateSchema.parse(response);
    } catch {
      return null;
    }

    if (state.phase !== "starting") return state;

    await new Promise((resolve) => setTimeout(resolve, STARTING_RETRY_MS));
  }

  return null;
}

// ---- page section -------------------------------------------------------------

function renderPage(state: PopupState) {
  if (state.phase === "starting") return;

  renderPauseRows(state);

  if (state.phase === "paused") {
    el("status").textContent = state.hostPaused
      ? `SWDI is paused on ${state.host}.`
      : "SWDI is paused on this page.";
    return;
  }

  if (state.phase === "unsuitable") {
    el("status").textContent = "This page does not look like readable content, so SWDI ignores it.";
    return;
  }

  const pct = state.total === 0 ? 0 : Math.round((state.read / state.total) * 100);

  el("status").hidden = true;
  el("stats").hidden  = false;

  el("bar-fill").style.width = `${pct}%`;
  el("numbers").textContent  = `${state.read} of ${state.total} paragraphs read (${pct}%)`;

  el<HTMLInputElement>("overlay").checked = state.overlay;

  // The resume buttons always show; they disable when there is nothing to do (no
  // furthest point reached yet, or no skipped stretch behind it).
  el<HTMLButtonElement>("resume-furthest").disabled = !state.canResume;
  el<HTMLButtonElement>("gap-up").disabled   = !state.canGapUp;
  el<HTMLButtonElement>("gap-down").disabled = !state.canGapDown;

  if (state.changed > 0) {
    const changed = el("changed");
    changed.hidden      = false;
    changed.textContent = `${state.changed} paragraphs are new or changed since you read this page.`;
  }

  const sentences: string[] = [];
  if (state.badges.read > 0) {
    sentences.push(state.badges.read === 1
      ? "1 link here points to a page you have read."
      : `${state.badges.read} links here point to pages you have read.`);
  }
  if (state.badges.reading > 0) {
    sentences.push(state.badges.reading === 1
      ? "1 link here points to a page you are still reading."
      : `${state.badges.reading} links here point to pages you are still reading.`);
  }

  if (sentences.length > 0) {
    const links = el("links");
    links.hidden      = false;
    links.textContent = sentences.join(" ");
  }
}

function wirePageHandlers(state: PopupState, tabId: number) {
  if (state.phase === "starting") return;

  // Backfill affordances: vouch for the current page, or enter click-to-mark mode.
  // Marking works on unsuitable pages too (short pages you still finished reading).
  if (state.phase !== "paused") el("page-actions").hidden = false;

  el("mark-read").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tabId, { type: "swdi:mark-page-read" });
    el("mark-read").textContent = "Marked as read";
  });

  el("backfill").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tabId, { type: "swdi:set-backfill", value: true });
    window.close();
  });

  // Scroll the page (behind the popup) to the resume point; keep the popup open so the
  // reader can step through skipped gaps with repeated clicks.
  el("resume-furthest").addEventListener("click", () => {
    void chrome.tabs.sendMessage(tabId, { type: "swdi:scroll-furthest" });
  });

  el("gap-up").addEventListener("click", async () => {
    applyGapNav(await chrome.tabs.sendMessage(tabId, { type: "swdi:scroll-gap", up: true }).catch(() => null));
  });

  el("gap-down").addEventListener("click", async () => {
    applyGapNav(await chrome.tabs.sendMessage(tabId, { type: "swdi:scroll-gap", up: false }).catch(() => null));
  });

  el<HTMLInputElement>("overlay").addEventListener("change", (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    void chrome.tabs.sendMessage(tabId, { type: "swdi:set-overlay", value: checked });
  });

  el<HTMLInputElement>("pause-host").addEventListener("change", async (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    await chrome.tabs.sendMessage(tabId, { type: "swdi:set-site-paused", value: checked });

    // A site pause supersedes the per-page toggle; lock it on and show it checked, then
    // hand it back to its own stored state when the site is un-paused.
    const pageBox = el<HTMLInputElement>("pause-page");
    pageBox.disabled = checked;
    pageBox.checked  = checked || state.pagePaused;

    showPauseNotice(checked ? `Paused on ${state.host}.` : `Resumed on ${state.host}.`, checked);
  });

  el<HTMLInputElement>("pause-page").addEventListener("change", async (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    await chrome.tabs.sendMessage(tabId, { type: "swdi:set-page-paused", value: checked });

    showPauseNotice(checked ? "Paused on this page." : "Resumed on this page.", checked);
  });
}

// Both pause checkboxes reflect the stored flags; a site pause supersedes and locks the
// per-page one.
function renderPauseRows(state: PopupState) {
  const hostBox = el<HTMLInputElement>("pause-host");
  const pageBox = el<HTMLInputElement>("pause-page");

  el("pause-page-row").hidden = false;
  el("pause-host-row").hidden = false;
  el("pause-host-label").textContent = `Pause on ${state.host}`;

  hostBox.checked  = state.hostPaused;
  pageBox.checked  = state.pagePaused || state.hostPaused;
  pageBox.disabled = state.hostPaused;
}

function showPauseNotice(what: string, paused: boolean) {
  el("status").hidden      = false;
  el("stats").hidden       = true;
  el("status").textContent = paused
    ? `${what} Takes full effect when the page reloads.`
    : `${what} Reload the page to start tracking.`;
}

// Reading speed, sync and export live behind a Settings view; the header button flips
// between it and the page view.
function wireNav() {
  const btn      = el<HTMLButtonElement>("nav-settings");
  const main     = el("main-view");
  const settings = el("settings-view");

  btn.addEventListener("click", () => {
    const toSettings = settings.hidden;
    settings.hidden = !toSettings;
    main.hidden     = toSettings;
    btn.textContent = toSettings ? "Back" : "Settings";
  });
}

// Reflect the arrow availability a scroll-gap step returns: disable whichever direction
// now has nowhere to go.
function applyGapNav(raw: unknown) {
  const nav = gapNavSchema.safeParse(raw);
  if (!nav.success) return;

  el<HTMLButtonElement>("gap-up").disabled   = !nav.data.canUp;
  el<HTMLButtonElement>("gap-down").disabled = !nav.data.canDown;
}

function wireMarkersInfo() {
  const toggle = el<HTMLButtonElement>("markers-info-toggle");
  const info   = el("markers-info");

  toggle.addEventListener("click", () => {
    const open = info.hidden;
    info.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
}

async function wireReadingSpeed() {
  const slider   = el<HTMLInputElement>("reading-speed");
  const value    = el("reading-speed-value");
  const settings = await loadSettings();

  const show = (wpm: number) => { value.textContent = `${wpm} words per minute`; };

  slider.value = String(settings.readingWpm);
  show(settings.readingWpm);

  slider.addEventListener("input",  () => show(Number(slider.value)));
  slider.addEventListener("change", () => void updateSettings({ readingWpm: Number(slider.value) }));
}

function showUntracked() {
  el("status").textContent = "SWDI cannot run on this page.";
}

// ---- sync section -------------------------------------------------------------

async function renderSyncSection() {
  const settings = await loadSettings();

  const off = el("sync-off");
  const on  = el("sync-on");

  if (settings.syncSecret === null) {
    off.hidden = false;
    on.hidden  = true;
    return;
  }

  off.hidden = true;
  on.hidden  = false;

  el<HTMLInputElement>("sync-secret").value    = settings.syncSecret;
  el<HTMLAnchorElement>("dashboard-link").href = `${settings.syncBaseUrl}/dashboard`;

  const meta   = await loadSyncMeta();
  const status = el("sync-status");
  if      (meta.lastError !== null)  status.textContent = failedText(meta.lastError);
  else if (meta.lastSyncAt !== null) status.textContent = syncedText(meta.lastSyncAt);
  else                               status.textContent = "Not synced yet.";
}

function wireSyncHandlers() {
  el("sync-enable").addEventListener("click", async () => {
    const settings = await loadSettings();
    if (settings.syncSecret !== null) return;

    settings.syncSecret = generateSyncSecret();
    await saveSettings(settings);

    await requestSync();
    await renderSyncSection();
  });

  el("sync-have").addEventListener("click", () => {
    el("sync-connect").hidden = false;
  });

  el("sync-connect-btn").addEventListener("click", async () => {
    const input  = el<HTMLInputElement>("sync-input");
    const secret = input.value.trim();

    if ((await deriveSyncKeys(secret)) === null) {
      input.value       = "";
      input.placeholder = "That does not look like a sync key";
      return;
    }

    const settings = await loadSettings();
    settings.syncSecret = secret;
    await saveSettings(settings);

    await requestSync();
    await renderSyncSection();
  });

  el("sync-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(el<HTMLInputElement>("sync-secret").value);
    el("sync-copy").textContent = "Copied";
  });

  el("sync-now").addEventListener("click", async () => {
    el("sync-status").textContent = "Syncing...";
    const result = await requestSync();
    el("sync-status").textContent = result.ok ? syncedText(result.at) : failedText(result.error);
  });

  el("sync-disable").addEventListener("click", async () => {
    const settings = await loadSettings();
    settings.syncSecret = null;
    await saveSettings(settings);

    await chrome.runtime.sendMessage({ type: "swdi:sync-now" }).catch(() => null); // lets background clear its alarm
    await renderSyncSection();
  });
}

function syncedText(atIso: string): string {
  return `Last synced ${atIso.slice(0, 16).replace("T", " ")}`;
}

function failedText(error: string): string {
  return `Last attempt failed: ${error}`;
}

async function requestSync() {
  const raw    = await chrome.runtime.sendMessage({ type: "swdi:sync-now" }).catch(() => null);
  const parsed = syncResultSchema.safeParse(raw);

  return parsed.success ? parsed.data : { ok: false as const, error: "the background worker did not answer" };
}

// ---- export --------------------------------------------------------------------

function wireExport() {
  el("export").addEventListener("click", async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });

    const a = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `swdi-export-${nowIso().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return ensure(document.getElementById(id), `popup element #${id}`) as T;
}
