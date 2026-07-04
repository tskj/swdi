import {
  LinkTarget,
  PageRecord,
  ReadLevel,
  newSinceLastRead,
  nowIso,
  nowMs,
  readThresholdMs,
  splitLinkTarget,
  summarize,
  targetReadLevel,
  normalizePageUrl,
} from "@swdi/shared";
import { Paragraph, collectParagraphs, findArticleContainer } from "./lib/dom";
import { getStateMessageSchema, setOverlayMessageSchema } from "./lib/messages";
import { loadPageRecord, loadSettings, loadSummaries, savePage, saveSettings } from "./lib/storage";

// A paragraph counts as visible for dwell purposes at half its area, or half a viewport
// for blocks taller than the screen. The extra thresholds make the observer re-fire while
// a tall block scrolls through, so the height clause gets re-evaluated.
const VISIBLE_RATIO = 0.5;
const IO_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

const TICK_MS    = 1_000;
const PERSIST_MS = 2_000;

type Tracked = {
  p:            Paragraph;
  thresholdMs:  number;
  accruedMs:    number;
  visibleSince: number | null;
  intersecting: boolean;
  read:         boolean;
};

main().catch((err) => console.warn("swdi: reader failed to start", err));

async function main() {
  const pageUrl = normalizePageUrl(location.href);
  if (pageUrl === null) return;

  const container = findArticleContainer(document);
  if (container === null) return;

  const paragraphs = await collectParagraphs(container);
  if (paragraphs.length === 0) return;

  const settings = await loadSettings();
  const stored   = await loadPageRecord(pageUrl);
  const record   = stored ?? freshRecord(pageUrl);

  // Newness is judged against the record as loaded, before this visit merges its sightings.
  const changed = newSinceLastRead(record, paragraphs.map((p) => p.hash));

  const visitIso = nowIso();
  record.title       = document.title;
  record.lastVisitAt = visitIso;
  record.outline     = paragraphs.map(({ hash, words, sectionId }) => ({ h: hash, w: words, s: sectionId }));
  for (const p of paragraphs) record.seen[p.hash] ??= visitIso;

  applyOverlayEnabled(settings.overlay);
  for (const p of paragraphs) {
    if (p.hash in record.read) p.el.classList.add("swdi-read");
    else if (changed.has(p.hash)) p.el.classList.add("swdi-new");
  }

  // ---- persistence ----------------------------------------------------------

  let persistTimer: number | null = null;

  function schedulePersist() {
    persistTimer ??= window.setTimeout(() => void flush(), PERSIST_MS);
  }

  async function flush() {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = null;

    await savePage(record, summarize(record));
    refreshLocalBadges();
    sendBadge();
  }

  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flush();
  });

  // ---- dwell tracking -------------------------------------------------------

  const tracked = new Map<Element, Tracked>();
  for (const p of paragraphs) {
    if (tracked.has(p.el)) continue;

    tracked.set(p.el, {
      p,
      thresholdMs:  readThresholdMs(p.words),
      accruedMs:    0,
      visibleSince: null,
      intersecting: false,
      read:         p.hash in record.read,
    });
  }

  function updateRunning(t: Tracked, now: number) {
    const running = t.intersecting && !document.hidden && !t.read;

    if (running  && t.visibleSince === null) t.visibleSince = now;
    if (!running && t.visibleSince !== null) {
      t.accruedMs   += now - t.visibleSince;
      t.visibleSince = null;
    }
  }

  function markRead(t: Tracked, now: number) {
    t.read = true;
    updateRunning(t, now);
    io.unobserve(t.p.el);

    record.read[t.p.hash] = { at: nowIso(), dwellMs: Math.round(t.accruedMs) };
    record.lastReadAt     = nowIso();
    advanceFurthest(t.p.hash);

    t.p.el.classList.remove("swdi-new");
    t.p.el.classList.add("swdi-read");
    changed.delete(t.p.hash);
    schedulePersist();
  }

  const io = new IntersectionObserver((entries) => {
    const now = nowMs();
    for (const entry of entries) {
      const t = tracked.get(entry.target);
      if (t === undefined || t.read) continue;

      t.intersecting = entry.intersectionRatio >= VISIBLE_RATIO
                    || entry.intersectionRect.height >= window.innerHeight * VISIBLE_RATIO;
      updateRunning(t, now);
    }
  }, { threshold: IO_THRESHOLDS });

  for (const t of tracked.values()) {
    if (!t.read) io.observe(t.p.el);
  }

  document.addEventListener("visibilitychange", () => {
    const now = nowMs();
    for (const t of tracked.values()) updateRunning(t, now);
  });

  setInterval(() => {
    if (document.hidden) return;

    const now = nowMs();
    for (const t of tracked.values()) {
      if (t.read || t.visibleSince === null) continue;
      if (t.accruedMs + (now - t.visibleSince) >= t.thresholdMs) markRead(t, now);
    }
  }, TICK_MS);

  // ---- furthest position + resume -------------------------------------------

  const indexOfHash = new Map<string, number>();
  paragraphs.forEach((p, i) => indexOfHash.set(p.hash, indexOfHash.get(p.hash) ?? i));

  function advanceFurthest(hash: string) {
    const current  = record.furthestReadHash === null ? -1 : indexOfHash.get(record.furthestReadHash) ?? -1;
    const incoming = indexOfHash.get(hash) ?? -1;

    if (incoming > current) record.furthestReadHash = hash;
  }

  offerResume(paragraphs, record.furthestReadHash);

  // ---- link badges -----------------------------------------------------------

  const links: Array<{ a: HTMLAnchorElement; target: LinkTarget }> = [];
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (a.closest(".swdi-ui") !== null) continue;

    const target = splitLinkTarget(a.href);
    if (target !== null) links.push({ a, target });
  }

  const remotePages = [...new Set(links.map((l) => l.target.page))].filter((page) => page !== pageUrl);
  const summaries   = await loadSummaries(remotePages);

  function refreshLocalBadges() {
    const summary = summarize(record);
    for (const { a, target } of links) {
      if (target.page === pageUrl) applyBadge(a, targetReadLevel(summary, target.fragment));
    }
  }

  for (const { a, target } of links) {
    if (target.page === pageUrl) continue;

    const summary = summaries.get(target.page);
    applyBadge(a, summary === undefined ? "none" : targetReadLevel(summary, target.fragment));
  }
  refreshLocalBadges();

  // ---- popup + badge ----------------------------------------------------------

  function sendBadge() {
    const summary = summarize(record);
    chrome.runtime.sendMessage({ type: "swdi:badge", read: summary.read, total: summary.total }).catch(() => {});
  }

  function applyOverlayEnabled(enabled: boolean) {
    document.documentElement.classList.toggle("swdi-overlay-off", !enabled);
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (getStateMessageSchema.safeParse(message).success) {
      const summary = summarize(record);
      sendResponse({
        title:   record.title,
        total:   summary.total,
        read:    summary.read,
        changed: changed.size,
        overlay: settings.overlay,
      });
      return;
    }

    const setOverlay = setOverlayMessageSchema.safeParse(message);
    if (setOverlay.success) {
      settings.overlay = setOverlay.data.value;
      applyOverlayEnabled(settings.overlay);
      void saveSettings(settings);
      sendResponse({ ok: true });
    }
  });

  // The visit itself (outline, sightings, title) is worth persisting even if nothing gets read.
  await flush();
}

