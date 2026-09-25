/**
 * priceQuote — the definition-of-done scenario (Step 14 item 3), the
 * welding-only minimum order, margin/markup equivalence, totals by type,
 * validation and determinism.
 * File path: /test/pricing/price-quote.test.ts
 */

import { describe, expect, it } from "vitest";
import { PricingError } from "@/lib/pricing/errors";
import { priceQuote, resolveMarginPct } from "@/lib/pricing/price-quote";
import type { OperationType, QuoteInput, WeldingOnlySeam } from "@/lib/pricing/types";
import { makeAnnotations } from "@/test/helpers/geometry";
import { make200164Like } from "@/test/helpers/parts";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID, cloneSnapshot } from "@/test/helpers/rates";

function scenario3(): QuoteInput {
  const part = makePricingPart({
    id: "p-200164",
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
          process: "mig_mag",
          beadMm: 4,
          pattern: "stitch",
          stitch: { beadLengthMm: 30, pitchMm: 60 },
          sides: 1,
          effectiveLengthMm: 277.15,
        },
      ],
    }),
  });
  return makeQuoteInput({
    marginPct: 30,
    parts: [part],
    items: [makeItem({ id: "i1", partId: "p-200164", qty: 50 })],
  });
}

describe("Step 14 (3): 200164-like × 50 with 4 bends and a stitch weld", () => {
  const priced = priceQuote(scenario3(), RATE_SNAPSHOT_V1, MACHINE_PARK);
  const item = priced.items[0];
  const types = item.operations.map((o) => o.type);

  it("shows cutting, material, 4 bends, welding and setup spread over 50 pieces", () => {
    expect(types).toContain("laser_cut");
    expect(types).toContain("material");
    expect(types.filter((t) => t === "bend")).toHaveLength(4);
    expect(types).toContain("weld");
    const setups = item.operations.filter((o) => o.type === "setup");
    expect(setups.map((s) => s.label)).toEqual(["bend_setup", "weld_setup"]);
    expect(setups[0].unitCost).toBeCloseTo(8 / 50, 12);
    expect(setups[1].unitCost).toBeCloseTo(15 / 50, 12);
    for (const s of setups) expect(s.setupShare).toBe(s.unitCost);
  });

  it("unit cost is the sum of the lines; unit price = unit cost / 0.7; batch = × 50", () => {
    const sum = item.operations.reduce((acc, o) => acc + o.unitCost, 0);
    expect(item.unitCost).toBeCloseTo(sum, 12);
    expect(item.unitPrice).toBeCloseTo(item.unitCost / 0.7, 12);
    expect(item.batchCost).toBeCloseTo(item.unitCost * 50, 9);
    expect(item.batchPrice).toBeCloseTo(item.unitPrice * 50, 9);
    // hand total: laser 0.344623 + material 0.946734 + bends 3.60 + 0.16 + weld 12.47175 + 0.30
    expect(item.unitCost).toBeCloseTo(0.344623 + 0.946734 + 3.6 + 0.16 + 12.47175 + 0.3, 4);
    expect(priced.subtotalCost).toBeCloseTo(item.batchCost, 9);
    expect(priced.subtotalPrice).toBeCloseTo(item.batchPrice, 9);
  });

  it("totals by type carry setup in its own bucket and add up to the subtotal", () => {
    const t = priced.totalsByType;
    expect(t.bend?.cost).toBeCloseTo(3.6 * 50, 9);
    expect(t.setup?.cost).toBeCloseTo((8 + 15), 9);
    expect(t.weld?.cost).toBeCloseTo(277.15 * 0.045 * 50, 9);
    expect(t.laser_cut?.cost).toBeCloseTo(0.344623 * 50, 3);
    expect(t.material?.cost).toBeCloseTo(0.946734 * 50, 3);
    const sumCost = (Object.keys(t) as OperationType[]).reduce((acc, k) => acc + (t[k]?.cost ?? 0), 0);
    const sumPrice = (Object.keys(t) as OperationType[]).reduce((acc, k) => acc + (t[k]?.price ?? 0), 0);
    expect(sumCost).toBeCloseTo(priced.subtotalCost, 9);
    expect(sumPrice).toBeCloseTo(priced.subtotalPrice, 9);
    expect(t.bend?.price).toBeCloseTo((t.bend?.cost ?? 0) / 0.7, 9);
  });

  it("carries margin, markup, flags, placeholder state and the rate version", () => {
    expect(priced.marginPct).toBe(30);
    expect(priced.markupPct).toBeCloseTo(42.857142857, 8);
    expect(priced.rateVersionId).toBe(RATE_VERSION_ID);
    expect(priced.usesPlaceholderRates).toBe(true);
    expect(priced.welding).toBeNull();
    expect(priced.flags.some((f) => f.code === "rates.placeholder" && f.partId === null)).toBe(true);
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
    expect(priced.flags.filter((f) => f.severity === "amber")).toEqual([]);
    expect(priced.flags.some((f) => f.code === "laser.slow_contours" && f.itemId === "i1")).toBe(true);
    expect(item.flags.every((f) => f.partId === "p-200164")).toBe(true);
  });

  it("usesPlaceholderRates is false once every used row is confirmed", () => {
    const snap = cloneSnapshot();
    snap.general.placeholder = false;
    for (const list of [snap.materials, snap.laser, snap.bend, snap.weld]) {
      for (const row of list) row.placeholder = false;
    }
    const confirmed = priceQuote(scenario3(), snap, MACHINE_PARK);
    expect(confirmed.usesPlaceholderRates).toBe(false);
    expect(confirmed.flags.some((f) => f.code === "rates.placeholder")).toBe(false);
  });
});

