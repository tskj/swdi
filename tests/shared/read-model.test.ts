import { describe, expect, it } from "vitest";
import {
  PageRecord,
  newSinceLastRead,
  readLevel,
  readThresholdMs,
  summarize,
  targetReadLevel,
  READ_DWELL_MAX_MS,
  READ_DWELL_MIN_MS,
} from "@swdi/shared";

function record(partial: Partial<PageRecord>): PageRecord {
  return {
    v: 1,
    url:   "https://example.com/page",
    title: "Page",

    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastVisitAt: "2026-01-01T00:00:00.000Z",
    lastReadAt:  null,

    outline: [],
    read:    {},
    seen:    {},

    furthestReadHash: null,
    assumedReadAt: null,
    ...partial,
  };
}

describe("readThresholdMs", () => {
  it("clamps tiny paragraphs up and huge ones down", () => {
    expect(readThresholdMs(1)).toBe(READ_DWELL_MIN_MS);
    expect(readThresholdMs(10_000)).toBe(READ_DWELL_MAX_MS);
  });

  it("scales with reading time in between", () => {
    expect(readThresholdMs(130)).toBe(30_000);
  });
});

describe("readLevel", () => {
  it("is none with no reading and read at the 90% ratio", () => {
    expect(readLevel(10, 0)).toBe("none");
    expect(readLevel(10, 5)).toBe("partial");
    expect(readLevel(10, 9)).toBe("read");
    expect(readLevel(0, 0)).toBe("none");
  });
});

describe("summarize", () => {
  const outline = [
    { h: "a", w: 50, s: null },
    { h: "b", w: 50, s: "intro" },
    { h: "c", w: 50, s: "intro" },
    { h: "d", w: 50, s: "body" },
  ];

  it("counts reads per page and per section", () => {
    const summary = summarize(record({
      outline,
      read: { b: { at: "2026-01-02T00:00:00.000Z", dwellMs: 9000 } },
    }));

    expect(summary.total).toBe(4);
    expect(summary.read).toBe(1);
    expect(summary.sections).toEqual({
      intro: { total: 2, read: 1 },
      body:  { total: 1, read: 0 },
    });
  });

  it("feeds section-fragment link badges through targetReadLevel", () => {
    const summary = summarize(record({
      outline,
      read: {
        b: { at: "2026-01-02T00:00:00.000Z", dwellMs: 9000 },
        c: { at: "2026-01-02T00:00:00.000Z", dwellMs: 9000 },
      },
    }));

    expect(targetReadLevel(summary, "intro")).toBe("read");
    expect(targetReadLevel(summary, "body")).toBe("none");
    expect(targetReadLevel(summary, null)).toBe("partial");
    expect(targetReadLevel(summary, "no-such-section")).toBe("partial");
  });
});

describe("newSinceLastRead", () => {
  it("is empty for pages never read, whatever changed", () => {
    expect(newSinceLastRead(record({}), ["a", "b"]).size).toBe(0);
  });

  it("flags hashes never seen before the last reading, and skips read ones", () => {
    const r = record({
      lastReadAt: "2026-02-01T00:00:00.000Z",
      read: { a: { at: "2026-02-01T00:00:00.000Z", dwellMs: 5000 } },
      seen: {
        a: "2026-01-01T00:00:00.000Z",
        b: "2026-01-01T00:00:00.000Z",
        c: "2026-03-01T00:00:00.000Z",
      },
    });

    const changed = newSinceLastRead(r, ["a", "b", "c", "d"]);

    expect(changed.has("a")).toBe(false);
    expect(changed.has("b")).toBe(false);
    expect(changed.has("c")).toBe(true);
    expect(changed.has("d")).toBe(true);
  });
});
