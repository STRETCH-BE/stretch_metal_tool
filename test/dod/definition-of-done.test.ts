/**
 * Definition of done (docs/quoting-tool-build-prompt.md Step 14) as
 * executable assertions against the REAL modules and the REAL customer
 * fixtures, so the final report can cite one file per item.
 * File path: /test/dod/definition-of-done.test.ts
 *
 * Every `it` names the DoD item it demonstrates:
 *   1  200005.dxf / 200164.dxf through the geometry engine — green, Step 6
 *      numbers within tolerance, threads on 200005, 4 bend lines with
 *      directions on 200164.
 *   2  200005 as S355 / 15 mm — the flat-laser rule flags "subcontract —
 *      above 12.7 mm" and the cut is priced from the supplier per-metre row
 *      (with the test snapshot, and with the real seed.sql rates loaded from
 *      the local Postgres when SMTOOL_LOCAL_PG=1).
 *   3  200164 × 50, 90° on each bend, one 30/60 stitch weld — cutting,
 *      material, 4 bends, welding and setup spread over 50; the PDF renders
 *      PL/PLN and EN/EUR without cost or margin figures.
 *   4  Feasibility: 4 m bend in 12 mm S355 red (force), hole 5 mm from a
 *      bend in 8 mm amber, hole crossing a bend red, rolled part in 8 mm
 *      red, roll radius 150 mm red.
 *   5  Roles: the rate-editor actions refuse a sales session and let an
 *      admin clone a version; an old quote re-prices identically from its
 *      pinned snapshot after the active rates change.
 *   6  Send guard: red flag blocks, pending override blocks, approved
 *      override unblocks.
 *   7  Content: PL and EN have identical key shapes, no lorem ipsum, and
 *      the flags catalogue covers every FlagCode.
 *
 * Decisions:
 * - The DXFs are decoded and analysed exactly as lib/parts/intake.ts does
 *   (decodeDxfBytes → analyzeDxfSync, tolerance 0.01, blank margin 10),
 *   with the companion PDF text as forming hint.
 * - The Step 14 (3) seam is taken over the full 554.3 mm part length as
 *   the item states (the longest straight outer edge, which the seam is
 *   tagged on, measures 549.3 mm because of its R5 corner).
 * - The seed variant of item 2 uses its own scratch database
 *   (smtool_dod_test) so it never races test/db/seed.test.ts, which resets
 *   smtool_seed_test.
 * - The admin actions are exercised with the same module mocks as
 *   test/admin/rates-actions.test.ts (vi.mock is file-wide; nothing else
 *   imported here touches lib/auth, next/navigation or next/cache).
 * - Item 7 (desktop / tablet layouts, keyboard pass) is a manual check;
 *   only its "PL and EN both complete, no lorem ipsum" half is asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getContent } from "@/content";
import type {
  MachineRow,
  MaterialRow,
  RateBendRow,
  RateFeatureRow,
  RateFinishRow,
  RateGeneralRow,
  RateLaserRow,
  RateRollRow,
  RateThreadRow,
  RateTubeLaserRow,
  RateVersionRow,
  RateWeldRow,
} from "@/lib/db/types";
import { formatMoney, toQuoteCurrency, type Locale } from "@/lib/format";
import { analyzeDxfSync, decodeDxfBytes } from "@/lib/geometry";
import type { AnalyzeOptions, PartGeometry, WeldAnnotation } from "@/lib/geometry/types";
import { materialiseBends } from "@/lib/parts/annotation-edits";
import { flagMessage } from "@/lib/parts/flag-message";
import { extractPdfText } from "@/lib/pdf-text";
import { renderQuotePdf } from "@/lib/pdf/render";
import {
  evaluatePartFlags,
  familyThicknessLimitMm,
  findLaserRate,
  machineOf,
  priceQuote,
  rowsToMachinePark,
  rowsToRateSnapshot,
  type Flag,
  type FlagCode,
  type Loose,
  type MachinePark,
  type PricedQuote,
  type QuoteInput,
  type RateRows,
  type RateSnapshot,
} from "@/lib/pricing";
import { toJson } from "@/lib/quotes/mapper";
import { canSend } from "@/lib/quotes/send-guard";
import { cleanupStaging, queryJson, resetDatabase } from "@/test/db/pg";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID, cloneSnapshot } from "@/test/helpers/rates";
import { ADMIN_ID, ITEM_ID, PART_ID, amberFlag, makeBundle, makeOverride, makePartRow, redFlag } from "@/test/quotes/fixtures";
import { callsTo, fakeClient } from "@/test/admin/fake-supabase";

/* ─── DoD 5 mocks (same pattern as test/admin/rates-actions.test.ts) ─── */

const { createClient, redirect, getCurrentUser, logAudit, revalidatePath } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) =>
    Boolean(session && roles.includes(session.profile.role)),
  ADMIN_ONLY: ["admin"],
}));

import { activateRateVersionAction, cloneRateVersionAction, saveRateRow } from "@/lib/admin/rates-actions";

