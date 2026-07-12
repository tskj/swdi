import { BrowserContext, Worker, chromium, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The whole story runs against a saved copy of a meaningness.com chapter, served via
// route interception, so the test is hermetic while the content script sees real URLs.

// The evaluate() callbacks below are serialized into the extension's service worker,
// where `chrome` exists; this declaration only satisfies the root typecheck.
declare const chrome: any;

const EXT_DIST = join(__dirname, "../extension/dist");
const FIXTURES = join(__dirname, "fixtures");

const PAGE_URL = "https://meaningness.com/preview-eternalism-and-nihilism";
const PAGE_KEY = `swdi:page:${PAGE_URL}`;

const LINKED_URL = "https://meaningness.com/fixation-and-denial";
const LINKED_KEY = `swdi:idx:${LINKED_URL}`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let worker:  Worker;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel:  "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_DIST}`,
      `--load-extension=${EXT_DIST}`,
    ],
  });

  await context.route("https://meaningness.com/**", (route) => {
    const path = new URL(route.request().url()).pathname;

    if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?)$/.test(path)) {
      void route.fulfill({ status: 404, body: "" });
      return;
    }

    const file = path === "/" ? "mn-home.html" : "mn-page.html";
    void route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(join(FIXTURES, file)) });
  });

  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
});

test.afterAll(async () => {
  await context.close();
});

async function storedRecord(): Promise<any> {
  return worker.evaluate(async (key) => {
    const got = await chrome.storage.local.get(key);
    return got[key] ?? null;
  }, PAGE_KEY);
}

test("first visit collects the outline, and scrolling a paragraph out of view commits it", async () => {
  // Read fast, so every paragraph's threshold is the 2s floor and the test stays quick.
  await worker.evaluate(() => chrome.storage.local.set({ "swdi:settings": { overlay: true, readingWpm: 100000 } }));

  const page = await context.newPage();
  await page.goto(PAGE_URL);

  // Boot persists the visit (outline + sightings) even before anything is read.
  await expect.poll(async () => (await storedRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);

  // Sitting still commits nothing: dwell only earns eligibility.
  await page.waitForTimeout(2500);
  expect(await page.locator(".swdi-read").count()).toBe(0);

  // Scrolling the opening paragraphs out of view commits the ones watched long enough.
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 3));
  await expect.poll(() => page.locator(".swdi-read").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Object.keys((await storedRecord()).read).length, { timeout: 15_000 }).toBeGreaterThan(0);

  await page.close();
});

test("silently ignores pages without enough readable text", async () => {
  await context.route("https://tiny-app.example/**", (route) => {
    void route.fulfill({
      status:      200,
      contentType: "text/html; charset=utf-8",
      body: `<html><body><main>
        <p>A settings page with one short paragraph of text, nothing article shaped.</p>
        <button>Save</button><input placeholder="name">
      </main></body></html>`,
    });
  });

  const page = await context.newPage();
  await page.goto("https://tiny-app.example/");
  await page.waitForTimeout(1_500);

  const state = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: "swdi:get-state" });
  });
  expect(state?.phase).toBe("unsuitable");

  const keys = await worker.evaluate(async () =>
    Object.keys(await chrome.storage.local.get(null)).filter((k) => k.includes("tiny-app.example")),
  );
  expect(keys).toEqual([]);

  await page.close();
});

