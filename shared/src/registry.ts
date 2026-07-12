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

// The url renders as an href on Pay buttons, and the registry is meant to become a
// community-edited commons: an unconstrained scheme here would be stored XSS
// (javascript:) or payment redirection waiting for that day. Web channels take
// https, bitcoin takes a bitcoin: URI (bare addresses are written as URIs).
export const paymentMethodSchema = z.object({
  kind: paymentKindSchema,
  url:  z.string(),
}).refine(
  (m) => (m.kind === "bitcoin" ? m.url.startsWith("bitcoin:") : m.url.startsWith("https://")),
  { message: "bitcoin methods take a bitcoin: URI; every other channel takes an https URL" },
);

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
