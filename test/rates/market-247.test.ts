/**
 * SM-2026-0004 — the 38 SMT test parts priced from their STORED geometry
 * (test/fixtures/quotes/sm-2026-0004.json, exported from the project):
 *   (a) placeholder (cost) version → every unit price equals what the app
 *       stored on 26 Sep 2026 (cost mode unchanged by the market work);
 *   (b) market version (the workbook loaded by scripts/seed-market-rates.mjs
 *       --export-json test/fixtures/rates/market-247plus10.json) → every unit
 *       price within €1.20 of 247TailorSteel's real price × 1.10, with qty 1,
 *       11 working days, pickup, deburring only on SMT19_SQ400_EB and
 *       engraving only on SMT20_SQ200_ENG.
 * (b) is skipped, with a clear reason, until that export exists — it is what
 * keeps the market version from drifting once the workbook is loaded.
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
const MARKET_JSON = path.join(FIXTURES, "rates/market-247plus10.json");

type Bundle = { quote: QuoteRow; items: QuoteItemRow[]; parts: PartRow[] };
type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0]; leadtime?: RateRows["leadtime"] };

/** 247TailorSteel real price and the expected selling price (× 1.10), per part (owner, 26 Sep 2026). */
export const EXPECTED_247: ReadonlyArray<readonly [name: string, price247: number, expected: number]> = [
  ["SMT01_SQ025", 2.28, 2.51],
  ["SMT02_SQ050", 2.36, 2.6],
  ["SMT03_SQ100", 2.67, 2.94],
  ["SMT04_SQ200", 3.84, 4.22],
  ["SMT05_SQ400", 8.46, 9.31],
  ["SMT06_SQ800", 26.86, 29.55],
  ["SMT07_RE100x400", 3.86, 4.25],
  ["SMT08_RE050x800", 3.9, 4.29],
  ["SMT09_RE025x1600", 3.99, 4.39],
  ["SMT10_H04xD20", 3.89, 4.28],
  ["SMT11_H16xD10", 4.17, 4.59],
  ["SMT12_H64xD5", 5.21, 5.73],
  ["SMT13_ZZ2x", 4.41, 4.85],
  ["SMT14_ZZ3x", 4.62, 5.08],
  ["SMT15_FRAME200", 2.73, 3.0],
  ["SMT16_SQ087", 2.57, 2.83],
  ["SMT17_SQ100_EB", 2.67, 2.94],
  ["SMT18_SQ200_EB", 3.84, 4.22],
  ["SMT19_SQ400_EB", 44.08, 48.49],
  ["SMT20_SQ200_ENG", 4.59, 5.05],
  ["SMT21_SQ100_DC01-1p0", 25.73, 28.3],
  ["SMT22_H04xD20_DC01-1p0", 27.48, 30.23],
  ["SMT23_SQ100_DC01-2p0", 16.9, 18.59],
  ["SMT24_H04xD20_DC01-2p0", 19.47, 21.42],
  ["SMT25_SQ100_DC01-3p0", 19.56, 21.52],
  ["SMT26_H04xD20_DC01-3p0", 22.71, 24.98],
  ["SMT27_SQ100_S235-3p0", 16.11, 17.72],
  ["SMT28_H04xD20_S235-3p0", 19.37, 21.31],
  ["SMT29_SQ100_S235-5p0", 14.67, 16.14],
  ["SMT30_H04xD20_S235-5p0", 18.9, 20.79],
  ["SMT31_SQ100_S235-8p0", 16.39, 18.03],
  ["SMT32_H04xD20_S235-8p0", 23.88, 26.27],
  ["SMT33_SQ100_S235-10p0", 14.28, 15.71],
  ["SMT34_H04xD20_S235-10p0", 22.87, 25.16],
  ["SMT35_SQ100_304-1p5", 18.3, 20.13],
  ["SMT36_H04xD20_304-1p5", 23.34, 25.67],
  ["SMT37_SQ100_AlMg3-1p5", 27.09, 29.8],
  ["SMT38_H04xD20_AlMg3-1p5", 31.69, 34.86],
];

export const TOLERANCE_EUR = 1.2;
const LEAD_TIME_DAYS = 11;
const DEBURR_PARTS = new Set(["SMT19_SQ400_EB"]);
const ENGRAVE_PARTS = new Set(["SMT20_SQ200_ENG"]);

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function snapshotFrom(json: RatesJson): { rates: RateSnapshot; machines: MachinePark } {
  const { machines, ...rows } = json;
  return { rates: rowsToRateSnapshot({ ...rows, leadtime: rows.leadtime ?? [] }), machines: rowsToMachinePark(machines) };
}

/** The owner's test setup: qty 1 everywhere, deburring / engraving as finish extras on the two named parts. */
function scenarioItems(bundle: Bundle): QuoteItemRow[] {
  const nameOf = new Map(bundle.parts.map((p) => [p.id, p.name]));
  return bundle.items.map((item) => {
    const name = nameOf.get(item.part_id) ?? "";
    const extras = [
      ...(DEBURR_PARTS.has(name) ? [{ type: "finish", code: "deburr", maskingMinutes: 0, note: null }] : []),
      ...(ENGRAVE_PARTS.has(name) ? [{ type: "finish", code: "engrave", maskingMinutes: 0, note: null }] : []),
    ];
    return { ...item, qty: 1, extras };
  });
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
    const rows = priced.items.map((item) => ({ name: nameOf.get(item.partId) ?? item.partId, expected: stored.get(item.itemId) ?? Number.NaN, actual: item.unitPrice }));
    console.log(`placeholder version — stored vs re-priced unit prices (EUR)\n${table(rows)}`);
    for (const row of rows) expect(row.actual, row.name).toBeCloseTo(row.expected, 3);
  });
});

const marketAvailable = fs.existsSync(MARKET_JSON);

describe.skipIf(!marketAvailable)("SM-2026-0004 in the market version (247TailorSteel × 1.10)", () => {
  it(`prices every part within €${TOLERANCE_EUR.toFixed(2)} of 247's price × 1.10`, () => {
    const market = snapshotFrom(loadJson<RatesJson>(MARKET_JSON));
    expect(market.rates.general.pricingMode).toBe("market");
    const items = scenarioItems(bundle);
    const input = buildQuoteInput({ quote: { ...bundle.quote, lead_time_days: LEAD_TIME_DAYS }, customer: null, items, parts: bundle.parts, rates: market.rates });
    const priced = priceQuote(input, market.rates, market.machines, { costRates: placeholder.rates });
    expect(priced.pricingMode).toBe("market");
    expect(priced.leadTimeDays).toBe(LEAD_TIME_DAYS);
    const nameOf = new Map(bundle.parts.map((p) => [p.id, p.name]));
    const actualByName = new Map(priced.items.map((item) => [nameOf.get(item.partId) ?? "", item.unitPrice]));
    const rows = EXPECTED_247.map(([name, , expected]) => ({ name, expected, actual: actualByName.get(name) ?? Number.NaN }));
    console.log(`market version — expected (247 × 1.10) vs engine unit prices (EUR)\n${table(rows)}\nmargin vs cost version: ${priced.marginPct.toFixed(1)} %`);
    for (const row of rows) expect(Math.abs(row.actual - row.expected), `${row.name}: expected ${row.expected}, got ${row.actual.toFixed(2)}`).toBeLessThanOrEqual(TOLERANCE_EUR);
  });
});

if (!marketAvailable) {
  describe("market version export", () => {
    it.skip(`skipped — ${path.relative(process.cwd(), MARKET_JSON)} does not exist; run scripts/seed-market-rates.mjs with --export-json`, () => {});
  });
}
