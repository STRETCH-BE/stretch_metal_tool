/**
 * Unit tests for the market-mode eligibility rules: material lists,
 * thickness ranges, finish variants by material family, thread prices by
 * thickness and the exact bend row.
 * File path: /lib/pricing/eligibility.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  FINISHES_INCLUDING_EDGE_BREAKING,
  bendFamilyFactor,
  bendLengthClasses,
  codeListed,
  familyOf,
  featureEligibility,
  findBendRateExact,
  finishEligibility,
  finishRefused,
  finishVariantBase,
  finishesOffered,
  resolveFinishRate,
  thicknessWithin,
  threadPriceFor,
  threadThicknesses,
} from "./eligibility";
import type { BendRate, FeatureRate, FinishRate, ThreadRate } from "./types";

const finishBase: FinishRate = {
  code: "deburr",
  name: "Edge breaking both sides (steel)",
  unit: "m",
  price: 1.29,
  minimum: 0,
  placeholder: false,
  setupPerOrderEur: 0,
  setupPerLineEur: 36.35,
  minPartMm: "steel 250x60 or 600x50",
  materialCodes: ["DC01", "DX51D", "S235", "S355", "CortenA"],
  minThicknessMm: null,
  maxThicknessMm: null,
  pricePerPartEur: 0,
  minLeadTimeDays: 0,
  minimumScope: "order",
  tierMultiplierApplies: true,
  limits: {},
};
const deburrNonferrous: FinishRate = { ...finishBase, code: "deburr_nonferrous", price: 9.22, setupPerLineEur: 5.65, minPartMm: "aluminium/stainless 50x50", materialCodes: ["1.4301", "1.4404", "AlMg3", "AlMg4.5"] };
const deburrOneSide: FinishRate = { ...deburrNonferrous, code: "deburr_one_side", price: 3.28, setupPerLineEur: 5.18 };
const edgeRound: FinishRate = { ...finishBase, code: "edge_round", price: 37, setupPerLineEur: 33, materialCodes: ["S235", "S355"], minThicknessMm: 4 };
const powder: FinishRate = { ...finishBase, code: "powder", unit: "m2", price: 42.49, minimum: 186.53, setupPerLineEur: 1.91, minPartMm: null, materialCodes: ["DC01", "S235"], minThicknessMm: 1.5, maxThicknessMm: 3, pricePerPartEur: 6.98, minLeadTimeDays: 19, minimumScope: "colour" };
const engrave: FinishRate = { ...finishBase, code: "engrave", unit: "part", price: 0.6, setupPerLineEur: 0, minPartMm: null, materialCodes: null };
const rates = { finish: [finishBase, deburrNonferrous, deburrOneSide, edgeRound, powder, engrave] };

describe("material lists and thickness ranges", () => {
  it("codeListed: null = any; otherwise case-insensitive membership; no code fails a list", () => {
    expect(codeListed(null, null)).toBe(true);
    expect(codeListed(["DC01", "S235"], "dc01")).toBe(true);
    expect(codeListed(["DC01", "S235"], "1.4301")).toBe(false);
    expect(codeListed(["DC01"], null)).toBe(false);
  });
  it("thicknessWithin: inclusive bounds, open ends, no thickness fails a bounded range", () => {
    expect(thicknessWithin(null, null, null)).toBe(true);
    expect(thicknessWithin(1.5, 3, 1.5)).toBe(true);
    expect(thicknessWithin(1.5, 3, 3)).toBe(true);
    expect(thicknessWithin(1.5, 3, 4)).toBe(false);
    expect(thicknessWithin(4, null, 3)).toBe(false);
    expect(thicknessWithin(4, null, 5)).toBe(true);
    expect(thicknessWithin(1.5, 3, null)).toBe(false);
  });
});

describe("finishes", () => {
  it("variants: deburr_nonferrous is a variant of deburr and hidden from the option list; deburr_one_side is its own option", () => {
    expect(finishVariantBase("deburr_nonferrous")).toBe("deburr");
    expect(finishVariantBase("deburr_one_side")).toBeNull();
    expect(finishesOffered(rates).map((f) => f.code)).toEqual(["deburr", "deburr_one_side", "edge_round", "powder", "engrave"]);
  });
  it("resolveFinishRate picks the row whose material list holds the material, else the exact row for the report", () => {
    expect(resolveFinishRate(rates, "deburr", "S235")?.code).toBe("deburr");
    expect(resolveFinishRate(rates, "deburr", "1.4301")?.code).toBe("deburr_nonferrous");
    expect(resolveFinishRate(rates, "deburr", "CuZn37")?.code).toBe("deburr");
    expect(resolveFinishRate(rates, "deburr_one_side", "S235")?.code).toBe("deburr_one_side");
    expect(resolveFinishRate(rates, "zinc", "S235")).toBeNull();
  });
  it("finishEligibility: material and thickness refuse, the size rule only makes the finish unavailable", () => {
    expect(finishEligibility(edgeRound, { materialCode: "S235", thicknessMm: 3, family: "mild_steel" })).toBe("thickness");
    expect(finishEligibility(edgeRound, { materialCode: "S235", thicknessMm: 5, family: "mild_steel", widthMm: 400, heightMm: 400 })).toBe("ok");
    expect(finishEligibility(edgeRound, { materialCode: "DC01", thicknessMm: 5, family: "mild_steel" })).toBe("material");
    expect(finishEligibility(finishBase, { materialCode: "DC01", thicknessMm: 1.5, family: "mild_steel", widthMm: 100, heightMm: 100 })).toBe("size");
    expect(finishEligibility(deburrOneSide, { materialCode: "1.4301", thicknessMm: 1.5, family: "stainless", widthMm: 40, heightMm: 400 })).toBe("size");
    expect(finishEligibility(powder, { materialCode: "S235", thicknessMm: 6, family: "mild_steel" })).toBe("thickness");
    expect(finishEligibility(powder, { materialCode: "AlMg3", thicknessMm: 3, family: "aluminium" })).toBe("material");
    expect(finishEligibility(engrave, { materialCode: "CuZn37", thicknessMm: 2, family: "brass", widthMm: 10, heightMm: 10 })).toBe("ok");
    expect(finishRefused("material")).toBe(true);
    expect(finishRefused("thickness")).toBe(true);
    expect(finishRefused("size")).toBe(false);
    expect(finishRefused("family")).toBe(false);
  });
  it("coatings that include edge breaking name the options they replace", () => {
    expect(FINISHES_INCLUDING_EDGE_BREAKING.powder).toEqual(["deburr", "deburr_one_side"]);
    expect(FINISHES_INCLUDING_EDGE_BREAKING.zinc).toEqual(["deburr", "deburr_one_side"]);
  });
});

describe("features", () => {
  const csk: FeatureRate = { code: "csk_m6", name: "Countersink M6", priceEach: 2.19, placeholder: false, setupPerLineEur: 6.76, materialCodes: ["DC01", "S235"], minThicknessMm: 3, maxThicknessMm: 5 };
  it("eligible only for a listed material inside the thickness range", () => {
    expect(featureEligibility(csk, "S235", 3)).toBe("ok");
    expect(featureEligibility(csk, "S235", 5)).toBe("ok");
    expect(featureEligibility(csk, "DC01", 1.5)).toBe("thickness");
    expect(featureEligibility(csk, "1.4301", 3)).toBe("material");
    expect(featureEligibility({ ...csk, materialCodes: null, minThicknessMm: null, maxThicknessMm: null }, null, null)).toBe("ok");
  });
});

describe("threads", () => {
  const m8: ThreadRate = { size: "M8", priceEach: 0.9688, placeholder: false, setupPerLineEur: 2.8812, priceByThickness: [{ thicknessMm: 3, priceEach: 0.9688 }, { thicknessMm: 6, priceEach: 2.0543 }], materialCodes: ["DC01", "S235"] };
  it("prices the exact thickness entry for a listed material; rows without entries price price_each", () => {
    expect(threadPriceFor(m8, "S235", 3)).toBe(0.9688);
    expect(threadPriceFor(m8, "S235", 6)).toBe(2.0543);
    expect(threadPriceFor(m8, "S235", 4)).toBeNull();
    expect(threadPriceFor(m8, "1.4301", 3)).toBeNull();
    expect(threadPriceFor(m8, "S235", null)).toBeNull();
    const v2 = { ...m8, size: "M12", priceEach: 0.76, priceByThickness: [], materialCodes: null };
    expect(threadPriceFor(v2, "AlMg3", 1.5)).toBe(0.76);
    expect(threadThicknesses(m8)).toEqual([3, 6]);
    expect(threadThicknesses(v2)).toEqual([]);
  });
});

describe("bends", () => {
  const rows: BendRate[] = [
    { thicknessMm: 1.5, lengthClassMm: 200, pricePerBend: 1.4152, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 0.8136, familyMultipliers: { stainless: 2.233 }, materialCodes: ["DC01", "1.4301"] },
    { thicknessMm: 2, lengthClassMm: 1500, pricePerBend: 13.8708, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 7.974, familyMultipliers: {}, materialCodes: ["DC01"] },
    { thicknessMm: 2, lengthClassMm: 200, pricePerBend: 1.9371, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 1.113, familyMultipliers: {}, materialCodes: ["DC01"] },
  ];
  it("exact thickness, listed material, smallest length class ≥ the longest bend", () => {
    expect(findBendRateExact({ bend: rows }, "DC01", 2, 160)?.lengthClassMm).toBe(200);
    expect(findBendRateExact({ bend: rows }, "DC01", 2, 200)?.lengthClassMm).toBe(200);
    expect(findBendRateExact({ bend: rows }, "DC01", 2, 1460)?.lengthClassMm).toBe(1500);
    expect(findBendRateExact({ bend: rows }, "DC01", 2, 3000)).toBeNull();
    expect(findBendRateExact({ bend: rows }, "DC01", 1.5, 400)).toBeNull();
    expect(findBendRateExact({ bend: rows }, "DX51D", 2, 160)).toBeNull();
    expect(findBendRateExact({ bend: rows }, "DC01", 3, 160)).toBeNull();
    expect(findBendRateExact({ bend: rows }, "1.4301", 1.5, 100)?.thicknessMm).toBe(1.5);
    expect(bendLengthClasses({ bend: rows }, "DC01", 2)).toEqual([200, 1500]);
  });
  it("family factor applies only to listed families", () => {
    expect(bendFamilyFactor(rows[0], "stainless")).toBe(2.233);
    expect(bendFamilyFactor(rows[0], "mild_steel")).toBe(1);
    expect(bendFamilyFactor(rows[0], null)).toBe(1);
  });
  it("familyOf reads the material family from the snapshot", () => {
    const materials = [{ code: "1.4301", family: "stainless" as const }];
    expect(familyOf({ materials: materials as never }, "1.4301")).toBe("stainless");
    expect(familyOf({ materials: materials as never }, "S235")).toBeNull();
  });
});
