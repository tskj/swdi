import {
  LinkTarget,
  PageRecord,
  ReadLevel,
  mergeRecords,
  newSinceLastRead,
  nowIso,
  nowMs,
  readThresholdMs,
  splitLinkTarget,
  summarize,
  targetReadLevel,
  normalizePageUrl,
} from "@swdi/shared";
import { Paragraph, collectParagraphs, findArticleContainer, isReadableArticle } from "./lib/dom";
import { getStateMessageSchema, setOverlayMessageSchema, setSitePausedMessageSchema } from "./lib/messages";
import { loadPageRecord, loadSettings, loadSummaries, savePage, saveSettings, savePausedHosts } from "./lib/storage";

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
  intersecting: boolean;
  read:         boolean;
};

type TrackingState = {
  title:   string;
  total:   number;
  read:    number;
  changed: number;
  overlay: boolean;
  badges:  { read: number; partial: number };
};

// The extension runs on every page, so the popup must always get an answer: either the
// page is tracked, or it was silently ignored (no readable article), or its site is on
// the user's paused list. The listener exists from the first tick; the phase evolves.
type Phase =
  | { phase: "starting" }
  | { phase: "paused";     host: string }
  | { phase: "unsuitable"; host: string }
  | { phase: "tracking";   host: string; getState: () => TrackingState; setOverlay: (value: boolean) => void };

let current: Phase = { phase: "starting" };

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (getStateMessageSchema.safeParse(message).success) {
    if (current.phase === "tracking") sendResponse({ phase: "tracking", host: current.host, ...current.getState() });
    else                              sendResponse({ phase: current.phase, host: location.hostname });
    return;
  }

  const setOverlay = setOverlayMessageSchema.safeParse(message);
  if (setOverlay.success) {
    if (current.phase === "tracking") current.setOverlay(setOverlay.data.value);
    sendResponse({ ok: true });
    return;
  }

  const setPaused = setSitePausedMessageSchema.safeParse(message);
  if (setPaused.success) {
    void savePausedHosts(location.hostname, setPaused.data.value).then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});

main().catch((err) => console.warn("swdi: reader failed to start", err));

async function main() {
  const host     = location.hostname;
  const settings = await loadSettings();

  if (isPausedHost(settings.blockedHosts, host)) {
    current = { phase: "paused", host };
    return;
  }

  const pageUrl = normalizePageUrl(location.href);
  if (pageUrl === null) return;

  const container = findArticleContainer(document);
  if (container === null) return;

  const paragraphs = await collectParagraphs(container.el);
  const stored     = await loadPageRecord(pageUrl);

  // The readability gate decides whether to START tracking a page; existing history
  // overrides it, so a short page a reader already has state for keeps its markers.
  if (stored === null && !isReadableArticle(paragraphs, container.fallback)) {
    current = { phase: "unsuitable", host };
    return;
  }
  if (paragraphs.length === 0) return;

  const record = stored ?? freshRecord(pageUrl);

  // Newness is judged against the record as loaded, before this visit merges its sightings.
  const changed = newSinceLastRead(record, paragraphs.map((p) => p.hash));

  const visitIso = nowIso();
  record.title       = document.title;
  record.lastVisitAt = visitIso;
  record.outline     = paragraphs.map(({ hash, words, sectionId }) => ({ h: hash, w: words, s: sectionId }));
  for (const p of paragraphs) record.seen[p.hash] ??= visitIso;

  applyOverlayEnabled(settings.overlay);
  watchDarkReader();
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

    // Another tab of this page may have flushed since we loaded; fold its reads in
    // rather than overwriting them (see mergeRecords).
    const concurrent = await loadPageRecord(record.url);
    if (concurrent !== null) mergeRecords(record, concurrent);

    await savePage(record, summarize(record));
    refreshLocalBadges();
    sendBadge();
    chrome.runtime.sendMessage({ type: "swdi:page-flushed" }).catch(() => {});
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
      intersecting: false,
      read:         p.hash in record.read,
    });
  }

  function markRead(t: Tracked) {
    t.read = true;
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
    for (const entry of entries) {
      const t = tracked.get(entry.target);
      if (t === undefined || t.read) continue;

      t.intersecting = entry.intersectionRatio >= VISIBLE_RATIO
                    || entry.intersectionRect.height >= window.innerHeight * VISIBLE_RATIO;
    }
  }, { threshold: IO_THRESHOLDS });

  for (const t of tracked.values()) {
    if (!t.read) io.observe(t.p.el);
  }

  // Dwell accrues per tick with a clamped delta, never as an open wall-clock span:
  // an OS suspend or display sleep fires no visibility event, so an unbounded
  // now - since would mark everything in view read the moment the laptop wakes.
  let lastTickAt = nowMs();

  setInterval(() => {
    const now   = nowMs();
    const delta = Math.min(now - lastTickAt, TICK_MS * 2);
    lastTickAt  = now;

    if (document.hidden) return;

    for (const t of tracked.values()) {
      if (t.read || !t.intersecting) continue;

      t.accruedMs += delta;
      if (t.accruedMs >= t.thresholdMs) markRead(t);
    }
  }, TICK_MS);

  // ---- furthest position + resume -------------------------------------------

  const indexOfHash = new Map<string, number>();
  paragraphs.forEach((p, i) => indexOfHash.set(p.hash, indexOfHash.get(p.hash) ?? i));

  function advanceFurthest(hash: string) {
    const currentIdx  = record.furthestReadHash === null ? -1 : indexOfHash.get(record.furthestReadHash) ?? -1;
    const incomingIdx = indexOfHash.get(hash) ?? -1;

    if (incomingIdx > currentIdx) record.furthestReadHash = hash;
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

  current = {
    phase: "tracking",
    host,

    getState: () => {
      const summary = summarize(record);
      return {
        title:   record.title,
        total:   summary.total,
        read:    summary.read,
        changed: changed.size,
        overlay: settings.overlay,
        badges:  badgeCounts(),
      };
    },

    setOverlay: (value: boolean) => {
      settings.overlay = value;
      applyOverlayEnabled(value);
      void saveSettings(settings);
    },
  };

  // The visit itself (outline, sightings, title) is worth persisting even if nothing gets read.
  await flush();
}

