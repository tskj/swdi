import { describe, expect, it } from "vitest";
import {
  PageRecord,
  SyncPayload,
  decryptPayload,
  deriveSyncKeys,
  encryptPayload,
  generateSyncSecret,
  mergePages,
  secretStrength,
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
    assumedReadAt: null,
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

  it("accepts a password-manager-generated key and derives deterministically from it", async () => {
    const brought = "xK9$mQ2!pW7@vN4#rT6%";

    const a = await deriveSyncKeys(brought);
    const b = await deriveSyncKeys(brought);

    expect(a?.syncId).toMatch(/^[0-9a-f]{32}$/);
    expect(a?.syncId).toBe(b?.syncId);
    expect(a?.authToken).toBe(b?.authToken);
  });

  it("rejects memorable phrases however long they are", async () => {
    expect(await deriveSyncKeys("correct horse battery staple")).toBeNull();
    expect(await deriveSyncKeys("password123!")).toBeNull();
    expect(await deriveSyncKeys("MinKattHeterFia1")).toBeNull();
  });
});

describe("secretStrength", () => {
  it("classifies the three kinds", () => {
    expect(secretStrength(generateSyncSecret()).kind).toBe("generated");
    expect(secretStrength("xK9$mQ2!pW7@vN4#rT6%").kind).toBe("strong-text");
    expect(secretStrength("short1!").kind).toBe("weak");
  });

  it("names the reason a key is refused", () => {
    expect(secretStrength("aB3$xyz")).toEqual({ kind: "weak", reason: "too-short" });
    expect(secretStrength("just lowercase words here")).toEqual({ kind: "weak", reason: "has-spaces" });
    expect(secretStrength("MinKattHeterFia1")).toEqual({ kind: "weak", reason: "too-uniform" });
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

  it("compresses payloads and still opens blobs written before compression", async () => {
    const keys = await deriveSyncKeys(generateSyncSecret());
    if (keys === null) throw new Error("keys");

    const big = payload(Array.from({ length: 50 }, (_, i) => page(`https://example.com/${i}`)));

    const sealed = await encryptPayload(keys.encKey, big);
    expect(sealed.data.length).toBeLessThan(JSON.stringify(big).length / 3);
    expect(await decryptPayload(keys.encKey, sealed.iv, sealed.data)).toEqual(big);

    // A pre-compression blob: plain JSON encrypted with the same key.
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const legacy    = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.encKey, new TextEncoder().encode(JSON.stringify(big)));
    const b64       = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
    const reopened  = await decryptPayload(keys.encKey, b64(iv), b64(new Uint8Array(legacy)));

    expect(reopened).toEqual(big);
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
      read:    { old: { at: "2026-01-01T00:00:00.000Z", dwellMs: 100, words: 10 } },
    });
    const newer = page("https://a.com/x", {
      lastVisitAt: "2026-02-01T00:00:00.000Z",
      outline: [{ h: "new", w: 10, s: null }],
      read:    { new: { at: "2026-02-01T00:00:00.000Z", dwellMs: 200, words: 10 } },
    });

    const merged = mergePages([older], [newer]);
    const record = merged[0];

    expect(merged.length).toBe(1);
    expect(record?.outline.map((e) => e.h)).toEqual(["new"]);
    expect(Object.keys(record?.read ?? {}).sort()).toEqual(["new", "old"]);
  });
});
