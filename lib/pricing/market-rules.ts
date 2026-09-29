/**
 * Pricing engine — market-mode rules that are data-driven but are not
 * plain rate rows: the lead-time multiplier curve, the packaging choice
 * and the free-text minimum part size for deburring. Pure.
 * File path: /lib/pricing/market-rules.ts
 *
 * Lead time (rate_leadtime rows, working days → multiplier): tiers are
 * steps — the row with the LARGEST working_days ≤ the promised lead time
 * applies (11 → 1.00, 7–10 → 1.12, 4–6 → 1.75 in the 27 Sep 2026
 * benchmark); shorter than the shortest row → not offered (the engine
 * refuses the quote with market.leadtime_not_offered); longer than the
 * longest row → the longest row's multiplier; no rows or no promised lead
 * time → 1 (list price).
 *
 * Packaging: a box when every part fits in PACKAGING_BOX_MAX_SIDE_MM and
 * the total net mass stays within PACKAGING_BOX_MAX_MASS_KG (5 kg, the
 * benchmark's box limit), else a pallet. Both limits are engine constants
 * for now ([CONFIRM]; the owner asked for an editable rule in a later
 * admin iteration). Assembly mode (docs/assembly-mode-design.md §2) picks
 * the packaging from the admin table instead (lib/pricing/packaging.ts);
 * only the gross-mass allowance (PACKAGING_ALLOWANCE_PCT) and the
 * step-bend pitch (STEP_BEND_PITCH_MM) stay here as rules.
 *
 * Minimum part size (rate_finish.min_part_mm, free text kept editable by
 * the admin), e.g. "steel 250x60 or 600x50; aluminium/stainless 50x50":
 * segments separated by ";", each = family words followed by one or more
 * WxH sizes joined by "or" / ",". Family words: steel|mild|black →
 * mild_steel, stainless|inox → stainless, aluminium|aluminum|alu →
 * aluminium, brass, copper, all|other|any → every family. A part meets a
 * size when its larger bbox side ≥ the larger dimension and its smaller
 * side ≥ the smaller one (orientation-free); any listed size is enough. A
 * family without a rule has no minimum. Text that parses to nothing means
 * no minimum at all (never a silent refusal).
 */

import type { LeadtimeRate, MaterialFamily } from "./types";

/* ─── Lead time ───────────────────────────────────────────── */

export type LeadTimeResolution = {
  /** Multiplier applied to every part line (1 when no tier applies or no lead time is requested). */
  multiplier: number;
  /** The tier the multiplier comes from: the row with the LARGEST working_days ≤ requested. */
  row: LeadtimeRate | null;
  /** False when the requested lead time is shorter than the shortest tier offered. */
  offered: boolean;
};

/**
 * Lead-time tiers are steps, not a curve: the tier with the largest
 * working_days that is still ≤ the requested lead time applies (11 →
 * 1.00, 7–10 → 1.12, 4–6 → 1.75 in the 247 benchmark). A request shorter
 * than the shortest tier is not offered. No request (null) = list price.
 */
export function resolveLeadTimeMultiplier(rows: readonly LeadtimeRate[], workingDays: number | null): LeadTimeResolution {
  const sorted = [...rows].sort((a, b) => a.workingDays - b.workingDays);
  if (sorted.length === 0 || workingDays === null || !Number.isFinite(workingDays)) {
    return { multiplier: 1, row: null, offered: true };
  }
  let row: LeadtimeRate | null = null;
  for (const tier of sorted) if (tier.workingDays <= workingDays + 1e-9) row = tier;
  if (!row) return { multiplier: 1, row: null, offered: false };
  return { multiplier: row.multiplier, row, offered: true };
}

/* ─── Packaging ───────────────────────────────────────────── */

/** [CONFIRM] Box when every part fits in this (mm) … */
export const PACKAGING_BOX_MAX_SIDE_MM = 600;
/** [CONFIRM] … and the order's total net mass stays under this (kg). */
export const PACKAGING_BOX_MAX_MASS_KG = 5; // [CONFIRM] 247 ships up to 5 kg in a box

export type PackagingKind = "box" | "pallet";

/** [CONFIRM] Assembly mode: gross mass = net mass of every part × (1 + this %) — the carton / foam / pallet itself. */
export const PACKAGING_ALLOWANCE_PCT = 5;