describe("welding-only quotes", () => {
  const seam = (over: Partial<WeldingOnlySeam> = {}): WeldingOnlySeam => ({
    id: "s1",
    label: "Frame seam",
    process: "mig_mag",
    beadMm: 4,
    lengthMm: 500,
    pattern: "full",
    stitch: null,
    sides: 1,
    qty: 1,
    ...over,
  });
  const weldingQuote = (seams: WeldingOnlySeam[], partsCount = 2): QuoteInput =>
    makeQuoteInput({ type: "welding_only", marginPct: 30, weldingOnly: { seams, partsCount } });

  it("below the minimum order: seams + setup + handling are topped up to the minimum", () => {
    const priced = priceQuote(weldingQuote([seam()]), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const w = priced.welding;
    expect(w).not.toBeNull();
    // 500 × 0.045 = 22.5 + setup 15 + handling 2 × 5 = 47.5 → min order 60
    const labels = w?.operations.map((o) => o.label);
    expect(labels).toEqual(["Frame seam", "weld_setup", "weld_handling", "weld_min_order"]);
    expect(w?.operations[0].unitCost).toBeCloseTo(22.5, 12);
    expect(w?.operations[1].unitCost).toBe(15);
    expect(w?.operations[1].setupShare).toBe(15);
    expect(w?.operations[2].unitCost).toBe(10);
    expect(w?.operations[3].unitCost).toBeCloseTo(12.5, 12);
    expect(w?.operations[3].details).toMatchObject({ minOrder: 60, totalBefore: 47.5, shortfall: 12.5 });
    expect(w?.cost).toBe(60);
    expect(w?.price).toBeCloseTo(60 / 0.7, 12);
    expect(w?.minOrderApplied).toBe(true);
    expect(priced.subtotalCost).toBe(60);
    expect(priced.subtotalPrice).toBeCloseTo(60 / 0.7, 12);
    const flag = priced.flags.find((f) => f.code === "weld.min_order_applied");
    expect(flag?.severity).toBe("green");
    expect(flag?.params).toMatchObject({ minOrder: 60, shortfall: 12.5, totalBefore: 47.5 });
    expect(priced.totalsByType.weld?.cost).toBeCloseTo(22.5 + 12.5, 12);
    expect(priced.totalsByType.setup?.cost).toBe(15);
    expect(priced.totalsByType.handling?.cost).toBe(10);
  });

  it("above the minimum: no top-up line, stitch and sides and qty applied", () => {
    const priced = priceQuote(
      weldingQuote([seam({ lengthMm: 1000, pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 60 }, sides: 2, qty: 3 })]),
      RATE_SNAPSHOT_V1,
      MACHINE_PARK
    );
    const w = priced.welding;
    // 1000 × 0.5 × 2 × 3 = 3000 mm × 0.045 = 135 + 15 + 10 = 160
    expect(w?.operations[0].driverQty).toBe(3000);
    expect(w?.operations[0].unitCost).toBeCloseTo(135, 12);
    expect(w?.cost).toBeCloseTo(160, 12);
    expect(w?.minOrderApplied).toBe(false);
    expect(w?.operations.some((o) => o.label === "weld_min_order")).toBe(false);
    expect(priced.flags.some((f) => f.code === "weld.min_order_applied")).toBe(false);
  });

  it("one setup per process; the largest minimum order among the processes applies", () => {
    const snap = cloneSnapshot();
    const tig = snap.weld.find((r) => r.process === "tig");
    if (tig) tig.minOrder = 100;
    const priced = priceQuote(
      weldingQuote([seam(), seam({ id: "s2", process: "tig", lengthMm: 100 })], 0),
      snap,
      MACHINE_PARK
    );
    const w = priced.welding;
    const setups = w?.operations.filter((o) => o.type === "setup") ?? [];
    expect(setups.map((s) => s.details.process)).toEqual(["mig_mag", "tig"]);
    // 22.5 + 9 + 15 + 15 = 61.5 < 100 → top-up 38.5, no handling line for 0 parts
    expect(w?.operations.some((o) => o.label === "weld_handling")).toBe(false);
    expect(w?.cost).toBeCloseTo(100, 12);
    expect(w?.operations.at(-1)?.unitCost).toBeCloseTo(38.5, 12);
  });

  it("a seam without a rate row is a red quote-level flag and is not priced", () => {
    const snap = cloneSnapshot();
    snap.weld = snap.weld.filter((r) => r.process !== "tig");
    const priced = priceQuote(weldingQuote([seam({ process: "tig" })]), snap, MACHINE_PARK);
    expect(priced.welding?.operations).toEqual([]);
    expect(priced.welding?.cost).toBe(0);
    const flag = priced.flags.find((f) => f.code === "weld.no_rate_row");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ seamId: "s1", process: "tig" });
  });
});

