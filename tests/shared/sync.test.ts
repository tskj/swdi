import { describe, expect, it } from "vitest";
import {
  PageRecord,
  SyncPayload,
  decryptPayload,
  deriveSyncKeys,
  encryptPayload,
  generateSyncSecret,
  mergePages,
} from "@swdi/shared";

function page(url: string, partial: Partial<PageRecord> = {}): PageRecord {
  return {
    v: 1,
    url,
    title: url,

    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastVisitAt: "2026-01-01T00:00:00.000Z",
    lastReadAt:  null,

    outline: [{ h: "a", w: 50, s: null }],
    read:    {},
    seen:    {},

    furthestReadHash: null,
    ...partial,
  };
}

function payload(pages: PageRecord[]): SyncPayload {
  return { v: 1, exportedAt: "2026-07-04T00:00:00.000Z", pages };
}

describe("deriveSyncKeys", () => {
  it("derives deterministically from the secret, and secrets do not collide", async () => {
    const secret = generateSyncSecret();

    const a = await deriveSyncKeys(secret);
    const b = await deriveSyncKeys(secret);
    const c = await deriveSyncKeys(generateSyncSecret());

    expect(a?.syncId).toMatch(/^[0-9a-f]{32}$/);
    expect(a?.syncId).toBe(b?.syncId);
    expect(a?.authToken).toBe(b?.authToken);
    expect(a?.syncId).not.toBe(c?.syncId);
  });

  it("never derives the secret itself as a server-visible value", async () => {
    const secret = generateSyncSecret();
    const keys   = await deriveSyncKeys(secret);

    expect(keys?.syncId).not.toBe(secret);
    expect(keys?.authToken).not.toBe(secret);
  });

  it("rejects garbage and low-entropy input", async () => {
    expect(await deriveSyncKeys("not base64url at all!!")).toBeNull();
    expect(await deriveSyncKeys("c2hvcnQ")).toBeNull();
    expect(await deriveSyncKeys("")).toBeNull();
  });
});

describe("encrypt/decrypt roundtrip", () => {
  it("roundtrips a payload", async () => {
    const keys = await deriveSyncKeys(generateSyncSecret());
    if (keys === null) throw new Error("keys");

    const original         = payload([page("https://example.com/a")]);
    const { iv, data }     = await encryptPayload(keys.encKey, original);
    const decrypted        = await decryptPayload(keys.encKey, iv, data);

    expect(decrypted).toEqual(original);
  });

  it("returns null for the wrong key and for tampered ciphertext", async () => {
    const keysA = await deriveSyncKeys(generateSyncSecret());
    const keysB = await deriveSyncKeys(generateSyncSecret());
    if (keysA === null || keysB === null) throw new Error("keys");

    const { iv, data } = await encryptPayload(keysA.encKey, payload([]));

    expect(await decryptPayload(keysB.encKey, iv, data)).toBeNull();
    expect(await decryptPayload(keysA.encKey, iv, `${data.slice(0, -2)}AA`)).toBeNull();
  });
});

describe("mergePages", () => {
  it("unions disjoint pages", () => {
    const merged = mergePages([page("https://a.com/x")], [page("https://b.com/y")]);

    expect(merged.map((p) => p.url).sort()).toEqual(["https://a.com/x", "https://b.com/y"]);
  });

  it("merges duplicates with the newer visit's outline winning and reads unioned", () => {
    const older = page("https://a.com/x", {
      lastVisitAt: "2026-01-01T00:00:00.000Z",
      outline: [{ h: "old", w: 10, s: null }],
      read:    { old: { at: "2026-01-01T00:00:00.000Z", dwellMs: 100 } },
    });
    const newer = page("https://a.com/x", {
      lastVisitAt: "2026-02-01T00:00:00.000Z",
      outline: [{ h: "new", w: 10, s: null }],
      read:    { new: { at: "2026-02-01T00:00:00.000Z", dwellMs: 200 } },
    });

    const merged = mergePages([older], [newer]);
    const record = merged[0];

    expect(merged.length).toBe(1);
    expect(record?.outline.map((e) => e.h)).toEqual(["new"]);
    expect(Object.keys(record?.read ?? {}).sort()).toEqual(["new", "old"]);
  });
});
