import { describe, expect, it } from "vitest";
import { EMPTY_DONATION_DOC, Settlements, applyDonationPatch, applySettlementPatch } from "@swdi/shared";

const settlement = {
  month:     "2026-07",
  settledAt: "2026-07-05T12:00:00.000Z",
  lines: [
    { key: "a", name: "A", minor: 5_000, paid: false },
    { key: "b", name: "B", minor: 5_000, paid: false },
  ],
};

describe("applyDonationPatch", () => {
  it("sets and clears the budget without touching the rest", () => {
    const withBudget = applyDonationPatch(EMPTY_DONATION_DOC, { op: "set-budget", budget: { amountMinor: 10_000, currency: "kr" } });

    expect(withBudget.budget?.amountMinor).toBe(10_000);
    expect(applyDonationPatch(withBudget, { op: "set-budget", budget: null }).budget).toBeNull();
  });

  it("composes edits from two sessions instead of losing one", () => {
    // Session A answers the ask while session B changes the budget; applied in either
    // order against the shared doc, both survive.
    const afterA  = applyDonationPatch(EMPTY_DONATION_DOC, { op: "set-share", share: { include: true, pct: 1, answeredAt: "2026-07-05T12:00:00.000Z" } });
    const afterAB = applyDonationPatch(afterA, { op: "set-budget", budget: { amountMinor: 30_000, currency: "kr" } });

    expect(afterAB.share?.include).toBe(true);
    expect(afterAB.budget?.amountMinor).toBe(30_000);
  });
});

describe("applySettlementPatch", () => {
  it("settles, marks lines paid, and unsettles a month", () => {
    let settlements: Settlements = applySettlementPatch({}, { op: "settle", settlement });

    settlements = applySettlementPatch(settlements, { op: "set-paid", month: "2026-07", key: "a", paid: true });
    expect(settlements["2026-07"]?.lines.find((l) => l.key === "a")?.paid).toBe(true);
    expect(settlements["2026-07"]?.lines.find((l) => l.key === "b")?.paid).toBe(false);

    settlements = applySettlementPatch(settlements, { op: "unsettle", month: "2026-07" });
    expect(settlements["2026-07"]).toBeUndefined();
  });

  it("leaves other months alone", () => {
    const june = { ...settlement, month: "2026-06" };

    let settlements: Settlements = applySettlementPatch({}, { op: "settle", settlement: june });
    settlements = applySettlementPatch(settlements, { op: "settle", settlement });
    settlements = applySettlementPatch(settlements, { op: "unsettle", month: "2026-07" });

    expect(settlements["2026-06"]).toEqual(june);
  });

  it("ignores marking a line in a month that no longer exists", () => {
    expect(applySettlementPatch({}, { op: "set-paid", month: "2026-01", key: "a", paid: true })).toEqual({});
  });
});
