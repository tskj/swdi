import { describe, expect, it } from "vitest";
import { DonationDoc, EMPTY_DONATION_DOC, applyDonationPatch } from "@swdi/shared";

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

  it("settles, marks lines paid, and unsettles a month", () => {
    let doc: DonationDoc = applyDonationPatch(EMPTY_DONATION_DOC, { op: "settle", settlement });

    doc = applyDonationPatch(doc, { op: "set-paid", month: "2026-07", key: "a", paid: true });
    expect(doc.settlements["2026-07"]?.lines.find((l) => l.key === "a")?.paid).toBe(true);
    expect(doc.settlements["2026-07"]?.lines.find((l) => l.key === "b")?.paid).toBe(false);

    doc = applyDonationPatch(doc, { op: "unsettle", month: "2026-07" });
    expect(doc.settlements["2026-07"]).toBeUndefined();
  });

  it("composes edits from two sessions instead of losing one", () => {
    // Session A ticks a payment while session B changes the budget; applied in either
    // order against the shared doc, both survive.
    const base = applyDonationPatch(EMPTY_DONATION_DOC, { op: "settle", settlement });

    const afterA  = applyDonationPatch(base, { op: "set-paid", month: "2026-07", key: "a", paid: true });
    const afterAB = applyDonationPatch(afterA, { op: "set-budget", budget: { amountMinor: 30_000, currency: "kr" } });

    expect(afterAB.settlements["2026-07"]?.lines.find((l) => l.key === "a")?.paid).toBe(true);
    expect(afterAB.budget?.amountMinor).toBe(30_000);
  });

  it("ignores marking a line in a month that no longer exists", () => {
    expect(applyDonationPatch(EMPTY_DONATION_DOC, { op: "set-paid", month: "2026-01", key: "a", paid: true })).toEqual(EMPTY_DONATION_DOC);
  });
});
