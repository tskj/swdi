import { describe, expect, it } from "vitest";
import { PageRecord, Registry, withClock } from "@swdi/shared";
import { authorEngagement, currentMonth, formatMonth, monthOf, pageStats } from "../../src/app/dashboard/derive";

// Months bucket in LOCAL time, so these tests only assert on mid-month instants,
// which land in the same month whatever timezone the test machine runs in.

function page(url: string, readAt: string): PageRecord {
  return {
    v: 1,
    url,
    title: url,

    firstSeenAt: readAt,
    lastVisitAt: readAt,
    lastReadAt:  readAt,

    outline: [{ h: "aaaa", w: 100, s: null }],
    read:    { aaaa: { at: readAt, dwellMs: 30_000, words: 100 } },
    seen:    { aaaa: readAt },
    cleared: {},

    furthestReadHash: "aaaa",
    assumedReadAt:    null,
    assumedClearedAt: null,
  };
}

const registry: Registry = {
  v: 1,
  updatedAt: "2026-07-01T00:00:00.000Z",
  entries: [{ name: "A", sites: ["https://a.example"], payment: [], status: "unverified", verifiedAt: null }],
};

describe("local months", () => {
  it("buckets a stored timestamp into its month", () => {
    expect(monthOf("2026-07-15T12:00:00.000Z")).toBe("2026-07");
    expect(monthOf("not a timestamp")).toBe("");
  });

  it("names a month key for display and passes garbage through", () => {
    expect(formatMonth("2026-07")).toBe("July 2026");
    expect(formatMonth("garbage")).toBe("garbage");
  });

  it("keys the current month to the clock", async () => {
    await withClock({ nowMs: () => Date.UTC(2026, 6, 15, 12) }, () => {
      expect(currentMonth()).toBe("2026-07");
    });
  });
});

describe("authorEngagement month window", () => {
  it("counts only reads bucketed into the asked month, everything when null", () => {
    const pages = [
      pageStats(page("https://a.example/june", "2026-06-15T12:00:00.000Z")),
      pageStats(page("https://a.example/july", "2026-07-15T12:00:00.000Z")),
    ];

    const july = authorEngagement(registry, pages, "2026-07");
    const all  = authorEngagement(registry, pages, null);

    expect(july).toHaveLength(1);
    expect(july[0]?.words).toBe(100);
    expect(all[0]?.words).toBe(200);
  });
});
