/**
 * Operations builder — one part × item → OperationLines, with the
 * definition-of-done scenarios (Step 14 items 2 and 3) and every line kind.
 * File path: /test/pricing/operations.test.ts
 */

import { describe, expect, it } from "vitest";
import { PricingError } from "@/lib/pricing/errors";
import { buildItemOperations } from "@/lib/pricing/operations";
import type { OperationLine, PricingItem, PricingPart } from "@/lib/pricing/types";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { make200005Like, make200164Like } from "@/test/helpers/parts";
import { makeItem, makePricingPart } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, cloneSnapshot } from "@/test/helpers/rates";

const HOLES_200164_MM = 30 * Math.PI * 5.5 + 2 * Math.PI * 8.5; // 571.77
const CUT_200164_MM = 2 * (554.3 + 60) + HOLES_200164_MM; // 1800.37
const HOLES_200005_MM = Math.PI * (8 * 6.647 + 6 * 8.917 + 4 * 10 + 6 * 13 + 32); // 806.38
const CUT_200005_MM = 2 * (500 + 220) + HOLES_200005_MM; // 2246.38
const NET_AREA_200164 = 554.3 * 60 - (30 * Math.PI * 2.75 ** 2 + 2 * Math.PI * 4.25 ** 2);

function build(part: PricingPart, itemOverrides: Partial<PricingItem> = {}, rates = RATE_SNAPSHOT_V1) {
  return buildItemOperations(part, makeItem({ partId: part.id, ...itemOverrides }), rates, MACHINE_PARK);
}

const ofType = (ops: OperationLine[], type: OperationLine["type"]) => ops.filter((o) => o.type === type);
const one = (ops: OperationLine[], type: OperationLine["type"]): OperationLine => {
  const found = ofType(ops, type);
  expect(found).toHaveLength(1);
  return found[0];
};

function part200164(): PricingPart {
  return makePricingPart({ geometry: make200164Like(), materialCode: "DC01", thicknessMm: 2 });
}

