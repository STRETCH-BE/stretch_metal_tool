/**
 * supabase/seed.sql against a fresh local Postgres (migration + seed).
 * File path: /test/db/seed.test.ts
 *
 * Skipped unless SMTOOL_LOCAL_PG=1 — CI without the local Postgres from
 * CLAUDE.md must stay green. Run with:
 *   SMTOOL_LOCAL_PG=1 npx vitest run test/db
 *
 * What it checks: the seed applies on top of the migration, exactly one
 * active rate version exists, every rate table has the row count the build
 * prompt (Step 9) asks for, the JSON columns match the shapes in
 * lib/pricing/types.ts (compile-time key check + runtime), machines.limits
 * validates against the zod schemas of lib/pricing/snapshot.ts when that
 * module exists (built in parallel — imported lazily, assertion skipped when
 * missing), a second run neither errors nor duplicates, an EDITED seed lands
 * on re-run but inserts nothing into a version quotes reference (row sets
 * compared, not counts), a failure anywhere in the seed leaves the previous
 * rate set intact (single-statement seed + the documented psql -1 command),
 * every stock gauge within the flat-laser limit prices in-house through the
 * real lookup (lib/pricing/lookup.ts findLaserRate), the seed never steals
 * activation from a newer version, and next_quote_number() yields
 * SM-<year>-0001.
 *
 * Seed variants (edited / broken copies) are made by regex edits of the file
 * text; each anchor must match exactly once so a reworded seed fails loudly
 * instead of making the test vacuous.
 */

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  FlatLaserLimits,
  LaserRate,
  MachineKind,
  MaterialFamily,
  PressBrakeLimits,
  RateSnapshot,
  RollLimits,
  ThicknessBandPrice,
  TubeLaserLimits,
  WeldLimits,
} from "@/lib/pricing/types";
import type { WeldProcess } from "@/lib/geometry/types";
import { familyThicknessLimitMm, findLaserRate } from "@/lib/pricing/lookup";
import {
  PG_DATABASE,
  SEED_SQL,
  cleanupStaging,
  queryJson,
  queryScalar,
  resetDatabase,
  runSeed,
  runSql,
} from "./pg";

const ENABLED = process.env.SMTOOL_LOCAL_PG === "1";
const DB = PG_DATABASE;
const V1 = "00000000-0000-4000-8000-000000000001";
const V2 = "00000000-0000-4000-8000-000000000002";

/** Built in parallel by the pricing owner; may not exist yet. */
const SNAPSHOT_MODULE = "../../lib/pricing/snapshot";

/* ─── Expected laser ladder (build prompt Step 9 + stock gauges) ────────── */

/**
 * Sheet gauges the shop stocks per family. All are within the TruFiber
 * 12001 limit of that family (12.7 / 12.7 / 6 / 6 / 6 mm) and the seed must
 * price every one of them in-house: findLaserRate needs an exact in-house
 * thickness row, otherwise it falls back to the nearest SUPPLIER row (a
 * 2.5 mm bracket would be priced from the 15 mm subcontract tariff).
 */
const STOCK_GAUGES_MM: Record<MaterialFamily, readonly number[]> = {
  mild_steel: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 12.7],
  stainless: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 12.7],
  aluminium: [1, 1.5, 2, 2.5, 3, 4, 5, 6],
  brass: [1, 1.5, 2, 2.5, 3, 4, 5, 6],
  copper: [1, 1.5, 2, 2.5, 3, 4, 5, 6],
};

/** Mild-steel placeholder cutting data: Step 9 values plus interpolated stock gauges. */
const MILD_STEEL_BASE: Record<number, { speed: number; pierce: number }> = {
  1: { speed: 25, pierce: 0.2 },
  1.5: { speed: 20.5, pierce: 0.25 },
  2: { speed: 16, pierce: 0.3 },
  2.5: { speed: 13.5, pierce: 0.35 },
  3: { speed: 11, pierce: 0.4 },
  4: { speed: 7, pierce: 0.6 },
  5: { speed: 5.5, pierce: 0.8 },
  6: { speed: 4.5, pierce: 1.0 },
  8: { speed: 3.0, pierce: 1.3 },
  10: { speed: 2.2, pierce: 1.6 },
  12: { speed: 1.7, pierce: 2.0 },
  12.7: { speed: 1.5, pierce: 2.2 },
};

const IN_HOUSE_LASER_ROWS =
  3 * STOCK_GAUGES_MM.mild_steel.length +
  STOCK_GAUGES_MM.stainless.length +
  STOCK_GAUGES_MM.aluminium.length +
  STOCK_GAUGES_MM.brass.length +
  STOCK_GAUGES_MM.copper.length;
const SUBCONTRACT_LASER_ROWS = 4;

/* ─── Expected row counts (build prompt Step 9 / spec 7) ───────────────── */

