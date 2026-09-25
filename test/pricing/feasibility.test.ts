/**
 * Feasibility rules — every rule from build prompt Step 9 / spec §8 with
 * synthetic parts, including the definition-of-done scenarios (Step 14
 * items 2 and 4).
 * File path: /test/pricing/feasibility.test.ts
 */

import { describe, expect, it } from "vitest";
import { evaluatePartFlags, evaluateQuoteFlags } from "@/lib/pricing/feasibility";
import type {
  Flag,
  FlagCode,
  MachinePark,
  OperationLine,
  PricingItem,
  PricingPart,
  RateSnapshot,
} from "@/lib/pricing/types";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { make200005Like, make200164Like } from "@/test/helpers/parts";
import { makeItem, makePricingPart } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, cloneSnapshot } from "@/test/helpers/rates";

function flagsFor(
  part: PricingPart,
  itemOverrides: Partial<PricingItem> = {},
  rates: RateSnapshot = RATE_SNAPSHOT_V1,
  machines: MachinePark = MACHINE_PARK
): Flag[] {
  return evaluatePartFlags(part, makeItem({ partId: part.id, ...itemOverrides }), rates, machines);
}

const codes = (flags: Flag[]): FlagCode[] => flags.map((f) => f.code);
const find = (flags: Flag[], code: FlagCode): Flag | undefined => flags.find((f) => f.code === code);
const reds = (flags: Flag[]): Flag[] => flags.filter((f) => f.severity === "red");

function rect(
  lengthMm: number,
  widthMm: number,
  thicknessMm: number | null,
  materialCode: string | null,
  extra: Partial<Parameters<typeof makeRectPartGeometry>[0]> = {},
  partOverrides: Partial<PricingPart> = {}
): PricingPart {
  const geometry = makeRectPartGeometry({ lengthMm, widthMm, thicknessMm, densityKgM3: 7850, ...extra });
  return makePricingPart({ geometry, materialCode, thicknessMm, ...partOverrides });
}

describe("geometry / intake flags", () => {
  it("manual geometry is an overridable amber", () => {
    const part = rect(100, 100, 2, "S235", { source: "manual" });
    const f = find(flagsFor(part), "geometry.manual");
    expect(f?.severity).toBe("amber");
    expect(f?.overridable).toBe(true);
    expect(f?.partId).toBe("part-1");
    expect(f?.itemId).toBe("item-1");
  });

  it("amber_units → units_unconfirmed until the user confirms", () => {
    const part = rect(100, 100, 2, "S235", { triage: { state: "amber_units", reasons: ["units_missing"] } });
    expect(find(flagsFor(part), "geometry.units_unconfirmed")?.params.state).toBe("amber_units");
    const confirmed = { ...part, annotations: makeAnnotations({ unitsConfirmed: true }) };
    expect(codes(flagsFor(confirmed)).filter((c) => c.startsWith("geometry."))).toEqual([]);
  });

  it("amber_forming_unknown → triage_amber until forming is chosen", () => {
    const part = rect(100, 100, 2, "S235", { triage: { state: "amber_forming_unknown" } });
    expect(find(flagsFor(part), "geometry.triage_amber")?.params.state).toBe("amber_forming_unknown");
    const answered = { ...part, annotations: makeAnnotations({ forming: "flat" }) };
    expect(find(flagsFor(answered), "geometry.triage_amber")).toBeUndefined();
  });

  it("amber_bend_candidates → triage_amber until every candidate has a role", () => {
    const part = rect(100, 100, 2, "S235", {
      triage: { state: "amber_bend_candidates", candidateEntityIds: ["a", "b"] },
    });
    const half = { ...part, annotations: makeAnnotations({ entities: { a: { role: "bend_up" } } }) };
    expect(find(flagsFor(half), "geometry.triage_amber")?.params.count).toBe(1);
    const all = {
      ...part,
      annotations: makeAnnotations({ entities: { a: { role: "bend_up" }, b: { role: "ignore" } } }),
    };
    expect(find(flagsFor(all), "geometry.triage_amber")).toBeUndefined();
  });

  it("red triage blocks and is not overridable", () => {
    const part = rect(100, 100, 2, "S235", { triage: { state: "red_drawing_sheet" } });
    const f = find(flagsFor(part), "geometry.triage_red");
    expect(f?.severity).toBe("red");
    expect(f?.overridable).toBe(false);
    expect(f?.params.state).toBe("red_drawing_sheet");
  });

  it("missing or unknown material and missing thickness are red", () => {
    expect(find(flagsFor(rect(100, 100, 2, null)), "geometry.no_material")?.severity).toBe("red");
    expect(find(flagsFor(rect(100, 100, 2, "X99")), "geometry.no_material")?.params.code).toBe("X99");
    const noT = rect(100, 100, null, "S235");
    expect(find(flagsFor(noT), "geometry.no_thickness")?.severity).toBe("red");
    // nothing that needs a thickness fires without one
    expect(codes(flagsFor(noT)).filter((c) => c.startsWith("laser.") || c.startsWith("material."))).toEqual([]);
  });
});

