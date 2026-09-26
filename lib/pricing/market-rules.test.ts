/**
 * Unit tests for the market-mode rules: lead-time interpolation, packaging
 * choice and the minimum part size parser.
 * File path: /lib/pricing/market-rules.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  PACKAGING_BOX_MAX_MASS_KG,
  PACKAGING_BOX_MAX_SIDE_MM,
  decidePackaging,
  meetsMinPartSize,
  parseMinPartRule,
  resolveLeadTimeMultiplier,
} from "./market-rules";

const rows = [
  { workingDays: 3, multiplier: 1.4, placeholder: false },
  { workingDays: 6, multiplier: 1.15, placeholder: false },
  { workingDays: 11, multiplier: 1, placeholder: false },
];

describe("resolveLeadTimeMultiplier", () => {
  it("returns the row multiplier on a row and interpolates between rows", () => {
    expect(resolveLeadTimeMultiplier(rows, 11).multiplier).toBe(1);
    expect(resolveLeadTimeMultiplier(rows, 6).multiplier).toBe(1.15);
    expect(resolveLeadTimeMultiplier(rows, 8.5).multiplier).toBeCloseTo(1.075, 12);
    expect(resolveLeadTimeMultiplier(rows, 4.5).multiplier).toBeCloseTo(1.275, 12);
  });
  it("caps at the shortest row and holds the longest row beyond it", () => {
    expect(resolveLeadTimeMultiplier(rows, 1).multiplier).toBe(1.4);
    expect(resolveLeadTimeMultiplier(rows, 30).multiplier).toBe(1);
  });
  it("is 1 without rows or without a promised lead time", () => {
    expect(resolveLeadTimeMultiplier([], 5).multiplier).toBe(1);
    expect(resolveLeadTimeMultiplier(rows, null).multiplier).toBe(1);
  });
});

describe("decidePackaging", () => {
  it("box when everything fits and the mass is under the limit, pallet otherwise", () => {
    expect(decidePackaging([{ maxSideMm: 400, massKg: 2, qty: 5 }]).kind).toBe("box");
    expect(decidePackaging([{ maxSideMm: PACKAGING_BOX_MAX_SIDE_MM + 1, massKg: 1, qty: 1 }]).kind).toBe("pallet");
    expect(decidePackaging([{ maxSideMm: 100, massKg: PACKAGING_BOX_MAX_MASS_KG / 2 + 0.01, qty: 2 }]).kind).toBe("pallet");
    expect(decidePackaging([{ maxSideMm: 100, massKg: null, qty: 100 }]).totalMassKg).toBe(0);
  });
});

describe("min part size rule", () => {
  const rules = parseMinPartRule("steel 250x60 or 600x50; aluminium/stainless 50x50");
  it("parses families and sizes", () => {
    expect(rules).toEqual([
      { families: ["mild_steel"], sizes: [{ aMm: 250, bMm: 60 }, { aMm: 600, bMm: 50 }] },
      { families: ["aluminium", "stainless"], sizes: [{ aMm: 50, bMm: 50 }] },
    ]);
  });
  it("checks either orientation and any listed size", () => {
    expect(meetsMinPartSize(rules, "mild_steel", 400, 400)).toBe(true);
    expect(meetsMinPartSize(rules, "mild_steel", 60, 250)).toBe(true);
    expect(meetsMinPartSize(rules, "mild_steel", 700, 55)).toBe(true);
    expect(meetsMinPartSize(rules, "mild_steel", 200, 200)).toBe(false);
    expect(meetsMinPartSize(rules, "mild_steel", 100, 100)).toBe(false);
    expect(meetsMinPartSize(rules, "aluminium", 50, 50)).toBe(true);
    expect(meetsMinPartSize(rules, "stainless", 49, 200)).toBe(false);
  });
  it("families without a rule have no minimum; empty or unparsable text means no minimum", () => {
    expect(meetsMinPartSize(rules, "brass", 10, 10)).toBeNull();
    expect(meetsMinPartSize(rules, null, 10, 10)).toBeNull();
    expect(parseMinPartRule("")).toEqual([]);
    expect(parseMinPartRule("ask production")).toEqual([]);
    expect(parseMinPartRule(null)).toEqual([]);
  });
  it("an 'all' rule applies to every family unless a specific one exists", () => {
    const mixed = parseMinPartRule("all 100x100; aluminium 30x30");
    expect(meetsMinPartSize(mixed, "copper", 90, 200)).toBe(false);
    expect(meetsMinPartSize(mixed, "aluminium", 30, 30)).toBe(true);
  });
});