describe("laser cutting line", () => {
  it("in-house time mode: 200164-like at 16 m/min, 0.3 s pierce, 32 slow contours × 1.5", () => {
    const { operations } = build(part200164());
    const laser = one(operations, "laser_cut");
    expect(laser.id).toBe("item-1:laser");
    expect(laser.label).toBe("laser_cut");
    expect(laser.driverUnit).toBe("min");
    expect(laser.auto).toBe(true);
    expect(laser.rateRef).toMatchObject({ table: "rate_laser", key: "DC01/2" });
    expect(laser.rateRef.values).toMatchObject({ speedMMin: 16, pierceS: 0.3, inHouse: true, machineRateEurH: 70, placeholder: true });
    expect(laser.details.cutLengthMm).toBeCloseTo(CUT_200164_MM, 6);
    expect(laser.details.slowLengthMm).toBeCloseTo(HOLES_200164_MM, 6);
    expect(laser.details.slowCount).toBe(32);
    expect(laser.details.pierces).toBe(33);
    // adjusted = 1800.37 + 571.77 × 0.5 = 2086.25 mm → /16 + 33 × 0.3 / 60 = 0.29539 min
    const adjusted = CUT_200164_MM + HOLES_200164_MM * 0.5;
    const cutTimeMin = adjusted / 1000 / 16 + (33 * 0.3) / 60;
    expect(laser.details.adjustedCutLengthMm).toBeCloseTo(adjusted, 6);
    expect(laser.details.cutTimeMin).toBeCloseTo(cutTimeMin, 9);
    expect(laser.driverQty).toBeCloseTo(cutTimeMin, 9);
    expect(laser.unitCost).toBeCloseTo((cutTimeMin / 60) * 70, 9);
    expect(laser.unitCost).toBeCloseTo(0.344623, 5);
    expect(laser.setupShare).toBe(0);
  });

  it("Step 14 (2): 200005-like at 15 mm S355 becomes subcontract_cutting priced from the supplier row", () => {
    const part = makePricingPart({ geometry: make200005Like(), materialCode: "S355", thicknessMm: 15 });
    const { operations, flags } = build(part);
    expect(ofType(operations, "laser_cut")).toHaveLength(0);
    const sub = one(operations, "subcontract_cutting");
    expect(sub.id).toBe("item-1:subcontract");
    expect(sub.label).toBe("subcontract_cutting");
    expect(sub.driverUnit).toBe("m");
    expect(sub.rateRef).toMatchObject({ table: "rate_laser", key: "S355/15/supplier" });
    expect(sub.rateRef.values).toMatchObject({ inHouse: false, mode: "per_m", pricePerM: 4.5, pricePerPierce: 0.5, machineRateEurH: null });
    expect(sub.details).toMatchObject({ subcontract: true, reason: "over_limit", exactThickness: true, pierces: 26 });
    // Step 9 mode per_m: cost = cutLengthM × €/m + pierces × €/pierce — the PLAIN cut length.
    // Every hole here is < 10 × t = 150 mm, so weighting them would add (1.5 − 1) × 0.806 m × 4.5 = 1.81 € (+7.9 %).
    expect(sub.details.cutLengthMm).toBeCloseTo(CUT_200005_MM, 6);
    expect(sub.details.slowCount).toBe(25);
    expect(sub.details.slowFactorApplied).toBe(false);
    expect(sub.details.adjustedCutLengthMm).toBeCloseTo(CUT_200005_MM, 6);
    expect(sub.unitCost).toBeCloseTo((CUT_200005_MM / 1000) * 4.5 + 26 * 0.5, 9);
    expect(sub.unitCost).toBeCloseTo(23.1087, 3);
    expect(sub.driverQty).toBeCloseTo(CUT_200005_MM / 1000, 12);
    expect(sub.rateRef.values.slowContourFactor).toBeNull();
    expect(flags.find((f) => f.code === "laser.thickness_over_limit")?.params.limitMm).toBe(12.7);
    // the slow-contour info is not raised when the factor is not applied
    expect(flags.some((f) => f.code === "laser.slow_contours")).toBe(false);
  });

  it("an in-house per_m row prices the plain cut length as well; only mode time applies the slow factor", () => {
    const snap = cloneSnapshot();
    const row = snap.laser.find((r) => r.materialCode === "DC01" && r.thicknessMm === 2);
    if (row) Object.assign(row, { mode: "per_m", pricePerM: 1.0, pricePerPierce: 0.05 });
    const { operations, flags } = build(part200164(), {}, snap);
    const laser = one(operations, "laser_cut");
    expect(laser.driverUnit).toBe("m");
    expect(laser.driverQty).toBeCloseTo(CUT_200164_MM / 1000, 12);
    // 1.80037 m × 1.0 + 33 × 0.05 = 3.45037
    expect(laser.unitCost).toBeCloseTo((CUT_200164_MM / 1000) * 1.0 + 33 * 0.05, 9);
    expect(laser.details).toMatchObject({ mode: "per_m", subcontract: false, slowCount: 32, slowFactorApplied: false, cutTimeMin: null });
    expect(laser.rateRef.values).toMatchObject({ machineRateEurH: null, slowContourFactor: null });
    expect(flags.some((f) => f.code === "laser.slow_contours")).toBe(false);

    // the same part on the time row: factor applied, info flag raised
    const timed = build(part200164());
    expect(one(timed.operations, "laser_cut").details.slowFactorApplied).toBe(true);
    expect(one(timed.operations, "laser_cut").rateRef.values.slowContourFactor).toBe(1.5);
    expect(timed.flags.some((f) => f.code === "laser.slow_contours")).toBe(true);
  });

  it("no laser row → no cutting line, red flag instead", () => {
    const part = makePricingPart({ geometry: make200005Like(), materialCode: "DC01", thicknessMm: 15 });
    const { operations, flags } = build(part);
    expect(ofType(operations, "laser_cut")).toHaveLength(0);
    expect(ofType(operations, "subcontract_cutting")).toHaveLength(0);
    expect(flags.some((f) => f.code === "laser.no_rate_row" && f.severity === "red")).toBe(true);
  });

  it("review: 2.5 mm S355 (allowed, no in-house row) is not priced from the 15 mm plasma row — red, no line", () => {
    const part = makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 100, widthMm: 100, thicknessMm: 2.5, densityKgM3: 7850, holes: [{ x: 50, y: 50, diameterMm: 10 }] }),
      materialCode: "S355",
      thicknessMm: 2.5,
    });
    const { operations, flags } = build(part);
    expect(ofType(operations, "subcontract_cutting")).toHaveLength(0);
    expect(ofType(operations, "laser_cut")).toHaveLength(0);
    expect(flags.find((f) => f.code === "laser.no_rate_row")).toMatchObject({ severity: "red", params: { thicknessMm: 2.5, reason: "none" } });
    expect(flags.some((f) => f.code === "laser.subcontract")).toBe(false);
  });

  it("review: 25 mm S355 (above every supplier row) is not priced from the thinner 20 mm row — red, no line", () => {
    const part = makePricingPart({ geometry: make200005Like({ thicknessMm: 25 }), materialCode: "S355", thicknessMm: 25 });
    const { operations, flags } = build(part);
    expect(ofType(operations, "subcontract_cutting")).toHaveLength(0);
    expect(flags.find((f) => f.code === "laser.no_rate_row")).toMatchObject({ severity: "red", params: { thicknessMm: 25, reason: "over_limit" } });
  });

  it("18 mm S355 is priced from the next thicker supplier row (20) and the amber flag shows the mismatch", () => {
    const part = makePricingPart({ geometry: make200005Like({ thicknessMm: 18 }), materialCode: "S355", thicknessMm: 18 });
    const { operations, flags } = build(part);
    const sub = one(operations, "subcontract_cutting");
    expect(sub.rateRef.key).toBe("S355/20/supplier");
    expect(sub.details).toMatchObject({ exactThickness: false, partThicknessMm: 18, rowThicknessMm: 20 });
    expect(sub.unitCost).toBeCloseTo((CUT_200005_MM / 1000) * 6.0 + 26 * 0.7, 9);
    expect(flags.find((f) => f.code === "laser.thickness_over_limit")).toMatchObject({ severity: "amber", params: { thicknessMm: 18, rowThicknessMm: 20 } });
  });
});