describe("flat laser", () => {
  it("Step 14 (2): 500 × 220 in 15 mm S355 → amber thickness_over_limit with limit 12.7", () => {
    const part = makePricingPart({ geometry: make200005Like(), materialCode: "S355", thicknessMm: 15 });
    const flags = flagsFor(part);
    const f = find(flags, "laser.thickness_over_limit");
    expect(f?.severity).toBe("amber");
    expect(f?.overridable).toBe(true);
    expect(f?.params).toMatchObject({
      limitMm: 12.7,
      thicknessMm: 15,
      family: "mild_steel",
      rowThicknessMm: 15,
    });
    expect(reds(flags)).toEqual([]);
    expect(find(flags, "laser.blank_exceeds_bed")).toBeUndefined();
  });

  it("no in-house or supplier row → red no_rate_row", () => {
    const part = makePricingPart({ geometry: make200005Like(), materialCode: "DC01", thicknessMm: 15 });
    const f = find(flagsFor(part), "laser.no_rate_row");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ materialCode: "DC01", thicknessMm: 15, limitMm: 12.7 });
  });

  it("allowed thickness priced by a supplier row → amber subcontract", () => {
    const part = rect(100, 100, 2.5, "S355");
    const f = find(flagsFor(part), "laser.subcontract");
    expect(f?.severity).toBe("amber");
    expect(f?.params).toMatchObject({ thicknessMm: 2.5, rowThicknessMm: 15, reason: "supplier_row" });
  });

  it("blank larger than the usable bed in both orientations is red", () => {
    // blank 3020 × 1020 vs usable 2980 × 1480
    expect(find(flagsFor(rect(3000, 1000, 5, "S235")), "laser.blank_exceeds_bed")?.params).toMatchObject({
      blankLengthMm: 3020,
      blankWidthMm: 1020,
      bedLengthMm: 3000,
      bedWidthMm: 1500,
      edgeMarginMm: 10,
    });
    expect(find(flagsFor(rect(2950, 1450, 5, "S235")), "laser.blank_exceeds_bed")).toBeUndefined();
    // rotated fits
    expect(find(flagsFor(rect(1450, 2950, 5, "S235")), "laser.blank_exceeds_bed")).toBeUndefined();
    expect(find(flagsFor(rect(1500, 2950, 5, "S235")), "laser.blank_exceeds_bed")?.severity).toBe("red");
  });

  it("the bed check does not apply to subcontracted cutting", () => {
    const part = rect(3500, 1000, 15, "S355");
    const flags = flagsFor(part);
    expect(find(flags, "laser.blank_exceeds_bed")).toBeUndefined();
    expect(find(flags, "laser.thickness_over_limit")).toBeDefined();
  });

  it("slow contours are a green info with count and factor", () => {
    const part = makePricingPart({ geometry: make200164Like(), materialCode: "DC01", thicknessMm: 2 });
    const f = find(flagsFor(part), "laser.slow_contours");
    expect(f?.severity).toBe("green");
    expect(f?.overridable).toBe(false);
    expect(f?.params).toMatchObject({ count: 32, factor: 1.5 });
    expect(f?.params.lengthMm).toBeCloseTo(30 * Math.PI * 5.5 + 2 * Math.PI * 8.5, 6);
  });

  it("the laser row's minContourMm overrides the 10 × t threshold", () => {
    const snap = cloneSnapshot();
    const row = snap.laser.find((r) => r.materialCode === "DC01" && r.thicknessMm === 2);
    if (row) row.minContourMm = 6;
    const part = makePricingPart({ geometry: make200164Like(), materialCode: "DC01", thicknessMm: 2 });
    const f = find(flagsFor(part, {}, snap), "laser.slow_contours");
    expect(f?.params).toMatchObject({ count: 30, thresholdMm: 6 });
  });

  it("without a flat laser in the park every cut is subcontract", () => {
    const park = MACHINE_PARK.filter((m) => m.kind !== "flat_laser");
    const part = rect(100, 100, 12, "S355");
    const f = find(flagsFor(part, {}, RATE_SNAPSHOT_V1, park), "laser.subcontract");
    expect(f?.params.reason).toBe("no_machine");
  });
});

