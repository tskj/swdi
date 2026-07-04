import { ensure, nowIso } from "@swdi/shared";
import { PopupState, popupStateSchema } from "../lib/messages";
import { exportAll } from "../lib/storage";

main().catch(() => showUntracked());

async function main() {
  wireExport();

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

  render(state);
  wireOverlayToggle(tabId, state.overlay);
}

function render(state: PopupState) {
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
}

function showUntracked() {
  el("status").textContent = "This page is not tracked. SWDI Reader currently follows a small set of hypertext book sites.";
}

function wireOverlayToggle(tabId: number, initial: boolean) {
  const checkbox = el<HTMLInputElement>("overlay");
  checkbox.checked = initial;
  checkbox.addEventListener("change", () => {
    void chrome.tabs.sendMessage(tabId, { type: "swdi:set-overlay", value: checkbox.checked });
  });
}

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
