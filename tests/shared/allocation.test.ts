import { describe, expect, it } from "vitest";
import { computeProposal, proposalWithShare } from "@swdi/shared";

describe("computeProposal", () => {
  it("splits proportionally and sums exactly to the budget", () => {
    const split = computeProposal(10_000, [
      { key: "a", weight: 3 },
      { key: "b", weight: 1 },
    ]);

    expect(split.reduce((sum, s) => sum + s.minor, 0)).toBe(10_000);
    expect(split.find((s) => s.key === "a")?.minor).toBe(7_500);
    expect(split.find((s) => s.key === "b")?.minor).toBe(2_500);
  });

  it("distributes rounding remainders without losing a single minor unit", () => {
    const split = computeProposal(100, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 },
    ]);

    expect(split.reduce((sum, s) => sum + s.minor, 0)).toBe(100);
    expect(split.map((s) => s.minor).sort()).toEqual([33, 33, 34]);
  });

  it("ignores zero weights and answers empty for an empty month", () => {
    expect(computeProposal(1_000, [{ key: "a", weight: 0 }])).toEqual([]);
    expect(computeProposal(1_000, [])).toEqual([]);
    expect(computeProposal(0, [{ key: "a", weight: 1 }])).toEqual([]);
  });
});

describe("proposalWithShare", () => {
  it("takes the opted-in share off the top", () => {
    const split = proposalWithShare(10_000, 1, [{ key: "a", weight: 1 }]);

    expect(split.find((s) => s.key === "swdi")?.minor).toBe(100);
    expect(split.find((s) => s.key === "a")?.minor).toBe(9_900);
    expect(split.reduce((sum, s) => sum + s.minor, 0)).toBe(10_000);
  });

  it("adds no line when the answer was no", () => {
    const split = proposalWithShare(10_000, null, [{ key: "a", weight: 1 }]);

    expect(split.some((s) => s.key === "swdi")).toBe(false);
    expect(split.reduce((sum, s) => sum + s.minor, 0)).toBe(10_000);
  });
});
