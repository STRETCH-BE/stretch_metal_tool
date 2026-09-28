/**
 * Pricing engine — market-mode ELIGIBILITY of options against the rate
 * rows of the active version: which finish / feature / thread / bend row
 * applies to a part, and why one does not. Pure; shared by the engine
 * (lib/pricing/market.ts) and the forms, which grey out options that have
 * no eligible row ("not benchmarked — quote manually").
 * File path: /lib/pricing/eligibility.ts
 *
 * Rules (rate_* columns of migration 20260928090000_rates_v3_market):
 * - `material_codes` null = any material of the version; otherwise the
 *   part's material code must be listed (case-insensitive).
 * - `min_thickness_mm` / `max_thickness_mm` bound the sheet thickness
 *   (null = open end); both inclusive.
 * - Finishes also carry the free-text `min_part_mm` size rule
 *   (market-rules.ts): failing it is "size" / "family" — the finish is
 *   simply not available for the part (amber, no charge), while a
 *   material / thickness miss is a refusal (red, the part has no price).
 * - Threads: the price is the `price_by_thickness` entry at exactly the
 *   part thickness; a row without entries prices `price_each` for any
 *   thickness (rows written before v3). No entry → not benchmarked.
 * - Bends: the row with exactly the part thickness whose material list
 *   holds the part's material and whose length class (the longest bend the
 *   row prices at all — the press brake) is the smallest one ≥ the part's
 *   longest bend line; no row covering the length → too long (red). Per
 *   bend per piece: price_per_bend + price_per_bend_per_m × the length
 *   beyond BEND_BASE_LENGTH_M (the benchmark's 200 mm parts), × the family
 *   multiplier (also on the bend-line set-up). A bend longer than the row's
 *   benchmarked_max_length_mm is priced that way but flagged amber
 *   (extrapolated).
 * - Steel fallback (resolveBendRateForMaterial): when no row lists the
 *   part's material, the row at the SAME thickness that lists a mild-steel
 *   material of the version prices the bends instead, times the family
 *   factor (mild steel 1; otherwise that row's family_multipliers entry,
 *   else the entry of any other bend row of the version, else 1) — amber
 *   market.bend_rate_from_steel, never silent. BEND_FALLBACK_APPLY_FAMILY_FACTOR
 *   switches the factor off (pure steel price). No steel row at the
 *   thickness → not benchmarked as before; no nearest thickness, no
 *   interpolation.
 * - Variants: a finish offered as ONE option in the UI but priced from
 *   two rows by material family carries a suffix from
 *   FINISH_VARIANT_SUFFIXES (`deburr` for steel, `deburr_nonferrous` for
 *   aluminium / stainless). resolveFinishRate picks the row whose
 *   material list holds the part's material; the variant rows are hidden
 *   from the option lists (finishesOffered).
 * - Coatings that include edge breaking (FINISHES_INCLUDING_EDGE_BREAKING,
 *   the benchmark forces it) make a deburring option on the same line
 *   redundant: the engine drops it with the info flag market.finish_implied.
 */

import { MM_EPSILON } from "./lookup";
import { applicableMinPartRules, meetsMinPartSize, parseMinPartRule } from "./market-rules";
import type { BendRate, FeatureRate, FinishRate, MaterialFamily, RateSnapshot, ThreadRate } from "./types";

function sameMm(a: number, b: number): boolean {
  return Math.abs(a - b) < MM_EPSILON;
}

function normaliseCode(code: string): string {
  return code.trim().toLowerCase();
}

/** True when the list is open (null) or holds the material code. */
export function codeListed(codes: readonly string[] | null, materialCode: string | null): boolean {
  if (codes === null) return true;
  if (!materialCode) return false;
  const key = normaliseCode(materialCode);
  return codes.some((c) => normaliseCode(c) === key);
}

/** True when the thickness lies within [min, max] (nulls = open ends). */
export function thicknessWithin(minMm: number | null, maxMm: number | null, thicknessMm: number | null): boolean {
  if (minMm === null && maxMm === null) return true;
  if (thicknessMm === null) return false;
  if (minMm !== null && thicknessMm < minMm - MM_EPSILON) return false;
  if (maxMm !== null && thicknessMm > maxMm + MM_EPSILON) return false;
  return true;
}

