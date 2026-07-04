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

test("first visit collects the outline and dwell turns paragraphs read", async () => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);

  // Boot persists the visit (outline + sightings) even before anything is read.
  await expect.poll(async () => (await storedRecord())?.outline?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);

  // Sitting at the top of the page long enough marks the short opening paragraphs read.
  await expect.poll(() => page.locator(".swdi-read").count(), { timeout: 45_000 }).toBeGreaterThan(0);

  await expect.poll(async () => Object.keys((await storedRecord()).read).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.close();
});

test("read state seeds overlay markers, link badges and the resume pill", async () => {
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

  const pill = page.locator(".swdi-resume");
  await expect(pill).toBeVisible({ timeout: 15_000 });

  const before = await page.evaluate(() => window.scrollY);
  await pill.click();
  await expect(pill).not.toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(before);

  await page.close();
});