describe("material", () => {
  it("no price band → red material.no_price", () => {
    const snap = cloneSnapshot();
    const s235 = snap.materials.find((m) => m.code === "S235");
    if (s235) s235.pricePerKg = [];
    const f = find(flagsFor(rect(100, 100, 2, "S235"), {}, snap), "material.no_price");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ code: "S235", thicknessMm: 2 });
  });

  it("part mass above the handling limit is a green suggestion", () => {
    const heavy = rect(1000, 1000, 15, "S355");
    const f = find(flagsFor(heavy), "material.mass_handling");
    expect(f?.severity).toBe("green");
    expect(f?.params.massKg).toBeCloseTo(117.75, 6);
    expect(f?.params.limitKg).toBe(25);
    const light = makePricingPart({ geometry: make200164Like(), materialCode: "DC01", thicknessMm: 2 });
    expect(find(flagsFor(light), "material.mass_handling")).toBeUndefined();
  });
});

describe("press brake", () => {
  it("Step 14 (4): a 4 m bend in 12 mm S355 → red force_over_limit (≈ 4.35 MN > 3.2 MN)", () => {
    const part = rect(4000, 300, 12, "S355", {
      bendLines: [{ id: "long", x1: 0, y1: 150, x2: 4000, y2: 150, direction: "up" }],
    });
    const f = find(flagsFor(part), "bend.force_over_limit");
    expect(f?.severity).toBe("red");
    expect(f?.overridable).toBe(false);
    expect(f?.params.forceKN).toBeCloseTo(4345.2, 6);
    expect(f?.params).toMatchObject({ limitKN: 3200, bendId: "long", lengthMm: 4000, dieVMm: 96, rmNmm2: 510 });
    expect(find(flagsFor(part), "bend.length_over_limit")).toBeUndefined();
  });

  it("3 mm S235 over 4 m stays under the force limit (spec §8.3 table)", () => {
    const part = rect(4000, 300, 3, "S235", {
      bendLines: [{ x1: 0, y1: 150, x2: 4000, y2: 150, direction: "up" }],
    });
    expect(find(flagsFor(part), "bend.force_over_limit")).toBeUndefined();
  });

  it("bend longer than the machine → red length_over_limit", () => {
    const part = rect(4500, 300, 3, "S235", {
      bendLines: [{ id: "b", x1: 0, y1: 150, x2: 4500, y2: 150, direction: "up" }],
    });
    expect(find(flagsFor(part), "bend.length_over_limit")?.params).toMatchObject({
      bendId: "b",
      lengthMm: 4500,
      limitMm: 4420,
    });
  });

  it("Step 14 (4): a hole edge 5 mm from a bend line in 8 mm → amber hole_near_bend (min 20)", () => {
    const part = rect(300, 200, 8, "S235", {
      holes: [{ x: 165, y: 100, diameterMm: 20 }],
      bendLines: [{ id: "mid", x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }],
    });
    const flags = flagsFor(part);
    const f = find(flags, "bend.hole_near_bend");
    expect(f?.severity).toBe("amber");
    expect(f?.overridable).toBe(true);
    expect(f?.params.distanceMm).toBeCloseTo(5, 9);
    expect(f?.params).toMatchObject({ minMm: 20, bendId: "mid", count: 1, loopIds: "loop-hole-1" });
    expect(find(flags, "bend.hole_crosses_bend")).toBeUndefined();
    expect(find(flags, "bend.short_flange")).toBeUndefined();
  });

  it("a hole crossing the bend line is red", () => {
    const part = rect(300, 200, 8, "S235", {
      holes: [{ x: 155, y: 100, diameterMm: 20 }],
      bendLines: [{ id: "mid", x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }],
    });
    const f = find(flagsFor(part), "bend.hole_crosses_bend");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ bendId: "mid", count: 1, loopIds: "loop-hole-1" });
  });

  it("holes beside the bend's span or far away do not fire", () => {
    const beside = rect(300, 200, 8, "S235", {
      holes: [{ x: 155, y: 150, diameterMm: 20 }],
      bendLines: [{ x1: 150, y1: 0, x2: 150, y2: 100, direction: "up" }],
    });
    const far = rect(300, 200, 8, "S235", {
      holes: [{ x: 250, y: 100, diameterMm: 20 }],
      bendLines: [{ x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }],
    });
    for (const part of [beside, far]) {
      const flags = flagsFor(part);
      expect(find(flags, "bend.hole_near_bend")).toBeUndefined();
      expect(find(flags, "bend.hole_crosses_bend")).toBeUndefined();
    }
  });

  it("holes are aggregated per bend with the smallest distance", () => {
    const part = rect(300, 200, 8, "S235", {
      holes: [
        { x: 165, y: 50, diameterMm: 20 },
        { x: 172, y: 150, diameterMm: 20 },
      ],
      bendLines: [{ id: "mid", x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }],
    });
    const f = find(flagsFor(part), "bend.hole_near_bend");
    expect(f?.params).toMatchObject({ count: 2, loopIds: "loop-hole-1,loop-hole-2" });
    expect(f?.params.distanceMm).toBeCloseTo(5, 9);
  });

  it("a flange shorter than V/2 + r + 2 is amber", () => {
    const part = rect(100, 50, 2, "S235", {
      bendLines: [{ id: "edge", x1: 5, y1: 0, x2: 5, y2: 50, direction: "up" }],
    });
    const f = find(flagsFor(part), "bend.short_flange");
    expect(f?.severity).toBe("amber");
    expect(f?.params.flangeMm).toBeCloseTo(5, 9);
    expect(f?.params).toMatchObject({ minMm: 12, bendId: "edge", dieVMm: 16, radiusMm: 2 });
  });

  it("two close parallel bends form a short flange between them", () => {
    const part = rect(100, 50, 2, "S235", {
      bendLines: [
        { id: "a", x1: 46, y1: 0, x2: 46, y2: 50, direction: "up" },
        { id: "b", x1: 54, y1: 0, x2: 54, y2: 50, direction: "up" },
      ],
    });
    const shorts = flagsFor(part).filter((f) => f.code === "bend.short_flange");
    expect(shorts).toHaveLength(2);
    for (const f of shorts) expect(f.params.flangeMm).toBeCloseTo(8, 9);
  });

  it("annotations.bends replace the geometry bend lines and carry the user's die and radius", () => {
    const geometry = makeRectPartGeometry({
      lengthMm: 100,
      widthMm: 50,
      thicknessMm: 2,
      densityKgM3: 7850,
      bendLines: [{ x1: 5, y1: 0, x2: 5, y2: 50, direction: "up" }],
    });
    const part = makePricingPart({
      geometry,
      materialCode: "S235",
      thicknessMm: 2,
      annotations: makeAnnotations({
        bends: [
          {
            id: "ann-1",
            entityId: null,
            start: { x: 8, y: 0 },
            end: { x: 8, y: 50 },
            lengthMm: 50,
            angleDeg: 90,
            radiusMm: 1,
            direction: "down",
            dieVMm: 8,
          },
        ],
      }),
    });
    // min flange with V 8, r 1 = 4 + 1 + 2 = 7 < 8 → no short flange
    const flags = flagsFor(part);
    expect(find(flags, "bend.short_flange")).toBeUndefined();
    // and no flag refers to the geometry's bend id
    expect(flags.some((f) => f.params.bendId === "bend-1")).toBe(false);
  });

  it("no bend rate row for the thickness → amber no_rate_row", () => {
    const part = rect(100, 100, 25, "S355", {
      bendLines: [{ id: "b", x1: 50, y1: 0, x2: 50, y2: 100, direction: "up" }],
    });
    const f = find(flagsFor(part), "bend.no_rate_row");
    expect(f?.severity).toBe("amber");
    expect(f?.params).toMatchObject({ bendId: "b", thicknessMm: 25, lengthMm: 100 });
  });

  it("candidate bend lines awaiting an answer are ignored", () => {
    const part = rect(100, 50, 2, "S235", {
      bendLines: [{ x1: 5, y1: 0, x2: 5, y2: 50, direction: "unknown", source: "candidate" }],
    });
    expect(codes(flagsFor(part)).filter((c) => c.startsWith("bend."))).toEqual([]);
  });

  it("without a press brake the force/length/flange rules are skipped but hole checks run", () => {
    const park = MACHINE_PARK.filter((m) => m.kind !== "press_brake");
    const part = rect(4500, 300, 12, "S355", {
      holes: [{ x: 2000, y: 165, diameterMm: 20 }],
      bendLines: [{ x1: 0, y1: 150, x2: 4500, y2: 150, direction: "up" }],
    });
    const flags = flagsFor(part, {}, RATE_SNAPSHOT_V1, park);
    expect(find(flags, "bend.force_over_limit")).toBeUndefined();
    expect(find(flags, "bend.length_over_limit")).toBeUndefined();
    expect(find(flags, "bend.short_flange")).toBeUndefined();
    expect(find(flags, "bend.hole_near_bend")?.params.distanceMm).toBeCloseTo(5, 9);
  });

  it("the 200164-like part has no bend warnings", () => {
    const part = makePricingPart({ geometry: make200164Like(), materialCode: "DC01", thicknessMm: 2 });
    expect(codes(flagsFor(part)).filter((c) => c.startsWith("bend."))).toEqual([]);
  });
});