/* ─── Finishes ────────────────────────────────────────────── */

/** Suffixes of finish rows that are variants of a base option, chosen by material (rule 18). */
export const FINISH_VARIANT_SUFFIXES: readonly string[] = ["_nonferrous"];

/** Coatings whose benchmark price includes edge breaking → these options are dropped on the same line (rules 19–20). */
export const FINISHES_INCLUDING_EDGE_BREAKING: Readonly<Record<string, readonly string[]>> = {
  powder: ["deburr", "deburr_one_side"],
  zinc: ["deburr", "deburr_one_side"],
};

/** "deburr_nonferrous" → "deburr"; null when the code is not a variant. */
export function finishVariantBase(code: string): string | null {
  const key = normaliseCode(code);
  for (const suffix of FINISH_VARIANT_SUFFIXES) {
    if (key.endsWith(suffix) && key.length > suffix.length) return key.slice(0, -suffix.length);
  }
  return null;
}

/** The finish rows a form offers: every row except the material variants of another row. */
export function finishesOffered(rates: Pick<RateSnapshot, "finish">): FinishRate[] {
  const codes = new Set(rates.finish.map((f) => normaliseCode(f.code)));
  return rates.finish.filter((f) => {
    const base = finishVariantBase(f.code);
    return base === null || !codes.has(base);
  });
}

/**
 * The row that prices finish `code` for a material: the exact row when its
 * material list holds the material, else a variant row that does, else the
 * exact row (so the caller can report the ineligibility), else null.
 */
export function resolveFinishRate(rates: Pick<RateSnapshot, "finish">, code: string, materialCode: string | null): FinishRate | null {
  const key = normaliseCode(code);
  const exact = rates.finish.find((f) => normaliseCode(f.code) === key) ?? null;
  if (exact && codeListed(exact.materialCodes, materialCode)) return exact;
  for (const suffix of FINISH_VARIANT_SUFFIXES) {
    const variant = rates.finish.find((f) => normaliseCode(f.code) === `${key}${suffix}`);
    if (variant && codeListed(variant.materialCodes, materialCode)) return variant;
  }
  return exact;
}

export type FinishEligibility = "ok" | "material" | "thickness" | "size" | "family";

export type FinishEligibilityInput = {
  materialCode: string | null;
  thicknessMm: number | null;
  family: MaterialFamily | null;
  /** Bounding box of the part (mm) for the min_part_mm rule; omit to skip the size check. */
  widthMm?: number;
  heightMm?: number;
};

/** Material and thickness first (a miss refuses the part), then the size rule (a miss = not available, no charge). */
export function finishEligibility(rate: FinishRate, part: FinishEligibilityInput): FinishEligibility {
  if (!codeListed(rate.materialCodes, part.materialCode)) return "material";
  if (!thicknessWithin(rate.minThicknessMm, rate.maxThicknessMm, part.thicknessMm)) return "thickness";
  const rules = parseMinPartRule(rate.minPartMm);
  if (rules.length === 0 || part.widthMm === undefined || part.heightMm === undefined) return "ok";
  const applicable = applicableMinPartRules(rules, part.family);
  if (applicable.length === 0) return "family";
  return meetsMinPartSize(applicable, part.family, part.widthMm, part.heightMm) === false ? "size" : "ok";
}

/** Refusal reasons (red); "size" / "family" only make the finish unavailable (amber). */
export function finishRefused(eligibility: FinishEligibility): boolean {
  return eligibility === "material" || eligibility === "thickness";
}

/* ─── Features ────────────────────────────────────────────── */

export type FeatureEligibility = "ok" | "material" | "thickness";

export function featureEligibility(rate: FeatureRate, materialCode: string | null, thicknessMm: number | null): FeatureEligibility {
  if (!codeListed(rate.materialCodes, materialCode)) return "material";
  if (!thicknessWithin(rate.minThicknessMm, rate.maxThicknessMm, thicknessMm)) return "thickness";
  return "ok";
}

/* ─── Threads ─────────────────────────────────────────────── */

/**
 * EUR per thread for a part: the price_by_thickness entry at exactly the
 * part thickness (rows without entries price price_each at any thickness);
 * null when the material is not listed or no entry matches.
 */
