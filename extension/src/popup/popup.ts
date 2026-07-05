import { ensure, generateSyncSecret, deriveSyncKeys, nowIso } from "@swdi/shared";
import { PopupState, popupStateSchema, syncResultSchema } from "../lib/messages";
import { exportAll, loadSettings, loadSyncMeta, saveSettings } from "../lib/storage";

main().catch(() => showUntracked());

async function main() {
  wireExport();
  await renderSyncSection();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId === undefined) { showUntracked(); return; }

  let state: PopupState;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "swdi:get-state" });
    state = popupStateSchema.parse(response);
  } catch {
    showUntracked();
    return;
  }

  renderPage(state, tabId);
}

// ---- page section -------------------------------------------------------------

function renderPage(state: PopupState, tabId: number) {
  wirePauseToggle(state, tabId);

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

function wirePauseToggle(state: PopupState, tabId: number) {
  const row      = el("pause-row");
  const checkbox = el<HTMLInputElement>("pause");

  row.hidden       = false;
  checkbox.checked = state.phase === "paused";
  el("pause-label").textContent = `Pause on ${state.host}`;

  checkbox.addEventListener("change", async () => {
    await chrome.tabs.sendMessage(tabId, { type: "swdi:set-site-paused", value: checkbox.checked });
    el("status").hidden      = false;
    el("stats").hidden       = true;
    el("status").textContent = checkbox.checked
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
    wireSyncOff();
    return;
  }

  off.hidden = true;
  on.hidden  = false;

  el<HTMLInputElement>("sync-secret").value = settings.syncSecret;
  el<HTMLAnchorElement>("dashboard-link").href = `${settings.syncBaseUrl}/dashboard`;

  const meta = await loadSyncMeta();
  const status = el("sync-status");
  if      (meta.lastError !== null)  status.textContent = `Last attempt failed: ${meta.lastError}`;
  else if (meta.lastSyncAt !== null) status.textContent = `Last synced ${meta.lastSyncAt.slice(0, 16).replace("T", " ")}`;
  else                               status.textContent = "Not synced yet.";

  wireSyncOn();
}

function wireSyncOff() {
  el("sync-enable").addEventListener("click", async () => {
    const settings = await loadSettings();
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
}

function wireSyncOn() {
  el("sync-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(el<HTMLInputElement>("sync-secret").value);
    el("sync-copy").textContent = "Copied";
  });

  el("sync-now").addEventListener("click", async () => {
    el("sync-status").textContent = "Syncing...";
    const result = await requestSync();
    el("sync-status").textContent = result.ok
      ? `Last synced ${result.at.slice(0, 16).replace("T", " ")}`
      : `Last attempt failed: ${result.error}`;
  });

  el("sync-disable").addEventListener("click", async () => {
    const settings = await loadSettings();
    settings.syncSecret = null;
    await saveSettings(settings);

    await chrome.runtime.sendMessage({ type: "swdi:sync-now" }).catch(() => null); // lets background clear its alarm
    await renderSyncSection();
  });
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
