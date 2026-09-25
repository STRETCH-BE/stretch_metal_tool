/**
 * Pricing engine — database rows → RateSnapshot / MachinePark.
 * File path: /lib/pricing/snapshot.ts
 *
 * The only place that knows the DB column names. Numeric columns arrive
 * from PostgREST as numbers or strings (Postgres `numeric`), so every
 * number goes through `num()` (Number() + finite check); JSON columns
 * (materials.price_per_kg, materials.sheet_formats,
 * rate_general.margin_by_class, machines.limits) are validated with zod.
 * Rows are sorted deterministically (bands ascending, thickness/length/
 * radius/bead classes ascending, in-house laser rows before supplier
 * rows) so the lookups do not depend on DB ordering.
 *
 * The machine-limit zod schemas mirror FlatLaserLimits / TubeLaserLimits
 * / PressBrakeLimits / RollLimits / WeldLimits key for key (checked at
 * compile time with `checkExact`) and are exported for the admin machines
 * editor and the seed test. Unknown keys are stripped, missing or
 * non-numeric keys fail with a message naming the machine code.
 */

import { z } from "zod";
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
} from "../db/types";
import { PricingError } from "./errors";
import type {
  BendRate,
  FeatureRate,
  FinishRate,
  FlatLaserLimits,
  GeneralRate,
  LaserRate,
  Machine,
  MachineKind,
  MachinePark,
  MaterialFamily,
  MaterialRate,
  PressBrakeLimits,
  RateSnapshot,
  RollLimits,
  RollRate,
  ThreadRate,
  TubeLaserLimits,
  TubeLaserRate,
  WeldLimits,
  WeldRate,
} from "./types";

/* ─── Loose row types (numerics may be strings) ───────────── */

/** A DB row whose numeric columns may arrive as strings from PostgREST. */
export type Loose<T> = {
  [K in keyof T]: T[K] extends number
    ? number | string
    : T[K] extends number | null
      ? number | string | null
      : T[K];
};

export type RateRows = {
  version: Pick<RateVersionRow, "id" | "label">;
  general: Loose<RateGeneralRow>;
  materials: Loose<MaterialRow>[];
  laser: Loose<RateLaserRow>[];
  tubeLaser: Loose<RateTubeLaserRow>[];
  bend: Loose<RateBendRow>[];
  roll: Loose<RateRollRow>[];
  weld: Loose<RateWeldRow>[];
  thread: Loose<RateThreadRow>[];
  feature: Loose<RateFeatureRow>[];
  finish: Loose<RateFinishRow>[];
};

/* ─── Number coercion ─────────────────────────────────────── */

export function num(value: number | string | null | undefined, field: string): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) {
    throw new PricingError("invalid_rate_json", `${field}: expected a number, got ${String(value)}`, {
      field,
      value: value === null || value === undefined ? null : String(value),
    });
  }
  return n;
}

export function numOrNull(value: number | string | null | undefined, field: string): number | null {
  return value === null || value === undefined ? null : num(value, field);
}

/* ─── zod: JSON columns ───────────────────────────────────── */

/** Number that also accepts a non-empty numeric string ("1.20" from a CSV import). */
const numeric = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
  z.number()
);

export const priceBandsSchema = z.array(
  z.object({ maxThicknessMm: numeric, pricePerKg: numeric })
);
export const sheetFormatsSchema = z.array(z.object({ lengthMm: numeric, widthMm: numeric }));
export const marginByClassSchema = z.record(z.string(), numeric);

const MATERIAL_FAMILIES = ["mild_steel", "stainless", "aluminium", "brass", "copper"] as const;
const materialFamilySchema = z.enum(MATERIAL_FAMILIES);
const laserModeSchema = z.enum(["time", "per_m"]);
const tubeProfileFamilySchema = z.enum(["round", "square", "rectangular", "open"]);
const weldProcessSchema = z.enum(["mig_mag", "tig", "laser", "mma"]);
const finishUnitSchema = z.enum(["m2", "kg", "m", "each"]);