export function threadPriceFor(rate: ThreadRate, materialCode: string | null, thicknessMm: number | null): number | null {
  if (!codeListed(rate.materialCodes, materialCode)) return null;
  if (rate.priceByThickness.length === 0) return rate.priceEach;
  if (thicknessMm === null) return null;
  const entry = rate.priceByThickness.find((e) => sameMm(e.thicknessMm, thicknessMm));
  return entry ? entry.priceEach : null;
}

/** Thicknesses a thread size is benchmarked at (empty = any thickness, rows without entries). */
export function threadThicknesses(rate: ThreadRate): number[] {
  return [...new Set(rate.priceByThickness.map((e) => e.thicknessMm))].sort((a, b) => a - b);
}

/* ─── Bends ───────────────────────────────────────────────── */

/** Bend length the per-bend price covers (m); the per-metre rate applies beyond it (rate_bend.price_per_bend_per_m comment). */
export const BEND_BASE_LENGTH_M = 0.2;

/** The bend rows of exactly this thickness whose material list holds the material, by length class ascending. */
export function bendRowsFor(rates: Pick<RateSnapshot, "bend">, materialCode: string | null, thicknessMm: number | null): BendRate[] {
  if (thicknessMm === null) return [];
  return rates.bend
    .filter((r) => !r.placeholder && sameMm(r.thicknessMm, thicknessMm) && codeListed(r.materialCodes, materialCode))
    .sort((a, b) => a.lengthClassMm - b.lengthClassMm);
}

/**
 * The bend row for a part: exactly the part thickness, material listed,
 * smallest length class ≥ the longest bend line. null → not benchmarked or too long.
 */
export function findBendRateExact(rates: Pick<RateSnapshot, "bend">, materialCode: string | null, thicknessMm: number | null, longestBendMm: number): BendRate | null {
  return bendRowsFor(rates, materialCode, thicknessMm).find((r) => r.lengthClassMm >= longestBendMm - MM_EPSILON) ?? null;
}

export type BendResolution = {
  /** The row that prices the part's bends; null when none is benchmarked or the bend is too long. */
  rate: BendRate | null;
  /** True when rows exist for the material / thickness but every length class is shorter than the longest bend. */
  tooLong: boolean;
  /** The longest bend the version prices at all for this material / thickness (mm); null without rows. */
  limitMm: number | null;
};

export function resolveBendRate(rates: Pick<RateSnapshot, "bend">, materialCode: string | null, thicknessMm: number | null, longestBendMm: number): BendResolution {
  const rows = bendRowsFor(rates, materialCode, thicknessMm);
  if (rows.length === 0) return { rate: null, tooLong: false, limitMm: null };
  const limitMm = rows[rows.length - 1].lengthClassMm;
  const rate = rows.find((r) => r.lengthClassMm >= longestBendMm - MM_EPSILON) ?? null;
  return { rate, tooLong: rate === null, limitMm };
}

/**
 * Whether the steel fallback multiplies the steel row by the part's family
 * factor (true) or charges the plain steel price (false).
 */
export const BEND_FALLBACK_APPLY_FAMILY_FACTOR = true;

/** "Same thickness" for the steel fallback: |t − row.thickness_mm| ≤ 0.001 mm (no nearest thickness). */
export const BEND_FALLBACK_THICKNESS_TOLERANCE_MM = 0.001;

export type BendRateSource = "exact" | "steel_fallback";

export type BendResolutionForMaterial = BendResolution & {
  /** How the row was found; null when nothing prices the bends. */
  source: BendRateSource | null;
  /** Family factor on the per-bend prices and the bend-line set-up (1 when none applies). */
  factor: number;
};

/** The bend rows of exactly this thickness whose material list holds a mild-steel material of the version (or is open). */
export function steelBendRowsFor(rates: Pick<RateSnapshot, "bend" | "materials">, thicknessMm: number | null): BendRate[] {
  if (thicknessMm === null) return [];
  const steelCodes = rates.materials.filter((m) => m.family === "mild_steel").map((m) => normaliseCode(m.code));
  return rates.bend
    .filter(
      (r) =>
        !r.placeholder &&
        Math.abs(r.thicknessMm - thicknessMm) <= BEND_FALLBACK_THICKNESS_TOLERANCE_MM &&
        (r.materialCodes === null || r.materialCodes.some((c) => steelCodes.includes(normaliseCode(c))))
    )
    .sort((a, b) => a.lengthClassMm - b.lengthClassMm);
}

