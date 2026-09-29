/**
 * isPricingStale (lib/quotes/shared.ts): a draft whose stored pricing was
 * computed with a different rate version than the one it is pinned to is
 * stale and the builder re-prices it on open; unpriced or unpinned quotes
 * never are, so the first pricing run stays the only thing that pins them.
 * The same holds for a pricing computed by an OLDER pricing engine
 * (PRICING_ENGINE_VERSION): a deploy that changes a formula makes every
 * stored draft pricing stale once.
 * File path: /test/quotes/stale.test.ts
 */
import { describe, expect, it } from "vitest";
import { PRICING_ENGINE_VERSION } from "@/lib/pricing/version";
import { parsePricing } from "@/lib/quotes/schema";
import { isPricingStale } from "@/lib/quotes/shared";
import { toJson } from "@/lib/quotes/mapper";
import { makeBundle, priceFixture } from "./fixtures";

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

  it("the engine stamps its version on every result and the stored snapshot keeps it", () => {
    expect(PRICING_ENGINE_VERSION).toBeGreaterThanOrEqual(2);
    const priced = priceFixture();
    expect(priced.engineVersion).toBe(PRICING_ENGINE_VERSION);
    expect(parsePricing(toJson(priced))?.engineVersion).toBe(PRICING_ENGINE_VERSION);
    expect(makeBundle().pricing?.engineVersion).toBe(PRICING_ENGINE_VERSION);
  });

  it("is true for a pricing computed by an older engine, or stored before the engine was versioned (parses as 0)", () => {
    const older = makeBundle({ priced: { ...priceFixture(), engineVersion: PRICING_ENGINE_VERSION - 1 } });
    expect(isPricingStale(older.quote, older.pricing)).toBe(true);
    const { engineVersion: _dropped, ...legacy } = priceFixture();
    void _dropped;
    const parsed = parsePricing(toJson(legacy));
    expect(parsed?.engineVersion).toBe(0);
    expect(isPricingStale({ rate_version_id: parsed!.rateVersionId }, parsed)).toBe(true);
    // the engine rule does not need a pinned version; a null pricing is never stale
    expect(isPricingStale({ rate_version_id: null }, { rateVersionId: "x", engineVersion: 0 })).toBe(true);
    expect(isPricingStale({ rate_version_id: null }, null)).toBe(false);
  });
});
