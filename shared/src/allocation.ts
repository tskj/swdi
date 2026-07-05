// The monthly proposal: a budget split across authors in proportion to reading.
// Everything is integer minor units (cents, øre) and sums exactly to the budget;
// the dashboard consumes this, and later the extension may too.

export type AllocationWeight = { key: string; weight: number };
export type Allocation       = { key: string; minor: number };

/** Largest-remainder proportional split; the result sums exactly to budgetMinor. */
export function computeProposal(budgetMinor: number, weights: AllocationWeight[]): Allocation[] {
  const positive = weights.filter((w) => w.weight > 0);
  const total    = positive.reduce((sum, w) => sum + w.weight, 0);
  if (budgetMinor <= 0 || total <= 0) return [];

  const floored = positive.map((w) => {
    const exact = (budgetMinor * w.weight) / total;
    return { key: w.key, minor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });

  let leftover = budgetMinor - floored.reduce((sum, f) => sum + f.minor, 0);
  for (const f of [...floored].sort((a, b) => b.rem - a.rem)) {
    if (leftover <= 0) break;

    f.minor  += 1;
    leftover -= 1;
  }

  return floored.map(({ key, minor }) => ({ key, minor }));
}

export const SWDI_ALLOCATION_KEY = "swdi";

/**
 * SWDI's opted-in share comes off the top (the answer to the one-time ask); the rest
 * splits across the authors by weight. A null share means the user said no, and no
 * SWDI line appears.
 */
export function proposalWithShare(budgetMinor: number, sharePct: number | null, weights: AllocationWeight[]): Allocation[] {
  const shareMinor = sharePct === null ? 0 : Math.min(budgetMinor, Math.round((budgetMinor * sharePct) / 100));
  const rest       = computeProposal(budgetMinor - shareMinor, weights);

  return shareMinor > 0 ? [...rest, { key: SWDI_ALLOCATION_KEY, minor: shareMinor }] : rest;
}