test("read state seeds overlay markers, link badges, and popup-driven resume", async () => {
  // Simulate an earlier reading session: first 60% of paragraphs read, and a
  // page this chapter links to marked fully read.
  await worker.evaluate(async ({ pageKey, linkedKey }) => {
    const got    = await chrome.storage.local.get(pageKey);
    const record = got[pageKey];

    const cutoff = Math.floor(record.outline.length * 0.6);
    for (const entry of record.outline.slice(0, cutoff)) {
      record.read[entry.h] = { at: "2026-06-01T00:00:00.000Z", dwellMs: 5000 };
    }
    record.lastReadAt       = "2026-06-01T00:00:00.000Z";
    record.furthestReadHash = record.outline[cutoff - 1].h;

    const linkedSummary = {
      v: 1,
      title: "Fixation and denial",
      total: 20,
      read:  20,
      lastReadAt: "2026-05-01T00:00:00.000Z",
      sections:   {},
    };

    await chrome.storage.local.set({ [pageKey]: record, [linkedKey]: linkedSummary });
  }, { pageKey: PAGE_KEY, linkedKey: LINKED_KEY });

  const page = await context.newPage();
  await page.goto(PAGE_URL);

  await expect.poll(() => page.locator(".swdi-read").count(), { timeout: 15_000 }).toBeGreaterThan(5);

  // Link badges render inside closed shadow roots precisely so the page DOM cannot
  // reveal them; assert through the extension's own state channel instead.
  await expect.poll(async () => {
    const state = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: "swdi:get-state" });
    });
    return state?.badges?.read ?? 0;
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  const host = page.locator(`a[href*="fixation-and-denial"] .swdi-badge-host`).first();
  await expect(host).toBeAttached({ timeout: 15_000 });

  // Resume is popup-driven now: "Continue where you left off" scrolls to the furthest
  // paragraph. Drive it through the message the popup button sends.
  const before = await page.evaluate(() => window.scrollY);
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "swdi:scroll-furthest" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(before);

  await page.close();
});

test("backfill: click links to vouch for them, and mark the current page read", async () => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect.poll(async () => (await storedRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);

  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "swdi:set-backfill", value: true });
  });
  await expect(page.locator(".swdi-backfill")).toBeVisible();

  // Clicking a link in backfill mode vouches for the target instead of navigating.
  await page.locator(`a[href*="no-cosmic-plan"]`).first().click();
  expect(page.url()).toBe(PAGE_URL);

  const stub = await worker.evaluate(async () => {
    const key = "swdi:page:https://meaningness.com/no-cosmic-plan";
    return (await chrome.storage.local.get(key))[key];
  });
  expect(stub?.assumedReadAt).not.toBeNull();

  // A second click undoes the vouch: the record disappears and a deletion tombstone
  // takes its place, so the undo holds through sync.
  await page.locator(`a[href*="no-cosmic-plan"]`).first().click();
  const afterUndo = await worker.evaluate(async () => {
    const url  = "https://meaningness.com/no-cosmic-plan";
    const got  = await chrome.storage.local.get([`swdi:page:${url}`, "swdi:tombstones"]);
    return { record: got[`swdi:page:${url}`] ?? null, tombstone: got["swdi:tombstones"]?.[url] ?? null };
  });
  expect(afterUndo.record).toBeNull();
  expect(afterUndo.tombstone).not.toBeNull();

  await page.keyboard.press("Escape");
  await expect(page.locator(".swdi-backfill")).not.toBeAttached();

  // Vouch for the current page: every known paragraph becomes read.
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "swdi:mark-page-read" });
  });
  await expect.poll(async () => {
    const record = await storedRecord();
    return record !== null && Object.keys(record.read).length === record.outline.length;
  }, { timeout: 10_000 }).toBe(true);

  await page.close();
});