describe("rolling", () => {
  const rolled = (t: number, radiusMm: number, axisLengthMm = 1000): PricingPart =>
    makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 1000, widthMm: 500, thicknessMm: t, densityKgM3: 7850 }),
      materialCode: "S235",
      thicknessMm: t,
      annotations: makeAnnotations({
        roll: { radiusMm, axis: "x", arcAngleDeg: 90, axisLengthMm, developedWidthMm: 500, cone: null },
      }),
    });

  it("Step 14 (4): a rolled part in 8 mm → red thickness_over_limit", () => {
    const f = find(flagsFor(rolled(8, 500)), "roll.thickness_over_limit");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ thicknessMm: 8, maxThicknessMm: 6 });
  });

  it("radius 150 → red radius_too_small", () => {
    const f = find(flagsFor(rolled(4, 150)), "roll.radius_too_small");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ radiusMm: 150, minRadiusMm: 200 });
  });

  it("axis longer than the roll → red axis_too_long", () => {
    const f = find(flagsFor(rolled(4, 500, 3500)), "roll.axis_too_long");
    expect(f?.params).toMatchObject({ axisLengthMm: 3500, maxWidthMm: 3200 });
  });

  it("a feasible roll has no roll flags; a missing rate row is amber", () => {
    expect(codes(flagsFor(rolled(4, 500))).filter((c) => c.startsWith("roll."))).toEqual([]);
    const snap = cloneSnapshot();
    snap.roll = [];
    const f = find(flagsFor(rolled(4, 500), {}, snap), "roll.no_rate_row");
    expect(f?.severity).toBe("amber");
    expect(f?.params).toMatchObject({ thicknessMm: 4, radiusMm: 500 });
  });
});