const EXPECTED_COUNTS: Record<string, number> = {
  rate_versions: 1,
  rate_general: 1,
  materials: 7,
  rate_laser: IN_HOUSE_LASER_ROWS + SUBCONTRACT_LASER_ROWS,
  rate_tube_laser: 3 * 6,
  rate_bend: 10 * 3,
  rate_roll: 6 * 4,
  rate_weld: 4 * 4,
  rate_thread: 11,
  rate_feature: 5,
  rate_finish: 4,
  machines: 5,
};

/** Every rate table with the ORDER BY that makes its row set comparable. */
const RATE_TABLE_ORDER: Record<string, string> = {
  rate_versions: "id",
  rate_general: "rate_version_id",
  materials: "rate_version_id, code",
  rate_laser: "rate_version_id, material_code, thickness_mm, in_house",
  rate_tube_laser: "rate_version_id, profile_family, wall_mm",
  rate_bend: "rate_version_id, thickness_mm, length_class_mm",
  rate_roll: "rate_version_id, thickness_mm, radius_class_mm",
  rate_weld: "rate_version_id, process, bead_mm",
  rate_thread: "rate_version_id, size",
  rate_feature: "rate_version_id, code",
  rate_finish: "rate_version_id, code",
};

/* ─── Key sets tied to lib/pricing/types.ts at compile time ─────────────── */

type ExactKeys<T, K extends readonly PropertyKey[]> = Exclude<keyof T, K[number]> extends never
  ? Exclude<K[number], keyof T> extends never
    ? true
    : never
  : never;

const FLAT_LASER_KEYS = [
  "bedLengthMm",
  "bedWidthMm",
  "zMm",
  "edgeMarginMm",
  "maxThicknessMm",
] as const satisfies readonly (keyof FlatLaserLimits)[];
const TUBE_LASER_KEYS = [
  "maxRoundDiameterMm",
  "maxRectSideMm",
  "maxCircumscribedMm",
  "maxLengthMm",
  "maxKgPerM",
  "maxRawWeightKg",
  "wallThicknessMm",
] as const satisfies readonly (keyof TubeLaserLimits)[];
const PRESS_BRAKE_KEYS = [
  "forceKN",
  "bendLengthMm",
  "betweenColumnsMm",
  "openHeightMm",
  "dieFactor",
] as const satisfies readonly (keyof PressBrakeLimits)[];
const ROLL_KEYS = ["maxWidthMm", "minRadiusMm", "maxThicknessMm"] as const satisfies readonly (keyof RollLimits)[];
const WELD_KEYS = ["processes"] as const satisfies readonly (keyof WeldLimits)[];
const FAMILIES = ["mild_steel", "stainless", "aluminium", "brass", "copper"] as const satisfies readonly MaterialFamily[];
const PROCESSES = ["mig_mag", "tig", "laser", "mma"] as const satisfies readonly WeldProcess[];

// Fails to typecheck when a limits type gains or loses a field — update the
// seed and the lists above together.
const exhaustive: [
  ExactKeys<FlatLaserLimits, typeof FLAT_LASER_KEYS>,
  ExactKeys<TubeLaserLimits, typeof TUBE_LASER_KEYS>,
  ExactKeys<PressBrakeLimits, typeof PRESS_BRAKE_KEYS>,
  ExactKeys<RollLimits, typeof ROLL_KEYS>,
  ExactKeys<WeldLimits, typeof WELD_KEYS>,
  ExactKeys<Record<MaterialFamily, number>, typeof FAMILIES>,
] = [true, true, true, true, true, true];
void exhaustive;

const LIMIT_KEYS: Record<MachineKind, readonly string[]> = {
  flat_laser: FLAT_LASER_KEYS,
  tube_laser: TUBE_LASER_KEYS,
  press_brake: PRESS_BRAKE_KEYS,
  roll: ROLL_KEYS,
  weld: WELD_KEYS,
};

/* ─── Row shapes read back from psql (json_agg) ─────────────────────────── */

type CountRow = { table_name: string; n: number };
type VersionRow = { id: string; label: string; active: boolean; note: string | null };
type LaserRow = {
  material_code: string;
  thickness_mm: number;
  mode: "time" | "per_m";
  speed_m_min: number | null;
  pierce_s: number | null;
  price_per_m: number | null;
  price_per_pierce: number;
  gas: string | null;
  min_contour_mm: number | null;
  in_house: boolean;
  supplier: string | null;
  placeholder: boolean;
};
type MaterialRow = {
  code: string;
  family: MaterialFamily;
  density_kg_m3: number;
  rm_n_mm2: number;
  price_per_kg: ThicknessBandPrice[];
  sheet_formats: { lengthMm: number; widthMm: number }[];
  scrap_pct_default: number;
  placeholder: boolean;
};
type MachineRow = { code: string; name: string; kind: MachineKind; limits: Record<string, unknown> };
type GeneralRow = {
  machine_rate_eur_h: number;
  labour_rate_eur_h: number;
  machining_rate_eur_h: number;
  default_margin_pct: number;
  margin_by_class: Record<string, number>;
  blank_margin_mm: number;
  slow_contour_factor: number;
  default_stitch_bead_mm: number;
  default_stitch_pitch_mm: number;
  handling_mass_limit_kg: number;
  handling_surcharge_eur: number;
  weld_handling_per_part: number;
  placeholder: boolean;
};