test("'I've read this far' marks everything above read and clears everything below", async () => {
  await worker.evaluate((key) => chrome.storage.local.remove(key), PAGE_KEY);

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect.poll(async () => (await storedRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);

  // Simulate a page already fully marked read (e.g. dwell overshoot), then reload so the
  // content script paints every paragraph.
  await worker.evaluate(async (key) => {
    const got    = await chrome.storage.local.get(key);
    const record = got[key];
    for (const entry of record.outline) record.read[entry.h] = { at: "2026-06-01T00:00:00.000Z", dwellMs: 5000 };
    record.lastReadAt = "2026-06-01T00:00:00.000Z";
    await chrome.storage.local.set({ [key]: record });
  }, PAGE_KEY);

  await page.reload();
  const total = (await storedRecord()).outline.length;
  await expect.poll(() => page.locator(".swdi-read").count(), { timeout: 15_000 }).toBe(total);

  // Right-click a paragraph partway down. The content script captures the click's
  // document Y off the real contextmenu event; the OS menu item itself cannot be
  // automated, so we send the message it would.
  const paras  = page.locator("article#article p");
  const target = paras.nth(Math.floor((await paras.count()) / 2));
  await target.click({ button: "right" });
  const clickY = await target.evaluate((el) => el.getBoundingClientRect().top + (el as HTMLElement).offsetHeight / 2 + window.scrollY);

  // Scroll away first, so cleared paragraphs below can't re-commit while out of the check.
  await page.evaluate(() => window.scrollTo(0, 0));
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "swdi:read-up-to-here" });
  });

  // Everything below the click is now unread, so the count fell below the full total,
  // but the paragraphs above the click stay read.
  await expect.poll(async () => Object.keys((await storedRecord()).read).length, { timeout: 10_000 }).toBeLessThan(total);
  expect(Object.keys((await storedRecord()).read).length).toBeGreaterThan(0);

  // No read marker survives below where the reader clicked.
  const deepestReadTop = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll(".swdi-read")].map((el) => el.getBoundingClientRect().top + window.scrollY)),
  );
  expect(deepestReadTop).toBeLessThanOrEqual(clickY + 3);

  await page.close();
});

test("sync v2: a deletion tombstone holds through push, merge, and a fresh pull", async () => {
  // Runs against the same local server the dashboard spec uses (playwright's webServer).
  const SYNC_URL = "https://meaningness.com/preview-stage-fright";
  const extId    = new URL(worker.url()).host;

  // Point sync at the e2e server with a fresh generated key.
  await worker.evaluate(async (base) => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const secret = btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    await chrome.storage.local.set({ "swdi:settings": { overlay: false, syncSecret: secret, syncBaseUrl: base, blockedHosts: [], blockedPages: [], readingWpm: 260 } });
  }, "http://localhost:3105");

  // The background worker cannot message itself, so drive syncNow the way the popup
  // does: from an extension page context.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const syncNow = () => popup.evaluate(() => chrome.runtime.sendMessage({ type: "swdi:sync-now" }));

  const localState = (url: string) => worker.evaluate(async (u) => {
    const got = await chrome.storage.local.get([`swdi:page:${u}`, "swdi:tombstones"]);
    return { record: got[`swdi:page:${u}`] ?? null, tombstone: got["swdi:tombstones"]?.[u] ?? null };
  }, url);

  // Seed one read page and push it to the server.
  await worker.evaluate(async (url) => {
    const at = "2026-06-01T00:00:00.000Z";
    const record = {
      v: 1, url, title: "Tombstone page",
      firstSeenAt: at, lastVisitAt: at, lastReadAt: at,
      outline: [{ h: "t1", w: 50, s: null }],
      read:    { t1: { at, dwellMs: 5000, words: 50 } },
      seen:    { t1: at },
      cleared: {},
      furthestReadHash: "t1",
      assumedReadAt: null, assumedClearedAt: null,
    };
    await chrome.storage.local.set({ [`swdi:page:${url}`]: record });
  }, SYNC_URL);
  expect((await syncNow())?.ok).toBe(true);

  // Delete it the way removePage does: record gone, tombstone stamped after the visit.
  await worker.evaluate(async (url) => {
    await chrome.storage.local.remove([`swdi:page:${url}`, `swdi:idx:${url}`]);
    await chrome.storage.local.set({ "swdi:tombstones": { [url]: "2026-06-02T00:00:00.000Z" } });
  }, SYNC_URL);

  // The next sync pulls the server's copy of the page; the tombstone must keep it dead.
  expect((await syncNow())?.ok).toBe(true);
  const afterMerge = await localState(SYNC_URL);
  expect(afterMerge.record).toBeNull();
  expect(afterMerge.tombstone).not.toBeNull();

  // A fresh device (no pages, no tombstones) pulls: the page must not come back, and
  // the tombstone must arrive so this device re-propagates the deletion too.
  await worker.evaluate(async (url) => {
    await chrome.storage.local.remove([`swdi:page:${url}`, "swdi:tombstones"]);
  }, SYNC_URL);
  expect((await syncNow())?.ok).toBe(true);
  const freshDevice = await localState(SYNC_URL);
  expect(freshDevice.record).toBeNull();
  expect(freshDevice.tombstone).not.toBeNull();

  // Turn sync back off so later tests stay local.
  await worker.evaluate(async () => {
    const got      = await chrome.storage.local.get("swdi:settings");
    const settings = got["swdi:settings"];
    settings.syncSecret = null;
    await chrome.storage.local.set({ "swdi:settings": settings });
  });
  await popup.close();
});