/* ─── Fixtures: the customer DXFs through the intake path ────────────── */

const FIXTURES = path.join(process.cwd(), "test/fixtures");
const LEN_TOL = 0.2;
const MASS_TOL = 0.005;

/** decodeDxfBytes → analyzeDxfSync with the intake defaults (lib/parts/intake.ts). */
function analyseFixture(name: string, options: Pick<AnalyzeOptions, "thicknessMm" | "densityKgM3">): PartGeometry {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, `${name}.dxf`)));
  const pdfText = fs.readFileSync(path.join(FIXTURES, `${name}.pdf.txt`), "utf8");
  return analyzeDxfSync(decodeDxfBytes(bytes), { toleranceMm: 0.01, blankMarginMm: 10, name, pdfText, ...options });
}

const G_200005 = analyseFixture("200005", { thicknessMm: 15, densityKgM3: 7850 });
const G_200164 = analyseFixture("200164", { thicknessMm: 2, densityKgM3: 7850 });

const near = (actual: number, expected: number, tolerance: number) => Math.abs(actual - expected) < tolerance;
const codes = (flags: Flag[]): FlagCode[] => flags.map((f) => f.code);
const find = (flags: Flag[], code: FlagCode): Flag | undefined => flags.find((f) => f.code === code);

/** DoD 2 input: the REAL 200005 geometry priced as S355 / 15 mm, qty 1. */
function s355PlateInput(): QuoteInput {
  const part = makePricingPart({
    id: "part-200005",
    name: "200005",
    geometry: G_200005,
    materialCode: "S355",
    thicknessMm: 15,
  });
  return makeQuoteInput({ marginPct: 30, parts: [part], items: [makeItem({ id: "item-200005", partId: part.id, qty: 1 })] });
}

/** The assertions of DoD 2 for any rate snapshot / machine park. */
function assertSubcontractAbove12_7(rates: RateSnapshot, machines: MachinePark): PricedQuote {
  const priced = priceQuote(s355PlateInput(), rates, machines);
  const item = priced.items[0];
  const types = item.operations.map((o) => o.type);
  expect(types).toContain("subcontract_cutting");
  expect(types).not.toContain("laser_cut");
  expect(types).toContain("material");

  const cut = item.operations.find((o) => o.type === "subcontract_cutting")!;
  expect(cut.rateRef.table).toBe("rate_laser");
  expect(cut.rateRef.key).toBe("S355/15/supplier");
  expect(cut.rateRef.values.inHouse).toBe(false);
  expect(cut.rateRef.values.mode).toBe("per_m");
  expect(cut.driverUnit).toBe("m");
  expect(cut.driverQty).toBeCloseTo(G_200005.measures.cutLengthMm / 1000, 6);
  const supplierRow = rates.laser.find((r) => r.materialCode === "S355" && r.thicknessMm === 15 && !r.inHouse)!;
  expect(supplierRow).toBeDefined();
  expect(cut.unitCost).toBeCloseTo((G_200005.measures.cutLengthMm / 1000) * supplierRow.pricePerM! + 26 * supplierRow.pricePerPierce, 9);

  const flag = find(priced.flags, "laser.thickness_over_limit")!;
  expect(flag).toBeDefined();
  expect(flag.severity).toBe("amber");
  expect(flag.overridable).toBe(true);
  expect(flag.partId).toBe("part-200005");
  expect(flag.params.limitMm).toBe(12.7);
  expect(flag.params.thicknessMm).toBe(15);
  expect(flag.params.family).toBe("mild_steel");
  expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
  return priced;
}

/* ─── DoD 1 ──────────────────────────────────────────────────────────── */

