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
import {
  getStateMessageSchema,
  markPageReadMessageSchema,
  readUpToHereMessageSchema,
  setBackfillMessageSchema,
  scrollFurthestMessageSchema,
  scrollGapMessageSchema,
  setOverlayMessageSchema,
  setPagePausedMessageSchema,
  setSitePausedMessageSchema,
} from "./lib/messages";
import { clearTombstone, loadPageRecord, loadSettings, loadSummaries, removePage, savePage, savePausedHosts, savePausedPages, updateSettings, watchSettings } from "./lib/storage";

// A paragraph counts as visible for dwell purposes at half its area, or half a viewport
// for blocks taller than the screen. The extra thresholds make the observer re-fire while
// a tall block scrolls through, so the height clause gets re-evaluated.
const VISIBLE_RATIO = 0.5;
const IO_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

const TICK_MS    = 1_000;
const PERSIST_MS = 2_000;

// How close to the very bottom of the page counts as "reached the end", where the last
// paragraphs (which never scroll out of view) are allowed to commit.
const BOTTOM_SLACK_PX = 4;

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
  canResume:  boolean; // a furthest point exists to continue from
  canGapUp:   boolean; // a skipped stretch sits before the current one (arrow up)
  canGapDown: boolean; // a skipped stretch sits after the current one (arrow down)
  badges:  { read: number; reading: number };
};

// The extension runs on every page, so the popup must always get an answer: either the
// page is tracked, or it was silently ignored (no readable article), or its site is on
// the user's paused list. The listener exists from the first tick; the phase evolves.
type Phase =
  | { phase: "starting" }
  | { phase: "paused";     host: string }
  | { phase: "unsuitable"; host: string }
  | { phase: "tracking";   host: string; getState: () => TrackingState; setOverlay: (value: boolean) => void; markReadThisFar: (pageY: number) => Promise<void>; scrollFurthest: () => void; scrollGap: (up: boolean) => { canUp: boolean; canDown: boolean } };

let current: Phase = { phase: "starting" };

// Whether tracking is paused for this host or this exact page; the popup renders both as
// checkboxes. Set once main() has read settings, so get-state can always report them.
let pauseState = { host: false, page: false };

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (getStateMessageSchema.safeParse(message).success) {
    const pause = { hostPaused: pauseState.host, pagePaused: pauseState.page };
    if (current.phase === "tracking") sendResponse({ phase: "tracking", host: current.host, ...pause, ...current.getState() });
    else                              sendResponse({ phase: current.phase, host: location.hostname, ...pause });
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

  const setPagePaused = setPagePausedMessageSchema.safeParse(message);
  if (setPagePaused.success) {
    const url = normalizePageUrl(location.href);
    if (url === null) { sendResponse({ ok: false }); return; }

    void savePausedPages(url, setPagePaused.data.value).then(() => sendResponse({ ok: true }));
    return true; // async response
  }

  if (markPageReadMessageSchema.safeParse(message).success) {
    void markCurrentPageRead().then(() => sendResponse({ ok: true }));
    return true; // async response
  }

  const backfill = setBackfillMessageSchema.safeParse(message);
  if (backfill.success) {
    setBackfillMode(backfill.data.value);
    sendResponse({ ok: true });
    return;
  }

  if (readUpToHereMessageSchema.safeParse(message).success) {
    if (current.phase === "tracking") {
      void current.markReadThisFar(lastContextMenuY).then(() => sendResponse({ ok: true }));
      return true; // async response
    }

    sendResponse({ ok: false });
    return;
  }

  if (scrollFurthestMessageSchema.safeParse(message).success) {
    if (current.phase === "tracking") current.scrollFurthest();
    sendResponse({ ok: current.phase === "tracking" });
    return;
  }

  const gapMsg = scrollGapMessageSchema.safeParse(message);
  if (gapMsg.success) {
    if (current.phase === "tracking") sendResponse(current.scrollGap(gapMsg.data.up));
    else                              sendResponse({ canUp: false, canDown: false });
  }
});

