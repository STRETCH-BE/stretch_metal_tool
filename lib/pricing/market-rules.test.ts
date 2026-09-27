/**
 * Unit tests for the market-mode rules: lead-time steps, packaging choice
 * and the minimum part size parser.
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
  { workingDays: 11, multiplier: 1, placeholder: false },
  { workingDays: 4, multiplier: 1.75, placeholder: false },
  { workingDays: 7, multiplier: 1.12, placeholder: false },
];

describe("resolveLeadTimeMultiplier", () => {
  it("applies the tier with the largest working days ≤ the request (steps, no interpolation)", () => {
    expect(resolveLeadTimeMultiplier(rows, 11)).toMatchObject({ multiplier: 1, offered: true, row: { workingDays: 11 } });
    expect(resolveLeadTimeMultiplier(rows, 10).multiplier).toBe(1.12);
    expect(resolveLeadTimeMultiplier(rows, 8.5).multiplier).toBe(1.12);
    expect(resolveLeadTimeMultiplier(rows, 7).multiplier).toBe(1.12);
    expect(resolveLeadTimeMultiplier(rows, 6).multiplier).toBe(1.75);
    expect(resolveLeadTimeMultiplier(rows, 4).multiplier).toBe(1.75);
    expect(resolveLeadTimeMultiplier(rows, 4).row?.workingDays).toBe(4);
  });
  it("holds the longest tier beyond it and refuses anything shorter than the shortest tier", () => {
    expect(resolveLeadTimeMultiplier(rows, 30)).toMatchObject({ multiplier: 1, offered: true });
    expect(resolveLeadTimeMultiplier(rows, 3)).toEqual({ multiplier: 1, row: null, offered: false });
    expect(resolveLeadTimeMultiplier(rows, 1).offered).toBe(false);
  });
  it("is 1 and offered without rows or without a promised lead time", () => {
    expect(resolveLeadTimeMultiplier([], 5)).toEqual({ multiplier: 1, row: null, offered: true });
    expect(resolveLeadTimeMultiplier(rows, null)).toEqual({ multiplier: 1, row: null, offered: true });
  });
});

describe("decidePackaging", () => {
  it("box when everything fits in 600 mm and the total mass stays within 5 kg, pallet otherwise", () => {
    expect(PACKAGING_BOX_MAX_SIDE_MM).toBe(600);
    expect(PACKAGING_BOX_MAX_MASS_KG).toBe(5);
    expect(decidePackaging([{ maxSideMm: 400, massKg: 0.5, qty: 5 }]).kind).toBe("box");
    expect(decidePackaging([{ maxSideMm: 600, massKg: 2.5, qty: 2 }]).kind).toBe("box");
    expect(decidePackaging([{ maxSideMm: PACKAGING_BOX_MAX_SIDE_MM + 1, massKg: 1, qty: 1 }]).kind).toBe("pallet");
    expect(decidePackaging([{ maxSideMm: 100, massKg: PACKAGING_BOX_MAX_MASS_KG / 2 + 0.01, qty: 2 }]).kind).toBe("pallet");
    expect(decidePackaging([{ maxSideMm: 100, massKg: null, qty: 100 }]).totalMassKg).toBe(0);
    expect(decidePackaging([{ maxSideMm: 100, massKg: 1, qty: 3 }])).toMatchObject({ totalMassKg: 3, maxSideMm: 100, maxSideLimitMm: 600, massLimitKg: 5 });
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
  it("the v2 burr-side rule names only aluminium and stainless (mild steel gets no applicable rule)", () => {
    const oneSide = parseMinPartRule("aluminium/stainless 50x50; not available for mild steel");
    expect(oneSide.some((r) => r.families.includes("aluminium") && r.families.includes("stainless"))).toBe(true);
    expect(meetsMinPartSize(oneSide, "stainless", 60, 60)).toBe(true);
  });
});
