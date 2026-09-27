/**
 * SM-2026-0004 — the 38 SMT test parts priced from their STORED geometry
 * (test/fixtures/quotes/sm-2026-0004.json, exported from the project):
 *   (a) placeholder (cost) version → every unit price equals what the app
 *       stored on 26 Sep 2026 (cost mode unchanged by the market work);
 *   (b) market v2 "market-247+10% v2 (27 Sep 2026)" (test/fixtures/rates/
 *       market-247-v2.json = the rows of migration 20260927120000) → the
 *       owner's acceptance case E9: qty 1 everywhere, 11 working days, no
 *       extras → every unit price within 1 % of the expected figure, parts
 *       subtotal €430.54, one pallet (SMT06 is 800 mm) €36.78.
 * Both parts print the comparison table.
 * File path: /test/rates/market-247.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { QuoteItemRow, PartRow, QuoteRow } from "@/lib/db/types";
import { priceQuote } from "@/lib/pricing/price-quote";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import type { MachinePark, RateSnapshot } from "@/lib/pricing/types";
import { buildQuoteInput } from "@/lib/quotes/mapper";

const FIXTURES = path.join(__dirname, "../fixtures");
const MARKET_V2_JSON = path.join(FIXTURES, "rates/market-247-v2.json");

type Bundle = { quote: QuoteRow; items: QuoteItemRow[]; parts: PartRow[] };
type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0]; leadtime?: RateRows["leadtime"] };

/** E9 — expected unit prices (EUR) of the 38 SMT parts on market v2 (owner, 27 Sep 2026). */
export const EXPECTED_V2: ReadonlyArray<readonly [name: string, expected: number]> = [
  ["SMT01_SQ025", 2.35],
  ["SMT02_SQ050", 2.44],
  ["SMT03_SQ100", 2.75],
  ["SMT04_SQ200", 3.91],
  ["SMT05_SQ400", 8.33],
  ["SMT06_SQ800", 25.63],
  ["SMT07_RE100x400", 3.95],
  ["SMT08_RE050x800", 4.12],
  ["SMT09_RE025x1600", 4.49],
  ["SMT10_H04xD20", 4.01],
  ["SMT11_H16xD10", 4.35],
  ["SMT12_H64xD5", 5.56],
  ["SMT13_ZZ2x", 4.1],
  ["SMT14_ZZ3x", 4.29],
  ["SMT15_FRAME200", 2.96],
  ["SMT16_SQ087", 2.66],
  ["SMT17_SQ100_EB", 2.75],
  ["SMT18_SQ200_EB", 3.91],
  ["SMT19_SQ400_EB", 8.33],
  ["SMT20_SQ200_ENG", 3.91],
  ["SMT21_SQ100_DC01-1p0", 22.8],
  ["SMT22_H04xD20_DC01-1p0", 24.22],
  ["SMT23_SQ100_DC01-2p0", 14.92],
  ["SMT24_H04xD20_DC01-2p0", 16.52],
  ["SMT25_SQ100_DC01-3p0", 17.4],
  ["SMT26_H04xD20_DC01-3p0", 19.71],
  ["SMT27_SQ100_S235-3p0", 14.19],
  ["SMT28_H04xD20_S235-3p0", 16.43],
  ["SMT29_SQ100_S235-5p0", 13.16],
  ["SMT30_H04xD20_S235-5p0", 16.31],
  ["SMT31_SQ100_S235-8p0", 14.35],
  ["SMT32_H04xD20_S235-8p0", 20.23],
  ["SMT33_SQ100_S235-10p0", 12.36],
  ["SMT34_H04xD20_S235-10p0", 18.84],
  ["SMT35_SQ100_304-1p5", 15.95],
  ["SMT36_H04xD20_304-1p5", 19.29],
  ["SMT37_SQ100_AlMg3-1p5", 23.45],
  ["SMT38_H04xD20_AlMg3-1p5", 25.61],
];
export const EXPECTED_V2_PARTS_SUBTOTAL = 430.54;
export const EXPECTED_V2_PALLET = 36.78;

/** ±1 % — the owner's acceptance tolerance. */
export const TOLERANCE_PCT = 1;
const LEAD_TIME_DAYS = 11;

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function snapshotFrom(json: RatesJson): { rates: RateSnapshot; machines: MachinePark } {
  const { machines, ...rows } = json;
  return { rates: rowsToRateSnapshot({ ...rows, leadtime: rows.leadtime ?? [] }), machines: rowsToMachinePark(machines) };
}

/** E9: qty 1 everywhere, no extras. */
function scenarioItems(bundle: Bundle): QuoteItemRow[] {
  return bundle.items.map((item) => ({ ...item, qty: 1, extras: [] }));
}

