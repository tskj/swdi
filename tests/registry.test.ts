import { describe, expect, it } from "vitest";
import { registrySchema } from "@swdi/shared";
import registryJson from "../registry/registry.json";

// The registry ships as hand-edited JSON; this test is what keeps community edits honest.

describe("registry data", () => {
  const registry = registrySchema.parse(registryJson);

  it("parses against the schema", () => {
    expect(registry.v).toBe(1);
    expect(registry.entries.length).toBeGreaterThan(0);
  });

  it("gives every verified entry a verification date and at least one payment method", () => {
    for (const entry of registry.entries) {
      if (entry.status !== "verified") continue;

      expect(entry.verifiedAt, entry.name).not.toBeNull();
      expect(entry.payment.length, entry.name).toBeGreaterThan(0);
    }
  });

  it("uses canonical https site prefixes", () => {
    for (const entry of registry.entries) {
      for (const site of entry.sites) expect(site, entry.name).toMatch(/^https:\/\//);
    }
  });
});
