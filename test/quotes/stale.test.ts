/**
 * isPricingStale (lib/quotes/shared.ts): a draft whose stored pricing no
 * longer matches the quote — another rate version than the one it is pinned
 * to, another margin or lead time than the header carries, or a stored
 * subtotal in another currency than the one saved now (a header save whose
 * server re-price failed) — is stale and the builder re-prices it on open;
 * unpriced quotes never are, and an unpinned quote only through its inputs,
 * so the first pricing run stays the thing that pins it. Legacy snapshots
 * without inputMarginPct read it from marginPct (parsePricing).
 * File path: /test/quotes/stale.test.ts
 */
import { describe, expect, it } from "vitest";
import { isPricingStale } from "@/lib/quotes/shared";
import { parsePricing } from "@/lib/quotes/schema";
import { toJson } from "@/lib/quotes/mapper";
import { makeBundle, priceFixture } from "./fixtures";

describe("isPricingStale", () => {
  it("is false when the stored pricing and the quote agree on version, margin, lead time and currency", () => {
    const bundle = makeBundle();
    expect(bundle.pricing).not.toBeNull();
    expect(bundle.quote.rate_version_id).toBe(bundle.pricing?.rateVersionId);
    expect(bundle.pricing?.inputMarginPct).toBe(Number(bundle.quote.margin_pct));
    expect(isPricingStale(bundle.quote, bundle.pricing)).toBe(false);
  });

  it("is true once the quote is pinned to another version (re-pinned after activation)", () => {
    const bundle = makeBundle({ quote: { rate_version_id: "4eecc220-06e5-4807-99ae-b045c51716ab" } });
    expect(isPricingStale(bundle.quote, bundle.pricing)).toBe(true);
  });

  it("is true when the header margin differs from the margin the snapshot was priced with", () => {
    const bundle = makeBundle({ quote: { margin_pct: 40 } });
    expect(bundle.pricing?.inputMarginPct).toBe(30);
    expect(isPricingStale(bundle.quote, bundle.pricing)).toBe(true);
    // numeric columns may arrive as strings; equal values are not stale
    expect(isPricingStale({ ...bundle.quote, margin_pct: "30.00" }, bundle.pricing)).toBe(false);
  });

  it("is true when the header lead time differs from the one the snapshot was priced with", () => {
    const bundle = makeBundle();
    const snapshot = { ...bundle.pricing!, leadTimeDays: 11 };
    expect(isPricingStale({ ...bundle.quote, lead_time_days: 11 }, snapshot)).toBe(false);
    expect(isPricingStale({ ...bundle.quote, lead_time_days: 5 }, snapshot)).toBe(true);
    // a snapshot that recorded no lead time (cost mode before the field existed) cannot disagree
    expect(isPricingStale({ ...bundle.quote, lead_time_days: 5 }, { ...snapshot, leadTimeDays: null })).toBe(false);
  });

  it("is true when the stored subtotal is not the snapshot converted at the currency and fx rate saved now", () => {
    const bundle = makeBundle();
    const eur = bundle.pricing!.subtotalPrice;
    // PLN quote at 4.3 priced as PLN: consistent
    expect(Number(bundle.quote.subtotal_price)).toBeCloseTo(eur * 4.3, 6);
    expect(isPricingStale(bundle.quote, bundle.pricing)).toBe(false);
    // header switched to EUR (fx 1) but the PLN subtotal stayed: stale
    expect(isPricingStale({ ...bundle.quote, currency: "EUR", fx_rate: 1 }, bundle.pricing)).toBe(true);
    // the same quote after a successful re-price in EUR: consistent again
    expect(isPricingStale({ ...bundle.quote, currency: "EUR", fx_rate: 1, subtotal_price: eur }, bundle.pricing)).toBe(false);
    // numeric(14,4) rounding is not a difference
    expect(isPricingStale({ ...bundle.quote, subtotal_price: Number((eur * 4.3).toFixed(4)) }, bundle.pricing)).toBe(false);
  });

  it("is false for an unpriced quote, and an unpinned quote is stale only through its inputs", () => {
    const unpriced = makeBundle({ priced: null });
    expect(isPricingStale(unpriced.quote, unpriced.pricing)).toBe(false);
    const unpinned = makeBundle({ quote: { rate_version_id: null } });
    expect(isPricingStale(unpinned.quote, unpinned.pricing)).toBe(false);
    expect(isPricingStale({ ...unpinned.quote, margin_pct: 35 }, unpinned.pricing)).toBe(true);
  });

  it("reads inputMarginPct from marginPct on a snapshot stored before the field existed", () => {
    const priced = priceFixture(30);
    const legacy = toJson(priced) as Record<string, unknown>;
    delete legacy.inputMarginPct;
    const parsed = parsePricing(legacy as never);
    expect(parsed?.inputMarginPct).toBe(30);
    expect(parsePricing(toJson({ ...priced, inputMarginPct: 12 }))?.inputMarginPct).toBe(12);
  });
});
