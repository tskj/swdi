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