describe("material line", () => {
  it("blank from the bbox + rate_general margin, scrap from the material default", () => {
    const { operations } = build(part200164());
    const material = one(operations, "material");
    expect(material.id).toBe("item-1:material");
    expect(material.driverUnit).toBe("kg");
    // blank 574.3 × 80 × 2 × 7850e-9 = 0.7213208 kg
    expect(material.driverQty).toBeCloseTo(0.7213208, 9);
    expect(material.details).toMatchObject({ blankLengthMm: 574.3, blankWidthMm: 80, blankMarginMm: 10, scrapPct: 25, pricePerKg: 1.05 });
    expect(material.details.netMassKg).toBeCloseTo(NET_AREA_200164 * 2 * 7850e-9, 9);
    expect(material.unitCost).toBeCloseTo(0.7213208 * 1.25 * 1.05, 9);
    expect(material.rateRef).toMatchObject({ table: "materials", key: "DC01/<=30" });
    expect(material.rateRef.values).toMatchObject({ densityKgM3: 7850, bandMaxThicknessMm: 30, scrapPct: 25, placeholder: true });
  });

  it("the item's scrap override wins and the thickness band is recorded", () => {
    const snap = cloneSnapshot();
    const s355 = snap.materials.find((m) => m.code === "S355");
    if (s355) s355.pricePerKg = [{ maxThicknessMm: 6, pricePerKg: 1.3 }, { maxThicknessMm: 30, pricePerKg: 1.2 }];
    const part = makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 100, widthMm: 100, thicknessMm: 4, densityKgM3: 7850 }),
      materialCode: "S355",
      thicknessMm: 4,
    });
    const { operations } = build(part, { scrapPct: 10 }, snap);
    const material = one(operations, "material");
    // blank 120 × 120 × 4 × 7850e-9 = 0.45216 kg × 1.10 × 1.30
    expect(material.driverQty).toBeCloseTo(0.45216, 9);
    expect(material.unitCost).toBeCloseTo(0.45216 * 1.1 * 1.3, 9);
    expect(material.rateRef.key).toBe("S355/<=6");
    expect(material.rateRef.values.scrapPctDefault).toBe(25);
  });
});

