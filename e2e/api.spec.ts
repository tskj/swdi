import { APIRequestContext, expect, test } from "@playwright/test";
import postgres from "postgres";
import { SYNC_DATA_MAX_CHARS, SyncKeys, deriveSyncKeys, encryptPayload, generateSyncSecret } from "@swdi/shared";

// The security-relevant API paths, exercised against the real app and database: these
// are exactly where a silent regression would break the trust model. No browser; the
// requests speak for themselves. Each test carries its own X-Forwarded-For so rate
// buckets stay isolated per test (locally there is no proxy appending the real IP).

const BASE = "http://localhost:3105";

async function makeKeys(): Promise<SyncKeys> {
  const keys = await deriveSyncKeys(generateSyncSecret());
  if (keys === null) throw new Error("derive failed");

  return keys;
}

function headers(keys: SyncKeys, ip: string) {
  return { authorization: `Bearer ${keys.authToken}`, "x-forwarded-for": ip };
}

async function putBlob(request: APIRequestContext, keys: SyncKeys, ip: string, expectedVersion = 0) {
  const sealed = await encryptPayload(keys.encKey, { v: 3, exportedAt: "2026-07-04T00:00:00.000Z", pages: [], deleted: {}, settlements: {} });
  return request.put(`${BASE}/api/sync/${keys.syncId}`, { headers: headers(keys, ip), data: { expectedVersion, ...sealed } });
}

test("wrong token and unknown id answer the same 404", async ({ request }) => {
  const owner    = await makeKeys();
  const attacker = await makeKeys();
  const nobody   = await makeKeys();

  expect((await putBlob(request, owner, "203.0.113.10")).status()).toBe(200);

  const wrongToken = await request.get(`${BASE}/api/sync/${owner.syncId}`,  { headers: headers(attacker, "203.0.113.10") });
  const unknownId  = await request.get(`${BASE}/api/sync/${nobody.syncId}`, { headers: headers(nobody,   "203.0.113.10") });

  expect(wrongToken.status()).toBe(404);
  expect(unknownId.status()).toBe(404);
  expect(await wrongToken.json()).toEqual(await unknownId.json());
});

test("a stale expectedVersion answers 409 and names the current version", async ({ request }) => {
  const keys = await makeKeys();
  const ip   = "203.0.113.11";

  expect((await putBlob(request, keys, ip, 0)).status()).toBe(200);
  expect((await putBlob(request, keys, ip, 1)).status()).toBe(200);

  const stale = await putBlob(request, keys, ip, 1);
  expect(stale.status()).toBe(409);
  expect((await stale.json()).version).toBe(2);
});

test("an oversized blob answers 400", async ({ request }) => {
  const keys = await makeKeys();

  const response = await request.put(`${BASE}/api/sync/${keys.syncId}`, {
    headers: headers(keys, "203.0.113.12"),
    data:    { expectedVersion: 0, iv: "AAAAAAAAAAAAAAAA", data: "A".repeat(SYNC_DATA_MAX_CHARS + 1) },
  });
  expect(response.status()).toBe(400);
});

test("concurrent first registrations resolve to one row and one 409", async ({ request }) => {
  const keys = await makeKeys();
  const ip   = "203.0.113.13";

  const [a, b] = await Promise.all([putBlob(request, keys, ip, 0), putBlob(request, keys, ip, 0)]);
  expect([a.status(), b.status()].sort()).toEqual([200, 409]);
});