describe("welding, tube, threads, features, finishes", () => {
  const welded = (process: "mig_mag" | "tig"): PricingPart =>
    makePricingPart({
      geometry: make200164Like(),
      materialCode: "DC01",
      thicknessMm: 2,
      annotations: makeAnnotations({
        welds: [
          {
            id: "w1",
            entityIds: ["outer"],
            points: null,
            lengthMm: 554.3,
            process,
            beadMm: 4,
            pattern: "full",
            stitch: null,
            sides: 1,
            effectiveLengthMm: 554.3,
          },
        ],
      }),
    });

  it("weld without a rate row for the process → red", () => {
    const snap = cloneSnapshot();
    snap.weld = snap.weld.filter((r) => r.process !== "tig");
    const f = find(flagsFor(welded("tig"), {}, snap), "weld.no_rate_row");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ weldId: "w1", process: "tig", beadMm: 4 });
    expect(find(flagsFor(welded("mig_mag"), {}, snap), "weld.no_rate_row")).toBeUndefined();
  });

  it("tube limits: wall above the lower manufacturer value and length above the loader", () => {
    const part = rect(100, 100, 3, "S235");
    const wall = flagsFor(part, {
      extras: [{ type: "tube_cut", profileFamily: "round", wallMm: 12, cutLengthMm: 500, metres: 2, pricePerMTube: 5 }],
    });
    const overs = wall.filter((f) => f.code === "tube.over_limit");
    expect(overs).toHaveLength(1);
    expect(overs[0].params).toMatchObject({ what: "wall", value: 12, limit: 10, family: "mild_steel" });
    expect(find(wall, "tube.no_rate_row")?.params).toMatchObject({ profileFamily: "round", wallMm: 12 });
    // a tube part gets no flat-laser flags
    expect(codes(wall).some((c) => c.startsWith("laser."))).toBe(false);

    const long = flagsFor(part, {
      extras: [{ type: "tube_cut", profileFamily: "round", wallMm: 3, cutLengthMm: 500, metres: 7, pricePerMTube: 5 }],
    });
    expect(find(long, "tube.over_limit")?.params).toMatchObject({ what: "length", value: 7000, limit: 6500 });
  });

  it("tube limits: optional envelope, circumscribed circle and mass are checked when given", () => {
    const part = rect(100, 100, 3, "1.4301");
    const flags = flagsFor(part, {
      extras: [
        {
          type: "tube_cut",
          profileFamily: "rectangular",
          wallMm: 3,
          cutLengthMm: 500,
          metres: 6,
          pricePerMTube: 5,
          envelopeMm: 260,
          circumscribedMm: 300,
          kgPerM: 45,
        },
      ],
    });
    const whats = flags.filter((f) => f.code === "tube.over_limit").map((f) => f.params.what);
    expect(whats).toEqual(["envelope", "circumscribed", "kg_per_m", "raw_weight"]);
    const round = flagsFor(part, {
      extras: [{ type: "tube_cut", profileFamily: "round", wallMm: 3, cutLengthMm: 500, metres: 6, pricePerMTube: 5, envelopeMm: 273, kgPerM: 40 }],
    });
    expect(codes(round).filter((c) => c.startsWith("tube."))).toEqual([]);
  });

  it("confirmed threads without a rate row are red; unconfirmed suggestions are ignored", () => {
    const geometry = make200005Like();
    const part = makePricingPart({
      geometry,
      materialCode: "S355",
      thicknessMm: 12,
      annotations: makeAnnotations({ threads: { "loop-hole-1": "M7", "loop-hole-2": "M7", "loop-hole-3": "M8", "loop-hole-4": null } }),
    });
    const f = find(flagsFor(part), "thread.no_rate_row");
    expect(f?.severity).toBe("red");
    expect(f?.params).toMatchObject({ size: "M7", count: 2 });
    expect(flagsFor(part).filter((x) => x.code === "thread.no_rate_row")).toHaveLength(1);
    const suggestionsOnly = makePricingPart({ geometry, materialCode: "S355", thicknessMm: 12 });
    expect(find(flagsFor(suggestionsOnly), "thread.no_rate_row")).toBeUndefined();
  });

  it("features and finishes without a rate row are red", () => {
    const part = rect(100, 100, 2, "S235");
    const flags = flagsFor(part, {
      extras: [
        { type: "feature", code: "nope", count: 2 },
        { type: "feature", code: "countersink", count: 2 },
        { type: "finish", code: "chrome", maskingMinutes: 0, note: null },
      ],
    });
    expect(find(flags, "feature.no_rate_row")?.params).toMatchObject({ code: "nope", index: 0 });
    expect(flags.filter((f) => f.code === "feature.no_rate_row")).toHaveLength(1);
    expect(find(flags, "finish.no_rate_row")?.params).toMatchObject({ code: "chrome", index: 2 });
  });

  it("a finish minimum that kicks in is a green info with the batch numbers", () => {
    const part = rect(100, 100, 2, "S235");
    const extras: PricingItem["extras"] = [{ type: "finish", code: "powder", maskingMinutes: 0, note: null }];
    const f = find(flagsFor(part, { qty: 1, extras }), "finish.minimum_applied");
    expect(f?.severity).toBe("green");
    expect(f?.params).toMatchObject({ code: "powder", minimum: 25, batchCost: 25 });
    expect(f?.params.batchBefore).toBeCloseTo(0.01 * 2 * 14, 9);
    expect(find(flagsFor(part, { qty: 200, extras }), "finish.minimum_applied")).toBeUndefined();
  });

  it("engraving without an engrave finish row is red", () => {
    const part = rect(100, 100, 2, "S235", { engraveLengthMm: 100 });
    expect(find(flagsFor(part), "finish.no_rate_row")).toBeUndefined();
    const snap = cloneSnapshot();
    snap.finish = snap.finish.filter((r) => r.code !== "engrave");
    expect(find(flagsFor(part, {}, snap), "finish.no_rate_row")?.params.code).toBe("engrave");
  });
});

