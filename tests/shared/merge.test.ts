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
    read: {},
    seen: {},

    furthestReadHash: null,
    ...partial,
  };
}

describe("mergeRecords", () => {
  it("unions reads from a concurrent tab instead of losing them", () => {
    const mine   = record({ read: { a: { at: "2026-03-01T00:00:00.000Z", dwellMs: 4000 } } });
    const stored = record({ read: { b: { at: "2026-03-02T00:00:00.000Z", dwellMs: 6000 } }, lastReadAt: "2026-03-02T00:00:00.000Z" });

    mergeRecords(mine, stored);

    expect(Object.keys(mine.read).sort()).toEqual(["a", "b"]);
    expect(mine.lastReadAt).toBe("2026-03-02T00:00:00.000Z");
  });

  it("keeps the earliest read and sighting per hash", () => {
    const mine   = record({ read: { a: { at: "2026-03-05T00:00:00.000Z", dwellMs: 1 } }, seen: { a: "2026-03-05T00:00:00.000Z" } });
    const stored = record({ read: { a: { at: "2026-03-01T00:00:00.000Z", dwellMs: 2 } }, seen: { a: "2026-03-01T00:00:00.000Z" } });

    mergeRecords(mine, stored);

    expect(mine.read.a?.at).toBe("2026-03-01T00:00:00.000Z");
    expect(mine.seen.a).toBe("2026-03-01T00:00:00.000Z");
  });

  it("resolves the furthest position against the current outline order", () => {
    const mine   = record({ furthestReadHash: "a" });
    const stored = record({ furthestReadHash: "c" });

    mergeRecords(mine, stored);

    expect(mine.furthestReadHash).toBe("c");
  });

  it("ignores a stored furthest hash that no longer exists on the page", () => {
    const mine   = record({ furthestReadHash: "b" });
    const stored = record({ furthestReadHash: "gone" });

    mergeRecords(mine, stored);

    expect(mine.furthestReadHash).toBe("b");
  });
});
