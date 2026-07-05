import { z } from "zod";

// Donation configuration lives server-side in plaintext, deliberately OUTSIDE the
// E2EE payload. Reading history is the intimate data and stays encrypted; how much
// someone budgets for giving is configuration of this service, keyed to the same
// pseudonymous sync id and guarded by the same write token. Keeping it out of the
// blob also keeps the reading payload portable and single-purposed.

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
  lines:     z.array(settlementLineSchema),
});

export const donationDocSchema = z.object({
  v: z.literal(1),
  budget: budgetSchema.nullable(),
  share:  shareAnswerSchema.nullable(),
  settlements: z.record(z.string(), settlementSchema),
});

export type Budget          = z.infer<typeof budgetSchema>;
export type ShareAnswer     = z.infer<typeof shareAnswerSchema>;
export type Settlement      = z.infer<typeof settlementSchema>;
export type SettlementLine  = z.infer<typeof settlementLineSchema>;
export type DonationDoc     = z.infer<typeof donationDocSchema>;

export const EMPTY_DONATION_DOC: DonationDoc = { v: 1, budget: null, share: null, settlements: {} };

// Edits travel as small ops, not whole documents: the server applies each op against
// the doc it currently holds (inside a serializable transaction), so two open
// dashboard sessions can both edit without one overwriting the other. The same apply
// function runs client-side for optimistic updates.
export const donationPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-budget"), budget: budgetSchema.nullable() }),
  z.object({ op: z.literal("set-share"),  share: shareAnswerSchema }),
  z.object({ op: z.literal("settle"),     settlement: settlementSchema }),
  z.object({ op: z.literal("unsettle"),   month: z.string().regex(/^\d{4}-\d{2}$/) }),
  z.object({
    op:    z.literal("set-paid"),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    key:   z.string(),
    paid:  z.boolean(),
  }),
]);

export type DonationPatch = z.infer<typeof donationPatchSchema>;

export function applyDonationPatch(doc: DonationDoc, patch: DonationPatch): DonationDoc {
  switch (patch.op) {
    case "set-budget": return { ...doc, budget: patch.budget };
    case "set-share":  return { ...doc, share: patch.share };

    case "settle":
      return { ...doc, settlements: { ...doc.settlements, [patch.settlement.month]: patch.settlement } };

    case "unsettle": {
      const settlements = { ...doc.settlements };
      delete settlements[patch.month];
      return { ...doc, settlements };
    }

    case "set-paid": {
      const settlement = doc.settlements[patch.month];
      if (settlement === undefined) return doc; // settled elsewhere and unsettled since: nothing to mark

      const lines = settlement.lines.map((line) => (line.key === patch.key ? { ...line, paid: patch.paid } : line));
      return { ...doc, settlements: { ...doc.settlements, [patch.month]: { ...settlement, lines } } };
    }
  }
}