function table(rows: { name: string; expected: number; actual: number }[]): string {
  const line = (a: string, b: string, c: string, d: string) => `${a.padEnd(26)}${b.padStart(10)}${c.padStart(10)}${d.padStart(10)}`;
  return [
    line("part", "expected", "actual", "diff"),
    ...rows.map((r) => line(r.name, r.expected.toFixed(2), r.actual.toFixed(2), (r.actual - r.expected).toFixed(2))),
  ].join("\n");
}

const bundle = loadJson<Bundle>(path.join(FIXTURES, "quotes/sm-2026-0004.json"));
const placeholder = snapshotFrom(loadJson<RatesJson>(path.join(FIXTURES, "rates/placeholder-v1.json")));

describe("SM-2026-0004 in the placeholder (cost) version", () => {
  it("re-prices every part exactly as stored today (cost mode unchanged)", () => {
    const input = buildQuoteInput({ quote: { ...bundle.quote, lead_time_days: LEAD_TIME_DAYS }, customer: null, items: bundle.items, parts: bundle.parts, rates: placeholder.rates });
    const priced = priceQuote(input, placeholder.rates, placeholder.machines);
    expect(priced.pricingMode).toBe("cost");
    expect(priced.items).toHaveLength(38);
    const stored = new Map(bundle.items.map((i) => [i.id, Number(i.unit_price)]));
    const nameOf = new Map(bundle.parts.map((p) => [p.id, p.name]));
    const rows = priced.items.map((item) => ({ name: nameOf.get(item.partId) ?? item.partId, expected: stored.get(item.itemId) ?? Number.NaN, actual: item.unitPrice ?? Number.NaN }));
    console.log(`placeholder version — stored vs re-priced unit prices (EUR)\n${table(rows)}`);
    for (const row of rows) expect(row.actual, row.name).toBeCloseTo(row.expected, 3);
  });
});

describe("E9 — SM-2026-0004 on market v2 (market-247+10% v2, 27 Sep 2026)", () => {
  const market = snapshotFrom(loadJson<RatesJson>(MARKET_V2_JSON));
  const items = scenarioItems(bundle);
  const input = buildQuoteInput({ quote: { ...bundle.quote, lead_time_days: LEAD_TIME_DAYS }, customer: null, items, parts: bundle.parts, rates: market.rates });
  const priced = priceQuote(input, market.rates, market.machines, { costRates: placeholder.rates });
  const nameOf = new Map(bundle.parts.map((p) => [p.id, p.name]));
  const actualByName = new Map(priced.items.map((item) => [nameOf.get(item.partId) ?? "", item.unitPrice]));

  it(`prices every part within ${TOLERANCE_PCT} % of the expected figure`, () => {
    expect(market.rates.versionId).toBe("2a7c0927-0000-4000-8000-000000000002");
    expect(priced.pricingMode).toBe("market");
    expect(priced.leadTimeDays).toBe(LEAD_TIME_DAYS);
    expect(priced.items).toHaveLength(38);
    const rows = EXPECTED_V2.map(([name, expected]) => ({ name, expected, actual: actualByName.get(name) ?? Number.NaN }));
    console.log(`market v2 — expected vs engine unit prices (EUR)\n${table(rows)}\nparts subtotal ${(priced.subtotalPrice - (priced.quoteLines[0]?.unitCost ?? 0)).toFixed(2)}, packaging ${priced.quoteLines[0]?.label ?? "-"} ${(priced.quoteLines[0]?.unitCost ?? 0).toFixed(2)}, margin vs cost version ${priced.marginPct.toFixed(1)} %`);
    for (const row of rows) {
      expect(row.actual, row.name).not.toBeNaN();
      expect((Math.abs(row.actual - row.expected) / row.expected) * 100, `${row.name}: expected ${row.expected}, got ${row.actual.toFixed(2)}`).toBeLessThanOrEqual(TOLERANCE_PCT);
    }
  });

  it("parts subtotal €430.54 plus one pallet €36.78; no red flags, nothing refused", () => {
    const parts = priced.items.reduce((sum, i) => sum + (i.batchPrice ?? 0), 0);
    expect((Math.abs(parts - EXPECTED_V2_PARTS_SUBTOTAL) / EXPECTED_V2_PARTS_SUBTOTAL) * 100).toBeLessThanOrEqual(TOLERANCE_PCT);
    expect(priced.quoteLines).toHaveLength(1);
    expect(priced.quoteLines[0]).toMatchObject({ label: "packaging_pallet", unitCost: EXPECTED_V2_PALLET });
    expect(priced.subtotalPrice).toBeCloseTo(parts + EXPECTED_V2_PALLET, 6);
    expect(priced.items.every((i) => i.unitPrice !== null)).toBe(true);
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
    expect(priced.usesPlaceholderRates).toBe(false);
  });
});
