/**
 * Forming operations: feasibility against the machine park (roll radius /
 * width / thickness, press-brake length and force), the resolutions
 * (in house, step bend, subcontract, none needed) and their cost drivers,
 * the step-bend hit suggestion, and the "suspected forming" hint.
 * File path: /lib/pricing/forming.test.ts
 */
import { describe, expect, it } from "vitest";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeForming, makePricingPart } from "@/test/helpers/quote";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";
import { assessForming, formingFeasibility, formingHint, formingSuspected, rollArcLengthMm, suggestedStepBendHits } from "./forming";
import type { FormingOperation } from "./types";

const ctx = (thicknessMm: number | null, materialCode: string | null = "S235") => ({
  thicknessMm,
  materialCode,
  machines: MACHINE_PARK,
  partId: "p7",
  itemId: "i7",
  rates: RATE_SNAPSHOT_V1,
  jobRates: JOB_RATES,
});

describe("formingFeasibility", () => {
  it("roll R90 on 2 mm × 247 wide → not feasible (min radius 200); R250 → feasible", () => {
    expect(formingFeasibility(makeForming({ insideRadiusMm: 90, angleDeg: 180, widthMm: 247 }), ctx(2))).toEqual({ feasible: false, reason: "min_radius", value: 90, limit: 200 });
    expect(formingFeasibility(makeForming({ insideRadiusMm: 250 }), ctx(2))).toEqual({ feasible: true });
    expect(formingFeasibility(makeForming({ insideRadiusMm: 200 }), ctx(2))).toEqual({ feasible: true });
  });

  it("roll: thickness above 6 mm and width above 3 200 mm are not feasible; no roll in the park → no_machine", () => {
    expect(formingFeasibility(makeForming({ insideRadiusMm: 300 }), ctx(8))).toEqual({ feasible: false, reason: "max_thickness", value: 8, limit: 6 });
    expect(formingFeasibility(makeForming({ insideRadiusMm: 300, widthMm: 3500 }), ctx(3))).toEqual({ feasible: false, reason: "max_width", value: 3500, limit: 3200 });
    expect(formingFeasibility(makeForming({ insideRadiusMm: 300 }), { ...ctx(3), machines: MACHINE_PARK.filter((m) => m.kind !== "roll") })).toMatchObject({ feasible: false, reason: "no_machine" });
  });

  it("bend: length above 4 420 mm → not feasible; the 3 200 kN force rule (1.42 × Rm × t² × L / V) refuses 20 mm S355 over 4 m; a short bend is feasible", () => {
    expect(formingFeasibility(makeForming({ kind: "bend", lengthMm: 4500 }), ctx(3))).toEqual({ feasible: false, reason: "bend_length", value: 4500, limit: 4420 });
    const heavy = formingFeasibility(makeForming({ kind: "bend", lengthMm: 4000 }), ctx(20, "S355"));
    expect(heavy).toMatchObject({ feasible: false, reason: "force", limit: 3200 });
    // F = 1.42 × 510 × 400 × 4000 / 160 N = 7 242 kN
    expect((heavy as { value: number }).value).toBeCloseTo((1.42 * 510 * 400 * 4000) / 160 / 1000, 6);
    expect(formingFeasibility(makeForming({ kind: "bend", lengthMm: 300 }), ctx(3))).toEqual({ feasible: true });
    // no snapshot → the force rule is skipped, the length rule still runs
    expect(formingFeasibility(makeForming({ kind: "bend", lengthMm: 4000 }), { ...ctx(20, "S355"), rates: null })).toEqual({ feasible: true });
  });
});

describe("suggestedStepBendHits", () => {
  it("R90 over 180° → arc 282.7 mm → 19 hits at the 15 mm pitch; R200 × 90° → 21; zero arc → 0", () => {
    const op = makeForming({ insideRadiusMm: 90, angleDeg: 180 }) as Extract<FormingOperation, { kind: "roll" }>;
    expect(rollArcLengthMm(op)).toBeCloseTo(90 * Math.PI, 9);
    expect(suggestedStepBendHits(op)).toBe(19);
    expect(suggestedStepBendHits(makeForming({ insideRadiusMm: 200, angleDeg: 90 }) as Extract<FormingOperation, { kind: "roll" }>)).toBe(21);
    expect(suggestedStepBendHits(makeForming({ insideRadiusMm: 0, angleDeg: 90 }) as Extract<FormingOperation, { kind: "roll" }>)).toBe(0);
  });
});