describe("flag contract", () => {
  it("amber flags are overridable, red and green are not; output is deterministic", () => {
    const part = rect(4000, 300, 12, "S355", {
      holes: [{ x: 2000, y: 165 + 10, diameterMm: 20 }],
      bendLines: [{ x1: 0, y1: 150, x2: 4000, y2: 150, direction: "up" }],
      source: "manual",
    });
    const a = flagsFor(part, { extras: [{ type: "finish", code: "powder", maskingMinutes: 0, note: null }] });
    const b = flagsFor(part, { extras: [{ type: "finish", code: "powder", maskingMinutes: 0, note: null }] });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
    for (const f of a) expect(f.overridable).toBe(f.severity === "amber");
    expect(new Set(a.map((f) => f.severity))).toEqual(new Set(["red", "amber", "green"]));
  });
});

describe("evaluateQuoteFlags", () => {
  const line = (label: string, placeholder: boolean, details: OperationLine["details"] = {}): OperationLine => ({
    id: label,
    type: "weld",
    label,
    driverQty: 1,
    driverUnit: "lot",
    rateRef: { table: "rate_weld", key: "x", values: { placeholder } },
    unitCost: 1,
    setupShare: 0,
    auto: true,
    notes: null,
    details,
  });
  const item = (operations: OperationLine[]) => ({
    itemId: "i",
    partId: "p",
    qty: 1,
    operations,
    unitCost: 1,
    unitPrice: 1,
    batchCost: 1,
    batchPrice: 1,
    flags: [],
  });

  it("placeholder rates → one green rates.placeholder with the count", () => {
    const flags = evaluateQuoteFlags({ items: [item([line("a", true), line("b", false)])], welding: null });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "rates.placeholder", severity: "green", partId: null, itemId: null, params: { count: 1 } });
    expect(evaluateQuoteFlags({ items: [item([line("a", false)])], welding: null })).toEqual([]);
  });

  it("minimum order applied → green weld.min_order_applied with the numbers", () => {
    const flags = evaluateQuoteFlags({
      items: [],
      welding: {
        operations: [line("weld_min_order", false, { minOrder: 60, shortfall: 12.5, totalBefore: 47.5 })],
        cost: 60,
        price: 60,
        minOrderApplied: true,
      },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "weld.min_order_applied", params: { minOrder: 60, shortfall: 12.5, totalBefore: 47.5 } });
  });
});