/** The family multiplier of `family` from the given row, else from any other bend row of the version (by thickness), else 1. */
export function fallbackFamilyFactor(rates: Pick<RateSnapshot, "bend">, rate: BendRate, family: MaterialFamily | null): number {
  if (!family || family === "mild_steel") return 1;
  const own = rate.familyMultipliers[family];
  if (typeof own === "number" && Number.isFinite(own) && own > 0) return own;
  const others = rates.bend.filter((r) => r !== rate).sort((a, b) => a.thicknessMm - b.thicknessMm);
  for (const other of others) {
    const factor = other.familyMultipliers[family];
    if (typeof factor === "number" && Number.isFinite(factor) && factor > 0) return factor;
  }
  return 1;
}

/**
 * Bend row for a part: the exact row for its material first (factor = the
 * row's own multiplier), else the same-thickness steel row with the family
 * factor (see the header). `applyFamilyFactor` defaults to the constant.
 */
export function resolveBendRateForMaterial(
  rates: Pick<RateSnapshot, "bend" | "materials">,
  materialCode: string | null,
  family: MaterialFamily | null,
  thicknessMm: number | null,
  longestBendMm: number,
  applyFamilyFactor: boolean = BEND_FALLBACK_APPLY_FAMILY_FACTOR
): BendResolutionForMaterial {
  const exact = resolveBendRate(rates, materialCode, thicknessMm, longestBendMm);
  if (exact.rate) return { ...exact, source: "exact", factor: bendFamilyFactor(exact.rate, family) };
  if (exact.tooLong) return { ...exact, source: null, factor: 1 };
  const rows = steelBendRowsFor(rates, thicknessMm);
  if (rows.length === 0) return { rate: null, tooLong: false, limitMm: null, source: null, factor: 1 };
  const limitMm = rows[rows.length - 1].lengthClassMm;
  const rate = rows.find((r) => r.lengthClassMm >= longestBendMm - MM_EPSILON) ?? null;
  if (!rate) return { rate: null, tooLong: true, limitMm, source: null, factor: 1 };
  return { rate, tooLong: false, limitMm, source: "steel_fallback", factor: applyFamilyFactor ? fallbackFamilyFactor(rates, rate, family) : 1 };
}

/** EUR per bend per piece for a bend of `lengthMm`: (price_per_bend + price_per_bend_per_m × length beyond the base) × family factor. */
export function bendPricePerPiece(rate: BendRate, lengthMm: number, factor: number): number {
  const extraM = Math.max(0, lengthMm / 1000 - BEND_BASE_LENGTH_M);
  return (rate.pricePerBend + rate.pricePerBendPerM * extraM) * factor;
}

/** True when the bend is longer than the row's benchmarked length (priced by extrapolation, amber). */
export function bendExtrapolated(rate: BendRate, lengthMm: number): boolean {
  return rate.benchmarkedMaxLengthMm !== null && lengthMm > rate.benchmarkedMaxLengthMm + MM_EPSILON;
}

/** Family factor on the bend-line set-up and the per-bend price (1 when the family is not listed). */
export function bendFamilyFactor(rate: BendRate, family: MaterialFamily | null): number {
  if (!family) return 1;
  const factor = rate.familyMultipliers[family];
  return typeof factor === "number" && Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** Bend length classes a (material, thickness) prices at all — for the forms' hints. */
export function bendLengthClasses(rates: Pick<RateSnapshot, "bend">, materialCode: string | null, thicknessMm: number | null): number[] {
  return bendRowsFor(rates, materialCode, thicknessMm).map((r) => r.lengthClassMm);
}

/* ─── Materials ───────────────────────────────────────────── */

/** Family of a material code in the snapshot (for forms that only hold codes). */
export function familyOf(rates: Pick<RateSnapshot, "materials">, materialCode: string | null): MaterialFamily | null {
  if (!materialCode) return null;
  const key = normaliseCode(materialCode);
  return rates.materials.find((m) => normaliseCode(m.code) === key)?.family ?? null;
}
