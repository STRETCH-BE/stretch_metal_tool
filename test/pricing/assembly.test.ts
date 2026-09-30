/**
 * Assembly mode behaviours beyond the regression case: members vs loose
 * lines, nest de-duplication across loose lines and assemblies, set-ups
 * once per job, material consistency flags, seams (paired, stitch, tack,
 * none), forming.suspected, refused members, VAT / packaging / shipping
 * wiring in both pricing modes, and the legacy path when no job rates are
 * given.
 * File path: /test/pricing/assembly.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PricingError } from "@/lib/pricing/errors";
import { priceAssemblies, partitionItems } from "@/lib/pricing/assembly";
import { priceQuote } from "@/lib/pricing/price-quote";
import { PRICING_ENGINE_VERSION } from "@/lib/pricing/version";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import type { OperationLine, PricingAssembly, PricingItem, PricingPart, QuoteInput } from "@/lib/pricing/types";
import { makeAnnotations, makeRectPartGeometry, type RectBendLine } from "@/test/helpers/geometry";
import { makeAssembly, makeForming, makeItem, makePricingPart, makeQuoteInput, makeSeam } from "@/test/helpers/quote";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };
const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/market-247-v3.json"), "utf8")) as RatesJson;
const { machines: _machineRows, ...rows } = json;
void _machineRows;
const V3 = rowsToRateSnapshot(rows);
const COST = RATE_SNAPSHOT_V1;

type RectOpts = { id: string; lengthMm?: number; widthMm?: number; thicknessMm?: number; materialCode?: string | null; bendLines?: RectBendLine[]; annotations?: Partial<ReturnType<typeof makeAnnotations>> };

function rect(o: RectOpts): PricingPart {
  const t = o.thicknessMm ?? 3;
  return makePricingPart({
    id: o.id,
    name: o.id,
    geometry: makeRectPartGeometry({ lengthMm: o.lengthMm ?? 300, widthMm: o.widthMm ?? 200, thicknessMm: t, densityKgM3: 7850, bendLines: o.bendLines ?? [], blankMarginMm: 0 }),
    materialCode: o.materialCode === undefined ? "S235" : o.materialCode,
    thicknessMm: t,
    annotations: makeAnnotations(o.annotations ?? {}),
  });
}

const byLabel = (ops: readonly OperationLine[], label: string) => ops.filter((o) => o.label === label);
const codes = (priced: { flags: { code: string }[] }) => priced.flags.map((f) => f.code);

const ASM: PricingAssembly = makeAssembly({ id: "A", qty: 2, seams: [makeSeam({ lengthMm: 1000 })] });

function twoMemberInput(extra: Partial<QuoteInput> = {}, items: PricingItem[] = []): QuoteInput {
  return makeQuoteInput({
    marginPct: 30,
    parts: [rect({ id: "p1" }), rect({ id: "p2", thicknessMm: 2 })],
    items: [
      makeItem({ id: "m1", partId: "p1", qty: 2, assemblyId: "A", qtyPerAssembly: 1 }),
      makeItem({ id: "m2", partId: "p2", qty: 4, assemblyId: "A", qtyPerAssembly: 2 }),
      ...items,
    ],
    assemblies: [ASM],
    ...extra,
  });
}

describe("cost mode: members, parts at cost, set-ups spread over the assembly quantity", () => {
  const priced = priceQuote(twoMemberInput(), COST, MACHINE_PARK, { jobRates: JOB_RATES });
  const asm = priced.assemblies[0];

  it("member PricedItems: operations [], unitPrice null, qty = 2 × qtyPerAssembly, unitCost = the cost lines without set-ups", () => {
    const m1 = priced.items.find((i) => i.itemId === "m1")!;
    const m2 = priced.items.find((i) => i.itemId === "m2")!;
    expect([m1.qty, m2.qty]).toEqual([2, 4]);
    expect(m1.operations).toEqual([]);
    expect(m1.unitPrice).toBeNull();
    expect(m1.batchPrice).toBeNull();
    // the same part priced loose in cost mode: laser + material (no set-ups on a flat part) → identical unit cost
    const loose = priceQuote(makeQuoteInput({ marginPct: 30, parts: [rect({ id: "p1" })], items: [makeItem({ id: "x", partId: "p1", qty: 2 })] }), COST, MACHINE_PARK);
    expect(m1.unitCost).toBeCloseTo(loose.items[0].unitCost, 12);
    expect(m1.batchCost).toBeCloseTo(m1.unitCost * 2, 12);
  });

  it("the parts line per member = per-piece cost × qtyPerAssembly; the members are not added to the subtotal again", () => {
    const parts = byLabel(asm.operations, "assembly_parts");
    expect(parts).toHaveLength(2);
    const m2 = priced.items.find((i) => i.itemId === "m2")!;
    const p2 = parts.find((l) => l.details.itemId === "m2")!;
    expect(p2.unitCost).toBeCloseTo(m2.unitCost * 2, 12);
    expect(p2.driverQty).toBe(2);
    expect(p2.type).toBe("material");
    expect(priced.subtotalCost).toBeCloseTo(asm.batchCost + priced.quoteLines[0].unitCost, 9);
    expect(priced.subtotalPrice).toBeCloseTo((asm.batchPrice ?? 0) + priced.quoteLines[0].unitCost, 9);
  });

  it("set-ups: one laser nest per thickness (17.50 ÷ 2 each), weld fit-up once (12.50 ÷ 2), no press brake / roll without bends; setupShare = unitCost", () => {
    const nests = byLabel(asm.operations, "setup_laser_nest");
    expect(nests.map((n) => n.details.nestKey).sort()).toEqual(["S235/2", "S235/3"]);
    for (const n of nests) {
      expect(n.unitCost).toBeCloseTo(8.75, 9);
      expect(n.setupShare).toBeCloseTo(8.75, 9);
    }
    expect(byLabel(asm.operations, "setup_weld_fitup")[0].unitCost).toBeCloseTo(6.25, 9);
    expect(byLabel(asm.operations, "setup_press_brake")).toEqual([]);
    expect(byLabel(asm.operations, "setup_roll")).toEqual([]);
    expect(priced.totalsByType.setup?.cost).toBeCloseTo((17.5 * 2 + 12.5), 9);
  });

  it("labour: fit-up 6 × 3 parts, deburr 1.5 × 3, handling 10, weld 1 000 mm at 100 mm/min (3 mm assembly thickness), × 1.3 on fit-up + weld, 25 €/h, gas 8 €/h", () => {
    const { fitupMin, deburrMin, handlingMin, weldMin, tackMin, totalMin, arcMin } = asm.labour;
    expect(fitupMin).toBe(18);
    expect(deburrMin).toBe(4.5);
    expect(handlingMin).toBe(10);
    expect(weldMin).toBeCloseTo(10, 9);
    expect(tackMin).toBe(0);
    expect(totalMin).toBeCloseTo((18 + 10) * 1.3 + 4.5 + 10, 9);
    expect(arcMin).toBeCloseTo(10, 9);
    const labourEur = ["assembly_fitup", "assembly_weld", "assembly_deburr", "assembly_handling"].flatMap((l) => byLabel(asm.operations, l)).reduce((s, o) => s + o.unitCost, 0);
    expect(labourEur).toBeCloseTo((totalMin / 60) * 25, 9);
    expect(byLabel(asm.operations, "assembly_gas_wire")[0].unitCost).toBeCloseTo((10 / 60) * 8, 9);
    expect(byLabel(asm.operations, "assembly_tack")).toEqual([]);
  });

  it("margin = max(quote margin, assembly margin): 30 vs 30 → 30; a 40 % quote → 40; cost mode keeps the header margin on the quote", () => {
    expect(asm.marginPct).toBe(30);
    expect(asm.unitPrice).toBeCloseTo(asm.unitCost / 0.7, 9);
    const higher = priceQuote(twoMemberInput({ marginPct: 40 }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(higher.assemblies[0].marginPct).toBe(40);
    expect(higher.marginPct).toBe(40);
    const lower = priceQuote(twoMemberInput({ marginPct: 10 }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(lower.assemblies[0].marginPct).toBe(30);
    expect(lower.marginPct).toBe(10);
  });

  it("packaging comes from packaging_rates (carton_foam for 300 mm / ≈ 15 kg gross) and the placeholder job rates mark the quote", () => {
    expect(priced.quoteLines).toHaveLength(1);
    expect(priced.quoteLines[0]).toMatchObject({ type: "packaging", label: "packaging", unitCost: 6.5 });
    expect(priced.quoteLines[0].details.code).toBe("carton_foam");
    expect(priced.usesPlaceholderRates).toBe(true);
    expect(priced.flags.filter((f) => f.code === "rates.placeholder")).toHaveLength(1);
    expect(priced.shipping).toBeNull();
    expect(priced.vat).toBeNull();
    expect(priced.engineVersion).toBe(PRICING_ENGINE_VERSION);
  });
});

describe("nest de-duplication and set-ups once per job", () => {
  it("market mode: a loose S235 3 mm part charges its laser_setup, so the assembly does not charge the S235/3 nest again (only S235/2)", () => {
    const input = twoMemberInput({ marginPct: 0, leadTimeDays: 11, parts: [rect({ id: "p1" }), rect({ id: "p2", thicknessMm: 2 }), rect({ id: "p3" })] }, [makeItem({ id: "loose", partId: "p3", qty: 5 })]);
    const priced = priceQuote(input, V3, MACHINE_PARK, { costRates: COST, jobRates: JOB_RATES });
    const loose = priced.items.find((i) => i.itemId === "loose")!;
    expect(loose.unitPrice).not.toBeNull();
    expect(byLabel(loose.operations, "laser_setup")[0].rateRef.key).toBe("S235/3");
    const nests = byLabel(priced.assemblies[0].operations, "setup_laser_nest");
    expect(nests.map((n) => n.details.nestKey)).toEqual(["S235/2"]);
    // the loose line's order charge is split over the loose pieces only
    expect(byLabel(loose.operations, "order_charge")[0].details.pieces).toBe(5);
    expect(priced.pricingMode).toBe("market");
  });

  it("cost mode: loose lines carry no laser set-up, so the assembly charges every nest of its members", () => {
    const input = twoMemberInput({}, [makeItem({ id: "loose", partId: "p1", qty: 5 })]);
    const priced = priceQuote(input, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(byLabel(priced.assemblies[0].operations, "setup_laser_nest").map((n) => n.details.nestKey).sort()).toEqual(["S235/2", "S235/3"]);
    expect(priced.items.find((i) => i.itemId === "loose")!.unitPrice).not.toBeNull();
  });

  it("two assemblies sharing a nest: the first charges it; press brake once per job (a bent member), roll once per job (an in-house roll), weld fit-up per assembly", () => {
    const bent = rect({ id: "bent", bendLines: [{ x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }] });
    const b = makeAssembly({ id: "B", position: 1, qty: 1, seams: [makeSeam({ id: "sb", lengthMm: 500 })] });
    const input = makeQuoteInput({
      marginPct: 30,
      parts: [rect({ id: "p1" }), rect({ id: "p2", thicknessMm: 2 }), bent, rect({ id: "rolled" })],
      items: [
        makeItem({ id: "m1", partId: "p1", qty: 2, assemblyId: "A" }),
        makeItem({ id: "m2", partId: "p2", qty: 4, assemblyId: "A", qtyPerAssembly: 2 }),
        makeItem({ id: "m3", partId: "bent", qty: 1, assemblyId: "B" }),
        makeItem({ id: "m4", partId: "rolled", qty: 1, assemblyId: "B", forming: [makeForming({ id: "r", insideRadiusMm: 300, angleDeg: 90, widthMm: 200 })] }),
        makeItem({ id: "m5", partId: "p1", qty: 1, assemblyId: "B", forming: [makeForming({ id: "b", kind: "bend", lengthMm: 200, resolution: { kind: "in_house" } })] }),
      ],
      assemblies: [ASM, b],
    });
    const priced = priceQuote(input, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    const [a, bb] = priced.assemblies;
    expect(byLabel(a.operations, "setup_laser_nest").map((n) => n.details.nestKey).sort()).toEqual(["S235/2", "S235/3"]);
    expect(byLabel(bb.operations, "setup_laser_nest")).toEqual([]);
    expect(byLabel(a.operations, "setup_press_brake")).toEqual([]);
    expect(byLabel(bb.operations, "setup_press_brake")).toHaveLength(1);
    expect(byLabel(bb.operations, "setup_roll")).toHaveLength(1);
    expect(byLabel(a.operations, "setup_weld_fitup")).toHaveLength(1);
    expect(byLabel(bb.operations, "setup_weld_fitup")).toHaveLength(1);
    // the in-house roll: 6 min/m × 0.2 m; the bent member's bend line is in its parts at cost (one 0.9 € bend of the v1 table), the plain bend op adds nothing
    expect(byLabel(bb.operations, "roll_forming")[0].details).toMatchObject({ widthMm: 200 });
    expect(byLabel(bb.operations, "roll_forming")[0].unitCost).toBeCloseTo((6 * 0.2 / 60) * 25, 9);
    expect(bb.labour.formingMin).toBeCloseTo(6 * 0.2, 9);
    expect(byLabel(bb.operations, "step_bend")).toEqual([]);
    const m3 = priced.items.find((i) => i.itemId === "m3")!;
    const loosePart = priceQuote(makeQuoteInput({ marginPct: 30, parts: [bent], items: [makeItem({ id: "x", partId: "bent", qty: 1 })] }), COST, MACHINE_PARK).items[0];
    const bendSetup = loosePart.operations.find((o) => o.label === "bend_setup")!;
    expect(m3.unitCost).toBeCloseTo(loosePart.unitCost - bendSetup.unitCost, 9);
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
    expect(priced.subtotalCost).toBeCloseTo(a.batchCost + bb.batchCost + priced.quoteLines[0].unitCost, 9);
  });
});

describe("material consistency and seams", () => {
  it("a 1.4301 member in an S235 assembly without override → amber assembly.mixed_materials { materials }; with materialOverride → nothing", () => {
    const input = twoMemberInput({ parts: [rect({ id: "p1", materialCode: "1.4301" }), rect({ id: "p2", thicknessMm: 2 })] });
    const priced = priceQuote(input, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    const flag = priced.assemblies[0].flags.find((f) => f.code === "assembly.mixed_materials")!;
    expect(flag).toMatchObject({ severity: "amber", overridable: true, partId: null, itemId: null });
    expect(flag.params).toEqual({ assemblyId: "A", materials: "S235, 1.4301" });
    expect(codes(priced)).toContain("assembly.mixed_materials");
    const overridden = priceQuote({ ...input, items: input.items.map((i) => (i.id === "m1" ? { ...i, materialOverride: true } : i)) }, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(codes(overridden)).not.toContain("assembly.mixed_materials");
  });

  it("DC01 where the assembly says S235 → amber material.substituted on the member with the note, not mixed_materials", () => {
    const input = twoMemberInput({ parts: [rect({ id: "p1", materialCode: "DC01" }), rect({ id: "p2", thicknessMm: 2 })] });
    const priced = priceQuote({ ...input, items: input.items.map((i) => (i.id === "m1" ? { ...i, materialNote: "DC01 zamiast S235 – zgoda klienta" } : i)) }, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    const flag = priced.items.find((i) => i.itemId === "m1")!.flags.find((f) => f.code === "material.substituted")!;
    expect(flag).toMatchObject({ severity: "amber", partId: "p1", itemId: "m1" });
    expect(flag.params).toEqual({ materialCode: "DC01", requested: "S235", note: "DC01 zamiast S235 – zgoda klienta" });
    expect(codes(priced)).not.toContain("assembly.mixed_materials");
  });

  it("a member without a material inherits the assembly's (priced as S235); an unknown material refuses the member → assembly unitPrice null", () => {
    const inherited = priceQuote(twoMemberInput({ parts: [rect({ id: "p1", materialCode: null }), rect({ id: "p2", thicknessMm: 2 })] }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(inherited.assemblies[0].unitPrice).not.toBeNull();
    expect(inherited.flags.filter((f) => f.severity === "red")).toEqual([]);
    const refused = priceQuote(twoMemberInput({ parts: [rect({ id: "p1", materialCode: "UNOBTAINIUM" }), rect({ id: "p2", thicknessMm: 2 })] }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(refused.assemblies[0].unitPrice).toBeNull();
    expect(refused.items.find((i) => i.itemId === "m1")!.flags.some((f) => f.code === "geometry.no_material")).toBe(true);
  });

  it("seams: paired seams are skipped, a stitch seam counts bead ÷ pitch × sides, tack seams count tacks; no seams at all → amber assembly.no_seams", () => {
    const seamsAsm = makeAssembly({
      id: "A",
      qty: 1,
      thicknessMm: 2,
      seams: [
        makeSeam({ id: "a", lengthMm: 1000 }),
        makeSeam({ id: "a-pair", lengthMm: 1000, pairedSeamId: "a" }),
        makeSeam({ id: "st", lengthMm: 600, type: "stitch", stitch: { beadLengthMm: 30, pitchMm: 60 }, sides: 2 }),
        makeSeam({ id: "t", lengthMm: 0, type: "tack", tackCount: 4 }),
        makeSeam({ id: "tig", lengthMm: 200, process: "tig", thicknessMm: 3 }),
      ],
    });
    const priced = priceQuote(twoMemberInput({ assemblies: [seamsAsm], items: [makeItem({ id: "m1", partId: "p1", qty: 1, assemblyId: "A" })] }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    const asm = priced.assemblies[0];
    expect(asm.seamLengthMm).toBe(1800);
    // 1000 / 120 (mig 2 mm) + 600 × 0.5 × 2 / 120 + 200 / 40 (tig 3 mm)
    expect(asm.labour.weldMin).toBeCloseTo(1000 / 120 + 600 / 120 + 200 / 40, 9);
    expect(asm.labour.tackMin).toBeCloseTo(4, 9);
    expect(byLabel(asm.operations, "assembly_weld")[0].details).toMatchObject({ seams: 3, pairedSeamsSkipped: 1, processes: "mig_mag,tig" });
    const none = priceQuote(twoMemberInput({ assemblies: [makeAssembly({ id: "A", qty: 2, seams: [] })] }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(none.assemblies[0].flags.map((f) => f.code)).toEqual(["assembly.no_seams"]);
    expect(none.assemblies[0].labour.weldMin).toBe(0);
    expect(byLabel(none.assemblies[0].operations, "assembly_weld")).toEqual([]);
    expect(none.assemblies[0].unitPrice).not.toBeNull();
  });

  it("a seam process without a weld speed → red weld.no_rate_row on the assembly and no price", () => {
    const priced = priceQuote(twoMemberInput(), COST, MACHINE_PARK, { jobRates: { ...JOB_RATES, weldSpeeds: JOB_RATES.weldSpeeds.filter((w) => w.process !== "mig_mag") } });
    expect(priced.assemblies[0].unitPrice).toBeNull();
    expect(priced.assemblies[0].flags.find((f) => f.code === "weld.no_rate_row")?.params).toMatchObject({ seamId: "seam-1", process: "mig_mag" });
  });
});

describe("forming on members and loose lines", () => {
  it("a member with a roll annotation and no forming operation → red forming.suspected { hint }; a none_needed confirmation clears it", () => {
    const rolledPart = rect({ id: "p1", annotations: { roll: { radiusMm: 90, axis: "x", arcAngleDeg: 180, axisLengthMm: 247, developedWidthMm: 283, cone: null } } });
    const input = twoMemberInput({ parts: [rolledPart, rect({ id: "p2", thicknessMm: 2 })] });
    const priced = priceQuote(input, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    const flag = priced.items.find((i) => i.itemId === "m1")!.flags.find((f) => f.code === "forming.suspected")!;
    expect(flag).toMatchObject({ severity: "red", params: { hint: "roll_annotation" } });
    // the member's roll annotation is NOT priced by the roll table (forming is an operation here): no roll line, no roll.* flag
    expect(priced.items.find((i) => i.itemId === "m1")!.flags.some((f) => f.code.startsWith("roll."))).toBe(false);
    const confirmed = priceQuote({ ...input, items: input.items.map((i) => (i.id === "m1" ? { ...i, forming: [makeForming({ resolution: { kind: "none_needed" } })] } : i)) }, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(codes(confirmed)).not.toContain("forming.suspected");
  });

  it("a loose part marked 'rolled' without a roll annotation → red forming.suspected; a loose part WITH a roll annotation is priced by the roll table instead", () => {
    const hinted = rect({ id: "h", annotations: { forming: "rolled" } });
    const annotated = rect({ id: "r", annotations: { roll: { radiusMm: 500, axis: "x", arcAngleDeg: 90, axisLengthMm: 200, developedWidthMm: 785, cone: null } } });
    const priced = priceQuote(makeQuoteInput({ marginPct: 30, parts: [hinted, annotated], items: [makeItem({ id: "ih", partId: "h" }), makeItem({ id: "ir", partId: "r" })] }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(priced.items[0].flags.find((f) => f.code === "forming.suspected")?.params).toEqual({ hint: "forming_rolled" });
    expect(priced.items[0].unitPrice).not.toBeNull();
    expect(priced.items[1].flags.some((f) => f.code === "forming.suspected")).toBe(false);
    expect(priced.items[1].operations.some((o) => o.type === "roll")).toBe(true);
    // legacy path: no job rates → no forming.suspected anywhere
    expect(codes(priceQuote(makeQuoteInput({ marginPct: 30, parts: [hinted], items: [makeItem({ id: "ih", partId: "h" })] }), COST, MACHINE_PARK))).not.toContain("forming.suspected");
  });

  it("subcontracted forming: cost × 1.15 × qtyPerAssembly as a line, amber forming.subcontract, priced", () => {
    const input = twoMemberInput({}, []);
    const withSub = { ...input, items: input.items.map((i) => (i.id === "m2" ? { ...i, forming: [makeForming({ id: "s", resolution: { kind: "subcontract", supplier: "Walcownia", costEur: 20, extraLeadDays: 3 } })] } : i)) };
    const priced = priceQuote(withSub, COST, MACHINE_PARK, { jobRates: JOB_RATES });
    const line = byLabel(priced.assemblies[0].operations, "subcontract_forming")[0];
    expect(line.unitCost).toBeCloseTo(20 * 1.15 * 2, 9);
    expect(line.details).toMatchObject({ supplier: "Walcownia", costEur: 20, marginPct: 15, qtyPerAssembly: 2, extraLeadDays: 3, subcontract: true });
    expect(priced.assemblies[0].unitPrice).not.toBeNull();
    expect(codes(priced)).toContain("forming.subcontract");
    expect(byLabel(priced.assemblies[0].operations, "setup_roll")).toEqual([]);
  });
});

describe("VAT, shipping and the legacy path", () => {
  it("DE b2b without a VAT id → 23 % + amber customer.vat_id_missing; the VAT base includes the shipping line", () => {
    const priced = priceQuote(
      twoMemberInput({ customerType: "b2b", customerCountry: "DE", customerVatId: null, shipping: { countryCode: "DE", grossKg: null, costEur: null, source: "table", carrier: null, extraLeadDays: 0 } }),
      COST,
      MACHINE_PARK,
      { jobRates: JOB_RATES }
    );
    expect(priced.shipping).toMatchObject({ type: "shipping", unitCost: 35 });
    expect(priced.vat).toMatchObject({ mode: "b2c_domestic", ratePct: 23, netTotal: priced.subtotalPrice });
    expect(priced.vat?.grossTotal).toBeCloseTo(priced.subtotalPrice * 1.23, 9);
    expect(codes(priced)).toContain("customer.vat_id_missing");
    expect(priced.totalsByType.shipping).toEqual({ cost: 35, price: 35 });
    expect(priced.subtotalPrice).toBeCloseTo((priced.assemblies[0].batchPrice ?? 0) + priced.quoteLines[0].unitCost + 35, 9);
  });

  it("without job rates the result is the pre-assembly one: members priced as loose lines, no assemblies, no packaging in cost mode", () => {
    const legacy = priceQuote(twoMemberInput(), COST, MACHINE_PARK);
    expect(legacy.assemblies).toEqual([]);
    expect(legacy.items.every((i) => i.unitPrice !== null && i.operations.length > 0)).toBe(true);
    expect(legacy.quoteLines).toEqual([]);
    expect(legacy.vat).toBeNull();
    expect(legacy.priceScale).toEqual([]);
  });

  it("market mode without a cost version prices the parts from the market snapshot (assumption) and keeps market.no_cost_version", () => {
    // v3 has no S235 2 mm laser row: with the market snapshot standing in for cost such a member is refused, so use 4 mm here
    const priced = priceQuote(twoMemberInput({ marginPct: 0, leadTimeDays: 11, parts: [rect({ id: "p1" }), rect({ id: "p2", thicknessMm: 4 })] }), V3, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(priced.assemblies[0].unitPrice).not.toBeNull();
    expect(priced.assemblies[0].operations.find((o) => o.label === "assembly_parts")?.rateRef.key).toBe(`parts_at_cost/${V3.versionId}`);
    const refused = priceQuote(twoMemberInput({ marginPct: 0, leadTimeDays: 11 }), V3, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(refused.assemblies[0].unitPrice).toBeNull();
    expect(refused.items.find((i) => i.itemId === "m2")!.flags.some((f) => f.code === "laser.no_rate_row")).toBe(true);
    expect(codes(priced)).toContain("market.no_cost_version");
    expect(priced.costRateVersionId).toBeNull();
    expect(priced.marginPct).toBe(0);
  });

  it("invalid input: a member of an unknown assembly, an assembly qty ≤ 0, a qtyPerAssembly ≤ 0", () => {
    expect(() => priceQuote(twoMemberInput({}, [makeItem({ id: "ghost", partId: "p1", assemblyId: "Z" })]), COST, MACHINE_PARK, { jobRates: JOB_RATES })).toThrow(PricingError);
    expect(() => priceQuote(twoMemberInput({ assemblies: [{ ...ASM, qty: 0 }] }), COST, MACHINE_PARK, { jobRates: JOB_RATES })).toThrow(PricingError);
    const input = twoMemberInput();
    expect(() => priceQuote({ ...input, items: input.items.map((i) => ({ ...i, qtyPerAssembly: 0 })) }, COST, MACHINE_PARK, { jobRates: JOB_RATES })).toThrow(PricingError);
  });

  it("partitionItems and priceAssemblies work stand-alone (nests reported, chargedNests honoured)", () => {
    const input = twoMemberInput({}, [makeItem({ id: "loose", partId: "p1", qty: 1 })]);
    const parts = partitionItems(input);
    expect(parts.loose.map((i) => i.id)).toEqual(["loose"]);
    expect(parts.members.map((i) => i.id)).toEqual(["m1", "m2"]);
    const result = priceAssemblies(input, { rates: COST, costRates: null, machines: MACHINE_PARK, jobRates: JOB_RATES, chargedNests: new Set(["S235/3"]) });
    expect([...result.nests].sort()).toEqual(["S235/2", "S235/3"]);
    expect(byLabel(result.assemblies[0].operations, "setup_laser_nest").map((n) => n.details.nestKey)).toEqual(["S235/2"]);
    expect(result.items.map((i) => i.itemId)).toEqual(["m1", "m2"]);
    expect(result.usesPressBrake).toBe(false);
    expect(result.usesRoll).toBe(false);
  });
});