describe("tube parts", () => {
  const tubePart = makePricingPart({
    geometry: makeRectPartGeometry({ lengthMm: 0, widthMm: 0, thicknessMm: 3, densityKgM3: 7850, source: "manual" }),
    materialCode: "S235",
    thicknessMm: 3,
  });

  it("a tube_cut extra prices setup / qty + €/m of cut + handling, and material per metre from the extra", () => {
    const { operations } = build(tubePart, {
      qty: 10,
      extras: [{ type: "tube_cut", profileFamily: "round", wallMm: 3, cutLengthMm: 500, metres: 2, pricePerMTube: 5 }],
    });
    expect(ofType(operations, "laser_cut")).toHaveLength(0);
    const tube = one(operations, "tube_cut");
    expect(tube.id).toBe("item-1:tube:0");
    // 3.0 × 0.5 + 1.0 + 10 / 10
    expect(tube.unitCost).toBeCloseTo(1.5 + 1 + 1, 12);
    expect(tube.setupShare).toBe(1);
    expect(tube.driverQty).toBe(0.5);
    expect(tube.rateRef).toMatchObject({ table: "rate_tube_laser", key: "round/3" });
    const material = one(operations, "material");
    expect(material.label).toBe("material_tube");
    expect(material.unitCost).toBe(10);
    expect(material.rateRef.table).toBe("manual");
  });

  it("without a tube price per metre there is no tube material line", () => {
    const { operations } = build(tubePart, {
      extras: [{ type: "tube_cut", profileFamily: "round", wallMm: 3, cutLengthMm: 500, metres: 2, pricePerMTube: null }],
    });
    expect(ofType(operations, "material")).toHaveLength(0);
    expect(ofType(operations, "tube_cut")).toHaveLength(1);
  });
});

describe("bending lines", () => {
  it("one line per bend + one setup line spread over the quantity", () => {
    const { operations } = build(part200164(), { qty: 50 });
    const bends = ofType(operations, "bend");
    expect(bends).toHaveLength(4);
    expect(bends.map((b) => b.id)).toEqual([
      "item-1:bend:bend-up-1",
      "item-1:bend:bend-down-1",
      "item-1:bend:bend-down-2",
      "item-1:bend:bend-down-3",
    ]);
    for (const b of bends) {
      expect(b.unitCost).toBe(0.9);
      expect(b.driverUnit).toBe("bend");
      expect(b.rateRef).toMatchObject({ table: "rate_bend", key: "6/500" });
      expect(b.details).toMatchObject({ lengthMm: 60, angleDeg: 90, radiusMm: 2, dieVMm: 16, origin: "geometry" });
      // F = 1.42 × 350 × 4 × 60 / 16 = 7455 N
      expect(b.details.forceN).toBeCloseTo(7455, 6);
    }
    const setup = operations.find((o) => o.label === "bend_setup");
    expect(setup?.type).toBe("setup");
    expect(setup?.unitCost).toBeCloseTo(8 / 50, 12);
    expect(setup?.setupShare).toBeCloseTo(8 / 50, 12);
    expect(setup?.details).toMatchObject({ setup: 8, qty: 50, bendCount: 4 });
  });

  it("annotation bends win over geometry bend lines and carry their own ids, angle and die", () => {
    const part = makePricingPart({
      geometry: make200164Like(),
      materialCode: "DC01",
      thicknessMm: 2,
      annotations: makeAnnotations({
        bends: [
          {
            id: "ann-1",
            entityId: null,
            start: { x: -100, y: -60 },
            end: { x: -100, y: 0 },
            lengthMm: 60,
            angleDeg: 135,
            radiusMm: 3,
            direction: "down",
            dieVMm: 12,
          },
        ],
      }),
    });
    const { operations } = build(part);
    const bends = ofType(operations, "bend");
    expect(bends).toHaveLength(1);
    expect(bends[0].id).toBe("item-1:bend:ann-1");
    expect(bends[0].details).toMatchObject({ angleDeg: 135, radiusMm: 3, dieVMm: 12, direction: "down", origin: "annotation" });
    expect(bends[0].details.forceN).toBeCloseTo((1.42 * 350 * 4 * 60) / 12, 6);
  });

  it("thick plate uses the +50 % class; a bend without a rate is omitted and flagged", () => {
    const thick = makePricingPart({
      geometry: makeRectPartGeometry({
        lengthMm: 1000,
        widthMm: 300,
        thicknessMm: 8,
        densityKgM3: 7850,
        bendLines: [{ x1: 0, y1: 150, x2: 1000, y2: 150, direction: "up" }],
      }),
      materialCode: "S355",
      thicknessMm: 8,
    });
    const bend = one(build(thick).operations, "bend");
    expect(bend.unitCost).toBe(2.4);
    expect(bend.rateRef.key).toBe("20/1500");

    const tooThick = makePricingPart({ ...thick, thicknessMm: 25, geometry: { ...thick.geometry, material: { thicknessMm: 25, densityKgM3: 7850 } } });
    const { operations, flags } = build(tooThick);
    expect(ofType(operations, "bend")).toHaveLength(0);
    expect(operations.some((o) => o.label === "bend_setup")).toBe(false);
    expect(flags.some((f) => f.code === "bend.no_rate_row" && f.severity === "red")).toBe(true);
  });

  it("review: an omitted bend line is always backed by a RED flag, so an override can never ship a 0 € bend", () => {
    // 8 mm S355 cuts in-house; only the bend rows for its thickness class are missing
    const snap = cloneSnapshot();
    snap.bend = snap.bend.filter((r) => r.thicknessMm <= 6);
    const part = makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 1000, widthMm: 300, thicknessMm: 8, densityKgM3: 7850, bendLines: [{ id: "b", x1: 0, y1: 150, x2: 1000, y2: 150, direction: "up" }] }),
      materialCode: "S355",
      thicknessMm: 8,
    });
    const { operations, flags } = build(part, { qty: 5 }, snap);
    expect(operations.map((o) => o.type)).toEqual(["laser_cut", "material"]);
    const reds = flags.filter((f) => f.severity === "red");
    expect(reds).toHaveLength(1);
    expect(reds[0]).toMatchObject({ code: "bend.no_rate_row", overridable: false, params: { bendId: "b", thicknessMm: 8, lengthMm: 1000 } });
  });

  it("review: an omitted roll line is always backed by a RED flag", () => {
    const snap = cloneSnapshot();
    snap.roll = [];
    const part = makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 1000, widthMm: 500, thicknessMm: 4, densityKgM3: 7850 }),
      materialCode: "S235",
      thicknessMm: 4,
      annotations: makeAnnotations({
        roll: { radiusMm: 500, axis: "x", arcAngleDeg: 90, axisLengthMm: 1000, developedWidthMm: 500, cone: null },
      }),
    });
    const { operations, flags } = build(part, { qty: 10 }, snap);
    expect(ofType(operations, "roll")).toHaveLength(0);
    const reds = flags.filter((f) => f.severity === "red");
    expect(reds).toHaveLength(1);
    expect(reds[0]).toMatchObject({ code: "roll.no_rate_row", overridable: false, params: { thicknessMm: 4, radiusMm: 500 } });
  });
});

