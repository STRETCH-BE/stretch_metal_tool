/**
 * scripts/seed-market-rates.mjs against a synthetic workbook: the mapping
 * (bands, laser upserts with interpolated placeholders, deburr/engrave,
 * general keys, lead time), the "not mapped" report, the rendered SQL, and
 * — with SMTOOL_LOCAL_PG=1 — the idempotent load into a scratch database:
 * created once, re-run without change, no-op when a quote uses the version
 * and the workbook is unchanged, refused when the workbook changed.
 * File path: /test/rates/seed-market-rates.test.ts
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readWorkbook } from "../../scripts/lib/xlsx.mjs";
import { writeWorkbook } from "../../scripts/lib/xlsx-write.mjs";
import { DEBURR_MIN_PART_MM, buildMarketVersion, renderSql } from "../../scripts/seed-market-rates.mjs";
import { PG_DATABASE, cleanupStaging, queryJson, queryScalar, resetDatabase, runSeed, runSql } from "../db/pg";

const SOURCE = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/placeholder-v1.json"), "utf8"));
const LABEL = "market-247+10% v1 (26 Sep 2026)";

function workbook(overrides: Partial<Record<string, unknown[][]>> = {}) {
  return writeWorkbook({
    settings: [
      ["key", "value"],
      ["rate_version_name", LABEL],
      ["markup", 1.1],
    ],
    "247_base": [["part", "price_247"], ["SMT01", 2.28]],
    materials_price_bands: [
      ["material_code", "max_thickness_mm", "price_per_kg_247", "price_per_kg_sell"],
      ["DC01", 2, 1.2, 1.32],
      ["DC01", 999, 1.1, 1.21],
      ["S235", 999, 1.0, 1.1],
      ["1.4301", 999, 3.5, 3.85],
      ["AlMg3", 999, 4.0, 4.4],
    ],
    rate_laser: [
      ["material_code", "thickness_mm", "price_per_m_sell", "price_per_pierce_sell", "setup_eur_sell", "gas", "min_contour_mm", "source"],
      ["DC01", 1.5, 2.2, 0.11, 11, "N2", 15, "247 list"],
      ["DC01", 2.5, 2.9, 0.15, 11, "N2", 25, "interpolated 2–3 mm"],
      ["S235", 3, 3.3, 0.2, 12, "O2", 30, "247 list"],
      ["S235", 14, 9.9, 0.9, 12, "O2", 140, "extrapolated"],
    ],
    rate_finish: [
      ["code", "price_247", "price_sell", "setup_per_order_sell"],
      ["deburr", 0.5, 0.55, 22],
      ["engrave", 3, 3.3, null],
    ],
    rate_general: [
      ["key", "value_247", "value_sell"],
      ["order_charge_eur", 35, 38.5],
      ["packaging_box_eur", 8, 8.8],
      ["packaging_pallet_eur", 40, 44],
      ["shipping_note", null, "pickup"],
    ],
    rate_leadtime: [
      ["working_days", "multiplier"],
      [11, 1],
      [6, 1.15],
      [3, 1.4],
    ],
    import_notes: [["note"], ["prices are 247 × 1.10"]],
    ...overrides,
  });
}

describe("seed-market-rates: mapping", () => {
  const build = buildMarketVersion(readWorkbook(workbook()), SOURCE);
  const { rows, report } = build;

  it("names the version from settings and copies the source rows", () => {
    expect(build.label).toBe(LABEL);
    expect(rows.materials).toHaveLength(SOURCE.materials.length);
    expect(rows.bend).toHaveLength(SOURCE.bend.length);
    expect(rows.weld).toHaveLength(SOURCE.weld.length);
  });

  it("materials: bands from the sheet, scrap 0, placeholder false; untouched materials keep their rows", () => {
    const dc01 = rows.materials.find((m: { code: string }) => m.code === "DC01")!;
    expect(dc01.price_per_kg).toEqual([
      { maxThicknessMm: 2, pricePerKg: 1.32 },
      { maxThicknessMm: 999, pricePerKg: 1.21 },
    ]);
    expect(dc01.scrap_pct_default).toBe(0);
    expect(dc01.placeholder).toBe(false);
    const brass = rows.materials.find((m: { code: string }) => m.code === "CuZn37")!;
    expect(brass.placeholder).toBe(true);
    expect(brass.scrap_pct_default).toBe(SOURCE.materials.find((m: { code: string }) => m.code === "CuZn37").scrap_pct_default);
  });

  it("laser: upsert per (material, thickness) as per-metre in-house rows; interpolated/extrapolated stay placeholders", () => {
    const dc15 = rows.laser.find((r: { material_code: string; thickness_mm: number; in_house: boolean }) => r.material_code === "DC01" && Number(r.thickness_mm) === 1.5 && r.in_house)!;
    expect(dc15).toMatchObject({ mode: "per_m", price_per_m: 2.2, price_per_pierce: 0.11, setup_eur: 11, gas: "N2", min_contour_mm: 15, speed_m_min: null, pierce_s: null, placeholder: false });
    const dc25 = rows.laser.find((r: { material_code: string; thickness_mm: number }) => r.material_code === "DC01" && Number(r.thickness_mm) === 2.5)!;
    expect(dc25.placeholder).toBe(true);
    const s14 = rows.laser.find((r: { material_code: string; thickness_mm: number }) => r.material_code === "S235" && Number(r.thickness_mm) === 14)!;
    expect(s14).toMatchObject({ placeholder: true, in_house: true, setup_eur: 12 });
    // the source's DC01/1.5, DC01/2.5 and S235/3 time rows were replaced, not duplicated; S235/14 is new
    expect(rows.laser.filter((r: { material_code: string; thickness_mm: number; in_house: boolean }) => r.material_code === "DC01" && Number(r.thickness_mm) === 1.5 && r.in_house)).toHaveLength(1);
    expect(rows.laser.length).toBe(SOURCE.laser.length + 1);
  });

  it("finish: deburr per metre with setup and minimum part rule, engrave per part", () => {
    const deburr = rows.finish.find((f: { code: string }) => f.code === "deburr")!;
    expect(deburr).toMatchObject({ unit: "m", price: 0.55, setup_per_order_eur: 22, min_part_mm: DEBURR_MIN_PART_MM, placeholder: false });
    const engrave = rows.finish.find((f: { code: string }) => f.code === "engrave")!;
    expect(engrave).toMatchObject({ unit: "part", price: 3.3, placeholder: false });
    expect(rows.finish.find((f: { code: string }) => f.code === "powder")!.placeholder).toBe(true);
  });

  it("general: charges from value_sell, market mode, labour 25, blank margin 0, default margin 30", () => {
    expect(rows.general).toMatchObject({
      order_charge_eur: 38.5,
      packaging_box_eur: 8.8,
      packaging_pallet_eur: 44,
      pricing_mode: "market",
      labour_rate_eur_h: 25,
      blank_margin_mm: 0,
      default_margin_pct: 30,
      placeholder: false,
    });
    expect(rows.general.machine_rate_eur_h).toBe(Number(SOURCE.general.machine_rate_eur_h));
  });

  it("lead time rows are sorted and not placeholders", () => {
    expect(rows.leadtime).toEqual([
      { working_days: 3, multiplier: 1.4, placeholder: false },
      { working_days: 6, multiplier: 1.15, placeholder: false },
      { working_days: 11, multiplier: 1, placeholder: false },
    ]);
  });

  it("reports everything it did not use", () => {
    expect(report.unmapped).toEqual(
      expect.arrayContaining([
        'sheet "247_base" (documentation, not imported)',
        'sheet "import_notes" (documentation, not imported)',
        "settings!markup = 1.1 (setting not used)",
        "materials_price_bands!price_per_kg_247 (column not used)",
        "rate_finish!price_247 (column not used)",
        'rate_general!shipping_note = "pickup" (no rate_general column)',
        "rate_general!value_247 (column not used)",
      ])
    );
    expect(report.warnings).toEqual([]);
  });

  it("fails loudly on a missing required column", () => {
    const broken = workbook({ rate_leadtime: [["days_x", "multiplier"], [11, 1]] });
    expect(() => buildMarketVersion(readWorkbook(broken), SOURCE)).toThrow(/rate_leadtime.*working_days/);
  });

  it("renders one DO block with the version lookup, the fingerprint guard, the inserts and the audit entry", () => {
    const sql = renderSql(build, { file: "wb.xlsx", sha256: "abc", sourceId: SOURCE.version.id, sourceLabel: SOURCE.version.label });
    expect(sql).toContain(`v_label constant text := '${LABEL}'`);
    expect(sql).toContain("v_fingerprint constant text := 'sha256 abc'");
    expect(sql).toContain("insert into public.rate_general (rate_version_id, machine_rate_eur_h");
    expect(sql).toContain("insert into public.rate_leadtime (rate_version_id, working_days, multiplier, placeholder) values\n    (v_new, 3, 1.4, false)");
    expect(sql).toContain("'rate_version.seed'");
    expect(sql).toContain("raise exception 'seed-market-rates: version % (%) is used by quotes and the workbook changed");
    expect(sql).toMatch(/\(v_new, 'deburr', 'Deburring', 'm', 0.55, 0, false, 22, 'steel 250x60/);
  });
});

const ENABLED = process.env.SMTOOL_LOCAL_PG === "1";

describe.skipIf(!ENABLED)("seed-market-rates: idempotent load into Postgres (SMTOOL_LOCAL_PG=1)", () => {
  const DB = PG_DATABASE;
  const bytes = workbook();
  const sha = createHash("sha256").update(bytes).digest("hex");
  const build = buildMarketVersion(readWorkbook(bytes), SOURCE);
  const sql = renderSql(build, { file: "wb.xlsx", sha256: sha, sourceId: SOURCE.version.id, sourceLabel: SOURCE.version.label });

  beforeAll(() => {
    resetDatabase(DB);
    runSeed(DB);
  });
  afterAll(() => cleanupStaging());

  const versionId = () => queryScalar(DB, `select id::text from public.rate_versions where label = '${LABEL.replace(/'/g, "''")}'`);
  const byLabel = `(select id from public.rate_versions where label = '${LABEL.replace(/'/g, "''")}')`;
  // Column named `tbl`, not `t`: the queryJson wrapper aliases the subquery `t` and a column of that name would shadow it.
  const rowCounts = () =>
    queryJson<{ tbl: string; n: number }>(
      DB,
      `select tbl, n from (select 'materials' tbl, count(*) n from public.materials where rate_version_id = ${byLabel} union all select 'rate_laser', count(*) from public.rate_laser where rate_version_id = ${byLabel} union all select 'rate_leadtime', count(*) from public.rate_leadtime where rate_version_id = ${byLabel} union all select 'audit', count(*) from public.audit_log where action = 'rate_version.seed') x order by tbl`
    );

  it("creates the version with the computed rows, never active, and audits the run", () => {
    const first = runSql(DB, sql, "market-seed", { singleTransaction: true });
    expect(first.stderr).toContain("created version");
    const id = versionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(queryScalar(DB, `select active::text from public.rate_versions where id = '${id}'`)).toBe("false");
    expect(queryScalar(DB, `select pricing_mode from public.rate_general where rate_version_id = '${id}'`)).toBe("market");
    expect(queryScalar(DB, `select count(*)::text from public.rate_versions`)).toBe("2");
    const counts = Object.fromEntries(rowCounts().map((r) => [r.tbl, Number(r.n)]));
    expect(counts.materials).toBe(build.rows.materials.length);
    expect(counts.rate_laser).toBe(build.rows.laser.length);
    expect(counts.rate_leadtime).toBe(3);
    expect(counts.audit).toBe(1);
    expect(queryScalar(DB, `select price_per_m::text from public.rate_laser where rate_version_id = '${id}' and material_code = 'DC01' and thickness_mm = 1.5 and in_house`)).toBe("2.2000");
    expect(queryScalar(DB, `select note from public.rate_versions where id = '${id}'`)).toContain(`sha256 ${sha}`);
    // the source (placeholder) version is untouched
    expect(queryScalar(DB, `select count(*)::text from public.materials where rate_version_id = '${SOURCE.version.id}' and scrap_pct_default = 0`)).toBe("0");
  });

  it("re-running replaces the rows in place (same counts, second audit entry) and keeps the id", () => {
    const before = versionId();
    runSql(DB, sql, "market-seed", { singleTransaction: true });
    expect(versionId()).toBe(before);
    const counts = Object.fromEntries(rowCounts().map((r) => [r.tbl, Number(r.n)]));
    expect(counts.rate_laser).toBe(build.rows.laser.length);
    expect(counts.audit).toBe(2);
  });

  it("is a no-op once a quote uses the version and the workbook is unchanged, and refuses a changed workbook", () => {
    const id = versionId();
    runSql(DB, `insert into public.quotes (number, version, rate_version_id) values ('SM-2099-0001', 1, '${id}')`);
    const again = runSql(DB, sql, "market-seed", { singleTransaction: true });
    expect(again.stderr).toContain("nothing to do");
    const changed = renderSql(build, { file: "wb2.xlsx", sha256: "different", sourceId: SOURCE.version.id, sourceLabel: null });
    expect(() => runSql(DB, changed, "market-seed-changed", { singleTransaction: true })).toThrow(/used by quotes and the workbook changed/);
    expect(queryScalar(DB, `select note from public.rate_versions where id = '${id}'`)).toContain(`sha256 ${sha}`);
  });
});