function isPausedHost(blockedHosts: string[], host: string): boolean {
  return blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
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

// Badges live inside a closed shadow root on a zero-size host that every candidate link
// gets, marked or not. Page scripts see an identical DOM shape and zero layout impact
// whatever your history says, so which links you have read is not legible to the page.
// Cross-page reading state must never be readable by page JavaScript.
const badgeDots   = new WeakMap<HTMLAnchorElement, HTMLElement>();
const badgeLevels = new Map<HTMLAnchorElement, ReadLevel>();

function applyBadge(a: HTMLAnchorElement, level: ReadLevel) {
  let dot = badgeDots.get(a);

  if (dot === undefined) {
    const host = document.createElement("span");
    host.className = "swdi-badge-host swdi-ui";

    dot = document.createElement("span");
    host.attachShadow({ mode: "closed" }).appendChild(dot);
    a.appendChild(host);
    badgeDots.set(a, dot);
  }

  badgeLevels.set(a, level);

  if (level === "none") {
    dot.style.display = "none";
    dot.removeAttribute("title");
    return;
  }

  const green = darkReaderActive() ? "127, 172, 144" : "92, 138, 111";
  const color = level === "read" ? `rgba(${green}, 0.95)` : `rgba(${green}, 0.5)`;
  dot.style.cssText = `position: absolute; display: block; left: 0.1em; top: -0.85em; width: 0.42em; height: 0.42em; border-radius: 50%; background: ${color};`;
  dot.title         = level === "read" ? "You have read this" : "You have partly read this";
}

function badgeCounts(): { read: number; partial: number } {
  const counts = { read: 0, partial: 0 };
  for (const level of badgeLevels.values()) {
    if      (level === "read")    counts.read    += 1;
    else if (level === "partial") counts.partial += 1;
  }

  return counts;
}

// We can't darkreader-lock a page we don't own, and when Dark Reader restyles one of
// the tracked sites our low-alpha markers wash out against the darkened background.
// Dark Reader stamps data-darkreader-* attributes on <html>; mirror them into a class
// content.css keys its dark-tuned marker colors on, and follow later toggles.
function watchDarkReader() {
  const root = document.documentElement;

  const reflect = () => {
    const active = root.hasAttribute("data-darkreader-mode") || root.hasAttribute("data-darkreader-scheme");
    root.classList.toggle("swdi-darkreader", active);
  };

  new MutationObserver(reflect).observe(root, {
    attributes:      true,
    attributeFilter: ["data-darkreader-mode", "data-darkreader-scheme"],
  });
  reflect();
}

function darkReaderActive(): boolean {
  return document.documentElement.classList.contains("swdi-darkreader");
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
