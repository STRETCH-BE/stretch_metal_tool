/**
 * Price scale editor helpers (components/quote/price-scale.ts): parsing
 * the typed quantity list, formatting it back, the default set and the
 * server-side cap.
 * File path: /test/ui/price-scale.test.ts
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_SCALE, formatPriceScale, parsePriceScaleText, samePriceScale } from "@/components/quote/price-scale";
import { PRICE_SCALE_MAX } from "@/lib/quotes/schema";

describe("parsePriceScaleText", () => {
  it("parses comma / semicolon / whitespace separated whole numbers, deduplicated and ascending", () => {
    expect(parsePriceScaleText("20, 50, 100").values).toEqual([20, 50, 100]);
    expect(parsePriceScaleText("100;20 50\n20").values).toEqual([20, 50, 100]);
    expect(parsePriceScaleText("  ").values).toEqual([]);
  });

  it("reports tokens that are not positive whole numbers and keeps the valid ones", () => {
    const parsed = parsePriceScaleText("20, abc, 0, -5, 2.5, 50");
    expect(parsed.values).toEqual([20, 50]);
    expect(parsed.invalid).toEqual(["abc", "0", "-5", "2.5"]);
    expect(parsed.truncated).toBe(false);
  });

  it("caps the list at the server's PRICE_SCALE_MAX and flags the truncation", () => {
    const text = Array.from({ length: PRICE_SCALE_MAX + 3 }, (_, i) => String((i + 1) * 10)).join(", ");
    const parsed = parsePriceScaleText(text);
    expect(parsed.values).toHaveLength(PRICE_SCALE_MAX);
    expect(parsed.truncated).toBe(true);
    expect(parsed.invalid).toEqual([]);
  });

  it("round-trips through formatPriceScale", () => {
    const text = formatPriceScale(DEFAULT_PRICE_SCALE);
    expect(text).toBe("20, 50, 100, 200, 500, 1000");
    expect(parsePriceScaleText(text).values).toEqual([...DEFAULT_PRICE_SCALE]);
  });
});

describe("samePriceScale", () => {
  it("compares value by value", () => {
    expect(samePriceScale([20, 50], [20, 50])).toBe(true);
    expect(samePriceScale([20, 50], [50, 20])).toBe(false);
    expect(samePriceScale([20], [20, 50])).toBe(false);
  });
});