function issuesText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function parseJson<T>(schema: z.ZodType<T>, value: unknown, context: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PricingError("invalid_rate_json", `${context}: ${issuesText(result.error)}`, { context });
  }
  return result.data;
}

/* ─── zod: machine limits (mirror types.ts exactly) ───────── */

const familyRecord = <T extends z.ZodType>(value: T) =>
  z.object({ mild_steel: value, stainless: value, aluminium: value, brass: value, copper: value });

export const flatLaserLimitsSchema = z.object({
  bedLengthMm: z.number().positive(),
  bedWidthMm: z.number().positive(),
  zMm: z.number().positive(),
  edgeMarginMm: z.number().nonnegative(),
  maxThicknessMm: familyRecord(z.number().positive()),
});

export const tubeLaserLimitsSchema = z.object({
  maxRoundDiameterMm: z.number().positive(),
  maxRectSideMm: z.number().positive(),
  maxCircumscribedMm: z.number().positive(),
  maxLengthMm: z.number().positive(),
  maxKgPerM: z.number().positive(),
  maxRawWeightKg: z.number().positive(),
  wallThicknessMm: familyRecord(z.tuple([z.number().positive(), z.number().positive()])),
});

export const pressBrakeLimitsSchema = z.object({
  forceKN: z.number().positive(),
  bendLengthMm: z.number().positive(),
  betweenColumnsMm: z.number().positive(),
  openHeightMm: z.number().positive(),
  dieFactor: z.number().positive(),
});

export const rollLimitsSchema = z.object({
  maxWidthMm: z.number().positive(),
  minRadiusMm: z.number().positive(),
  maxThicknessMm: z.number().positive(),
});

export const weldLimitsSchema = z.object({
  processes: z.array(weldProcessSchema),
});

export const machineLimitsSchemas = {
  flat_laser: flatLaserLimitsSchema,
  tube_laser: tubeLaserLimitsSchema,
  press_brake: pressBrakeLimitsSchema,
  roll: rollLimitsSchema,
  weld: weldLimitsSchema,
} as const satisfies Record<MachineKind, z.ZodType>;

/** Compile-time proof that a schema's output equals the contract type key for key. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function checkExact<Expected, Actual>(ok: Exact<Expected, Actual>): void {
  void ok;
}
checkExact<FlatLaserLimits, z.infer<typeof flatLaserLimitsSchema>>(true);
checkExact<TubeLaserLimits, z.infer<typeof tubeLaserLimitsSchema>>(true);
checkExact<PressBrakeLimits, z.infer<typeof pressBrakeLimitsSchema>>(true);
checkExact<RollLimits, z.infer<typeof rollLimitsSchema>>(true);
checkExact<WeldLimits, z.infer<typeof weldLimitsSchema>>(true);

/* ─── Row mappers ─────────────────────────────────────────── */

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function gasOf(value: string | null): LaserRate["gas"] {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "o2") return "O2";
  if (v === "n2") return "N2";
  if (v === "air") return "air";
  return null;
}