test("a donation doc cannot be created without the sync row's token", async ({ request }) => {
  const owner    = await makeKeys();
  const attacker = await makeKeys();
  const ip       = "203.0.113.14";

  expect((await putBlob(request, owner, ip)).status()).toBe(200);

  const budgetPatch = { op: "set-budget", budget: { amountMinor: 10_000, currency: "kr" } };
  const fullDoc     = { v: 1, budget: { amountMinor: 10_000, currency: "kr" }, share: null };

  // An attacker who learned the sync id cannot squat the doc, by PATCH or by PUT.
  const squatPatch = await request.patch(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(attacker, ip), data: budgetPatch });
  const squatPut   = await request.put(`${BASE}/api/donations/${owner.syncId}`,   { headers: headers(attacker, ip), data: fullDoc });
  expect(squatPatch.status()).toBe(404);
  expect(squatPut.status()).toBe(404);

  // Without a sync row there is nothing to anchor creation to: denied even with a
  // self-consistent token.
  const anchorless = await makeKeys();
  const noRow = await request.patch(`${BASE}/api/donations/${anchorless.syncId}`, { headers: headers(anchorless, ip), data: budgetPatch });
  expect(noRow.status()).toBe(404);

  // The real owner creates and reads it back; the attacker still reads nothing.
  const create = await request.patch(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(owner, ip), data: budgetPatch });
  expect(create.status()).toBe(200);
  expect((await create.json()).budget.amountMinor).toBe(10_000);

  const attackerRead = await request.get(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(attacker, ip) });
  expect(attackerRead.status()).toBe(404);
});

test("a corrupted donation doc reads as absent, and the next PUT replaces it", async ({ request }) => {
  const owner = await makeKeys();
  const ip    = "203.0.113.15";

  expect((await putBlob(request, owner, ip)).status()).toBe(200);

  const doc = { v: 1, budget: { amountMinor: 20_000, currency: "kr" }, share: null };
  expect((await request.put(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(owner, ip), data: doc })).status()).toBe(200);

  // Corrupt the stored jsonb underneath the app, the way a bad migration or a hand
  // edit would.
  const sql = postgres({ host: "/var/run/postgresql", database: "swdi_e2e" });
  await sql`update donation_configs set doc = '"garbage"'::jsonb where sync_id = ${owner.syncId}`;
  await sql.end();

  const corrupted = await request.get(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(owner, ip) });
  expect(corrupted.status()).toBe(404);

  expect((await request.put(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(owner, ip), data: doc })).status()).toBe(200);
  const healed = await request.get(`${BASE}/api/donations/${owner.syncId}`, { headers: headers(owner, ip) });
  expect((await healed.json()).budget.amountMinor).toBe(20_000);
});

test("registration is priced separately from syncing", async ({ request }) => {
  // pid-salted address, so a rerun against a still-warm server gets a fresh allowance.
  const ip = `198.51.100.${(process.pid % 250) + 1}`;

  const created: SyncKeys[] = [];
  let status = 0;
  for (let attempt = 0; attempt < 40 && status !== 429; attempt++) {
    const keys     = await makeKeys();
    const response = await putBlob(request, keys, ip);
    status = response.status();
    if (status === 200) created.push(keys);
  }
  expect(status).toBe(429);
  expect(created.length).toBeLessThanOrEqual(30);

  // Updating an existing blob proves token ownership and is not registration-priced,
  // so it still passes for the same address.
  const first = created[0];
  if (first === undefined) throw new Error("no registration succeeded");
  expect((await putBlob(request, first, ip, 1)).status()).toBe(200);

  // Leave the shared throwaway database as this test found it.
  const sql = postgres({ host: "/var/run/postgresql", database: "swdi_e2e" });
  await sql`delete from sync_blobs where sync_id = any(${created.map((k) => k.syncId)})`;
  await sql.end();
});

// Last on purpose: this test spends a whole rate window for its own address.
test("the sync limiter answers 429 within one window", async ({ request }) => {
  const keys = await makeKeys();
  const ip   = "203.0.113.99";

  let limited = false;
  for (let i = 0; i < 121 && !limited; i++) {
    const response = await request.get(`${BASE}/api/sync/${keys.syncId}`, { headers: headers(keys, ip) });
    limited = response.status() === 429;
  }

  expect(limited).toBe(true);
});
