/**
 * isPricingStale (lib/quotes/shared.ts): a draft whose stored pricing was
 * computed with a different rate version than the one it is pinned to is
 * stale and the builder re-prices it on open; unpriced or unpinned quotes
 * never are, so the first pricing run stays the only thing that pins them.
 * File path: /test/quotes/stale.test.ts
 */
import { describe, expect, it } from "vitest";
import { isPricingStale } from "@/lib/quotes/shared";
import { makeBundle } from "./fixtures";

describe("isPricingStale", () => {
  it("is false when the stored pricing and the quote share a rate version", () => {
    const bundle = makeBundle();
    expect(bundle.pricing).not.toBeNull();
    expect(bundle.quote.rate_version_id).toBe(bundle.pricing?.rateVersionId);
    expect(isPricingStale(bundle.quote, bundle.pricing)).toBe(false);
  });

  it("is true once the quote is pinned to another version (re-pinned after activation)", () => {
    const bundle = makeBundle({ quote: { rate_version_id: "4eecc220-06e5-4807-99ae-b045c51716ab" } });
    expect(isPricingStale(bundle.quote, bundle.pricing)).toBe(true);
  });

  it("is false for an unpriced quote and for a quote without a pinned version", () => {
    const unpriced = makeBundle({ priced: null });
    expect(isPricingStale(unpriced.quote, unpriced.pricing)).toBe(false);
    const unpinned = makeBundle({ quote: { rate_version_id: null } });
    expect(isPricingStale(unpinned.quote, unpinned.pricing)).toBe(false);
  });
});
