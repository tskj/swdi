import { expect, test } from "@playwright/test";
import { PageRecord, deriveSyncKeys, encryptPayload, generateSyncSecret, nowIso } from "@swdi/shared";

// The donation loop end to end against the real app and a real (throwaway) database:
// seed an encrypted reading blob through the sync API, then drive connect, the
// one-time ask, budget, proposal, one-click pay, and server-side persistence.

const BASE = "http://localhost:3105";

function record(url: string, title: string, total: number, read: number, at: string): PageRecord {
  const outline = Array.from({ length: total }, (_, i) => ({ h: `${i.toString(16).padStart(4, "0")}${url.length.toString(16)}`.padEnd(8, "e"), w: 60, s: null }));
  const readMap: PageRecord["read"] = {};
  for (const entry of outline.slice(0, read)) readMap[entry.h] = { at, dwellMs: 30_000, words: entry.w };

  return {
    v: 1, url, title,
    firstSeenAt: at, lastVisitAt: at, lastReadAt: at,
    outline, read: readMap,
    seen: Object.fromEntries(outline.map((e) => [e.h, at])),
    furthestReadHash: outline[read - 1]?.h ?? null,
    assumedReadAt: null,
  };
}

test("the donation loop: connect, ask, budget, propose, pay, persist", async ({ page: ui }) => {
  // Keep the test hermetic: only the local app is reachable; Pay targets get a stub.
  await ui.context().route("**/*", (route) => {
    if (route.request().url().startsWith(BASE)) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html>stub</html>" });
  });

  const secret = generateSyncSecret();
  const keys   = await deriveSyncKeys(secret);
  if (keys === null) throw new Error("derive failed");

  const at    = `${nowIso().slice(0, 7)}-03T10:00:00.000Z`; // inside the current month
  const pages = [
    record("https://meaningness.com/nebulosity", "Nebulosity", 30, 24, at),
    record("https://overreacted.io/goodbye-clean-code", "Goodbye, Clean Code", 12, 8, at),
  ];

  const sealed = await encryptPayload(keys.encKey, { v: 1, exportedAt: at, pages });
  const put    = await fetch(`${BASE}/api/sync/${keys.syncId}`, {
    method:  "PUT",
    headers: { authorization: `Bearer ${keys.authToken}`, "content-type": "application/json" },
    body:    JSON.stringify({ expectedVersion: 0, ...sealed }),
  });
  expect(put.status).toBe(200);

  async function connect() {
    await ui.goto(`${BASE}/dashboard`);
    await ui.getByPlaceholder("Paste your sync key").fill(secret);
    await ui.getByRole("button", { name: "Open", exact: true }).click();
    await expect(ui.getByText("pages visited")).toBeVisible({ timeout: 15_000 });
  }

  await connect();

  // The one-time ask, answered yes at the suggested share.
  await ui.getByRole("button", { name: "Include SWDI at 1%" }).click();

  // Budget and proposal.
  await ui.getByPlaceholder("200").fill("100");
  await ui.getByRole("button", { name: "Set budget" }).click();
  await expect(ui.getByText("Proposed from your reading this month")).toBeVisible();
  await expect(ui.getByText("your 1% share")).toBeVisible();

  // Start paying: David Chapman leads the split, and his channel is Patreon.
  await ui.getByRole("button", { name: "Start paying" }).click();
  const pay = ui.getByRole("link", { name: /^Pay \d+ kr on Patreon$/ });
  await expect(pay).toBeVisible();

  const [popup] = await Promise.all([ui.waitForEvent("popup"), pay.click()]);
  await popup.close();
  await expect(ui.getByText("1 of 3 done")).toBeVisible();

  // Everything lives server-side now: a fresh connect finds the settled month again.
  await ui.reload();
  await connect();
  await expect(ui.getByText("1 of 3 done")).toBeVisible();
  await expect(ui.getByText("undo")).toBeVisible();
});
