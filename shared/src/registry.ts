import { z } from "zod";

// The author registry: a public mapping from the places writing lives to the payment
// channels its authors already have. The registry is a commons, reached through a
// configurable URL; v0 ships as versioned JSON in this repo, served by /api/registry.

export const paymentKindSchema = z.enum([
  "paypal",
  "bitcoin",
  "buymeacoffee",
  "kofi",
  "patreon",
  "stripe",
  "github-sponsors",
  "liberapay",
  "custom",
]);

export const paymentMethodSchema = z.object({
  kind: paymentKindSchema,
  url:  z.string(), // the donation URL, or for bitcoin the address / bitcoin: URI
});

export const registryEntrySchema = z.object({
  name:  z.string(),
  sites: z.array(z.string()), // canonical https URL prefixes the author's writing lives under

  payment: z.array(paymentMethodSchema),

  status:     z.enum(["verified", "unverified"]),
  verifiedAt: z.string().nullable(), // when the payment links were last confirmed to resolve
  notes:      z.string().optional(),
});

export const registrySchema = z.object({
  v: z.literal(1),
  updatedAt: z.string(),
  entries:   z.array(registryEntrySchema),
});

export type PaymentKind   = z.infer<typeof paymentKindSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type RegistryEntry = z.infer<typeof registryEntrySchema>;
export type Registry      = z.infer<typeof registrySchema>;