// "I've read this far" arrives from the service worker's context-menu click, which
// carries no coordinates; capture the last right-click position so the handler above
// knows how far "here" is. Capture phase, so a page that swallows contextmenu can't hide it.
let lastContextMenuY = 0;
window.addEventListener("contextmenu", (event) => { lastContextMenuY = event.pageY; }, true);

main().catch((err) => console.warn("swdi: reader failed to start", err));

async function main() {
  const host     = location.hostname;
  const settings = await loadSettings();
  const pageUrl  = normalizePageUrl(location.href);

  pauseState = {
    host: isPausedHost(settings.blockedHosts, host),
    page: pageUrl !== null && settings.blockedPages.includes(pageUrl),
  };

  if (pauseState.host || pauseState.page) {
    current = { phase: "paused", host };
    return;
  }

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

  // This visit recreates the page, so any pending deletion tombstone is obsolete.
  void clearTombstone(pageUrl);

  // A backfilled page materializes on its first real visit: every paragraph now on
  // the page becomes read as of the vouched time, so sections and change detection
  // work from here on. Paragraphs un-read after the vouch stay un-read.
  if (record.assumedReadAt !== null) {
    for (const p of paragraphs) {
      const clearedAt = record.cleared[p.hash];
      if (clearedAt !== undefined && clearedAt >= record.assumedReadAt) continue;

      record.read[p.hash] ??= { at: record.assumedReadAt, dwellMs: 0, words: p.words };
    }
    record.lastReadAt ??= record.assumedReadAt;
  }

  // Newness is judged against the record as loaded, before this visit merges its sightings.
  const changed = newSinceLastRead(record, paragraphs.map((p) => p.hash));

  const visitIso = nowIso();
  record.title       = document.title;
  record.lastVisitAt = visitIso;
  record.outline     = paragraphs.map(({ hash, words, sectionId }) => ({ h: hash, w: words, s: sectionId }));
  for (const p of paragraphs) record.seen[p.hash] ??= visitIso;

  // Self-heal the word count on any already-read paragraph still present, even off-screen:
  // a matching hash means the same text, so the same count. This corrects records written
  // before words were tracked, gradually, whenever their pages are opened again.
  for (const p of paragraphs) {
    const r = record.read[p.hash];
    if (r !== undefined) r.words = p.words;
  }

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
      thresholdMs:  readThresholdMs(p.words, settings.readingWpm),
      accruedMs:    0,
      intersecting: false,
      read:         p.hash in record.read,
    });
  }

  function markRead(t: Tracked) {
    t.read = true;
    io.unobserve(t.p.el);

    record.read[t.p.hash] = { at: nowIso(), dwellMs: Math.round(t.accruedMs), words: t.p.words };
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

      const nowIntersecting = entry.intersectionRatio >= VISIBLE_RATIO
                           || entry.intersectionRect.height >= window.innerHeight * VISIBLE_RATIO;

      // A paragraph commits as read when it leaves view AFTER being watched long enough.
      // A fast-scrolled skim never accrues the time, and a section parked on screen while
      // the reader is away never commits until they actually move on. Leaving in scroll
      // order also fills the markers top-to-bottom for free.
      if (t.intersecting && !nowIntersecting && t.accruedMs >= t.thresholdMs) markRead(t);

      t.intersecting = nowIntersecting;
    }
  }, { threshold: IO_THRESHOLDS });

  for (const t of tracked.values()) {
    if (!t.read) io.observe(t.p.el);
  }

  // Dwell accrues per tick with a clamped delta, never as an open wall-clock span:
  // an OS suspend or display sleep fires no visibility event, so an unbounded
  // now - since would count everything in view the instant the laptop wakes. Accrual
  // only earns eligibility; committing happens on scroll-out (above) or at the page
  // bottom (below), never from sitting still in the middle of a page.
  let lastTickAt = nowMs();

  setInterval(() => {
    const now   = nowMs();
    const delta = Math.min(now - lastTickAt, TICK_MS * 2);
    lastTickAt  = now;

    if (document.hidden) return;

    for (const t of tracked.values()) {
      if (!t.read && t.intersecting && t.accruedMs < t.thresholdMs) t.accruedMs += delta;
    }

    // The final paragraphs never scroll out, and a short page never scrolls at all;
    // reaching the bottom is the terminal equivalent, so eligible paragraphs still in
    // view now commit, in document order.
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - BOTTOM_SLACK_PX;
    if (!atBottom) return;

    for (const t of tracked.values()) {
      if (!t.read && t.intersecting && t.accruedMs >= t.thresholdMs) markRead(t);
    }
  }, TICK_MS);

  // Settings changed in the popup apply to the page you are on, not just the next load:
  // a new reading speed re-thresholds every paragraph live, and the marker overlay
  // follows too (so the toggle stays in step across a site's open tabs).
  watchSettings((next) => {
    if (next.readingWpm !== settings.readingWpm) {
      settings.readingWpm = next.readingWpm;
      for (const t of tracked.values()) t.thresholdMs = readThresholdMs(t.p.words, settings.readingWpm);
    }

    if (next.overlay !== settings.overlay) {
      settings.overlay = next.overlay;
      applyOverlayEnabled(settings.overlay);
    }
  });

  // ---- furthest position + resume -------------------------------------------

  const indexOfHash = new Map<string, number>();
  paragraphs.forEach((p, i) => indexOfHash.set(p.hash, indexOfHash.get(p.hash) ?? i));

  function advanceFurthest(hash: string) {
    const currentIdx  = record.furthestReadHash === null ? -1 : indexOfHash.get(record.furthestReadHash) ?? -1;
    const incomingIdx = indexOfHash.get(hash) ?? -1;

    if (incomingIdx > currentIdx) record.furthestReadHash = hash;
  }

  // Paragraph index of the skipped spot the arrows last moved to (-1 = none yet), a
  // document position so it survives the gap list shrinking as gaps get read.
  let gapCursor = -1;

  function furthestIndex(): number {
    return record.furthestReadHash === null ? -1 : indexOfHash.get(record.furthestReadHash) ?? -1;
  }

  // First paragraph of each unread run (a "gap") that sits BEFORE the furthest point
  // reached, i.e. every stretch the reader skipped, in document order.
  function skippedGapStarts(): number[] {
    const before = furthestIndex();
    if (before <= 0) return [];

    const starts: number[] = [];
    for (let i = 0; i < before; i++) {
      const p = paragraphs[i];
      if (p === undefined || p.hash in record.read) continue;

      const prev = i === 0 ? undefined : paragraphs[i - 1];
      if (prev === undefined || prev.hash in record.read) starts.push(i);
    }

    return starts;
  }

  // Which arrows have somewhere to go: is there a skipped spot before / after the cursor?
  function gapNav(): { canUp: boolean; canDown: boolean } {
    const gaps = skippedGapStarts();
    return { canUp: gaps.some((g) => g < gapCursor), canDown: gaps.some((g) => g > gapCursor) };
  }

  // Popup "Continue where I left off": jump all the way down to the furthest paragraph reached.
  function scrollFurthest() {
    const idx = furthestIndex();
    if (idx >= 0) paragraphs[idx]?.el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Popup up/down arrows: step to the previous or next skipped stretch, clamped at the
  // ends (a disabled arrow can't be clicked), landing with the last-read paragraph
  // centered for context. Returns the fresh arrow availability for the popup to apply.
  function scrollGap(up: boolean): { canUp: boolean; canDown: boolean } {
    const gaps = skippedGapStarts();

    let target: number | undefined;
    if (up) for (const g of gaps) { if (g < gapCursor) target = g; } // last gap before the cursor
    else    target = gaps.find((g) => g > gapCursor);                // first gap after the cursor

    if (target !== undefined) {
      gapCursor = target;
      paragraphs[Math.max(0, target - 1)]?.el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return gapNav();
  }

  // ---- link badges -----------------------------------------------------------
  // Cross-page reading memory only: a dot means the link leads to another page (or a
  // section of one) you have read. Links back into the current page are left alone,
  // its read-state is already on screen as paragraph markers, and badging a page's own
  // table of contents would count the page against itself.

  const links: Array<{ a: HTMLAnchorElement; target: LinkTarget }> = [];
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (a.closest(".swdi-ui") !== null) continue;

    const target = splitLinkTarget(a.href);
    if (target !== null && target.page !== pageUrl) links.push({ a, target });
  }

  const remotePages = [...new Set(links.map((l) => l.target.page))];
  const summaries   = await loadSummaries(remotePages);

  for (const { a, target } of links) {
    const summary = summaries.get(target.page);
    applyBadge(a, summary === undefined ? "none" : targetReadLevel(summary, target.fragment));
  }

  // ---- popup + badge ----------------------------------------------------------

  function sendBadge() {
    const summary = summarize(record);
    chrome.runtime.sendMessage({ type: "swdi:badge", read: summary.read, total: summary.total }).catch(() => {});
  }

  function applyOverlayEnabled(enabled: boolean) {
    document.documentElement.classList.toggle("swdi-overlay-off", !enabled);
  }

  // The popup tallies distinct destinations, not anchor tags: a page that links the
  // same target ten times counts it once. "read" and "reading" stay apart, so a page
  // you have only started never counts as one you have finished.
  function linkReadCounts(): { read: number; reading: number } {
    const byTarget = new Map<string, ReadLevel>();
    for (const { target } of links) {
      const summary = summaries.get(target.page);
      byTarget.set(`${target.page}#${target.fragment ?? ""}`, summary === undefined ? "none" : targetReadLevel(summary, target.fragment));
    }

    let read    = 0;
    let reading = 0;
    for (const level of byTarget.values()) {
      if      (level === "read")    read    += 1;
      else if (level === "partial") reading += 1;
    }

    return { read, reading };
  }

  function clearRead(t: Tracked, at: string) {
    t.read      = false;
    t.accruedMs = 0;
    delete record.read[t.p.hash];
    record.cleared[t.p.hash] = at; // tombstone: stale copies of this read stay dead in merges
    t.p.el.classList.remove("swdi-read");
    io.observe(t.p.el);
  }

  // "I've read this far" (the page context-menu item): the reader right-clicks the last
  // thing they read. Everything at or above that point becomes read and everything below
  // becomes unread, so the click is an exact place to resume from with no dwell overshoot
  // left marked beneath it. The clears are tombstoned, so they hold through every merge:
  // concurrent tabs, sync, and stale devices. A click above the first paragraph resets
  // the page, every paragraph cleared and no resume point, a way to start a reread.
  async function markReadThisFar(pageY: number): Promise<void> {
    const at = nowIso();

    let deepest: string | null = null;
    for (const t of tracked.values()) {
      const top = t.p.el.getBoundingClientRect().top + window.scrollY;

      if (top <= pageY) {
        if (!t.read) markRead(t);
        deepest = t.p.hash;
      } else if (t.read) {
        clearRead(t, at);
      }
    }

    // An explicit partial statement supersedes any whole-page vouch: revoking it keeps
    // the page from re-materializing the cleared paragraphs on the next visit, and the
    // revoke timestamp keeps a stale device's old vouch from winning the merge.
    if (record.assumedReadAt !== null) {
      record.assumedReadAt    = null;
      record.assumedClearedAt = at;
    }

    record.furthestReadHash = deepest;
    await flush();
  }

  current = {
    phase: "tracking",
    host,

    getState: () => {
      const summary = summarize(record);
      const nav     = gapNav();
      return {
        title:   record.title,
        total:   summary.total,
        read:    summary.read,
        changed: changed.size,
        overlay: settings.overlay,
        canResume:  furthestIndex() >= 0, // furthest paragraph still present on this page
        canGapUp:   nav.canUp,
        canGapDown: nav.canDown,
        badges:  linkReadCounts(),
      };
    },

    setOverlay: (value: boolean) => {
      settings.overlay = value;
      applyOverlayEnabled(value);
      void updateSettings({ overlay: value });
    },

    markReadThisFar,
    scrollFurthest,
    scrollGap,
  };

  // The visit itself (outline, sightings, title) is worth persisting even if nothing gets read.
  await flush();
}

