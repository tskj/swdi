import { ensure, generateSyncSecret, deriveSyncKeys, nowIso } from "@swdi/shared";
import { PopupState, popupStateSchema, syncResultSchema } from "../lib/messages";
import { exportAll, loadSettings, loadSyncMeta, saveSettings } from "../lib/storage";

// Every handler is wired exactly once at startup; re-renders only change visibility
// and text. Wiring inside a render stacks duplicate listeners across state changes.

const STARTING_RETRY_MS  = 300;
const STARTING_RETRY_MAX = 10;

main().catch(() => showUntracked());

async function main() {
  wireExport();
  wireSyncHandlers();
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

  const row      = el("pause-row");
  const checkbox = el<HTMLInputElement>("pause");

  row.hidden       = false;
  checkbox.checked = state.phase === "paused";
  el("pause-label").textContent = `Pause on ${state.host}`;

  if (state.phase === "paused") {
    el("status").textContent = `SWDI is paused on ${state.host}.`;
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

  if (state.changed > 0) {
    const changed = el("changed");
    changed.hidden      = false;
    changed.textContent = `${state.changed} paragraphs are new or changed since you read this page.`;
  }

  const known = state.badges.read + state.badges.partial;
  if (known > 0) {
    const links = el("links");
    links.hidden      = false;
    links.textContent = `${known} links here point to things you have read.`;
  }
}

function wirePageHandlers(state: PopupState, tabId: number) {
  if (state.phase === "starting") return;

  el<HTMLInputElement>("overlay").addEventListener("change", (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    void chrome.tabs.sendMessage(tabId, { type: "swdi:set-overlay", value: checked });
  });

  el<HTMLInputElement>("pause").addEventListener("change", async (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    await chrome.tabs.sendMessage(tabId, { type: "swdi:set-site-paused", value: checked });

    el("status").hidden      = false;
    el("stats").hidden       = true;
    el("status").textContent = checked
      ? `Paused on ${state.host}. Takes full effect when the page reloads.`
      : `Resumed on ${state.host}. Reload the page to start tracking.`;
  });
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
      input.placeholder = "That does not look like a keyphrase";
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
