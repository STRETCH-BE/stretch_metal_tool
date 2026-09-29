/**
 * Regression case of docs/assembly-mode-design.md §6: the U-shape heat store
 * box rev 3 (parts P1–P8, 3 760 mm of MIG seam counted once, a rolled P7)
 * priced as ONE welded assembly on the market v3 version with the v1 cost
 * snapshot and the seeded job rates. Checks: rolling flagged infeasible
 * until step bending is chosen, set-ups once per job, seams counted once,
 * welding + fit-up ≈ 3.6 h, net price €270–340 before shipping, one
 * assembly line, and 23 % VAT for a Finnish private customer with OSS off.
 * `PRINT_BREAKDOWN=1 npx vitest run test/pricing/assembly-regression.test.ts`
 * prints every line with its minutes and euros (the notes file carries it).
 * File path: /test/pricing/assembly-regression.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceQuote } from "@/lib/pricing/price-quote";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import type { AssemblySeam, FormingResolution, OperationLine, PricedQuote, PricingItem, PricingPart, QuoteInput, ShippingInput } from "@/lib/pricing/types";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeAssembly, makeForming, makeItem, makePricingPart, makeQuoteInput, makeSeam } from "@/test/helpers/quote";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };
const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/market-247-v3.json"), "utf8")) as RatesJson;
const { machines: _machineRows, ...rows } = json;
void _machineRows;
const V3 = rowsToRateSnapshot(rows);
const COST = RATE_SNAPSHOT_V1;

const ASM = "asm-heat-box";

type Member = { id: string; lengthMm: number; widthMm: number; thicknessMm: number; qtyPerAssembly: number; forming?: FormingResolution | null | "none" };

/** P1–P8 of the heat store box (design §6); P7 carries the roll operation, resolution as given. */
const MEMBERS: Member[] = [
  { id: "P1", lengthMm: 375, widthMm: 375, thicknessMm: 3, qtyPerAssembly: 1 },
  { id: "P2", lengthMm: 365, widthMm: 365, thicknessMm: 2, qtyPerAssembly: 1 },
  { id: "P3", lengthMm: 375, widthMm: 247, thicknessMm: 3, qtyPerAssembly: 1 },
  { id: "P4", lengthMm: 373, widthMm: 247, thicknessMm: 3, qtyPerAssembly: 2 },
  { id: "P5", lengthMm: 93.5, widthMm: 247, thicknessMm: 3, qtyPerAssembly: 2 },
  { id: "P6", lengthMm: 80, widthMm: 247, thicknessMm: 3, qtyPerAssembly: 2 },
  { id: "P7", lengthMm: 285.9, widthMm: 247, thicknessMm: 2, qtyPerAssembly: 1, forming: null },
  { id: "P8", lengthMm: 30, widthMm: 20, thicknessMm: 3, qtyPerAssembly: 11 },
];

function part(m: Member): PricingPart {
  return makePricingPart({
    id: m.id,
    name: m.id,
    geometry: makeRectPartGeometry({ lengthMm: m.lengthMm, widthMm: m.widthMm, thicknessMm: m.thicknessMm, densityKgM3: 7850, blankMarginMm: 10 }),
    materialCode: "S235",
    thicknessMm: m.thicknessMm,
  });
}

function seams(): AssemblySeam[] {
  const s1 = makeSeam({ id: "s1", partId: "P3", lengthMm: 1250, thicknessMm: 2 });
  const s2 = makeSeam({ id: "s2", partId: "P4", lengthMm: 1250, thicknessMm: 2 });
  const s3 = makeSeam({ id: "s3", partId: "P1", lengthMm: 1260, thicknessMm: 2 });
  /** The neighbour's edge of the same joint (lib/quotes/seams.ts matchSeam): stored, not counted. */
  const paired = makeSeam({ id: "s1-pair", partId: "P4", lengthMm: 1250.4, thicknessMm: 2, pairedSeamId: "s1" });
  const tacks = makeSeam({ id: "tacks", partId: "P8", lengthMm: 0, type: "tack", tackCount: 11 });
  return [s1, s2, s3, paired, tacks];
}

