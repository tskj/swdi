import { describe, expect, it } from "vitest";
import { PageRecord, mergeRecords } from "@swdi/shared";

function record(partial: Partial<PageRecord>): PageRecord {
  return {
    v: 1,
    url:   "https://example.com/page",
    title: "Page",

    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastVisitAt: "2026-01-01T00:00:00.000Z",
    lastReadAt:  null,

    outline: [
      { h: "a", w: 50, s: null },
      { h: "b", w: 50, s: null },
      { h: "c", w: 50, s: null },
    ],
    read:    {},
    seen:    {},
    cleared: {},

    furthestReadHash: null,
    assumedReadAt:    null,
    assumedClearedAt: null,
    ...partial,
  };
}

const readAt = (at: string) => ({ at, dwellMs: 5000, words: 50 });

describe("mergeRecords", () => {
  it("unions reads from a concurrent tab instead of losing them", () => {
    const mine   = record({ read: { a: { at: "2026-03-01T00:00:00.000Z", dwellMs: 4000, words: 50 } } });
    const stored = record({ read: { b: { at: "2026-03-02T00:00:00.000Z", dwellMs: 6000, words: 50 } }, lastReadAt: "2026-03-02T00:00:00.000Z" });

    mergeRecords(mine, stored);

    expect(Object.keys(mine.read).sort()).toEqual(["a", "b"]);
    expect(mine.lastReadAt).toBe("2026-03-02T00:00:00.000Z");
  });

  it("keeps the earliest read and sighting per hash", () => {
    const mine   = record({ read: { a: { at: "2026-03-05T00:00:00.000Z", dwellMs: 1, words: 50 } }, seen: { a: "2026-03-05T00:00:00.000Z" } });
    const stored = record({ read: { a: { at: "2026-03-01T00:00:00.000Z", dwellMs: 2, words: 50 } }, seen: { a: "2026-03-01T00:00:00.000Z" } });

    mergeRecords(mine, stored);

    expect(mine.read.a?.at).toBe("2026-03-01T00:00:00.000Z");
    expect(mine.seen.a).toBe("2026-03-01T00:00:00.000Z");
  });

  it("resolves the furthest position against the current outline order", () => {
    const mine   = record({ read: { a: readAt("2026-03-01T00:00:00.000Z") }, furthestReadHash: "a" });
    const stored = record({ read: { c: readAt("2026-03-02T00:00:00.000Z") }, furthestReadHash: "c" });

    mergeRecords(mine, stored);

    expect(mine.furthestReadHash).toBe("c");
  });

  it("ignores a stored furthest hash that no longer exists on the page", () => {
    const mine   = record({ read: { b: readAt("2026-03-01T00:00:00.000Z") }, furthestReadHash: "b" });
    const stored = record({ read: { gone: readAt("2026-03-02T00:00:00.000Z") }, furthestReadHash: "gone" });

    mergeRecords(mine, stored);

    expect(mine.furthestReadHash).toBe("b");
  });

  it("keeps a cleared paragraph cleared against a stale copy of its old read", () => {
    const mine   = record({ cleared: { a: "2026-03-10T00:00:00.000Z" } });
    const stored = record({ read: { a: readAt("2026-03-01T00:00:00.000Z") } });

    mergeRecords(mine, stored);

    expect(mine.read.a).toBeUndefined();
    expect(mine.cleared.a).toBe("2026-03-10T00:00:00.000Z");
  });

  it("lets a re-read after the clear beat both the clear and the stale old read", () => {
    const mine   = record({ cleared: { a: "2026-03-10T00:00:00.000Z" }, read: { a: readAt("2026-03-15T00:00:00.000Z") } });
    const stored = record({ read: { a: readAt("2026-03-01T00:00:00.000Z") } });

    mergeRecords(mine, stored);

    expect(mine.read.a?.at).toBe("2026-03-15T00:00:00.000Z");
  });

  it("takes the latest clear when both sides cleared", () => {
    const mine   = record({ cleared: { a: "2026-03-10T00:00:00.000Z" }, read: { a: readAt("2026-03-15T00:00:00.000Z") } });
    const stored = record({ cleared: { a: "2026-03-20T00:00:00.000Z" } });

    mergeRecords(mine, stored);

    expect(mine.cleared.a).toBe("2026-03-20T00:00:00.000Z");
    expect(mine.read.a).toBeUndefined(); // the re-read predates the newer clear
  });

  it("pulls the furthest position back to the deepest surviving read", () => {
    // "I've read this far" at paragraph a on one device; a stale device still holds
    // reads through c. The clears win, and furthest must not point past them.
    const mine = record({
      read:    { a: readAt("2026-03-01T00:00:00.000Z") },
      cleared: { b: "2026-03-10T00:00:00.000Z", c: "2026-03-10T00:00:00.000Z" },
      furthestReadHash: "a",
    });
    const stored = record({
      read: { a: readAt("2026-03-01T00:00:00.000Z"), b: readAt("2026-03-01T00:00:00.000Z"), c: readAt("2026-03-01T00:00:00.000Z") },
      furthestReadHash: "c",
    });

    mergeRecords(mine, stored);

    expect(Object.keys(mine.read)).toEqual(["a"]);
    expect(mine.furthestReadHash).toBe("a");
  });

  it("keeps a revoked whole-page vouch revoked, while a newer vouch survives", () => {
    const revoked = record({ assumedClearedAt: "2026-03-10T00:00:00.000Z" });
    const stale   = record({ assumedReadAt: "2026-03-01T00:00:00.000Z" });

    mergeRecords(revoked, stale);
    expect(revoked.assumedReadAt).toBeNull();

    const revouched = record({ assumedReadAt: "2026-03-15T00:00:00.000Z", assumedClearedAt: "2026-03-10T00:00:00.000Z" });
    mergeRecords(revouched, record({ assumedReadAt: "2026-03-01T00:00:00.000Z" }));
    expect(revouched.assumedReadAt).toBe("2026-03-15T00:00:00.000Z");
  });
});