describe("assessForming", () => {
  it("an infeasible roll without a resolution → red forming.not_feasible (kind, limit, value), unresolved, nothing priced", () => {
    const a = assessForming([makeForming({ insideRadiusMm: 90, angleDeg: 180, widthMm: 247 })], ctx(2));
    expect(a.unresolved).toBe(true);
    expect(a.labourMin).toBe(0);
    expect(a.usesPressBrake).toBe(false);
    expect(a.usesRoll).toBe(false);
    expect(a.flags).toHaveLength(1);
    expect(a.flags[0]).toMatchObject({ code: "forming.not_feasible", severity: "red", overridable: false, partId: "p7", itemId: "i7" });
    expect(a.flags[0].params).toMatchObject({ operation: "roll", kind: "roll", reason: "min_radius", value: 90, limit: 200, materialCode: "S235", thicknessMm: 2 });
    // in_house on an infeasible operation is the same red
    expect(assessForming([makeForming({ resolution: { kind: "in_house" } })], ctx(2)).unresolved).toBe(true);
  });

  it("step_bend with 19 hits → 19 × 25 s = 7.917 min of press-brake labour, amber forming.step_bend { hits }, uses the press brake", () => {
    const a = assessForming([makeForming({ resolution: { kind: "step_bend", hits: 19 } })], ctx(2));
    expect(a.unresolved).toBe(false);
    expect(a.labourMin).toBeCloseTo((19 * 25) / 60, 9);
    expect(a.usesPressBrake).toBe(true);
    expect(a.usesRoll).toBe(false);
    expect(a.flags).toHaveLength(1);
    expect(a.flags[0]).toMatchObject({ code: "forming.step_bend", severity: "amber", overridable: true });
    expect(a.flags[0].params).toMatchObject({ hits: 19, radiusMm: 90, angleDeg: 180 });
    expect(a.charges).toEqual([{ kind: "step_bend", opId: "form-1", hits: 19, minutes: (19 * 25) / 60, radiusMm: 90, angleDeg: 180 }]);
    // 0 hits is not a resolution
    expect(assessForming([makeForming({ resolution: { kind: "step_bend", hits: 0 } })], ctx(2)).unresolved).toBe(true);
  });

  it("subcontract → cost × (1 + 15 %), amber forming.subcontract (supplier, cost, extra lead days), lead days reported", () => {
    const a = assessForming([makeForming({ resolution: { kind: "subcontract", supplier: "Walcownia X", costEur: 40, extraLeadDays: 5 } })], ctx(2));
    expect(a.unresolved).toBe(false);
    expect(a.subcontractCostEur).toBeCloseTo(46, 9);
    expect(a.extraLeadDays).toBe(5);
    expect(a.labourMin).toBe(0);
    expect(a.flags[0]).toMatchObject({ code: "forming.subcontract", severity: "amber" });
    expect(a.flags[0].params).toMatchObject({ operation: "roll", supplier: "Walcownia X", costEur: 40, marginPct: 15, extraLeadDays: 5 });
  });

  it("a feasible roll in house → roll_min_per_m × width: 6 × 0.247 = 1.482 min, uses the roll, no flag; a feasible bend charges nothing but uses the press brake", () => {
    const roll = assessForming([makeForming({ insideRadiusMm: 300, widthMm: 247 })], ctx(3));
    expect(roll.flags).toEqual([]);
    expect(roll.labourMin).toBeCloseTo(6 * 0.247, 9);
    expect(roll.usesRoll).toBe(true);
    expect(roll.usesPressBrake).toBe(false);
    const bend = assessForming([makeForming({ kind: "bend", lengthMm: 300, resolution: { kind: "in_house" } })], ctx(3));
    expect(bend.flags).toEqual([]);
    expect(bend.labourMin).toBe(0);
    expect(bend.usesPressBrake).toBe(true);
    expect(bend.charges).toEqual([{ kind: "bend", opId: "form-1", bends: 1, lengthMm: 300 }]);
  });

  it("none_needed is ignored; no job rates → flags and feasibility only, no minutes", () => {
    expect(assessForming([makeForming({ resolution: { kind: "none_needed" } })], ctx(2))).toMatchObject({ flags: [], unresolved: false, labourMin: 0, charges: [] });
    const a = assessForming([makeForming({ resolution: { kind: "step_bend", hits: 19 } })], { ...ctx(2), jobRates: null });
    expect(a.labourMin).toBe(0);
    expect(a.usesPressBrake).toBe(true);
    expect(a.flags[0].code).toBe("forming.step_bend");
  });
});

describe("formingSuspected", () => {
  const flat = (over: Parameters<typeof makePricingPart>[0] extends infer T ? Partial<T> : never = {}) =>
    makePricingPart({ id: "p", geometry: makeRectPartGeometry({ lengthMm: 200, widthMm: 100, thicknessMm: 2, densityKgM3: 7850 }), materialCode: "S235", thicknessMm: 2, ...over });

  it("a roll annotation or forming 'rolled' is a hint; a ROLL / WALC layer too", () => {
    expect(formingHint(flat({ annotations: makeAnnotations({ roll: { radiusMm: 90, axis: "x", arcAngleDeg: 180, axisLengthMm: 247, developedWidthMm: 283, cone: null } }) }))).toBe("roll_annotation");
    expect(formingHint(flat({ annotations: makeAnnotations({ forming: "rolled" }) }))).toBe("forming_rolled");
    const geometry = makeRectPartGeometry({ lengthMm: 200, widthMm: 100, thicknessMm: 2, densityKgM3: 7850 });
    geometry.header.layers = [...geometry.header.layers, "ROLL_AXIS"];
    expect(formingHint(flat({ geometry }))).toBe("layer_roll");
    expect(formingSuspected(flat({ annotations: makeAnnotations({ forming: "rolled" }) }))).toBe(true);
  });

  it("bend lines are priced by the bend model: not a hint; 'bent' without bend lines is", () => {
    const bent = makeRectPartGeometry({ lengthMm: 200, widthMm: 100, thicknessMm: 2, densityKgM3: 7850, bendLines: [{ x1: 100, y1: 0, x2: 100, y2: 100, direction: "up" }] });
    expect(formingHint(flat({ geometry: bent }))).toBeNull();
    expect(formingHint(flat({ geometry: bent, annotations: makeAnnotations({ forming: "bent" }) }))).toBeNull();
    expect(formingHint(flat({ annotations: makeAnnotations({ forming: "bent" }) }))).toBe("forming_bent");
    expect(formingHint(flat())).toBeNull();
    expect(formingSuspected(flat())).toBe(false);
  });

  it("a forming operation or a none_needed confirmation on the item clears the suspicion", () => {
    const part = flat({ annotations: makeAnnotations({ forming: "rolled" }) });
    expect(formingSuspected(part, [makeForming({})])).toBe(false);
    expect(formingSuspected(part, [makeForming({ resolution: { kind: "none_needed" } })])).toBe(false);
    expect(formingSuspected(part, [])).toBe(true);
    expect(formingSuspected(part, null)).toBe(true);
  });
});