describe("Definition of done — 1. customer DXFs through the geometry engine", () => {
  it("DoD 1 — 200005.dxf: green, 500 × 220 mm, cut 2 224.5 mm, 26 pierces, 11.99 kg, threads M8 ×8 and M10x1 ×6, no bend lines", () => {
    const m = G_200005.measures;
    expect(G_200005.triage.state).toBe("green");
    expect(G_200005.partCount).toBe(1);
    expect(near(m.bbox.width, 500, LEN_TOL)).toBe(true);
    expect(near(m.bbox.height, 220, LEN_TOL)).toBe(true);
    expect(near(m.cutLengthMm, 2224.5, LEN_TOL)).toBe(true);
    expect(m.pierces).toBe(26);
    expect(m.holes).toHaveLength(25);
    expect(m.massKg).not.toBeNull();
    expect(near(m.massKg!, 11.99, MASS_TOL)).toBe(true);
    const threads = m.holes.map((h) => h.thread?.size ?? null);
    expect(threads.filter((s) => s === "M8")).toHaveLength(8);
    expect(threads.filter((s) => s === "M10x1")).toHaveLength(6);
    expect(threads.filter((s) => s !== null)).toHaveLength(14);
    expect(m.bendLines).toHaveLength(0);
  });

  it("DoD 1 — 200164.dxf: green, cut 1 796.1 mm, 33 pierces, 0.509 kg, 4 × 60 mm bend lines — up at x 156.926, down at x −1.131 / 39.355 / 98.356", () => {
    const m = G_200164.measures;
    expect(G_200164.triage.state).toBe("green");
    expect(G_200164.triage.reasons).toContain("bend_layers_found");
    expect(near(m.bbox.width, 554.3, LEN_TOL)).toBe(true);
    expect(near(m.bbox.height, 60, LEN_TOL)).toBe(true);
    expect(near(m.cutLengthMm, 1796.1, LEN_TOL)).toBe(true);
    expect(m.pierces).toBe(33);
    expect(m.massKg).not.toBeNull();
    expect(near(m.massKg!, 0.509, MASS_TOL)).toBe(true);

    expect(m.bendLines).toHaveLength(4);
    for (const b of m.bendLines) expect(near(b.lengthMm, 60, LEN_TOL)).toBe(true);
    const up = m.bendLines.filter((b) => b.direction === "up");
    const down = m.bendLines.filter((b) => b.direction === "down");
    expect(up).toHaveLength(1);
    expect(down).toHaveLength(3);
    expect(up[0].start.x).toBeCloseTo(156.926, 2);
    expect(up[0].end.x).toBeCloseTo(156.926, 2);
    const downX = down.map((b) => b.start.x).sort((a, b) => a - b);
    expect(downX[0]).toBeCloseTo(-1.131, 2);
    expect(downX[1]).toBeCloseTo(39.355, 2);
    expect(downX[2]).toBeCloseTo(98.356, 2);
  });
});

/* ─── DoD 2 ──────────────────────────────────────────────────────────── */