const LASER_SELECT = `select material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas,
                             min_contour_mm, in_house, supplier, placeholder
                        from public.rate_laser where rate_version_id = '${V1}'
                       order by material_code, in_house desc, thickness_mm`;

function countRows(): Record<string, number> {
  const union = Object.keys(EXPECTED_COUNTS)
    .map((t) => `select '${t}'::text as table_name, count(*)::int as n from public.${t}`)
    .join(" union all ");
  const rows = queryJson<CountRow>(DB, union);
  return Object.fromEntries(rows.map((r) => [r.table_name, r.n]));
}

/** Every row of every rate table (all columns, ids included), deterministically ordered. */
function rateRowsSnapshot(): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(RATE_TABLE_ORDER).map(([table, order]) => [
      table,
      queryJson<unknown>(DB, `select * from public.${table} order by ${order}`),
    ])
  );
}

function keySet(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort();
}

function threadPrices(): Record<string, number> {
  const rows = queryJson<{ size: string; price_each: number }>(
    DB,
    `select size, price_each from public.rate_thread where rate_version_id = '${V1}' order by size`
  );
  return Object.fromEntries(rows.map((r) => [r.size, r.price_each]));
}

/* ─── Seed variants: regex edits of seed.sql, each anchor exactly once ──── */

function seedText(): string {
  return fs.readFileSync(SEED_SQL, "utf8");
}

