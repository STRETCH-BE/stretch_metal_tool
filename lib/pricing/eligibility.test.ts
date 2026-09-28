/**
 * Unit tests for the market-mode eligibility rules: material lists,
 * thickness ranges, finish variants by material family, thread prices by
 * thickness, the exact bend row and the same-thickness steel fallback.
 * File path: /lib/pricing/eligibility.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  BEND_FALLBACK_APPLY_FAMILY_FACTOR,
  FINISHES_INCLUDING_EDGE_BREAKING,
  bendExtrapolated,
  bendFamilyFactor,
  bendLengthClasses,
  bendPricePerPiece,
  codeListed,
  fallbackFamilyFactor,
  familyOf,
  featureEligibility,
  findBendRateExact,
  finishEligibility,
  finishRefused,
  finishVariantBase,
  finishesOffered,
  resolveBendRate,
  resolveBendRateForMaterial,
  resolveFinishRate,
  steelBendRowsFor,
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
    { thicknessMm: 1.5, lengthClassMm: 4400, pricePerBend: 1.4152, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 0.8136, familyMultipliers: { stainless: 2.233 }, materialCodes: ["DC01", "1.4301"], pricePerBendPerM: 14.8646, benchmarkedMaxLengthMm: 200 },
    { thicknessMm: 2, lengthClassMm: 4400, pricePerBend: 1.9371, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 1.113, familyMultipliers: {}, materialCodes: ["DC01"], pricePerBendPerM: 14.8646, benchmarkedMaxLengthMm: 1460 },
    { thicknessMm: 2, lengthClassMm: 200, pricePerBend: 1.5, setupPerPartType: 2, placeholder: false, setupPerBendLineEur: 1, familyMultipliers: {}, materialCodes: ["DX51D"], pricePerBendPerM: 0, benchmarkedMaxLengthMm: null },
  ];
  it("resolves the row by exact thickness and material; length beyond every class is too long; no row is not benchmarked", () => {
    expect(resolveBendRate({ bend: rows }, "DC01", 2, 160)).toMatchObject({ rate: { thicknessMm: 2, lengthClassMm: 4400 }, tooLong: false, limitMm: 4400 });
    expect(resolveBendRate({ bend: rows }, "DC01", 2, 4400).rate?.lengthClassMm).toBe(4400);
    expect(resolveBendRate({ bend: rows }, "DC01", 2, 4500)).toEqual({ rate: null, tooLong: true, limitMm: 4400 });
    expect(resolveBendRate({ bend: rows }, "DX51D", 2, 300)).toEqual({ rate: null, tooLong: true, limitMm: 200 });
    expect(resolveBendRate({ bend: rows }, "DX51D", 2, 150).rate?.pricePerBend).toBe(1.5);
    expect(resolveBendRate({ bend: rows }, "S235", 2, 160)).toEqual({ rate: null, tooLong: false, limitMm: null });
    expect(resolveBendRate({ bend: rows }, "DC01", 3, 160).rate).toBeNull();
    expect(findBendRateExact({ bend: rows }, "1.4301", 1.5, 100)?.thicknessMm).toBe(1.5);
    expect(bendLengthClasses({ bend: rows }, "DC01", 2)).toEqual([4400]);
  });
  it("prices a bend by its length: flat up to the 200 mm base, plus €/m beyond it, times the family factor", () => {
    expect(bendPricePerPiece(rows[1], 160, 1)).toBeCloseTo(1.9371, 9);
    expect(bendPricePerPiece(rows[1], 200, 1)).toBeCloseTo(1.9371, 9);
    expect(bendPricePerPiece(rows[1], 1460, 1)).toBeCloseTo(1.9371 + 14.8646 * 1.26, 9);
    expect(bendPricePerPiece(rows[0], 3000, 2.233)).toBeCloseTo((1.4152 + 14.8646 * 2.8) * 2.233, 9);
    expect(bendExtrapolated(rows[1], 1460)).toBe(false);
    expect(bendExtrapolated(rows[1], 1461)).toBe(true);
    expect(bendExtrapolated(rows[0], 201)).toBe(true);
    expect(bendExtrapolated(rows[2], 10000)).toBe(false); // no benchmarked length recorded
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

describe("bends — same-thickness steel fallback", () => {
  const row15: BendRate = { id: "row-1.5", thicknessMm: 1.5, lengthClassMm: 4400, pricePerBend: 1.4152, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 0.8136, familyMultipliers: { stainless: 2.233 }, materialCodes: ["DC01", "1.4301"], pricePerBendPerM: 14.8646, benchmarkedMaxLengthMm: 200 };
  const row2: BendRate = { id: "row-2", thicknessMm: 2, lengthClassMm: 4400, pricePerBend: 1.9371, setupPerPartType: 2.7747, placeholder: false, setupPerBendLineEur: 1.113, familyMultipliers: {}, materialCodes: ["DC01"], pricePerBendPerM: 14.8646, benchmarkedMaxLengthMm: 1460 };
  const row3: BendRate = { id: "row-3", thicknessMm: 3, lengthClassMm: 4400, pricePerBend: 1.4497, setupPerPartType: 3.3005, placeholder: false, setupPerBendLineEur: 0.8338, familyMultipliers: { aluminium: 2.184 }, materialCodes: ["S235", "AlMg3"], pricePerBendPerM: 14.8646, benchmarkedMaxLengthMm: 200 };
  const row5any: BendRate = { id: "row-5", thicknessMm: 5, lengthClassMm: 3000, pricePerBend: 4, setupPerPartType: 3, placeholder: false, setupPerBendLineEur: 2, familyMultipliers: {}, materialCodes: null, pricePerBendPerM: 20, benchmarkedMaxLengthMm: null };
  const row6ph: BendRate = { id: "row-6", thicknessMm: 6, lengthClassMm: 4400, pricePerBend: 17.5378, setupPerPartType: 2.7747, placeholder: true, setupPerBendLineEur: 10.0829, familyMultipliers: {}, materialCodes: ["S235"], pricePerBendPerM: 29.7292, benchmarkedMaxLengthMm: 200 };
  const materials = [
    { code: "DC01", family: "mild_steel" },
    { code: "DX51D", family: "mild_steel" },
    { code: "S235", family: "mild_steel" },
    { code: "1.4301", family: "stainless" },
    { code: "1.4404", family: "stainless" },
    { code: "AlMg3", family: "aluminium" },
    { code: "CuZn37", family: "brass" },
  ] as never;
  const rates = { bend: [row15, row2, row3, row5any, row6ph], materials };

  it("the toggle is on by default", () => {
    expect(BEND_FALLBACK_APPLY_FAMILY_FACTOR).toBe(true);
  });

  it("steelBendRowsFor: rows at exactly the thickness whose material list holds a mild-steel code (or no list); placeholders never", () => {
    expect(steelBendRowsFor(rates, 1.5).map((r) => r.id)).toEqual(["row-1.5"]);
    expect(steelBendRowsFor(rates, 2).map((r) => r.id)).toEqual(["row-2"]);
    expect(steelBendRowsFor(rates, 3).map((r) => r.id)).toEqual(["row-3"]);
    expect(steelBendRowsFor(rates, 5).map((r) => r.id)).toEqual(["row-5"]); // material_codes null = generic row
    expect(steelBendRowsFor(rates, 6)).toEqual([]); // placeholder
    expect(steelBendRowsFor(rates, 4)).toEqual([]); // no nearest thickness
    expect(steelBendRowsFor(rates, 1.502)).toEqual([]); // beyond the 0.001 mm tolerance
    expect(steelBendRowsFor(rates, 1.5008).map((r) => r.id)).toEqual(["row-1.5"]);
    expect(steelBendRowsFor(rates, null)).toEqual([]);
    // a row listing only non-steel materials is not a steel row
    const inoxOnly: BendRate = { ...row15, id: "inox", materialCodes: ["1.4301"] };
    expect(steelBendRowsFor({ bend: [inoxOnly], materials }, 1.5)).toEqual([]);
  });

  it("fallbackFamilyFactor: mild steel 1; the row's own multiplier; else the multiplier of another row (by thickness); else 1", () => {
    expect(fallbackFamilyFactor(rates, row15, "mild_steel")).toBe(1);
    expect(fallbackFamilyFactor(rates, row15, null)).toBe(1);
    expect(fallbackFamilyFactor(rates, row15, "stainless")).toBe(2.233); // own
    expect(fallbackFamilyFactor(rates, row15, "aluminium")).toBe(2.184); // from the 3 mm row
    expect(fallbackFamilyFactor(rates, row3, "stainless")).toBe(2.233); // from the 1.5 mm row
    expect(fallbackFamilyFactor(rates, row2, "aluminium")).toBe(2.184);
    expect(fallbackFamilyFactor(rates, row2, "brass")).toBe(1); // no row of the version knows brass
    expect(fallbackFamilyFactor({ bend: [row2] }, row2, "aluminium")).toBe(1);
  });

  it("resolveBendRateForMaterial: exact row first (own factor), else the steel row with the family factor, else nothing", () => {
    expect(resolveBendRateForMaterial(rates, "DC01", "mild_steel", 1.5, 160)).toMatchObject({ rate: { id: "row-1.5" }, source: "exact", factor: 1, tooLong: false, limitMm: 4400 });
    expect(resolveBendRateForMaterial(rates, "1.4301", "stainless", 1.5, 160)).toMatchObject({ rate: { id: "row-1.5" }, source: "exact", factor: 2.233 });
    expect(resolveBendRateForMaterial(rates, "AlMg3", "aluminium", 3, 160)).toMatchObject({ rate: { id: "row-3" }, source: "exact", factor: 2.184 });
    // AlMg3 1.5: no row lists it → the 1.5 mm steel row × 2.184 (aluminium, from the 3 mm row)
    expect(resolveBendRateForMaterial(rates, "AlMg3", "aluminium", 1.5, 160)).toMatchObject({ rate: { id: "row-1.5" }, source: "steel_fallback", factor: 2.184, tooLong: false, limitMm: 4400 });
    expect(resolveBendRateForMaterial(rates, "AlMg3", "aluminium", 1.5, 160, false).factor).toBe(1);
    expect(resolveBendRateForMaterial(rates, "DX51D", "mild_steel", 2, 160)).toMatchObject({ rate: { id: "row-2" }, source: "steel_fallback", factor: 1 });
    expect(resolveBendRateForMaterial(rates, "1.4404", "stainless", 3, 160)).toMatchObject({ rate: { id: "row-3" }, source: "steel_fallback", factor: 2.233 });
    expect(resolveBendRateForMaterial(rates, "CuZn37", "brass", 2, 160)).toMatchObject({ rate: { id: "row-2" }, source: "steel_fallback", factor: 1 });
    expect(resolveBendRateForMaterial(rates, "CuZn37", "brass", 5, 160)).toMatchObject({ rate: { id: "row-5" }, source: "exact", factor: 1 }); // a row with no material list prices every material
    // the press-brake limit applies to the steel row too
    expect(resolveBendRateForMaterial(rates, "AlMg3", "aluminium", 1.5, 4500)).toEqual({ rate: null, tooLong: true, limitMm: 4400, source: null, factor: 1 });
    // no steel row at the thickness (none, or only a placeholder) → not benchmarked, no nearest thickness
    expect(resolveBendRateForMaterial(rates, "AlMg3", "aluminium", 1, 160)).toEqual({ rate: null, tooLong: false, limitMm: null, source: null, factor: 1 });
    expect(resolveBendRateForMaterial(rates, "S235", "mild_steel", 4, 160)).toEqual({ rate: null, tooLong: false, limitMm: null, source: null, factor: 1 });
    expect(resolveBendRateForMaterial(rates, "1.4404", "stainless", 6, 160).rate).toBeNull();
    expect(resolveBendRateForMaterial(rates, null, null, 1.5, 160)).toMatchObject({ rate: { id: "row-1.5" }, source: "steel_fallback", factor: 1 });
    expect(resolveBendRateForMaterial(rates, "AlMg3", "aluminium", null, 160).rate).toBeNull();
  });
});