test("stopping at the end of the article commits the tail, short of document bottom", async () => {
  await worker.evaluate(() => chrome.storage.local.set({ "swdi:settings": { overlay: true, readingWpm: 100000 } }));
  await worker.evaluate((key) => chrome.storage.local.remove(key), PAGE_KEY);

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect.poll(async () => (await storedRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);

  // Stop with the end of the article in view. The sidebar and comment chrome below
  // keep this well short of the document's own bottom, which is the whole point.
  const atDocumentBottom = await page.evaluate(() => {
    const article = document.querySelector("article#article");
    if (article === null) return null;

    const bottom = article.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo(0, bottom - window.innerHeight + 2);
    return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < 50;
  });
  expect(atDocumentBottom).toBe(false);

  // The final paragraph never scrolls out, so only the terminal rule can commit it.
  await expect.poll(async () => {
    const record = await storedRecord();
    const last   = record?.outline?.[record.outline.length - 1]?.h;
    return last !== undefined && last in (record.read ?? {});
  }, { timeout: 15_000 }).toBe(true);

  await page.close();
});

test("an article in an inner scroll pane: parked paragraphs never commit, its end still does", async () => {
  const INNER_URL = "https://inner-scroll.example/";
  const INNER_KEY = `swdi:page:${INNER_URL}`;

  await context.route("https://inner-scroll.example/**", (route) => {
    const paras = Array.from({ length: 40 }, (_, i) =>
      `<p>Paragraph number ${i} of the inner scroll fixture, with enough words in it to clear the minimum character bar for tracking.</p>`).join("");
    void route.fulfill({
      status:      200,
      contentType: "text/html; charset=utf-8",
      body: `<html><body style="margin:0"><main style="height:100vh; overflow:auto"><article>${paras}</article></main></body></html>`,
    });
  });

  const innerRecord = () => worker.evaluate(async (key) => {
    const got = await chrome.storage.local.get(key);
    return got[key] ?? null;
  }, INNER_KEY);

  const page = await context.newPage();
  await page.goto(INNER_URL);
  await expect.poll(async () => (await innerRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(30);

  // The window itself has nowhere to scroll, so the old document-bottom rule would
  // hold permanently and commit these parked paragraphs after mere dwell.
  await page.waitForTimeout(3_500);
  expect(await page.locator(".swdi-read").count()).toBe(0);

  // Scrolling the PANE to the end of the article is what finishes it.
  await page.evaluate(() => {
    const pane = document.querySelector("main");
    if (pane !== null) pane.scrollTop = pane.scrollHeight;
  });
  await expect.poll(async () => {
    const record = await innerRecord();
    const last   = record?.outline?.[record.outline.length - 1]?.h;
    return last !== undefined && last in (record.read ?? {});
  }, { timeout: 15_000 }).toBe(true);

  await page.close();
});

test("paragraphs detached by a SPA-style swap never commit", async () => {
  await worker.evaluate((key) => chrome.storage.local.remove(key), PAGE_KEY);

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect.poll(async () => (await storedRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);

  // Accrue past the threshold with the opening screenful in view, then swap the
  // article out. Removal fires no intersection entry, so the detached paragraphs
  // keep their stale "in view" state forever; without the connectedness guards, the
  // collapsed document reads as "end reached" and they all commit under this URL.
  await page.waitForTimeout(2_500);
  await page.evaluate(() => document.querySelector("article#article")?.remove());
  await page.waitForTimeout(3_000);

  expect(Object.keys((await storedRecord())?.read ?? {}).length).toBe(0);

  await page.close();
});