describe("Definition of done — 2. 200005 as S355 / 15 mm → subcontract above 12.7 mm", () => {
  it("DoD 2 — subcontract_cutting from the supplier per-metre row, no laser_cut, amber laser.thickness_over_limit with limitMm 12.7 (test snapshot)", () => {
    const priced = assertSubcontractAbove12_7(RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(priced.rateVersionId).toBe(RATE_VERSION_ID);
    expect(priced.items[0].unitPrice).toBeCloseTo(priced.items[0].unitCost / 0.7, 9);
  });

  it("DoD 2 — the flag renders in PL and EN naming the 12.7 mm limit (content/flags)", () => {
    const priced = priceQuote(s355PlateInput(), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = find(priced.flags, "laser.thickness_over_limit")!;
    const pl = flagMessage(getContent("pl").flags, flag, "pl");
    const en = flagMessage(getContent("en").flags, flag, "en");
    expect(pl).toContain("12,7");
    expect(pl).toContain("15 mm");
    expect(pl).toContain(getContent("pl").flags.families.mild_steel);
    expect(en).toContain("12.7");
    expect(en).toContain("15 mm");
    expect(en).toContain(getContent("en").flags.families.mild_steel);
    expect(pl).not.toMatch(/\{\w+\}/);
    expect(en).not.toMatch(/\{\w+\}/);
    expect(getContent("pl").flags.flags["laser.thickness_over_limit"].label).toMatch(/kooperacja/i);
    expect(getContent("en").flags.flags["laser.thickness_over_limit"].label).toMatch(/subcontract/i);
  });
});

/* ─── DoD 2 with the real seed rates (local Postgres) ────────────────── */

const LOCAL_PG = process.env.SMTOOL_LOCAL_PG === "1";
/** Own scratch database: test/db/seed.test.ts resets smtool_seed_test in parallel. */
const DOD_DB = process.env.SMTOOL_DOD_PG_DATABASE ?? "smtool_dod_test";

/** The rows lib/rates/load.ts reads, taken straight from the seeded tables. */
function loadSeededRates(db: string, versionId: string): { rates: RateSnapshot; machines: MachinePark } {
  const where = `where rate_version_id = '${versionId}'`;
  const [version] = queryJson<Pick<RateVersionRow, "id" | "label">>(db, `select id, label from public.rate_versions where id = '${versionId}'`);
  const [general] = queryJson<Loose<RateGeneralRow>>(db, `select * from public.rate_general ${where}`);
  expect(version).toBeDefined();
  expect(general).toBeDefined();
  const rows: RateRows = {
    version,
    general,
    materials: queryJson<Loose<MaterialRow>>(db, `select * from public.materials ${where} order by code`),
    laser: queryJson<Loose<RateLaserRow>>(db, `select * from public.rate_laser ${where} order by material_code, thickness_mm`),
    tubeLaser: queryJson<Loose<RateTubeLaserRow>>(db, `select * from public.rate_tube_laser ${where} order by profile_family, wall_mm`),
    bend: queryJson<Loose<RateBendRow>>(db, `select * from public.rate_bend ${where} order by thickness_mm, length_class_mm`),
    roll: queryJson<Loose<RateRollRow>>(db, `select * from public.rate_roll ${where} order by thickness_mm, radius_class_mm`),
    weld: queryJson<Loose<RateWeldRow>>(db, `select * from public.rate_weld ${where} order by process, bead_mm`),
    thread: queryJson<Loose<RateThreadRow>>(db, `select * from public.rate_thread ${where} order by size`),
    feature: queryJson<Loose<RateFeatureRow>>(db, `select * from public.rate_feature ${where} order by code`),
    finish: queryJson<Loose<RateFinishRow>>(db, `select * from public.rate_finish ${where} order by code`),
  };
  const machines = queryJson<Pick<MachineRow, "code" | "name" | "kind" | "limits">>(
    db,
    "select code, name, kind, limits from public.machines order by code"
  );
  return { rates: rowsToRateSnapshot(rows), machines: rowsToMachinePark(machines) };
}

describe.skipIf(!LOCAL_PG)("Definition of done — 2. with the real supabase/seed.sql rates (SMTOOL_LOCAL_PG=1)", () => {
  let seeded: { rates: RateSnapshot; machines: MachinePark };

  beforeAll(() => {
    resetDatabase(DOD_DB);
    seeded = loadSeededRates(DOD_DB, RATE_VERSION_ID);
  }, 180_000);

  afterAll(() => {
    cleanupStaging();
  });

  it("DoD 2 — seed.sql: findLaserRate S355 / 15 mm → over_limit, supplier row 6.00 €/m + 0.50 €/pierce, limit 12.7 from the machines table", () => {
    const flat = machineOf(seeded.machines, "flat_laser");
    expect(flat).not.toBeNull();
    const limit = familyThicknessLimitMm(flat!.limits, "mild_steel");
    expect(limit).toBe(12.7);
    const lookup = findLaserRate(seeded.rates, "S355", 15, limit);
    expect(lookup).toMatchObject({ subcontract: true, reason: "over_limit", exactThickness: true, limitMm: 12.7 });
    expect(lookup.row).toMatchObject({ materialCode: "S355", thicknessMm: 15, inHouse: false, mode: "per_m", pricePerM: 6, pricePerPierce: 0.5 });
    // 12.7 mm itself is still in-house on the seeded ladder.
    expect(findLaserRate(seeded.rates, "S355", 12.7, limit)).toMatchObject({ subcontract: false, reason: "in_house" });
  });

  it("DoD 2 — seed.sql: the priced 200005 plate switches to subcontract_cutting and carries the amber 12.7 mm flag", () => {
    expect(seeded.rates.versionId).toBe(RATE_VERSION_ID);
    expect(seeded.rates.label).toContain("[CONFIRM]");
    const priced = assertSubcontractAbove12_7(seeded.rates, seeded.machines);
    expect(priced.rateVersionId).toBe(RATE_VERSION_ID);
    expect(priced.usesPlaceholderRates).toBe(true);
    const cut = priced.items[0].operations.find((o) => o.type === "subcontract_cutting")!;
    expect(cut.rateRef.values.pricePerM).toBe(6);
    expect(cut.rateRef.values.pricePerPierce).toBe(0.5);
    expect(String(cut.rateRef.values.supplier)).toContain("[CONFIRM]");
  });
});

/* ─── DoD 3 ──────────────────────────────────────────────────────────── */

const NOW = new Date("2026-09-25T12:00:00Z");
const QUOTE_NUMBER = "SM-2026-0001";

/** Step 14 (3): the REAL 200164 geometry, DC01 2 mm, qty 50, 90° on each bend, one 30/60 stitch seam. */
function bracketScenario() {
  const bends = materialiseBends(makeAnnotations(), G_200164, 2);
  const longestEdge = G_200164.entities
    .filter((e) => e.role === "cut" && e.originalType === "LINE")
    .sort((a, b) => b.lengthMm - a.lengthMm)[0];
  const weld: WeldAnnotation = {
    id: "w1",
    entityIds: [longestEdge.id],
    points: null,
    lengthMm: 554.3,
    process: "mig_mag",
    beadMm: 4,
    pattern: "stitch",
    stitch: { beadLengthMm: 30, pitchMm: 60 },
    sides: 1,
    effectiveLengthMm: 554.3 * (30 / 60),
  };
  const annotations = makeAnnotations({ bends, welds: [weld] });
  const part = makePricingPart({
    id: PART_ID,
    name: "200164",
    geometry: G_200164,
    materialCode: "DC01",
    thicknessMm: 2,
    annotations,
  });
  const input = makeQuoteInput({ marginPct: 30, parts: [part], items: [makeItem({ id: ITEM_ID, partId: PART_ID, qty: 50 })] });
  return { bends, annotations, input, priced: priceQuote(input, RATE_SNAPSHOT_V1, MACHINE_PARK) };
}

describe("Definition of done — 3. 200164 × 50 with 90° bends and a 30/60 stitch weld", () => {
  const { bends, priced } = bracketScenario();
  const item = priced.items[0];
  const types = item.operations.map((o) => o.type);

  it("DoD 3 — the 4 geometry bend lines materialise as 90° bend annotations (radius = t)", () => {
    expect(bends).toHaveLength(4);
    expect(bends.every((b) => b.angleDeg === 90)).toBe(true);
    expect(bends.every((b) => b.radiusMm === 2)).toBe(true);
    expect(bends.filter((b) => b.direction === "up")).toHaveLength(1);
    expect(bends.filter((b) => b.direction === "down")).toHaveLength(3);
    expect(bends.every((b) => near(b.lengthMm, 60, LEN_TOL))).toBe(true);
  });

  it("DoD 3 — the quote shows cutting, material, exactly 4 bends, one weld and setup spread over 50 pieces", () => {
    expect(item.qty).toBe(50);
    expect(types).toContain("laser_cut");
    expect(types).toContain("material");
    expect(types.filter((t) => t === "bend")).toHaveLength(4);
    const bendLines = item.operations.filter((o) => o.type === "bend");
    expect(bendLines.every((o) => o.details.angleDeg === 90 && o.details.origin === "annotation")).toBe(true);
    expect(bendLines.every((o) => o.unitCost === 0.9)).toBe(true); // ≤ 500 mm class, ≤ 6 mm

    const welds = item.operations.filter((o) => o.type === "weld");
    expect(welds).toHaveLength(1);
    expect(near(Number(welds[0].details.effectiveLengthMm), 554.3 * (30 / 60), 0.5)).toBe(true);
    expect(near(welds[0].driverQty, 277.15, 0.5)).toBe(true);
    expect(welds[0].unitCost).toBeCloseTo(277.15 * 0.045, 9);
    expect(welds[0].rateRef.key).toBe("mig_mag/4");

    const setups = item.operations.filter((o) => o.type === "setup");
    expect(setups.map((s) => s.label).sort()).toEqual(["bend_setup", "weld_setup"]);
    const bendSetup = setups.find((s) => s.label === "bend_setup")!;
    const weldSetup = setups.find((s) => s.label === "weld_setup")!;
    expect(bendSetup.unitCost).toBeCloseTo(8 / 50, 12);
    expect(bendSetup.details.qty).toBe(50);
    expect(weldSetup.unitCost).toBeCloseTo(15 / 50, 12);
    expect(weldSetup.details.qty).toBe(50);
    expect(priced.totalsByType.setup?.cost).toBeCloseTo(8 + 15, 9);
  });

  it("DoD 3 — unit price = unit cost / (1 − 30 %), batch = × 50, no red flags", () => {
    const sum = item.operations.reduce((acc, o) => acc + o.unitCost, 0);
    expect(item.unitCost).toBeCloseTo(sum, 9);
    expect(Math.abs(item.unitPrice - item.unitCost / 0.7)).toBeLessThan(1e-6);
    expect(item.batchPrice).toBeCloseTo(item.unitPrice * 50, 6);
    expect(priced.subtotalPrice).toBeCloseTo(item.batchPrice, 6);
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
  });

  const renders = [
    { locale: "pl" as Locale, currency: "PLN" as const, fx: 4.3, country: "PL", name: "Acme Metal Sp. z o.o.", symbol: /zł|PLN/ },
    { locale: "en" as Locale, currency: "EUR" as const, fx: 1, country: "DE", name: "Muster Metallbau GmbH", symbol: /€|EUR/ },
  ];

  for (const c of renders) {
    it(`DoD 3 — the PDF renders ${c.locale.toUpperCase()} in ${c.currency} with the quote number and prices, and no cost or margin`, async () => {
      const { annotations } = bracketScenario();
      const bundle = makeBundle({
        priced,
        quote: { number: QUOTE_NUMBER, currency: c.currency, fx_rate: c.fx, show_operations_on_pdf: true },
        customer: { name: c.name, country: c.country },
        parts: [makePartRow({ geometry: toJson(G_200164), annotations: toJson(annotations) })],
      });
      const pdf = await renderQuotePdf(bundle, { locale: c.locale, showOperations: true, preparedBy: "Jan Kowalski", now: NOW });
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const text = await extractPdfText(pdf);
      const flat = text.text.replace(/\s+/g, " ");
      const norm = (s: string) => s.replace(/[\s  ]/g, "");
      expect(text.pageCount).toBeGreaterThanOrEqual(1);
      expect(flat).toContain(QUOTE_NUMBER);
      expect(flat).toContain(c.name);
      expect(flat).toMatch(c.symbol);

      // Prices in the quote currency are on the page …
      const unitPrice = formatMoney(toQuoteCurrency(item.unitPrice, c.currency, c.fx), c.currency, c.locale);
      const total = formatMoney(toQuoteCurrency(priced.subtotalPrice, c.currency, c.fx), c.currency, c.locale);
      expect(norm(flat)).toContain(norm(unitPrice));
      expect(norm(flat)).toContain(norm(total));
      // … cost and margin never are.
      for (const cost of [item.unitCost, item.batchCost, priced.subtotalCost]) {
        expect(norm(flat)).not.toContain(norm(formatMoney(toQuoteCurrency(cost, c.currency, c.fx), c.currency, c.locale)));
      }
      expect(flat).not.toMatch(/margin/i);
      expect(flat).not.toMatch(/marża/i);
      expect(flat).not.toMatch(/markup/i);
      expect(flat).not.toMatch(/narzut/i);
    }, 30_000);
  }
});

/* ─── DoD 4 ──────────────────────────────────────────────────────────── */

describe("Definition of done — 4. feasibility rules", () => {
  it("DoD 4 — a 4 000 mm bend in 12 mm S355 is red bend.force_over_limit (F = 1.42 × Rm × t² × L / V > 3 200 kN)", () => {
    const geometry = makeRectPartGeometry({
      lengthMm: 4000,
      widthMm: 500,
      thicknessMm: 12,
      densityKgM3: 7850,
      bendLines: [{ id: "b-4m", x1: 0, y1: 250, x2: 4000, y2: 250, direction: "up" }],
    });
    const part = makePricingPart({ geometry, materialCode: "S355", thicknessMm: 12 });
    const flags = evaluatePartFlags(part, makeItem({ partId: part.id }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = find(flags, "bend.force_over_limit")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("red");
    expect(flag.overridable).toBe(false);
    expect(flag.params.bendId).toBe("b-4m");
    expect(flag.params.limitKN).toBe(3200);
    expect(flag.params.dieVMm).toBe(96);
    expect(Number(flag.params.forceKN)).toBeCloseTo((1.42 * 510 * 144 * 4000) / 96 / 1000, 6);
    expect(Number(flag.params.forceKN)).toBeGreaterThan(3200);
    expect(find(flags, "bend.length_over_limit")).toBeUndefined(); // 4 000 < 4 420 mm
  });

  it("DoD 4 — a hole whose edge is 5 mm from a bend line in 8 mm is amber bend.hole_near_bend (minimum 2.5 × t = 20 mm)", () => {
    const geometry = makeRectPartGeometry({
      lengthMm: 300,
      widthMm: 200,
      thicknessMm: 8,
      densityKgM3: 7850,
      holes: [{ x: 160, y: 100, diameterMm: 10 }],
      bendLines: [{ id: "b1", x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }],
    });
    const part = makePricingPart({ geometry, materialCode: "S355", thicknessMm: 8 });
    const flags = evaluatePartFlags(part, makeItem({ partId: part.id }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = find(flags, "bend.hole_near_bend")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("amber");
    expect(flag.overridable).toBe(true);
    expect(flag.params.minMm).toBe(20);
    expect(Number(flag.params.distanceMm)).toBeCloseTo(5, 6);
    expect(flag.params.count).toBe(1);
    expect(find(flags, "bend.hole_crosses_bend")).toBeUndefined();
    expect(flags.filter((f) => f.severity === "red")).toEqual([]);
  });

  it("DoD 4 — a hole crossing a bend line is red bend.hole_crosses_bend", () => {
    const geometry = makeRectPartGeometry({
      lengthMm: 300,
      widthMm: 200,
      thicknessMm: 8,
      densityKgM3: 7850,
      holes: [{ x: 152, y: 100, diameterMm: 10 }],
      bendLines: [{ id: "b1", x1: 150, y1: 0, x2: 150, y2: 200, direction: "up" }],
    });
    const part = makePricingPart({ geometry, materialCode: "S355", thicknessMm: 8 });
    const flags = evaluatePartFlags(part, makeItem({ partId: part.id }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = find(flags, "bend.hole_crosses_bend")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("red");
    expect(flag.overridable).toBe(false);
    expect(flag.params.count).toBe(1);
    expect(flag.params.loopIds).toBe("loop-hole-1");
  });

  it("DoD 4 — a rolled part in 8 mm is red roll.thickness_over_limit (roll limit 6 mm)", () => {
    const geometry = makeRectPartGeometry({ lengthMm: 1000, widthMm: 800, thicknessMm: 8, densityKgM3: 7850 });
    const part = makePricingPart({
      geometry,
      materialCode: "S235",
      thicknessMm: 8,
      annotations: makeAnnotations({
        roll: { radiusMm: 500, axis: "x", arcAngleDeg: 90, axisLengthMm: 1000, developedWidthMm: 800, cone: null },
      }),
    });
    const flags = evaluatePartFlags(part, makeItem({ partId: part.id }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = find(flags, "roll.thickness_over_limit")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("red");
    expect(flag.params.thicknessMm).toBe(8);
    expect(flag.params.maxThicknessMm).toBe(6);
    expect(find(flags, "roll.radius_too_small")).toBeUndefined();
    expect(find(flags, "roll.axis_too_long")).toBeUndefined();
  });

  it("DoD 4 — roll radius 150 mm in 3 mm is red roll.radius_too_small (minimum 200 mm)", () => {
    const geometry = makeRectPartGeometry({ lengthMm: 1000, widthMm: 300, thicknessMm: 3, densityKgM3: 7850 });
    const part = makePricingPart({
      geometry,
      materialCode: "S235",
      thicknessMm: 3,
      annotations: makeAnnotations({
        roll: { radiusMm: 150, axis: "x", arcAngleDeg: 180, axisLengthMm: 1000, developedWidthMm: 300, cone: null },
      }),
    });
    const flags = evaluatePartFlags(part, makeItem({ partId: part.id }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = find(flags, "roll.radius_too_small")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("red");
    expect(flag.params.radiusMm).toBe(150);
    expect(flag.params.minRadiusMm).toBe(200);
    expect(codes(flags)).not.toContain("roll.thickness_over_limit");
  });
});

/* ─── DoD 5 ──────────────────────────────────────────────────────────── */

const VERSION_V2 = "00000000-0000-4000-8000-000000000002";
const ROW_ID = "5b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const ADMIN = { user: { id: "admin-1" }, profile: { role: "admin" } };
const SALES = { user: { id: "sales-1" }, profile: { role: "sales" } };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("Definition of done — 5. roles and rate-version pinning", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    redirect.mockClear();
    revalidatePath.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("DoD 5 — a sales session is refused by every rate-editor action before any database call", async () => {
    getCurrentUser.mockResolvedValue(SALES);
    await expect(cloneRateVersionAction(form({ source: RATE_VERSION_ID, label: "v2" }))).rejects.toThrow("NEXT_REDIRECT:/forbidden");
    await expect(activateRateVersionAction(RATE_VERSION_ID)).rejects.toThrow("NEXT_REDIRECT:/forbidden");
    const save = await saveRateRow({
      versionId: RATE_VERSION_ID,
      table: "materials",
      ref: { id: ROW_ID },
      values: { code: "S355", name: "S355J2", family: "mild_steel", density_kg_m3: 7850, rm_n_mm2: 510, price_per_kg: "[]", sheet_formats: "[]", scrap_pct_default: 25 },
    });
    expect(save).toEqual({ ok: false, error: "forbidden" });
    expect(createClient).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("DoD 5 — an admin can create a new rate version (clone → audit → opens the draft)", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const client = fakeClient({}, { clone_rate_version: { data: VERSION_V2 } });
    createClient.mockResolvedValue(client);
    await expect(cloneRateVersionAction(form({ source: RATE_VERSION_ID, label: "v2 confirmed rates" }))).rejects.toThrow(
      `NEXT_REDIRECT:/admin/rates/${VERSION_V2}?notice=cloned`
    );
    expect(client.rpc).toHaveBeenCalledWith("clone_rate_version", { p_source: RATE_VERSION_ID, p_label: "v2 confirmed rates" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "admin-1", action: "rate_version.clone", entityId: VERSION_V2, after: { id: VERSION_V2, label: "v2 confirmed rates" } })
    );
    expect(callsTo(client.calls, "rate_versions", "update")).toHaveLength(0);
  });

  it("DoD 5 — an old quote keeps its old prices: re-pricing with the pinned snapshot is byte-identical after the S355 price doubled in v2", () => {
    const first = priceQuote(s355PlateInput(), RATE_SNAPSHOT_V1, MACHINE_PARK);

    const v2 = cloneSnapshot();
    v2.versionId = VERSION_V2;
    v2.label = "v2 — S355 doubled";
    for (const band of v2.materials.find((m) => m.code === "S355")!.pricePerKg) band.pricePerKg *= 2;
    const withV2 = priceQuote(s355PlateInput(), v2, MACHINE_PARK);
    const materialV1 = first.items[0].operations.find((o) => o.type === "material")!;
    const materialV2 = withV2.items[0].operations.find((o) => o.type === "material")!;
    expect(materialV2.unitCost).toBeCloseTo(materialV1.unitCost * 2, 9);
    expect(withV2.subtotalPrice).toBeGreaterThan(first.subtotalPrice);
    expect(withV2.rateVersionId).toBe(VERSION_V2);

    const again = priceQuote(s355PlateInput(), RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(again).toEqual(first);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(again.rateVersionId).toBe(RATE_VERSION_ID);
  });
});

/* ─── DoD 6 ──────────────────────────────────────────────────────────── */

describe("Definition of done — 6. send guard and overrides", () => {
  it("DoD 6 — a red-flagged quote cannot be sent (red_flags), not even with an approved override", () => {
    const blocked = canSend(makeBundle({ flags: [redFlag()] }));
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons).toContain("red_flags");
    const overridden = canSend(
      makeBundle({
        flags: [redFlag()],
        overrides: [makeOverride({ rule_code: "bend.force_over_limit", status: "approved", decided_by: ADMIN_ID, decided_at: "2026-09-25T12:00:00Z" })],
      })
    );
    expect(overridden.ok).toBe(false);
    expect(overridden.reasons).toEqual(["red_flags"]);
  });

  it("DoD 6 — an amber flag with a pending override request is blocked (pending_override)", () => {
    const pending = makeOverride({ status: "pending" });
    const check = canSend(makeBundle({ flags: [amberFlag()], overrides: [pending], quote: { status: "pending_override" } }));
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("pending_override");
    expect(pending.rule_code).toBe(amberFlag().code);
    expect(pending.part_id).toBe(PART_ID);
  });

  it("DoD 6 — once the admin approves that override the same quote can be sent", () => {
    const approved = makeOverride({ status: "approved", decided_by: ADMIN_ID, decided_at: "2026-09-25T12:00:00Z", decision_note: "ok" });
    const check = canSend(makeBundle({ flags: [amberFlag()], overrides: [approved], quote: { status: "pending_override" } }));
    expect(check).toEqual({ ok: true, reasons: [] });
    // A rejection leaves the flag uncovered.
    const rejected = makeOverride({ status: "rejected", decided_by: ADMIN_ID, decided_at: "2026-09-25T12:00:00Z" });
    expect(canSend(makeBundle({ flags: [amberFlag()], overrides: [rejected] })).reasons).toEqual(["amber_unconfirmed"]);
  });
});

/* ─── DoD 7 ──────────────────────────────────────────────────────────── */

/** Compile-time exhaustive: a FlagCode missing here (or an extra key) fails `satisfies`. */
const FLAG_CODES = {
  "geometry.manual": true,
  "geometry.triage_amber": true,
  "geometry.triage_red": true,
  "geometry.units_unconfirmed": true,
  "geometry.no_material": true,
  "geometry.no_thickness": true,
  "laser.thickness_over_limit": true,
  "laser.blank_exceeds_bed": true,
  "laser.no_rate_row": true,
  "laser.slow_contours": true,
  "laser.subcontract": true,
  "material.no_price": true,
  "material.mass_handling": true,
  "bend.force_over_limit": true,
  "bend.length_over_limit": true,
  "bend.hole_near_bend": true,
  "bend.hole_crosses_bend": true,
  "bend.short_flange": true,
  "bend.no_rate_row": true,
  "roll.radius_too_small": true,
  "roll.axis_too_long": true,
  "roll.thickness_over_limit": true,
  "roll.no_rate_row": true,
  "weld.no_rate_row": true,
  "weld.min_order_applied": true,
  "tube.over_limit": true,
  "tube.no_rate_row": true,
  "thread.no_rate_row": true,
  "feature.no_rate_row": true,
  "finish.no_rate_row": true,
  "finish.minimum_applied": true,
  "rates.placeholder": true,
} satisfies Record<FlagCode, true>;

/** Same shape logic as content/parity.test.ts: every leaf path with its type. */
function shape(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [`${prefix}:array`];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  }
  return [`${prefix}:${typeof value}`];
}

describe("Definition of done — 7. PL and EN complete", () => {
  const pl = getContent("pl");
  const en = getContent("en");

  it("DoD 7 — getContent('pl') and getContent('en') expose identical key shapes in every domain", () => {
    const domains = (Object.keys(pl) as (keyof typeof pl)[]).filter((d) => d !== "locale");
    expect(domains.sort()).toEqual(["admin", "common", "flags", "guide", "pdf", "quote", "upload", "viewer"]);
    for (const domain of domains) {
      expect(shape(en[domain]).sort(), domain).toEqual(shape(pl[domain]).sort());
    }
    expect(pl.locale).toBe("pl");
    expect(en.locale).toBe("en");
  });

  it("DoD 7 — no lorem ipsum, TODO or empty string anywhere in either dictionary", () => {
    const text = JSON.stringify([pl, en]).toLowerCase();
    expect(text).not.toMatch(/lorem ipsum/);
    expect(text).not.toMatch(/\btodo\b/);
    const leaves = (value: unknown): unknown[] =>
      value && typeof value === "object" ? Object.values(value as Record<string, unknown>).flatMap(leaves) : [value];
    const empties = [...leaves(pl), ...leaves(en)].filter((v) => typeof v === "string" && v.trim().length === 0);
    expect(empties).toEqual([]);
  });

  it("DoD 7 — the flags catalogue covers every FlagCode with a label and message in PL and EN", () => {
    const expected = Object.keys(FLAG_CODES).sort();
    expect(Object.keys(pl.flags.flags).sort()).toEqual(expected);
    expect(Object.keys(en.flags.flags).sort()).toEqual(expected);
    for (const code of expected as FlagCode[]) {
      expect(pl.flags.flags[code].label.trim().length, `pl ${code}`).toBeGreaterThan(0);
      expect(pl.flags.flags[code].message.trim().length, `pl ${code}`).toBeGreaterThan(0);
      expect(en.flags.flags[code].label.trim().length, `en ${code}`).toBeGreaterThan(0);
      expect(en.flags.flags[code].message.trim().length, `en ${code}`).toBeGreaterThan(0);
    }
  });
});
