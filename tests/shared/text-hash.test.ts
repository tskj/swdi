import { describe, expect, it } from "vitest";
import { hashText, normalizeParagraphText, wordCount } from "@swdi/shared";

describe("normalizeParagraphText", () => {
  it("collapses whitespace so markup churn does not change identity", () => {
    expect(normalizeParagraphText("  a\n  b\t c ")).toBe("a b c");
  });

  it("applies unicode NFC so composed and decomposed accents agree", () => {
    expect(normalizeParagraphText("é")).toBe("é");
  });
});

describe("wordCount", () => {
  it("counts words in normalized text", () => {
    expect(wordCount(" one   two\nthree ")).toBe(3);
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
  });
});

describe("hashText", () => {
  it("is deterministic and hex-shaped", async () => {
    const a = await hashText("the same paragraph");
    const b = await hashText("the same paragraph");

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes when the text changes", async () => {
    expect(await hashText("paragraph one")).not.toBe(await hashText("paragraph two"));
  });
});