function freshRecord(url: string): PageRecord {
  return {
    v: 1,
    url,
    title: document.title,

    firstSeenAt: nowIso(),
    lastVisitAt: nowIso(),
    lastReadAt:  null,

    outline: [],
    read:    {},
    seen:    {},

    furthestReadHash: null,
  };
}

function applyBadge(a: HTMLAnchorElement, level: ReadLevel) {
  const existing = a.querySelector<HTMLElement>(":scope > .swdi-badge");

  if (level === "none") {
    existing?.remove();
    return;
  }

  const badge = existing ?? a.appendChild(document.createElement("span"));
  badge.className     = "swdi-badge swdi-ui";
  badge.dataset.level = level;
  badge.title         = level === "read" ? "You have read this" : "You have partly read this";
}

function offerResume(paragraphs: Paragraph[], furthestHash: string | null) {
  if (furthestHash === null) return;

  const target = paragraphs.find((p) => p.hash === furthestHash);
  if (target === undefined) return;
  if (target.el.getBoundingClientRect().top <= window.innerHeight) return;

  const pill = document.createElement("button");
  pill.className   = "swdi-resume swdi-ui";
  pill.textContent = "Continue where you left off";
  pill.addEventListener("click", () => {
    target.el.scrollIntoView({ behavior: "smooth", block: "center" });
    pill.remove();
  });
  document.body.appendChild(pill);

  // The pill also leaves once the reader scrolls down to their old position on their own.
  const seen = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { pill.remove(); seen.disconnect(); }
  });
  seen.observe(target.el);
}