function mapMaterial(row: Loose<MaterialRow>): MaterialRate {
  const context = `materials[${row.code}]`;
  const family: MaterialFamily = parseJson(materialFamilySchema, row.family, `${context}.family`);
  const bands = parseJson(priceBandsSchema, row.price_per_kg, `${context}.price_per_kg`);
  return {
    code: row.code,
    name: row.name,
    family,
    densityKgM3: num(row.density_kg_m3, `${context}.density_kg_m3`),
    rmNmm2: num(row.rm_n_mm2, `${context}.rm_n_mm2`),
    pricePerKg: [...bands].sort((a, b) => a.maxThicknessMm - b.maxThicknessMm),
    sheetFormats: parseJson(sheetFormatsSchema, row.sheet_formats, `${context}.sheet_formats`),
    scrapPctDefault: num(row.scrap_pct_default, `${context}.scrap_pct_default`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapLaser(row: Loose<RateLaserRow>): LaserRate {
  const context = `rate_laser[${row.material_code}/${String(row.thickness_mm)}]`;
  return {
    materialCode: row.material_code,
    thicknessMm: num(row.thickness_mm, `${context}.thickness_mm`),
    mode: parseJson(laserModeSchema, row.mode, `${context}.mode`),
    speedMMin: numOrNull(row.speed_m_min, `${context}.speed_m_min`),
    pierceS: numOrNull(row.pierce_s, `${context}.pierce_s`),
    pricePerM: numOrNull(row.price_per_m, `${context}.price_per_m`),
    pricePerPierce: num(row.price_per_pierce, `${context}.price_per_pierce`),
    gas: gasOf(row.gas),
    minContourMm: numOrNull(row.min_contour_mm, `${context}.min_contour_mm`),
    inHouse: Boolean(row.in_house),
    supplier: row.supplier,
    placeholder: Boolean(row.placeholder),
  };
}

function mapTubeLaser(row: Loose<RateTubeLaserRow>): TubeLaserRate {
  const context = `rate_tube_laser[${row.profile_family}/${String(row.wall_mm)}]`;
  return {
    profileFamily: parseJson(tubeProfileFamilySchema, row.profile_family, `${context}.profile_family`),
    wallMm: num(row.wall_mm, `${context}.wall_mm`),
    pricePerMCut: num(row.price_per_m_cut, `${context}.price_per_m_cut`),
    handlingPerPart: num(row.handling_per_part, `${context}.handling_per_part`),
    setup: num(row.setup, `${context}.setup`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapBend(row: Loose<RateBendRow>): BendRate {
  const context = `rate_bend[${String(row.thickness_mm)}/${String(row.length_class_mm)}]`;
  return {
    thicknessMm: num(row.thickness_mm, `${context}.thickness_mm`),
    lengthClassMm: num(row.length_class_mm, `${context}.length_class_mm`),
    pricePerBend: num(row.price_per_bend, `${context}.price_per_bend`),
    setupPerPartType: num(row.setup_per_part_type, `${context}.setup_per_part_type`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapRoll(row: Loose<RateRollRow>): RollRate {
  const context = `rate_roll[${String(row.thickness_mm)}/${String(row.radius_class_mm)}]`;
  return {
    thicknessMm: num(row.thickness_mm, `${context}.thickness_mm`),
    radiusClassMm: num(row.radius_class_mm, `${context}.radius_class_mm`),
    pricePerM: num(row.price_per_m, `${context}.price_per_m`),
    setup: num(row.setup, `${context}.setup`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapWeld(row: Loose<RateWeldRow>): WeldRate {
  const context = `rate_weld[${row.process}/${String(row.bead_mm)}]`;
  return {
    process: parseJson(weldProcessSchema, row.process, `${context}.process`),
    beadMm: num(row.bead_mm, `${context}.bead_mm`),
    pricePerMm: num(row.price_per_mm, `${context}.price_per_mm`),
    setup: num(row.setup, `${context}.setup`),
    minOrder: num(row.min_order, `${context}.min_order`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapThread(row: Loose<RateThreadRow>): ThreadRate {
  return {
    size: row.size,
    priceEach: num(row.price_each, `rate_thread[${row.size}].price_each`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapFeature(row: Loose<RateFeatureRow>): FeatureRate {
  return {
    code: row.code,
    name: row.name,
    priceEach: num(row.price_each, `rate_feature[${row.code}].price_each`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapFinish(row: Loose<RateFinishRow>): FinishRate {
  const context = `rate_finish[${row.code}]`;
  return {
    code: row.code,
    name: row.name,
    unit: parseJson(finishUnitSchema, row.unit, `${context}.unit`),
    price: num(row.price, `${context}.price`),
    minimum: num(row.minimum, `${context}.minimum`),
    placeholder: Boolean(row.placeholder),
  };
}

function mapGeneral(row: Loose<RateGeneralRow>): GeneralRate {
  const c = "rate_general";
  return {
    machineRateEurH: num(row.machine_rate_eur_h, `${c}.machine_rate_eur_h`),
    labourRateEurH: num(row.labour_rate_eur_h, `${c}.labour_rate_eur_h`),
    machiningRateEurH: num(row.machining_rate_eur_h, `${c}.machining_rate_eur_h`),
    defaultMarginPct: num(row.default_margin_pct, `${c}.default_margin_pct`),
    marginByClass: parseJson(marginByClassSchema, row.margin_by_class, `${c}.margin_by_class`),
    blankMarginMm: num(row.blank_margin_mm, `${c}.blank_margin_mm`),
    slowContourFactor: num(row.slow_contour_factor, `${c}.slow_contour_factor`),
    defaultStitch: {
      beadLengthMm: num(row.default_stitch_bead_mm, `${c}.default_stitch_bead_mm`),
      pitchMm: num(row.default_stitch_pitch_mm, `${c}.default_stitch_pitch_mm`),
    },
    handlingMassLimitKg: num(row.handling_mass_limit_kg, `${c}.handling_mass_limit_kg`),
    handlingSurchargeEur: num(row.handling_surcharge_eur, `${c}.handling_surcharge_eur`),
    weldHandlingPerPart: num(row.weld_handling_per_part, `${c}.weld_handling_per_part`),
    placeholder: Boolean(row.placeholder),
  };
}

/* ─── Public API ──────────────────────────────────────────── */

export function rowsToRateSnapshot(rows: RateRows): RateSnapshot {
  return {
    versionId: rows.version.id,
    label: rows.version.label,
    materials: rows.materials.map(mapMaterial).sort((a, b) => byString(a.code, b.code)),
    laser: rows.laser
      .map(mapLaser)
      .sort(
        (a, b) =>
          byString(a.materialCode, b.materialCode) ||
          a.thicknessMm - b.thicknessMm ||
          Number(b.inHouse) - Number(a.inHouse)
      ),
    tubeLaser: rows.tubeLaser
      .map(mapTubeLaser)
      .sort((a, b) => byString(a.profileFamily, b.profileFamily) || a.wallMm - b.wallMm),
    bend: rows.bend
      .map(mapBend)
      .sort((a, b) => a.thicknessMm - b.thicknessMm || a.lengthClassMm - b.lengthClassMm),
    roll: rows.roll
      .map(mapRoll)
      .sort((a, b) => a.thicknessMm - b.thicknessMm || a.radiusClassMm - b.radiusClassMm),
    weld: rows.weld.map(mapWeld).sort((a, b) => byString(a.process, b.process) || a.beadMm - b.beadMm),
    thread: rows.thread.map(mapThread).sort((a, b) => byString(a.size, b.size)),
    feature: rows.feature.map(mapFeature).sort((a, b) => byString(a.code, b.code)),
    finish: rows.finish.map(mapFinish).sort((a, b) => byString(a.code, b.code)),
    general: mapGeneral(rows.general),
  };
}

export function machineFromRow(row: Pick<MachineRow, "code" | "name" | "kind" | "limits">): Machine {
  const { code, name, kind } = row;
  const fail = (reason: string): never => {
    throw new PricingError("invalid_machine_limits", `machine ${code} (${kind}): ${reason}`, {
      machine: code,
      kind,
    });
  };
  const parse = <T>(schema: z.ZodType<T>): T => {
    const result = schema.safeParse(row.limits);
    return result.success ? result.data : fail(issuesText(result.error));
  };
  switch (kind) {
    case "flat_laser":
      return { code, name, kind, limits: parse(flatLaserLimitsSchema) };
    case "tube_laser":
      return { code, name, kind, limits: parse(tubeLaserLimitsSchema) };
    case "press_brake":
      return { code, name, kind, limits: parse(pressBrakeLimitsSchema) };
    case "roll":
      return { code, name, kind, limits: parse(rollLimitsSchema) };
    case "weld":
      return { code, name, kind, limits: parse(weldLimitsSchema) };
    default:
      return fail(`unknown machine kind ${String(kind)}`);
  }
}

export function rowsToMachinePark(rows: Pick<MachineRow, "code" | "name" | "kind" | "limits">[]): MachinePark {
  return rows.map(machineFromRow).sort((a, b) => byString(a.code, b.code));
}