// ---- backfill -------------------------------------------------------------------
// Two ways to vouch for reading that predates the extension: mark the current page
// read (popup), and a mode where clicking links marks their targets instead of
// navigating. Targets never visited get a stub record carrying assumedReadAt; real
// paragraph state materializes on the first actual visit.

async function markCurrentPageRead(): Promise<void> {
  const pageUrl = normalizePageUrl(location.href);
  if (pageUrl === null) return;

  const record = await vouchFor(pageUrl, document.title);

  // If this page is actively tracked, its in-memory record catches up at next flush
  // via mergeRecords; the overlay refreshes fully on the next load. Do the cheap,
  // immediately visible part here.
  if (record !== null) document.querySelectorAll(".swdi-new").forEach((el) => el.classList.remove("swdi-new"));
}

/** Mark a page read by assertion; returns the saved record. */
async function vouchFor(pageUrl: string, fallbackTitle: string): Promise<PageRecord | null> {
  const stored = await loadPageRecord(pageUrl);
  const record = stored ?? { ...freshRecord(pageUrl), title: fallbackTitle };
  const at     = nowIso();

  record.assumedReadAt ??= at;
  record.lastReadAt    ??= at;
  for (const entry of record.outline) {
    const clearedAt = record.cleared[entry.h];
    if (clearedAt !== undefined && clearedAt >= record.assumedReadAt) continue; // un-read after the vouch stays un-read

    record.read[entry.h] ??= { at: record.assumedReadAt, dwellMs: 0, words: entry.w };
  }

  await clearTombstone(pageUrl); // vouching recreates a deleted page
  await savePage(record, summarize(record));
  chrome.runtime.sendMessage({ type: "swdi:page-flushed" }).catch(() => {});
  return record;
}