describe("rolling line", () => {
  it("setup / qty + €/m × axis length, setup share recorded", () => {
    const part = makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 1000, widthMm: 500, thicknessMm: 4, densityKgM3: 7850 }),
      materialCode: "S235",
      thicknessMm: 4,
      annotations: makeAnnotations({
        roll: { radiusMm: 500, axis: "x", arcAngleDeg: 90, axisLengthMm: 1000, developedWidthMm: 500, cone: null },
      }),
    });
    const roll = one(build(part, { qty: 10 }).operations, "roll");
    expect(roll.unitCost).toBeCloseTo(25 / 10 + 12 * 1.0, 12);
    expect(roll.setupShare).toBeCloseTo(2.5, 12);
    expect(roll.driverQty).toBe(1);
    expect(roll.driverUnit).toBe("m");
    expect(roll.rateRef).toMatchObject({ table: "rate_roll", key: "6/3000" });
    expect(roll.details).toMatchObject({ radiusMm: 500, axisLengthMm: 1000, cone: false, qty: 10 });
  });
});

describe("welding lines", () => {
  const weld = (id: string, over: Partial<ReturnType<typeof makeAnnotations>["welds"][number]> = {}) => ({
    id,
    entityIds: ["outer"],
    points: null,
    lengthMm: 554.3,
    process: "mig_mag" as const,
    beadMm: 4,
    pattern: "stitch" as const,
    stitch: { beadLengthMm: 30, pitchMm: 60 },
    sides: 1 as const,
    effectiveLengthMm: 277.15,
    ...over,
  });

  it("Step 14 (3): a 30/60 stitch weld on the 554.3 mm edge in MIG 4 mm, setup over 50", () => {
    const part = { ...part200164(), annotations: makeAnnotations({ welds: [weld("w1")] }) };
    const { operations } = build(part, { qty: 50 });
    const line = one(operations, "weld");
    expect(line.id).toBe("item-1:weld:w1");
    expect(line.driverQty).toBeCloseTo(277.15, 9);
    expect(line.driverUnit).toBe("mm");
    expect(line.unitCost).toBeCloseTo(277.15 * 0.045, 9);
    expect(line.rateRef).toMatchObject({ table: "rate_weld", key: "mig_mag/4" });
    expect(line.details).toMatchObject({ pattern: "stitch", beadLengthMm: 30, pitchMm: 60, sides: 1, lengthMm: 554.3 });
    const setup = operations.find((o) => o.label === "weld_setup");
    expect(setup?.id).toBe("item-1:weld-setup:mig_mag");
    expect(setup?.type).toBe("setup");
    expect(setup?.unitCost).toBeCloseTo(15 / 50, 12);
    expect(setup?.setupShare).toBeCloseTo(15 / 50, 12);
  });

  it("stitch without a pattern uses the default stitch; two sides double; sides are not applied twice", () => {
    const part = {
      ...part200164(),
      annotations: makeAnnotations({
        welds: [weld("w1", { stitch: null, sides: 2, effectiveLengthMm: 999 })],
      }),
    };
    const line = one(build(part).operations, "weld");
    expect(line.driverQty).toBeCloseTo(554.3 * 0.5 * 2, 9);
    expect(line.details).toMatchObject({ beadLengthMm: 30, pitchMm: 60, storedEffectiveLengthMm: 999 });
    expect(line.unitCost).toBeCloseTo(554.3 * 0.045, 9);
  });

  it("one setup line per process used", () => {
    const part = {
      ...part200164(),
      annotations: makeAnnotations({
        welds: [weld("w1"), weld("w2", { process: "tig", pattern: "full", stitch: null }), weld("w3")],
      }),
    };
    const { operations } = build(part, { qty: 2 });
    expect(ofType(operations, "weld")).toHaveLength(3);
    const setups = operations.filter((o) => o.label === "weld_setup");
    expect(setups.map((s) => s.details.process)).toEqual(["mig_mag", "tig"]);
    for (const s of setups) expect(s.unitCost).toBe(7.5);
  });
});

