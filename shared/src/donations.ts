import { z } from "zod";

// Donation configuration lives server-side in plaintext, deliberately OUTSIDE the
// E2EE payload: how much someone budgets for giving is configuration of this service,
// keyed to the same pseudonymous sync id and guarded by the same write token. What
// that budget was PAID TO is different in kind: a settlement line names an author you
// read, which is a direct projection of reading history, so settlements travel inside
// the encrypted sync payload (shared/src/sync.ts) where the server cannot read them.

export const budgetSchema = z.object({
  amountMinor: z.number().int().positive(),
  currency:    z.string().min(1).max(8),
});

export const shareAnswerSchema = z.object({
  include:    z.boolean(),
  pct:        z.number().min(0).max(50),
  answeredAt: z.string(),
});

export const settlementLineSchema = z.object({
  key:   z.string(),
  name:  z.string(),
  minor: z.number().int().nonnegative(),
  paid:  z.boolean(),
});

export const settlementSchema = z.object({
  month:     z.string().regex(/^\d{4}-\d{2}$/),
  settledAt: z.string(),

  // Snapshotted from the budget at settle time, so changing the budget's currency
  // later cannot re-denominate history. Optional because settlements predate it;
  // display falls back to the live budget's currency for those.
  currency:  z.string().min(1).max(8).optional(),

  lines:     z.array(settlementLineSchema),
});

export const donationDocSchema = z.object({
  v: z.literal(1),
  budget: budgetSchema.nullable(),
  share:  shareAnswerSchema.nullable(),

  // Legacy: settlements lived here in plaintext before they moved into the encrypted
  // sync payload. Old rows still carry them, so reads tolerate and surface the field
  // for the dashboard to adopt into the blob; once that adoption succeeds the doc is
  // rewritten without it. Nothing writes new settlements here.
  settlements: z.record(z.string(), settlementSchema).optional(),
});

export type Budget          = z.infer<typeof budgetSchema>;
export type ShareAnswer     = z.infer<typeof shareAnswerSchema>;
export type Settlement      = z.infer<typeof settlementSchema>;
export type SettlementLine  = z.infer<typeof settlementLineSchema>;
export type Settlements     = Record<string, Settlement>;
export type DonationDoc     = z.infer<typeof donationDocSchema>;

export const EMPTY_DONATION_DOC: DonationDoc = { v: 1, budget: null, share: null };

// Edits travel as small ops, not whole documents: the server applies each op against
// the doc it currently holds (inside a serializable transaction), so two open
// dashboard sessions can both edit without one overwriting the other. The same apply
// function runs client-side for optimistic updates.
export const donationPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-budget"), budget: budgetSchema.nullable() }),
  z.object({ op: z.literal("set-share"),  share: shareAnswerSchema }),
]);

export type DonationPatch = z.infer<typeof donationPatchSchema>;

export function applyDonationPatch(doc: DonationDoc, patch: DonationPatch): DonationDoc {
  switch (patch.op) {
    case "set-budget": return { ...doc, budget: patch.budget };
    case "set-share":  return { ...doc, share: patch.share };
  }
}

// Settlement edits are ops too, but they never reach the server as plaintext: the
// dashboard replays them against a freshly pulled payload before re-encrypting, so a
// version conflict resolves by pull-and-reapply instead of losing the edit. No zod
// schema because they cross no trust boundary; they live and die in one session.
export type SettlementPatch =
  | { op: "settle";   settlement: Settlement }
  | { op: "unsettle"; month: string }
  | { op: "set-paid"; month: string; key: string; paid: boolean };

export function applySettlementPatch(settlements: Settlements, patch: SettlementPatch): Settlements {
  switch (patch.op) {
    case "settle":
      return { ...settlements, [patch.settlement.month]: patch.settlement };

    case "unsettle": {
      const next = { ...settlements };
      delete next[patch.month];
      return next;
    }

    case "set-paid": {
      const settlement = settlements[patch.month];
      if (settlement === undefined) return settlements; // settled elsewhere and unsettled since: nothing to mark

      const lines = settlement.lines.map((line) => (line.key === patch.key ? { ...line, paid: patch.paid } : line));
      return { ...settlements, [patch.month]: { ...settlement, lines } };
    }
  }
}