function input(resolution: FormingResolution | null, extra: Partial<QuoteInput> = {}): QuoteInput {
  const assembly = makeAssembly({ id: ASM, name: "U-shape heat store box rev 3", drawingRef: "HSB-3", qty: 1, materialCode: "S235", thicknessMm: 3, seams: seams() });
  const items: PricingItem[] = MEMBERS.map((m) =>
    makeItem({
      id: `i-${m.id}`,
      partId: m.id,
      qty: assembly.qty * m.qtyPerAssembly,
      assemblyId: ASM,
      qtyPerAssembly: m.qtyPerAssembly,
      forming: m.id === "P7" ? [makeForming({ id: "roll-p7", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution })] : [],
    })
  );
  return makeQuoteInput({
    marginPct: 0,
    leadTimeDays: 11,
    parts: MEMBERS.map(part),
    items,
    assemblies: [assembly],
    customerType: "b2c",
    customerCountry: "FI",
    customerVatId: null,
    ...extra,
  });
}

const SHIPPING: ShippingInput = { countryCode: "FI", grossKg: null, costEur: null, source: "table", carrier: null, extraLeadDays: 0 };

function price(resolution: FormingResolution | null, extra: Partial<QuoteInput> = {}): PricedQuote {
  return priceQuote(input(resolution, extra), V3, MACHINE_PARK, { costRates: COST, jobRates: JOB_RATES });
}

const byLabel = (ops: readonly OperationLine[], label: string) => ops.filter((o) => o.label === label);

describe("heat store box — before the forming resolution", () => {
  const priced = price(null, { shipping: SHIPPING });
  const asm = priced.assemblies[0];

  it("prices ONE assembly whose rolling (R90 < 200 mm) is flagged red forming.not_feasible on P7; the assembly has no price yet", () => {
    expect(priced.assemblies).toHaveLength(1);
    expect(asm.unitPrice).toBeNull();
    expect(asm.batchPrice).toBeNull();
    const red = priced.flags.filter((f) => f.code === "forming.not_feasible");
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ severity: "red", partId: "P7", itemId: "i-P7", overridable: false });
    expect(red[0].params).toMatchObject({ kind: "roll", reason: "min_radius", value: 90, limit: 200 });
    expect(priced.items.find((i) => i.itemId === "i-P7")?.flags.some((f) => f.code === "forming.not_feasible")).toBe(true);
    expect(asm.unitCost).toBeGreaterThan(0);
  });

  it("members are not loose lines: operations [], unitPrice null, qty = assembly qty × qtyPerAssembly, unitCost = the part at cost", () => {
    expect(priced.items).toHaveLength(8);
    for (const item of priced.items) {
      expect(item.operations).toEqual([]);
      expect(item.unitPrice).toBeNull();
      expect(item.batchPrice).toBeNull();
      expect(item.unitCost).toBeGreaterThan(0);
    }
    expect(priced.items.find((i) => i.itemId === "i-P8")?.qty).toBe(11);
    expect(priced.items.find((i) => i.itemId === "i-P4")?.qty).toBe(2);
    expect(asm.memberItemIds).toEqual(MEMBERS.map((m) => `i-${m.id}`));
  });
});