/** Gross (packed) mass from the net mass of the parts: net × (1 + PACKAGING_ALLOWANCE_PCT / 100). */
export function grossMassKg(netMassKg: number): number {
  return netMassKg * (1 + PACKAGING_ALLOWANCE_PCT / 100);
}

/* ─── Step bending ────────────────────────────────────────── */

/** [CONFIRM] Step bending on the press brake: one hit per this much arc length (R90 over 180° → 19 hits). */
export const STEP_BEND_PITCH_MM = 15;

export type PackagingPart = { maxSideMm: number; massKg: number | null; qty: number };

export type PackagingDecision = {
  kind: PackagingKind;
  maxSideMm: number;
  totalMassKg: number;
  maxSideLimitMm: number;
  massLimitKg: number;
};

export function decidePackaging(parts: readonly PackagingPart[]): PackagingDecision {
  let maxSideMm = 0;
  let totalMassKg = 0;
  for (const part of parts) {
    if (part.maxSideMm > maxSideMm) maxSideMm = part.maxSideMm;
    totalMassKg += (part.massKg ?? 0) * part.qty;
  }
  const fits = maxSideMm <= PACKAGING_BOX_MAX_SIDE_MM && totalMassKg <= PACKAGING_BOX_MAX_MASS_KG;
  return {
    kind: fits ? "box" : "pallet",
    maxSideMm,
    totalMassKg,
    maxSideLimitMm: PACKAGING_BOX_MAX_SIDE_MM,
    massLimitKg: PACKAGING_BOX_MAX_MASS_KG,
  };
}

/* ─── Minimum part size ───────────────────────────────────── */

export type MinPartSize = { aMm: number; bMm: number };
export type MinPartRule = { families: MaterialFamily[] | "all"; sizes: MinPartSize[] };

const FAMILY_WORDS: Record<string, MaterialFamily | "all"> = {
  steel: "mild_steel",
  mild: "mild_steel",
  mild_steel: "mild_steel",
  black: "mild_steel",
  stainless: "stainless",
  inox: "stainless",
  aluminium: "aluminium",
  aluminum: "aluminium",
  alu: "aluminium",
  brass: "brass",
  copper: "copper",
  all: "all",
  any: "all",
  other: "all",
};

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/gi;

export function parseMinPartRule(text: string | null | undefined): MinPartRule[] {
  if (!text) return [];
  const rules: MinPartRule[] = [];
  for (const segment of text.split(";")) {
    const sizes: MinPartSize[] = [];
    for (const match of segment.matchAll(SIZE_RE)) {
      const a = Number(match[1].replace(",", "."));
      const b = Number(match[2].replace(",", "."));
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) sizes.push({ aMm: a, bMm: b });
    }
    if (sizes.length === 0) continue;
    const words = segment
      .replace(SIZE_RE, " ")
      .toLowerCase()
      .split(/[^a-z_]+/)
      .filter(Boolean);
    const families = new Set<MaterialFamily>();
    let all = false;
    for (const word of words) {
      const family = FAMILY_WORDS[word];
      if (family === "all") all = true;
      else if (family) families.add(family);
    }
    rules.push({ families: all || families.size === 0 ? "all" : [...families], sizes });
  }
  return rules;
}

/**
 * True/false when a rule applies to the family, null when no rule does
 * (no minimum). A family-specific rule wins over an "all" rule.
 */
/** The rules that decide for a family: the family-specific ones, else the "all" ones. */
export function applicableMinPartRules(rules: readonly MinPartRule[], family: MaterialFamily | null): MinPartRule[] {
  const specific = family ? rules.filter((r) => r.families !== "all" && r.families.includes(family)) : [];
  return specific.length > 0 ? specific : rules.filter((r) => r.families === "all");
}

export function meetsMinPartSize(
  rules: readonly MinPartRule[],
  family: MaterialFamily | null,
  widthMm: number,
  heightMm: number
): boolean | null {
  const applicable = applicableMinPartRules(rules, family);
  if (applicable.length === 0) return null;
  const big = Math.max(widthMm, heightMm);
  const small = Math.min(widthMm, heightMm);
  return applicable.some((rule) =>
    rule.sizes.some((size) => big >= Math.max(size.aMm, size.bMm) - 1e-9 && small >= Math.min(size.aMm, size.bMm) - 1e-9)
  );
}

/** Rendering of a rule for messages: "250×60 / 600×50". */
export function describeMinPartSizes(rule: MinPartRule): string {
  return rule.sizes.map((s) => `${s.aMm}×${s.bMm}`).join(" / ");
}