describe("margin", () => {
  it("resolveMarginPct: override → customer class → default", () => {
    const snap = cloneSnapshot();
    snap.general.marginByClass = { key_account: 20 };
    expect(resolveMarginPct(snap, "key_account", 25)).toBe(25);
    expect(resolveMarginPct(snap, "key_account", null)).toBe(20);
    expect(resolveMarginPct(snap, "unknown", null)).toBe(30);
    expect(resolveMarginPct(snap, null, undefined)).toBe(30);
    expect(resolveMarginPct(snap, "key_account", Number.NaN)).toBe(20);
  });

  it("30 % margin on price is a 42.857 % markup on cost and the price reflects it", () => {
    const priced = priceQuote(scenario3(), RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(priced.markupPct).toBeCloseTo(42.857142857, 8);
    expect(priced.items[0].unitPrice).toBeCloseTo(priced.items[0].unitCost * (1 + 0.42857142857), 8);
    const zero = priceQuote({ ...scenario3(), marginPct: 0 }, RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(zero.items[0].unitPrice).toBeCloseTo(zero.items[0].unitCost, 12);
    expect(zero.markupPct).toBe(0);
  });
});

describe("validation and determinism", () => {
  it("throws a typed PricingError on qty ≤ 0, margin ≥ 100 and a missing part", () => {
    const base = scenario3();
    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(PricingError);
        return (e as PricingError).code;
      }
      return "no error";
    };
    expect(codeOf(() => priceQuote({ ...base, items: [{ ...base.items[0], qty: 0 }] }, RATE_SNAPSHOT_V1, MACHINE_PARK))).toBe("invalid_qty");
    expect(codeOf(() => priceQuote({ ...base, marginPct: 100 }, RATE_SNAPSHOT_V1, MACHINE_PARK))).toBe("invalid_margin");
    expect(codeOf(() => priceQuote({ ...base, marginPct: Number.NaN }, RATE_SNAPSHOT_V1, MACHINE_PARK))).toBe("invalid_margin");
    expect(codeOf(() => priceQuote({ ...base, items: [{ ...base.items[0], partId: "ghost" }] }, RATE_SNAPSHOT_V1, MACHINE_PARK))).toBe("missing_part");
    expect(codeOf(() => priceQuote(base, RATE_SNAPSHOT_V1, MACHINE_PARK))).toBe("no error");
  });

  it("an empty quote prices to zero without flags", () => {
    const priced = priceQuote(makeQuoteInput(), RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(priced.items).toEqual([]);
    expect(priced.subtotalCost).toBe(0);
    expect(priced.subtotalPrice).toBe(0);
    expect(priced.totalsByType).toEqual({});
    expect(priced.flags).toEqual([]);
    expect(priced.usesPlaceholderRates).toBe(false);
  });

  it("same input → deep-equal output, and the input is not mutated", () => {
    const a = scenario3();
    const b = scenario3();
    const snapshotBefore = JSON.stringify(a);
    const pa = priceQuote(a, RATE_SNAPSHOT_V1, MACHINE_PARK);
    const pb = priceQuote(b, RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(pa).toEqual(pb);
    expect(JSON.stringify(a)).toBe(snapshotBefore);
    expect(JSON.stringify(pa)).toBe(JSON.stringify(priceQuote(a, RATE_SNAPSHOT_V1, MACHINE_PARK)));
  });
});