describe("heat store box — step bending with 19 hits chosen", () => {
  const priced = price({ kind: "step_bend", hits: 19 }, { shipping: SHIPPING });
  const asm = priced.assemblies[0];
  const ops = asm.operations;

  it("is priced: one assembly line, no red flag, amber forming.step_bend { hits: 19 }", () => {
    expect(priced.assemblies).toHaveLength(1);
    expect(asm.unitPrice).not.toBeNull();
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
    const stepBend = priced.flags.find((f) => f.code === "forming.step_bend");
    expect(stepBend?.params).toMatchObject({ hits: 19, radiusMm: 90, angleDeg: 180 });
    expect(byLabel(ops, "step_bend")).toHaveLength(1);
    expect(byLabel(ops, "step_bend")[0].details).toMatchObject({ hits: 19 });
    expect(byLabel(ops, "step_bend")[0].unitCost).toBeCloseTo(((19 * 25) / 60 / 60) * 25, 9);
  });

  it("set-ups once per operation: one laser nest for S235 3 mm and one for S235 2 mm, one press brake, one weld fit-up, no roll", () => {
    const nests = byLabel(ops, "setup_laser_nest");
    expect(nests.map((n) => n.details.nestKey).sort()).toEqual(["S235/2", "S235/3"]);
    for (const n of nests) expect(n.unitCost).toBeCloseTo(17.5, 9);
    expect(byLabel(ops, "setup_press_brake")).toHaveLength(1);
    expect(byLabel(ops, "setup_press_brake")[0].unitCost).toBeCloseTo(23.33, 9);
    expect(byLabel(ops, "setup_weld_fitup")).toHaveLength(1);
    expect(byLabel(ops, "setup_weld_fitup")[0].unitCost).toBeCloseTo(12.5, 9);
    expect(byLabel(ops, "setup_roll")).toEqual([]);
    const setups = ops.filter((o) => o.type === "setup");
    expect(setups).toHaveLength(4);
    expect(setups.reduce((s, o) => s + o.unitCost, 0)).toBeCloseTo(17.5 * 2 + 23.33 + 12.5, 9);
    // the older model's 8 laser + 7 weld set-ups are gone: no bend_setup / weld_setup / laser_setup anywhere
    expect(ops.some((o) => ["bend_setup", "weld_setup", "laser_setup"].includes(o.label))).toBe(false);
    expect(priced.items.every((i) => i.operations.length === 0)).toBe(true);
  });

  it("every seam counted once: 1 250 + 1 250 + 1 260 = 3 760 mm, the paired neighbour edge skipped, 11 tacks", () => {
    expect(asm.seamLengthMm).toBeCloseTo(3760, 9);
    const weld = byLabel(ops, "assembly_weld")[0];
    expect(weld.details).toMatchObject({ seams: 3, pairedSeamsSkipped: 1, seamLengthMm: 3760, effectiveLengthMm: 3760, processes: "mig_mag" });
    expect(asm.labour.weldMin).toBeCloseTo(3760 / 120, 9);
    expect(asm.labour.tackMin).toBeCloseTo(11, 9);
    expect(byLabel(ops, "assembly_tack")[0].details).toMatchObject({ tacks: 11 });
  });

  it("welding + fit-up (with the 1.3 distortion factor) between 3.2 and 4.0 h; totalMin adds deburr, handling and the step bend", () => {
    const { fitupMin, tackMin, weldMin, deburrMin, handlingMin, formingMin, totalMin, arcMin } = asm.labour;
    expect(fitupMin).toBeCloseTo(6 * 21, 9);
    const weldingAndFitupH = ((fitupMin + tackMin + weldMin) * JOB_RATES.assembly.distortionFactor) / 60;
    expect(weldingAndFitupH).toBeGreaterThanOrEqual(3.2);
    expect(weldingAndFitupH).toBeLessThanOrEqual(4.0);
    expect(deburrMin).toBeCloseTo(1.5 * 21, 9);
    expect(handlingMin).toBe(10);
    expect(formingMin).toBeCloseTo((19 * 25) / 60, 9);
    expect(totalMin).toBeCloseTo(weldingAndFitupH * 60 + deburrMin + handlingMin + formingMin, 9);
    expect(arcMin).toBeCloseTo(weldMin + tackMin, 9);
    // the labour lines carry the same minutes
    const labourLines = ["assembly_fitup", "assembly_tack", "assembly_weld", "assembly_deburr", "assembly_handling", "step_bend"].flatMap((l) => byLabel(ops, l));
    const minutes = labourLines.reduce((s, o) => s + Number(o.details.minutes), 0);
    expect(minutes).toBeCloseTo(totalMin, 6);
  });

  it("net price excluding shipping between €270 and €340 at the 30 % assembly margin, shipping FI 30 kg band = €45 on top", () => {
    expect(asm.marginPct).toBe(30);
    expect(asm.unitPrice).toBeCloseTo(asm.unitCost / 0.7, 9);
    expect(priced.shipping).toMatchObject({ type: "shipping", label: "shipping", unitCost: 45 });
    expect(priced.quoteLines.map((l) => l.label)).toEqual(["packaging"]);
    const packaging = priced.quoteLines[0];
    expect(packaging.details.code).toBe("crate");
    const netExclShipping = priced.subtotalPrice - (priced.shipping?.unitCost ?? 0);
    expect(netExclShipping).toBeCloseTo((asm.batchPrice ?? 0) + packaging.unitCost, 9);
    expect(netExclShipping).toBeGreaterThanOrEqual(270);
    expect(netExclShipping).toBeLessThanOrEqual(340);
    expect(priced.subtotalCost).toBeCloseTo(asm.batchCost + packaging.unitCost + 45, 9);
    expect(priced.pricingMode).toBe("market");
    expect(priced.costRateVersionId).toBe(COST.versionId);
    expect(priced.usesPlaceholderRates).toBe(true);
  });

  it("b2c customer in Finland, OSS off → 23 % b2c_domestic, gross = net × 1.23 on the total including shipping, no VAT flag", () => {
    expect(priced.vat).toMatchObject({ mode: "b2c_domestic", ratePct: 23, countryCode: "PL", netTotal: priced.subtotalPrice });
    expect(priced.vat?.grossTotal).toBeCloseTo(priced.subtotalPrice * 1.23, 9);
    expect(priced.flags.some((f) => f.code === "customer.vat_id_missing")).toBe(false);
    expect(priced.flags.some((f) => f.code === "shipping.missing")).toBe(false);
  });

  it("without a shipping input the Finnish customer gets amber shipping.missing and no shipping line; with OSS on the rate is 25.5 %", () => {
    const noShip = price({ kind: "step_bend", hits: 19 });
    expect(noShip.shipping).toBeNull();
    expect(noShip.flags.filter((f) => f.code === "shipping.missing")).toHaveLength(1);
    expect(noShip.subtotalPrice).toBeCloseTo(priced.subtotalPrice - 45, 9);
    const oss = priceQuote(input({ kind: "step_bend", hits: 19 }, { shipping: SHIPPING }), V3, MACHINE_PARK, { costRates: COST, jobRates: { ...JOB_RATES, ossActive: true } });
    expect(oss.vat).toMatchObject({ mode: "b2c_oss", ratePct: 25.5, countryCode: "FI" });
  });

  it("totals by type add up to the subtotals", () => {
    const cost = Object.values(priced.totalsByType).reduce((s, b) => s + (b?.cost ?? 0), 0);
    const priceSum = Object.values(priced.totalsByType).reduce((s, b) => s + (b?.price ?? 0), 0);
    expect(cost).toBeCloseTo(priced.subtotalCost, 6);
    expect(priceSum).toBeCloseTo(priced.subtotalPrice, 6);
  });

  it("prints the breakdown when PRINT_BREAKDOWN is set", () => {
    if (!process.env.PRINT_BREAKDOWN) return;
    const rows = ops.map((o) => `| ${o.label} | ${o.type} | ${o.driverQty.toFixed(3)} ${o.driverUnit} | ${o.details.minutes !== undefined ? Number(o.details.minutes).toFixed(2) : "—"} | ${o.unitCost.toFixed(2)} |`);
    const out = [
      "| line | type | driver | min | EUR |",
      "|---|---|---|---|---|",
      ...rows,
      `| **unit cost** | | | ${asm.labour.totalMin.toFixed(1)} | **${asm.unitCost.toFixed(2)}** |`,
      `| unit price (÷ 0.7) | | | | **${(asm.unitPrice ?? 0).toFixed(2)}** |`,
      `| packaging (${priced.quoteLines[0].details.code}) | | ${Number(priced.quoteLines[0].details.grossKg).toFixed(2)} kg | | ${priced.quoteLines[0].unitCost.toFixed(2)} |`,
      `| shipping | | | | ${(priced.shipping?.unitCost ?? 0).toFixed(2)} |`,
      `| net total | | | | ${priced.subtotalPrice.toFixed(2)} |`,
      `| VAT ${priced.vat?.ratePct} % (${priced.vat?.mode}) | | | | ${(priced.vat?.vatAmount ?? 0).toFixed(2)} |`,
      `| gross | | | | ${(priced.vat?.grossTotal ?? 0).toFixed(2)} |`,
    ];
    console.log(out.join("\n"));
    console.log(JSON.stringify(asm.labour, null, 2));
    console.log(priced.items.map((i) => `${i.itemId}: qty ${i.qty}, part at cost ${i.unitCost.toFixed(3)} €/pc`).join("\n"));
  });
});

describe("heat store box — cost mode", () => {
  it("prices the same assembly in cost mode (the tables are costs): one assembly, one nest per thickness, the same labour, no market lines", () => {
    const priced = priceQuote(input({ kind: "step_bend", hits: 19 }, { marginPct: 30, shipping: SHIPPING }), COST, MACHINE_PARK, { jobRates: JOB_RATES });
    expect(priced.pricingMode).toBe("cost");
    expect(priced.assemblies).toHaveLength(1);
    const asm = priced.assemblies[0];
    expect(asm.unitPrice).not.toBeNull();
    expect(byLabel(asm.operations, "setup_laser_nest").map((n) => n.details.nestKey).sort()).toEqual(["S235/2", "S235/3"]);
    expect(asm.labour.totalMin).toBeCloseTo(price({ kind: "step_bend", hits: 19 }).assemblies[0].labour.totalMin, 9);
    expect(asm.marginPct).toBe(30);
    expect(priced.marginPct).toBe(30);
    expect(priced.subtotalPrice).toBeCloseTo((asm.batchPrice ?? 0) + priced.quoteLines[0].unitCost + 45, 9);
    expect(priced.vat?.ratePct).toBe(23);
  });
});
