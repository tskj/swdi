import { describe, expect, it } from "vitest";
import { withClock } from "@swdi/shared";
import { clientIp, rateLimited } from "@/lib/rate-limit";

// The limiter is the only brake on online key-guessing, so what these tests pin is
// adversarial: a client must not be able to mint identities or reset other buckets.

function requestWith(forwarded: string | null): Request {
  return new Request("https://example.test/", forwarded === null ? undefined : { headers: { "x-forwarded-for": forwarded } });
}

describe("clientIp", () => {
  it("takes the rightmost X-Forwarded-For entry, the one our own hop appended", () => {
    expect(clientIp(requestWith("203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(requestWith("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(requestWith("a, b,  203.0.113.9 "))).toBe("203.0.113.9");
  });

  it("degrades to unknown without a forwarding header", () => {
    expect(clientIp(requestWith(null))).toBe("unknown");
    expect(clientIp(requestWith("spoofed,"))).toBe("unknown");
  });
});

describe("rateLimited", () => {
  it("limits within a window and forgives in the next", async () => {
    let now = 1_000_000;

    await withClock({ nowMs: () => now }, () => {
      for (let i = 0; i < 5; i++) expect(rateLimited("limit:me", 5)).toBe(false);
      expect(rateLimited("limit:me", 5)).toBe(true);

      now += 60_000;
      expect(rateLimited("limit:me", 5)).toBe(false);
    });
  });

  it("holds a long window well past the default one", async () => {
    let now = 3_000_000;

    await withClock({ nowMs: () => now }, () => {
      for (let i = 0; i < 3; i++) rateLimited("slow:burn", 3, 3_600_000);
      expect(rateLimited("slow:burn", 3, 3_600_000)).toBe(true);

      now += 120_000;
      expect(rateLimited("slow:burn", 3, 3_600_000)).toBe(true);

      now += 3_600_000;
      expect(rateLimited("slow:burn", 3, 3_600_000)).toBe(false);
    });
  });

  it("keeps live buckets limited while overflowing, instead of resetting everyone", async () => {
    const now = 2_000_000;

    await withClock({ nowMs: () => now }, () => {
      for (let i = 0; i < 3; i++) rateLimited("hot:bucket", 2);
      expect(rateLimited("hot:bucket", 2)).toBe(true);

      // Flood the map far past its cap with distinct keys, all inside the window.
      // The old behavior cleared the whole map here, forgiving the hot bucket.
      for (let i = 0; i < 11_000; i++) rateLimited(`flood:${i}`, 2);

      expect(rateLimited("hot:bucket", 2)).toBe(true);
    });
  });
});