function editOnce(sql: string, anchor: RegExp, replacement: string): string {
  const matches = sql.match(new RegExp(anchor.source, anchor.flags.includes("g") ? anchor.flags : `${anchor.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`seed variant: anchor ${anchor} matched ${matches?.length ?? 0} times in seed.sql (expected 1)`);
  }
  return sql.replace(anchor, replacement);
}

/** M3 re-priced and an M24 row added — what an admin re-running an edited seed does. */
function editedSeed(): string {
  let sql = seedText();
  sql = editOnce(sql, /('M3',\s+)0\.60(, true\))/, "$19.99$2");
  sql = editOnce(
    sql,
    /\(([^()]*?), 'M20',\s+1\.50, true\)/,
    "($1, 'M20', 1.50, true),\n  ($1, 'M24', 1.80, true)"
  );
  return sql;
}

/** A value error deep inside the seed (after the version reset and most inserts). */
function seedFailingInside(): string {
  return editOnce(seedText(), /('M20',\s+)1\.50(, true\))/, "$1'boom'$2");
}

/** A statement appended after the seed body that fails. */
function seedFailingAfter(): string {
  return `${seedText()}\nselect 1/0;\n`;
}

/* ─── Rows → pricing-engine types (only what findLaserRate reads) ───────── */

function gasOf(gas: string | null): LaserRate["gas"] {
  if (gas === "O2" || gas === "N2" || gas === "air" || gas === null) return gas;
  throw new Error(`rate_laser.gas holds "${gas}", not O2 / N2 / air / null`);
}

function toLaserRate(r: LaserRow): LaserRate {
  return {
    materialCode: r.material_code,
    thicknessMm: r.thickness_mm,
    mode: r.mode,
    speedMMin: r.speed_m_min,
    pierceS: r.pierce_s,
    pricePerM: r.price_per_m,
    pricePerPierce: r.price_per_pierce,
    gas: gasOf(r.gas),
    minContourMm: r.min_contour_mm,
    inHouse: r.in_house,
    supplier: r.supplier,
    placeholder: r.placeholder,
  };
}

/** A RateSnapshot carrying only the laser rows — findLaserRate reads nothing else. */
function laserOnlySnapshot(laser: LaserRate[]): RateSnapshot {
  return {
    versionId: V1,
    label: "seed test",
    materials: [],
    laser,
    tubeLaser: [],
    bend: [],
    roll: [],
    weld: [],
    thread: [],
    feature: [],
    finish: [],
    general: {
      machineRateEurH: 0,
      labourRateEurH: 0,
      machiningRateEurH: 0,
      defaultMarginPct: 0,
      marginByClass: {},
      blankMarginMm: 0,
      slowContourFactor: 1,
      defaultStitch: { beadLengthMm: 0, pitchMm: 0 },
      handlingMassLimitKg: 0,
      handlingSurchargeEur: 0,
      weldHandlingPerPart: 0,
      placeholder: true,
    },
  };
}

/* ─── zod schemas from lib/pricing/snapshot.ts (optional) ───────────────── */

type ZodLike = { safeParse: (value: unknown) => { success: boolean; error?: unknown } };

function isZodLike(value: unknown): value is ZodLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

async function loadSnapshotSchemas(): Promise<Record<string, ZodLike> | null> {
  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ SNAPSHOT_MODULE);
  } catch {
    return null;
  }
  if (typeof mod !== "object" || mod === null) return null;
  const schemas: Record<string, ZodLike> = {};
  for (const [name, value] of Object.entries(mod as Record<string, unknown>)) {
    if (isZodLike(value)) schemas[name] = value;
  }
  return schemas;
}

const KIND_TOKEN: Record<MachineKind, string> = {
  flat_laser: "flatlaser",
  tube_laser: "tubelaser",
  press_brake: "pressbrake",
  roll: "roll",
  weld: "weld",
};

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `flatLaserLimitsSchema`, `FlatLaserLimits`, `zFlatLaserLimits`, … */
function findLimitsSchema(schemas: Record<string, ZodLike>, kind: MachineKind): ZodLike | null {
  for (const [name, schema] of Object.entries(schemas)) {
    const n = normalise(name);
    if (n.includes(KIND_TOKEN[kind]) && n.includes("limit")) return schema;
  }
  return null;
}

/** `machineSchema` (one row) or `machineParkSchema` (the array). */
function findMachineSchema(schemas: Record<string, ZodLike>): { schema: ZodLike; array: boolean } | null {
  for (const [name, schema] of Object.entries(schemas)) {
    const n = normalise(name);
    if (n.includes("machinepark")) return { schema, array: true };
  }
  for (const [name, schema] of Object.entries(schemas)) {
    const n = normalise(name);
    if (n.includes("machine") && !n.includes("kind")) return { schema, array: false };
  }
  return null;
}

/* ─── Tests ─────────────────────────────────────────────────────────────── */

describe.skipIf(!ENABLED)("supabase/seed.sql on a fresh local database", () => {
  beforeAll(() => {
    resetDatabase(DB);
  }, 180_000);

  afterAll(() => {
    cleanupStaging();
  });

  it("has exactly one active rate version — the seeded placeholder one", () => {
    const versions = queryJson<VersionRow>(DB, "select id, label, active, note from public.rate_versions");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ id: V1, active: true });
    expect(versions[0].label).toContain("[CONFIRM]");
    expect(versions[0].label).toMatch(/^v1 /);
  });

  it("seeds the expected number of rows per table", () => {
    expect(countRows()).toEqual(EXPECTED_COUNTS);
  });

  it("rate_general holds the Step 9 placeholders and is flagged placeholder", () => {
    const [g] = queryJson<GeneralRow>(DB, `select * from public.rate_general where rate_version_id = '${V1}'`);
    expect(g).toMatchObject({
      machine_rate_eur_h: 70,
      labour_rate_eur_h: 35,
      machining_rate_eur_h: 60,
      default_margin_pct: 30,
      margin_by_class: {},
      blank_margin_mm: 10,
      slow_contour_factor: 1.5,
      default_stitch_bead_mm: 30,
      default_stitch_pitch_mm: 60,
      handling_mass_limit_kg: 25,
      handling_surcharge_eur: 5,
      weld_handling_per_part: 3,
      placeholder: true,
    });
  });

  it("materials: seven grades, price bands and sheet formats in the pricing-engine JSON shape", () => {
    const rows = queryJson<MaterialRow>(
      DB,
      `select code, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder
         from public.materials where rate_version_id = '${V1}' order by code`
    );
    expect(rows.map((r) => r.code).sort()).toEqual(
      ["S235", "S355", "DC01", "1.4301", "AlMg3", "CuZn37", "Cu-ETP"].sort()
    );
    for (const r of rows) {
      expect(FAMILIES).toContain(r.family);
      expect(r.placeholder).toBe(true);
      expect(r.scrap_pct_default).toBe(25);
      expect(r.sheet_formats).toEqual([
        { lengthMm: 3000, widthMm: 1500 },
        { lengthMm: 2500, widthMm: 1250 },
        { lengthMm: 2000, widthMm: 1000 },
      ]);
      expect(r.price_per_kg.length).toBeGreaterThan(0);
      let previous = 0;
      for (const band of r.price_per_kg) {
        expect(keySet(band)).toEqual(["maxThicknessMm", "pricePerKg"]);
        expect(band.maxThicknessMm).toBeGreaterThan(previous); // ascending
        expect(band.pricePerKg).toBeGreaterThan(0);
        previous = band.maxThicknessMm;
      }
    }
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.S235).toMatchObject({ family: "mild_steel", density_kg_m3: 7850, rm_n_mm2: 400 });
    expect(byCode.S235.price_per_kg.map((b) => b.pricePerKg)).toEqual([1.1, 1.15, 1.2]);
    expect(byCode.S355).toMatchObject({ family: "mild_steel", density_kg_m3: 7850, rm_n_mm2: 510 });
    expect(byCode.S355.price_per_kg.map((b) => b.pricePerKg)).toEqual([1.15, 1.2, 1.25]);
    expect(byCode.DC01.price_per_kg.map((b) => b.pricePerKg)).toEqual([1.05]);
    expect(byCode["1.4301"]).toMatchObject({ family: "stainless", density_kg_m3: 7900, rm_n_mm2: 600 });
    expect(byCode["1.4301"].price_per_kg[0].pricePerKg).toBe(3.6);
    expect(byCode.AlMg3).toMatchObject({ family: "aluminium", density_kg_m3: 2660, rm_n_mm2: 220 });
    expect(byCode.AlMg3.price_per_kg[0].pricePerKg).toBe(4.5);
    expect(byCode.CuZn37).toMatchObject({ family: "brass", density_kg_m3: 8440, rm_n_mm2: 350 });
    expect(byCode["Cu-ETP"]).toMatchObject({ family: "copper", density_kg_m3: 8940, rm_n_mm2: 250 });
  });

  it("rate_laser: mild-steel base table incl. stock gauges, 70 % families, gas rule, min contour and subcontract rows", () => {
    const rows = queryJson<LaserRow>(DB, LASER_SELECT);
    const inHouse = rows.filter((r) => r.in_house);
    const subcontract = rows.filter((r) => !r.in_house);
    expect(inHouse).toHaveLength(IN_HOUSE_LASER_ROWS);
    expect(subcontract).toHaveLength(SUBCONTRACT_LASER_ROWS);

    for (const r of rows) expect(r.placeholder).toBe(true);

    for (const r of inHouse) {
      const b = MILD_STEEL_BASE[r.thickness_mm];
      expect(b, `base row for ${r.thickness_mm} mm`).toBeDefined();
      expect(r.mode).toBe("time");
      expect(r.price_per_m).toBeNull();
      expect(r.price_per_pierce).toBe(0.05);
      expect(r.min_contour_mm).toBe(r.thickness_mm * 10);
      expect(r.supplier).toBeNull();
      expect(r.pierce_s).toBe(b.pierce);
      const mildSteel = ["S235", "S355", "DC01"].includes(r.material_code);
      if (mildSteel) {
        expect(r.speed_m_min).toBe(b.speed);
        expect(r.gas).toBe(r.thickness_mm >= 3 ? "O2" : "N2");
      } else {
        expect(r.speed_m_min).toBeCloseTo(b.speed * 0.7, 6);
        expect(r.gas).toBe("N2");
      }
    }
    const thicknessesOf = (code: string) =>
      inHouse.filter((r) => r.material_code === code).map((r) => r.thickness_mm);
    for (const code of ["S235", "S355", "DC01"]) {
      expect(thicknessesOf(code), code).toEqual([...STOCK_GAUGES_MM.mild_steel]);
    }
    expect(thicknessesOf("1.4301")).toEqual([...STOCK_GAUGES_MM.stainless]);
    expect(thicknessesOf("AlMg3")).toEqual([...STOCK_GAUGES_MM.aluminium]);
    expect(thicknessesOf("CuZn37")).toEqual([...STOCK_GAUGES_MM.brass]);
    expect(thicknessesOf("Cu-ETP")).toEqual([...STOCK_GAUGES_MM.copper]);

    expect(
      subcontract.map((r) => [r.material_code, r.thickness_mm, r.price_per_m, r.price_per_pierce])
    ).toEqual([
      ["S235", 15, 6, 0.5],
      ["S235", 20, 8, 0.5],
      ["S355", 15, 6, 0.5],
      ["S355", 20, 8, 0.5],
    ]);
    for (const r of subcontract) {
      expect(r.mode).toBe("per_m");
      expect(r.speed_m_min).toBeNull();
      expect(r.pierce_s).toBeNull();
      expect(r.supplier).toContain("[CONFIRM]");
    }
  });

  it("every stock gauge within the flat-laser limit prices in-house through findLaserRate; above it → the supplier row", () => {
    const rates = laserOnlySnapshot(queryJson<LaserRow>(DB, LASER_SELECT).map(toLaserRate));
    const materials = queryJson<{ code: string; family: MaterialFamily }>(
      DB,
      `select code, family from public.materials where rate_version_id = '${V1}' order by code`
    );
    const [flat] = queryJson<{ limits: FlatLaserLimits }>(
      DB,
      "select limits from public.machines where kind = 'flat_laser'"
    );
    expect(flat).toBeDefined();
    expect(materials).toHaveLength(7);

    for (const { code, family } of materials) {
      const limit = familyThicknessLimitMm(flat.limits, family);
      expect(limit, `${family} limit`).not.toBeNull();
      const gauges = STOCK_GAUGES_MM[family];
      expect(gauges.every((t) => t <= (limit ?? 0)), `${family} gauges within ${limit} mm`).toBe(true);
      for (const t of gauges) {
        const r = findLaserRate(rates, code, t, limit);
        expect(r.reason, `${code} ${t} mm`).toBe("in_house");
        expect(r.subcontract, `${code} ${t} mm`).toBe(false);
        expect(r.exactThickness, `${code} ${t} mm`).toBe(true);
        expect(r.row?.inHouse, `${code} ${t} mm`).toBe(true);
        expect(r.row?.mode, `${code} ${t} mm`).toBe("time");
      }
    }

    // Above the mild-steel limit: exact supplier row, then the nearest one.
    const mildLimit = familyThicknessLimitMm(flat.limits, "mild_steel");
    const s235at15 = findLaserRate(rates, "S235", 15, mildLimit);
    expect(s235at15).toMatchObject({ subcontract: true, reason: "over_limit", exactThickness: true });
    expect(s235at15.row).toMatchObject({ inHouse: false, mode: "per_m", pricePerM: 6, pricePerPierce: 0.5 });
    const s355at20 = findLaserRate(rates, "S355", 20, mildLimit);
    expect(s355at20).toMatchObject({ subcontract: true, reason: "over_limit", exactThickness: true });
    expect(s355at20.row).toMatchObject({ inHouse: false, pricePerM: 8 });
    const s235at13 = findLaserRate(rates, "S235", 13, mildLimit);
    expect(s235at13).toMatchObject({ subcontract: true, reason: "over_limit", exactThickness: false });
    expect(s235at13.row).toMatchObject({ inHouse: false, thicknessMm: 15 });
    // No supplier tariff is seeded for stainless above 12.7 mm: red laser.no_rate_row until the admin adds one.
    const stainlessAt15 = findLaserRate(rates, "1.4301", 15, familyThicknessLimitMm(flat.limits, "stainless"));
    expect(stainlessAt15).toMatchObject({ row: null, subcontract: true, reason: "over_limit" });
  });

  it("tube laser, bend, roll, weld, thread, feature and finish rows carry the Step 9 placeholders", () => {
    type TubeRow = { profile_family: string; wall_mm: number; price_per_m_cut: number; handling_per_part: number; setup: number };
    const tube = queryJson<TubeRow>(
      DB,
      `select profile_family, wall_mm, price_per_m_cut, handling_per_part, setup
         from public.rate_tube_laser where rate_version_id = '${V1}' order by profile_family, wall_mm`
    );
    expect(new Set(tube.map((r) => r.profile_family))).toEqual(new Set(["round", "square", "rectangular"]));
    for (const r of tube) {
      expect([2, 3, 4, 5, 6, 8]).toContain(r.wall_mm);
      expect(r.price_per_m_cut).toBeGreaterThanOrEqual(4);
      expect(r.price_per_m_cut).toBeLessThanOrEqual(10);
      expect(r.handling_per_part).toBe(1.5);
      expect(r.setup).toBe(10);
    }

    type BendRow = { thickness_mm: number; length_class_mm: number; price_per_bend: number; setup_per_part_type: number };
    const bend = queryJson<BendRow>(
      DB,
      `select thickness_mm, length_class_mm, price_per_bend, setup_per_part_type
         from public.rate_bend where rate_version_id = '${V1}' order by thickness_mm, length_class_mm`
    );
    const bendBase: Record<number, number> = { 500: 0.9, 1500: 1.6, 4420: 3.0 };
    expect(new Set(bend.map((r) => r.thickness_mm))).toEqual(new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 15]));
    for (const r of bend) {
      const factor = r.thickness_mm > 6 ? 1.5 : 1;
      expect(r.price_per_bend).toBeCloseTo(bendBase[r.length_class_mm] * factor, 6);
      expect(r.setup_per_part_type).toBe(8);
    }

    type RollRow = { thickness_mm: number; radius_class_mm: number; price_per_m: number; setup: number };
    const roll = queryJson<RollRow>(
      DB,
      `select thickness_mm, radius_class_mm, price_per_m, setup
         from public.rate_roll where rate_version_id = '${V1}' order by thickness_mm, radius_class_mm`
    );
    expect(new Set(roll.map((r) => r.thickness_mm))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(new Set(roll.map((r) => r.radius_class_mm))).toEqual(new Set([200, 500, 1000, 3000]));
    for (const r of roll) {
      expect(r.price_per_m).toBe(12);
      expect(r.setup).toBe(25);
    }

    type WeldRow = { process: WeldProcess; bead_mm: number; price_per_mm: number; setup: number; min_order: number };
    const weld = queryJson<WeldRow>(
      DB,
      `select process, bead_mm, price_per_mm, setup, min_order
         from public.rate_weld where rate_version_id = '${V1}' order by process, bead_mm`
    );
    const weldPrice: Record<WeldProcess, number> = { mig_mag: 0.045, tig: 0.09, laser: 0.06, mma: 0.07 };
    expect(new Set(weld.map((r) => r.process))).toEqual(new Set(PROCESSES));
    expect(new Set(weld.map((r) => r.bead_mm))).toEqual(new Set([3, 4, 6, 8]));
    for (const r of weld) {
      expect(r.price_per_mm).toBeCloseTo(weldPrice[r.process], 9);
      expect(r.setup).toBe(15);
      expect(r.min_order).toBe(60);
    }

    expect(threadPrices()).toEqual({
      M3: 0.6, M4: 0.65, M5: 0.7, M6: 0.8, M8: 0.9, M10: 1, "M10x1": 1.05, M12: 1.2, "M12x1.5": 1.25, M16: 1.4, M20: 1.5,
    });

    type FeatureRow = { code: string; price_each: number };
    const feature = queryJson<FeatureRow>(
      DB,
      `select code, price_each from public.rate_feature where rate_version_id = '${V1}' order by code`
    );
    expect(Object.fromEntries(feature.map((r) => [r.code, r.price_each]))).toEqual({
      countersink: 0.8, counterbore: 1.2, bore_h7: 4, insert: 1.5, stud: 1,
    });

    type FinishRow = { code: string; unit: string; price: number; minimum: number };
    const finish = queryJson<FinishRow>(
      DB,
      `select code, unit, price, minimum from public.rate_finish where rate_version_id = '${V1}' order by code`
    );
    expect(finish).toEqual([
      { code: "deburr", unit: "m", price: 0.4, minimum: 0 },
      { code: "engrave", unit: "m", price: 0.5, minimum: 0 },
      { code: "powder", unit: "m2", price: 14, minimum: 25 },
      { code: "zinc", unit: "kg", price: 1.2, minimum: 30 },
    ]);
  });

  it("every rate row of the seeded version is a placeholder", () => {
    const tables = [
      "rate_general", "materials", "rate_laser", "rate_tube_laser", "rate_bend",
      "rate_roll", "rate_weld", "rate_thread", "rate_feature", "rate_finish",
    ];
    const union = tables
      .map((t) => `select '${t}'::text as table_name, count(*) filter (where not placeholder)::int as n from public.${t}`)
      .join(" union all ");
    const rows = queryJson<CountRow>(DB, union);
    for (const r of rows) expect(r.n, `${r.table_name} non-placeholder rows`).toBe(0);
  });

  it("machines.limits match the MachineLimits shapes of lib/pricing/types.ts", () => {
    const machines = queryJson<MachineRow>(DB, "select code, name, kind, limits from public.machines order by code");
    expect(machines.map((m) => [m.code, m.kind])).toEqual([
      ["press-brake-3200", "press_brake"],
      ["roll-3200", "roll"],
      ["trufiber-12001", "flat_laser"],
      ["tube-laser-12kw", "tube_laser"],
      ["welding", "weld"],
    ]);
    for (const m of machines) {
      expect(keySet(m.limits), `${m.code} keys`).toEqual([...LIMIT_KEYS[m.kind]].sort());
    }
    const byKind = Object.fromEntries(machines.map((m) => [m.kind, m.limits])) as Record<MachineKind, Record<string, unknown>>;

    const flat = byKind.flat_laser as unknown as FlatLaserLimits;
    expect(flat).toMatchObject({ bedLengthMm: 3000, bedWidthMm: 1500, zMm: 120, edgeMarginMm: 10 });
    expect(flat.maxThicknessMm).toEqual({ mild_steel: 12.7, stainless: 12.7, aluminium: 6, brass: 6, copper: 6 });

    const tube = byKind.tube_laser as unknown as TubeLaserLimits;
    expect(tube).toMatchObject({
      maxRoundDiameterMm: 273, maxRectSideMm: 254, maxCircumscribedMm: 290,
      maxLengthMm: 6500, maxKgPerM: 40, maxRawWeightKg: 260,
    });
    expect(tube.wallThicknessMm).toEqual({
      mild_steel: [14, 10], stainless: [12.5, 8], aluminium: [12.5, 8], copper: [5, 5], brass: [5, 5],
    });
    for (const family of FAMILIES) {
      const pair = tube.wallThicknessMm[family];
      expect(pair).toHaveLength(2);
      for (const v of pair) expect(typeof v).toBe("number");
    }

    expect(byKind.press_brake).toEqual({
      forceKN: 3200, bendLengthMm: 4420, betweenColumnsMm: 3680, openHeightMm: 615, dieFactor: 8,
    } satisfies PressBrakeLimits);
    expect(byKind.roll).toEqual({ maxWidthMm: 3200, minRadiusMm: 200, maxThicknessMm: 6 } satisfies RollLimits);
    expect(byKind.weld).toEqual({ processes: [...PROCESSES] } satisfies WeldLimits);
  });

  it("machines.limits validate against the zod schemas of lib/pricing/snapshot.ts (skipped while that module is absent)", async () => {
    const schemas = await loadSnapshotSchemas();
    if (!schemas) {
      console.info("[seed.test] lib/pricing/snapshot.ts not present yet — zod validation skipped");
      return;
    }
    const machines = queryJson<MachineRow>(DB, "select code, name, kind, limits from public.machines order by code");
    let validated = 0;
    for (const m of machines) {
      const limitsSchema = findLimitsSchema(schemas, m.kind);
      if (limitsSchema) {
        const result = limitsSchema.safeParse(m.limits);
        expect(result.success, `${m.code} limits vs zod: ${JSON.stringify(result.error ?? null)}`).toBe(true);
        validated++;
      }
    }
    const machineSchema = findMachineSchema(schemas);
    if (machineSchema) {
      if (machineSchema.array) {
        const result = machineSchema.schema.safeParse(machines);
        expect(result.success, `machine park vs zod: ${JSON.stringify(result.error ?? null)}`).toBe(true);
      } else {
        for (const m of machines) {
          const result = machineSchema.schema.safeParse(m);
          expect(result.success, `${m.code} vs zod: ${JSON.stringify(result.error ?? null)}`).toBe(true);
        }
      }
      validated++;
    }
    if (validated === 0) {
      console.info(
        `[seed.test] lib/pricing/snapshot.ts exports no recognisable machine/limits schema (exports: ${Object.keys(schemas).join(", ")}) — zod validation skipped`
      );
    }
  });

  it("running seed.sql a second time neither errors nor duplicates", () => {
    const before = countRows();
    const result = runSeed(DB);
    expect(result.stderr).not.toMatch(/referenced by quotes/);
    expect(countRows()).toEqual(before);
    const active = queryScalar<number>(DB, "select count(*)::int as n from public.rate_versions where active");
    expect(active).toBe(1);
  });

  it("an edited seed lands on re-run while nothing references the version, and the original restores it", () => {
    expect(() => runSql(DB, editedSeed(), "seed-edited", { singleTransaction: true })).not.toThrow();
    expect(countRows()).toEqual({ ...EXPECTED_COUNTS, rate_thread: 12 });
    expect(threadPrices()).toMatchObject({ M3: 9.99, M24: 1.8 });

    runSeed(DB);
    expect(countRows()).toEqual(EXPECTED_COUNTS);
    const prices = threadPrices();
    expect(prices.M3).toBe(0.6);
    expect(prices).not.toHaveProperty("M24");
  });

  it("inserts nothing into a version referenced by quotes — even from an edited seed (row sets identical, NOTICE)", () => {
    runSql(DB, `insert into public.quotes (number, rate_version_id) values ('SM-TEST-0001', '${V1}');`);
    try {
      const before = rateRowsSnapshot();
      const result = runSql(DB, editedSeed(), "seed-edited-referenced", { singleTransaction: true });
      expect(result.stderr).toMatch(/NOTICE.*referenced by quotes/);
      expect(rateRowsSnapshot()).toEqual(before);
      expect(threadPrices()).not.toHaveProperty("M24");
      expect(threadPrices().M3).toBe(0.6);
      const label = queryScalar<string>(DB, `select label from public.rate_versions where id = '${V1}'`);
      expect(label).toContain("placeholder");
    } finally {
      runSql(DB, "delete from public.quotes where number = 'SM-TEST-0001';");
    }
  });

  it("a failure inside the seed leaves the previous rate set intact, even without psql -1 (single-statement seed)", () => {
    const before = rateRowsSnapshot();
    expect(before.rate_laser.length).toBe(EXPECTED_COUNTS.rate_laser);
    expect(() => runSql(DB, seedFailingInside(), "seed-failing-inside")).toThrow(/boom/);
    expect(rateRowsSnapshot()).toEqual(before);
  });

  it("a failure after the seed body is rolled back by the documented --single-transaction command", () => {
    const before = rateRowsSnapshot();
    expect(() => runSql(DB, seedFailingAfter(), "seed-failing-after", { singleTransaction: true })).toThrow(
      /division by zero/
    );
    expect(rateRowsSnapshot()).toEqual(before);
  });

  it("never steals activation from a newer version the admin activated", () => {
    runSql(
      DB,
      `update public.rate_versions set active = false;
       insert into public.rate_versions (id, label, active) values ('${V2}', 'v2 test', true);`
    );
    expect(() => runSeed(DB)).not.toThrow();
    const versions = queryJson<VersionRow>(DB, "select id, label, active, note from public.rate_versions order by id");
    expect(versions.map((v) => [v.id, v.active])).toEqual([
      [V1, false],
      [V2, true],
    ]);
    // v1 was re-created (nothing referenced it) with its full row set.
    expect(countRows()).toEqual({ ...EXPECTED_COUNTS, rate_versions: 2 });
    runSql(
      DB,
      `delete from public.rate_versions where id = '${V2}';
       update public.rate_versions set active = true where id = '${V1}';`
    );
  });

  it("next_quote_number() returns SM-<year>-0001, then -0002", () => {
    const year = new Date().getFullYear();
    const first = queryScalar<string>(DB, "select public.next_quote_number() as n");
    expect(first).toBe(`SM-${year}-0001`);
    const second = queryScalar<string>(DB, "select public.next_quote_number() as n");
    expect(second).toBe(`SM-${year}-0002`);
  });
});
