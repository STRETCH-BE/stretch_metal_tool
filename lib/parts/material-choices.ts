/**
 * Material / thickness choices offered by the part forms — PURE (client-safe).
 * File path: /lib/parts/material-choices.ts
 *
 * A market version (rate_general.pricing_mode = 'market') benchmarks a
 * finite set of (material, thickness) pairs: exactly the rate_laser rows
 * of the version. The engine refuses anything else (market.no_benchmark_rate),
 * so the forms offer only those pairs: a material without any laser row
 * is listed as "not benchmarked" (disabled), and the thickness input turns
 * into a select of the material's benchmarked thicknesses. In cost mode
 * the thickness stays a free number and every material is selectable
 * (`thicknessesMm` is null → the caller renders a NumberInput).
 *
 * Thicknesses are taken from usable per-metre rows (in-house AND
 * subcontract — both are priced, subcontract only carries an amber flag),
 * placeholders excluded, sorted ascending, de-duplicated on MM_EPSILON.
 */

import { MM_EPSILON } from "@/lib/pricing/lookup";
import { codeListed, threadThicknesses } from "@/lib/pricing/eligibility";
import type { LaserRate, MaterialRate, PricingMode, RateSnapshot, ThreadRate } from "@/lib/pricing/types";

/** One option of a material select. `thicknessesMm` = null when the thickness is free (cost mode). */
export type MaterialChoice = {
  code: string;
  name: string;
  /** Benchmarked thicknesses of this material in the version (market mode); null = any thickness. */
  thicknessesMm: number[] | null;
  /** Market mode only: true when the version has no laser row for the material at all. */
  notBenchmarked: boolean;
};

/** Facts about the pinned version a form needs to build its choices. */
export type MaterialChoiceSource = {
  pricingMode: PricingMode;
  materials: readonly Pick<MaterialRate, "code" | "name">[];
  laser: readonly Pick<LaserRate, "materialCode" | "thicknessMm" | "mode" | "placeholder">[];
};

function sameMm(a: number, b: number): boolean {
  return Math.abs(a - b) < MM_EPSILON;
}

/** Benchmarked thicknesses per material code (market mode), from the version's usable per-metre laser rows. */
export function benchmarkedThicknesses(laser: MaterialChoiceSource["laser"]): Map<string, number[]> {
  const byCode = new Map<string, number[]>();
  for (const row of laser) {
    if (row.mode !== "per_m" || row.placeholder) continue;
    const list = byCode.get(row.materialCode) ?? [];
    if (!list.some((t) => sameMm(t, row.thicknessMm))) list.push(row.thicknessMm);
    byCode.set(row.materialCode, list);
  }
  for (const list of byCode.values()) list.sort((a, b) => a - b);
  return byCode;
}

export function materialChoices(source: MaterialChoiceSource): MaterialChoice[] {
  if (source.pricingMode !== "market") {
    return source.materials.map((m) => ({ code: m.code, name: m.name, thicknessesMm: null, notBenchmarked: false }));
  }
  const combos = benchmarkedThicknesses(source.laser);
  return source.materials.map((m) => {
    const thicknesses = combos.get(m.code) ?? [];
    return { code: m.code, name: m.name, thicknessesMm: thicknesses, notBenchmarked: thicknesses.length === 0 };
  });
}

export function materialChoicesFromSnapshot(rates: RateSnapshot | null): MaterialChoice[] {
  if (!rates) return [];
  return materialChoices({ pricingMode: rates.general.pricingMode, materials: rates.materials, laser: rates.laser });
}

/** True when the pair is priceable in the version: any pair in cost mode, a listed thickness in market mode. */
export function isBenchmarked(choice: MaterialChoice | null | undefined, thicknessMm: number | null): boolean {
  if (!choice) return false;
  if (choice.thicknessesMm === null) return true;
  return thicknessMm !== null && choice.thicknessesMm.some((t) => sameMm(t, thicknessMm));
}

/* ─── Threads ─────────────────────────────────────────────── */

/** A thread size of the version and where it is benchmarked (market mode); `thicknessesMm` empty = any thickness. */
export type ThreadOption = { size: string; materialCodes: string[] | null; thicknessesMm: number[] };

/** Thread options of a market version; null in cost mode (every size is priced there). */
export function threadOptions(source: { pricingMode: PricingMode; thread: readonly ThreadRate[] }): ThreadOption[] | null {
  if (source.pricingMode !== "market") return null;
  return source.thread.map((t) => ({ size: t.size, materialCodes: t.materialCodes, thicknessesMm: threadThicknesses(t) }));
}

/** True when a thread size has a benchmarked price for the part's material and thickness (null options = cost mode = always). */
export function threadBenchmarked(options: readonly ThreadOption[] | null, size: string, materialCode: string | null, thicknessMm: number | null): boolean {
  if (options === null) return true;
  const key = size.trim().toUpperCase().replace(/×/g, "X").replace(/\s+/g, "");
  const option = options.find((o) => o.size.trim().toUpperCase().replace(/×/g, "X").replace(/\s+/g, "") === key);
  if (!option || !codeListed(option.materialCodes, materialCode)) return false;
  if (option.thicknessesMm.length === 0) return true;
  return thicknessMm !== null && option.thicknessesMm.some((t) => sameMm(t, thicknessMm));
}