describe("threads", () => {
  it("only confirmed threads are priced, one line per size", () => {
    const geometry = make200005Like();
    const suggestionsOnly = makePricingPart({ geometry, materialCode: "S355", thicknessMm: 12 });
    expect(ofType(build(suggestionsOnly).operations, "thread")).toHaveLength(0);

    const confirmed = makePricingPart({
      geometry,
      materialCode: "S355",
      thicknessMm: 12,
      annotations: makeAnnotations({
        threads: { "loop-hole-1": "M8", "loop-hole-2": "M8", "loop-hole-9": "M10x1", "loop-hole-3": null },
      }),
    });
    const threads = ofType(build(confirmed).operations, "thread");
    expect(threads).toHaveLength(2);
    const m8 = threads.find((t) => t.label === "M8");
    expect(m8?.id).toBe("item-1:thread:M8");
    expect(m8?.driverQty).toBe(2);
    expect(m8?.unitCost).toBeCloseTo(1.8, 12);
    expect(m8?.details.loopIds).toBe("loop-hole-1,loop-hole-2");
    const m10 = threads.find((t) => t.label === "M10x1");
    expect(m10?.unitCost).toBe(1.0);
    expect(m10?.rateRef).toMatchObject({ table: "rate_thread", key: "M10x1" });
  });
});