let backfillTeardown: (() => void) | null = null;

function setBackfillMode(on: boolean) {
  if (!on) { backfillTeardown?.(); return; }
  if (backfillTeardown !== null) return;

  const banner = document.createElement("div");
  banner.className   = "swdi-backfill swdi-ui";
  banner.textContent = "Backfill: click links to mark them read (click again to undo). Esc to finish.";

  const done = document.createElement("button");
  done.textContent = "Done";
  banner.appendChild(done);
  document.body.appendChild(banner);

  // Pages stubbed during this session, so a second click can undo them.
  const stubbed = new Set<string>();

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".swdi-backfill") !== null) return;

    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;

    event.preventDefault();
    event.stopPropagation();

    const link = splitLinkTarget(anchor.href);
    if (link === null) return;

    void toggleBackfilled(link.page, anchor, stubbed);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") teardown();
  };

  function teardown() {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    banner.remove();
    backfillTeardown = null;
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  done.addEventListener("click", teardown);
  backfillTeardown = teardown;
}

async function toggleBackfilled(pageUrl: string, anchor: HTMLAnchorElement, stubbed: Set<string>): Promise<void> {
  if (stubbed.has(pageUrl)) {
    await removePage(pageUrl);
    stubbed.delete(pageUrl);
    applyBadge(anchor, "none");
    return;
  }

  const title = (anchor.textContent ?? "").trim().slice(0, 200) || pageUrl;
  await vouchFor(pageUrl, title);
  stubbed.add(pageUrl);
  applyBadge(anchor, "read");
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
    cleared: {},

    furthestReadHash: null,
    assumedReadAt:    null,
    assumedClearedAt: null,
  };
}

// Badges live inside a closed shadow root on a zero-size host that every candidate link
// gets, marked or not. Page scripts see an identical DOM shape and zero layout impact
// whatever your history says, so which links you have read is not legible to the page.
// Cross-page reading state must never be readable by page JavaScript.
const badgeDots = new WeakMap<HTMLAnchorElement, HTMLElement>();

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

  if (level === "none") {
    dot.style.display = "none";
    dot.removeAttribute("title");
    return;
  }

  const green = darkReaderActive() ? "127, 172, 144" : "92, 138, 111";
  const color = level === "read" ? `rgba(${green}, 0.95)` : `rgba(${green}, 0.5)`;
  dot.style.cssText = `position: absolute; display: block; left: 0.1em; top: -0.85em; width: 0.42em; height: 0.42em; border-radius: 50%; background: ${color};`;
  dot.title         = level === "read" ? "You have read this" : "You are still reading this";
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

