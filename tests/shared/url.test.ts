import { describe, expect, it } from "vitest";
import { normalizePageUrl, splitLinkTarget } from "@swdi/shared";

describe("normalizePageUrl", () => {
  it("maps equivalent spellings of the same page to one identity", () => {
    const canonical = "https://meaningness.com/preview-eternalism-and-nihilism";

    expect(normalizePageUrl("https://meaningness.com/preview-eternalism-and-nihilism")).toBe(canonical);
    expect(normalizePageUrl("http://meaningness.com/preview-eternalism-and-nihilism")).toBe(canonical);
    expect(normalizePageUrl("https://www.meaningness.com/preview-eternalism-and-nihilism")).toBe(canonical);
    expect(normalizePageUrl("https://meaningness.com/preview-eternalism-and-nihilism/")).toBe(canonical);
    expect(normalizePageUrl("https://meaningness.com/preview-eternalism-and-nihilism#completion")).toBe(canonical);
    expect(normalizePageUrl("https://meaningness.com/preview-eternalism-and-nihilism?utm_source=x")).toBe(canonical);
  });

  it("keeps meaningful query params and sorts them", () => {
    expect(normalizePageUrl("https://example.com/a?b=2&a=1")).toBe("https://example.com/a?a=1&b=2");
    expect(normalizePageUrl("https://example.com/a?b=2&utm_campaign=x&fbclid=y")).toBe("https://example.com/a?b=2");
  });

  it("normalizes host case and bare paths", () => {
    expect(normalizePageUrl("https://Example.COM")).toBe("https://example.com/");
  });

  it("rejects non-http targets", () => {
    expect(normalizePageUrl("mailto:someone@example.com")).toBeNull();
    expect(normalizePageUrl("javascript:void(0)")).toBeNull();
    expect(normalizePageUrl("not a url at all")).toBeNull();
  });

  it("resolves relative urls against a base", () => {
    expect(normalizePageUrl("/nebulosity", "https://meaningness.com/x")).toBe("https://meaningness.com/nebulosity");
  });
});

describe("splitLinkTarget", () => {
  it("separates page identity from the fragment", () => {
    const target = splitLinkTarget("https://meaningness.com/preview-eternalism-and-nihilism#completion");

    expect(target).toEqual({
      page:     "https://meaningness.com/preview-eternalism-and-nihilism",
      fragment: "completion",
    });
  });

  it("returns a null fragment for plain links", () => {
    expect(splitLinkTarget("https://meaningness.com/nebulosity")?.fragment).toBeNull();
  });

  it("decodes encoded fragments", () => {
    expect(splitLinkTarget("https://example.com/a#b%20c")?.fragment).toBe("b c");
  });

  it("survives malformed percent-encoding in third-party fragments", () => {
    expect(splitLinkTarget("https://example.com/a#100%")?.fragment).toBe("100%");
    expect(splitLinkTarget("https://example.com/a#%E0%A4%A")?.fragment).toBe("%E0%A4%A");
  });
});