describe("extras", () => {
  it("features, machining, other and handling", () => {
    const { operations } = build(part200164(), {
      extras: [
        { type: "feature", code: "countersink", count: 3 },
        { type: "machining", minutes: 30, note: "face" },
        { type: "other", label: "Packing crate", unitCost: 4.2 },
        { type: "handling", unitCost: 1.5 },
        { type: "feature", code: "unknown", count: 1 },
      ],
    });
    const feature = one(operations, "feature");
    expect(feature.id).toBe("item-1:feature:0");
    expect(feature.label).toBe("Countersink");
    expect(feature.unitCost).toBeCloseTo(2.4, 12);
    expect(feature.auto).toBe(false);
    const machining = one(operations, "machining");
    expect(machining.unitCost).toBe(30);
    expect(machining.driverUnit).toBe("min");
    expect(machining.notes).toBe("face");
    expect(machining.rateRef).toMatchObject({ table: "rate_general", key: "machining_rate_eur_h" });
    const other = one(operations, "other");
    expect(other.label).toBe("Packing crate");
    expect(other.unitCost).toBe(4.2);
    expect(other.rateRef.table).toBe("manual");
    expect(one(operations, "handling").unitCost).toBe(1.5);
  });

  it("powder: net area × 2 × €/m² + masking labour; zinc by mass with the batch minimum; deburr by cut length", () => {
    const { operations } = build(part200164(), {
      qty: 10,
      extras: [
        { type: "finish", code: "powder", maskingMinutes: 2, note: "RAL 9005" },
        { type: "finish", code: "zinc", maskingMinutes: 0, note: null },
        { type: "finish", code: "deburr", maskingMinutes: 0, note: null },
      ],
    });
    const powder = one(operations, "finish_powder");
    const areaM2 = NET_AREA_200164 / 1e6;
    expect(powder.driverQty).toBeCloseTo(areaM2, 12);
    expect(powder.driverUnit).toBe("m2");
    // 0.0324 m² × 2 × 14 + 2 min / 60 × 35 = 2.0748 per part → × 10 = 20.75 < 25 minimum → 2.50 per part
    expect(powder.details.unitCostBeforeMinimum).toBeCloseTo(areaM2 * 2 * 14 + (2 / 60) * 35, 9);
    expect(powder.details.maskingCost).toBeCloseTo((2 / 60) * 35, 9);
    expect(powder.unitCost).toBeCloseTo(2.5, 12);
    expect(powder.details).toMatchObject({ maskingMinutes: 2, minimumApplied: true, batchCost: 25 });
    expect(powder.notes).toBe("RAL 9005");
    expect(powder.label).toBe("Powder coating");

    const zinc = one(operations, "finish_zinc");
    const massKg = NET_AREA_200164 * 2 * 7850e-9;
    expect(zinc.driverQty).toBeCloseTo(massKg, 9);
    // 0.509 kg × 1.20 × 10 = 6.11 < 30 → unit cost raised to 3.00
    expect(zinc.details.unitCostBeforeMinimum).toBeCloseTo(massKg * 1.2, 9);
    expect(zinc.details.minimumApplied).toBe(true);
    expect(zinc.unitCost).toBeCloseTo(3, 12);

    const deburr = one(operations, "finish_deburr");
    expect(deburr.driverQty).toBeCloseTo(CUT_200164_MM / 1000, 9);
    expect(deburr.unitCost).toBeCloseTo((CUT_200164_MM / 1000) * 0.4, 9);
  });

  it("engraving comes from the geometry's tagged length via the engrave finish row", () => {
    const part = makePricingPart({
      geometry: makeRectPartGeometry({ lengthMm: 100, widthMm: 100, thicknessMm: 2, densityKgM3: 7850, engraveLengthMm: 250 }),
      materialCode: "S235",
      thicknessMm: 2,
    });
    const engrave = one(build(part).operations, "engrave");
    expect(engrave.id).toBe("item-1:engrave");
    expect(engrave.driverQty).toBe(0.25);
    expect(engrave.unitCost).toBe(0.25);
    expect(engrave.rateRef).toMatchObject({ table: "rate_finish", key: "engrave" });
  });
});

describe("contract", () => {
  it("line order is laser, material, bends, setup, roll, welds, weld setup, threads, extras, engrave", () => {
    const part = makePricingPart({
      geometry: make200164Like(),
      materialCode: "DC01",
      thicknessMm: 2,
      annotations: makeAnnotations({
        welds: [
          { id: "w", entityIds: [], points: null, lengthMm: 100, process: "mig_mag", beadMm: 4, pattern: "full", stitch: null, sides: 1, effectiveLengthMm: 100 },
        ],
        threads: { "loop-hole-1": "M5" },
      }),
    });
    const { operations } = build(part, { extras: [{ type: "machining", minutes: 5, note: null }] });
    expect(operations.map((o) => o.type)).toEqual([
      "laser_cut",
      "material",
      "bend",
      "bend",
      "bend",
      "bend",
      "setup",
      "weld",
      "setup",
      "thread",
      "machining",
    ]);
  });

  it("rejects qty ≤ 0 with a typed error and is deterministic", () => {
    expect(() => build(part200164(), { qty: 0 })).toThrow(PricingError);
    try {
      build(part200164(), { qty: -3 });
    } catch (e) {
      expect((e as PricingError).code).toBe("invalid_qty");
    }
    expect(build(part200164(), { qty: 7 })).toEqual(build(part200164(), { qty: 7 }));
  });
});
