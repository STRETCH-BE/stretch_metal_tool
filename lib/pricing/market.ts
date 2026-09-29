/**
 * Pricing engine — MARKET mode: the version's rate tables are benchmarked
 * selling prices (247TailorSteel / Laserhub standard tier × 1.10), nothing
 * is added on top, and whatever the version does not benchmark is REFUSED,
 * never approximated.
 * File path: /lib/pricing/market.ts
 *
 * Unit price of a part line (qty pieces), all from the active snapshot:
 *   setup_eur(material, t) ÷ pieces in the same (material, thickness) group
 *   + order_charge_eur ÷ pieces in the quote
 *   + net area × t × density × price_per_kg(t)          (material on NET area)
 *   + cut length × price_per_m + pierces × price_per_pierce
 *   + bending: (setup_per_part_type + n × setup_per_bend_line × f) ÷ qty
 *              + Σ over bend lines of (price_per_bend + price_per_bend_per_m × max(0, L − 0.2 m)) × f
 *              (n = bend lines, f = family multiplier, row by exact thickness and
 *              material list; L > length_class_mm (press brake) → red bend_too_long,
 *              L > benchmarked_max_length_mm → priced, amber extrapolated_rate;
 *              no row for the material → the same-thickness steel row × the
 *              family factor, amber bend_rate_from_steel; no steel row → red
 *              not_benchmarked)
 *   + welding: the version's rate_weld rows like cost mode; NO rows → cost-plus:
 *     the cost version's weld lines (options.costRates, every seam needs a row
 *     for its process there) × 1 ÷ (1 − the quote's margin), amber
 *     market.cost_plus instead of refusing the part; no cost version → red
 *     not_benchmarked as before. The welding-only block follows the same rule.
 *   + threads: setup_per_line ÷ qty + count × price_by_thickness[t]
 *   + features: setup_per_line ÷ qty + count × price_each (material + thickness range)
 *   + finishes: setup_per_line ÷ qty + price_per_part + units × price
 *              (units: m = cut length, m2 = net area × 2, kg = net mass, part = 1)
 *   + manual lines typed by the user (machining minutes, lump sums)
 *   × lead-time multiplier (one "leadtime" line = (multiplier − 1) × the
 *     tiered lines; finishes with tier_multiplier_applies = false stay outside)
 * Quote level: packaging once (box ≤ 5 kg and ≤ 600 mm, else pallet) and one
 * top-up line per finish minimum (per order, or per colour for powder), both
 * outside the lead-time multiplier.
 *
 * Gates and refusals (red flag, unitPrice null, no lines — the quote
 * cannot be sent and no number is shown for the part):
 * - market.no_benchmark_rate: no rate_laser row with exactly this material
 *   and thickness (context.ts exactRates → lookup.ts findExactLaserRate), no
 *   material band at exactly this thickness, a material code the version
 *   does not list, a thread size without a price at this thickness / for
 *   this material, or a feature outside its material list / thickness range;
 * - market.bend_too_long: a bend longer than the longest length class the
 *   version prices for the material / thickness (the 4 400 mm press brake);
 * - market.not_benchmarked {operation}: bends with no rate_bend row for the
 *   material / thickness (also bends recognised as 0 on a part marked bent), rolling /
 *   welding / tube parts without rows, a finish or feature code the version
 *   has no row for, a finish outside its material list / thickness range,
 *   a hot-dip order above limits.maxOrderNetKg (quote level);
 * - market.leadtime_not_offered: a lead time shorter than the shortest
 *   rate_leadtime tier, or shorter than the largest min_lead_time_days of the
 *   quote's finishes (coatings). Quote level, every part refused.
 * Amber (informational, priced): market.subcontract for in_house = false
 * rows, market.manual_price for user-typed lines, finish.part_too_small /
 * finish.not_for_family when a finish is not available for the part by its
 * min_part_mm rule (no charge, price unchanged), market.extrapolated_rate when a
 * bend is longer than the row's benchmarked length (priced per metre). Green:
 * market.finish_implied when a coating that includes edge breaking drops a
 * deburring option.
 * The cost-mode "*.no_rate_row" / subcontract flags are replaced by these;
 * geometry, bend-geometry and bed-size flags still apply.
 *
 * Decisions:
 * - Pieces = Σ qty over the PRICEABLE lines (a refused part is not in the
 *   order); set-ups and the order charge are per piece, so quantity
 *   discounts fall out of the split and there is no other quantity logic.
 * - per_m rows only. The cut length is charged plain: the benchmark's
 *   per-pierce prices already carry small-contour handling, so
 *   slow_contour_factor is not applied on top.
 * - No margin on market prices; the margin shown is 1 − cost ÷ price with
 *   the cost version (options.costRates, machine-hour model). Below the
 *   version's default_margin_pct → red market.margin_below_default.
 * - Finish minimums are compared with what the lines of that finish (and
 *   colour) charge after the lead-time multiplier; the difference is one
 *   quote line. A finish with price 0 and a minimum (hot-dip) is therefore a
 *   flat per-quote amount.
 * - eligibility.ts decides which row prices an option and why one does not.
 */

import { buildPartContext, type PartContext } from "./context";
import {
  FINISHES_INCLUDING_EDGE_BREAKING,
  bendExtrapolated,
  bendPricePerPiece,
  featureEligibility,
  finishEligibility,
  finishRefused,
  finishVariantBase,
  BEND_FALLBACK_APPLY_FAMILY_FACTOR,
  resolveBendRateForMaterial,
  type BendRateSource,
  resolveFinishRate,
  threadPriceFor,
  type FinishEligibility,
} from "./eligibility";
import { PricingError } from "./errors";
import { evaluateContextFlags, evaluateQuoteFlags } from "./feasibility";
import { machiningCost, mmToM } from "./formulas";
import { OPERATION_LABELS } from "./labels";
import { findFeatureRate, findThreadRate, findWeldRate, normaliseThreadSize } from "./lookup";
import { applicableMinPartRules, decidePackaging, describeMinPartSizes, parseMinPartRule, resolveLeadTimeMultiplier, type LeadTimeResolution, type MinPartRule } from "./market-rules";
import { laserLine, makeLine, rollLine, weldLines } from "./operations";
import {
  marginToMarkup,
  priceFromCost,
  type BendRate,
  type DriverUnit,
  type FeatureRate,
  type FinishRate,
  type Flag,
  type FlagCode,
  type FlagSeverity,
  type MachinePark,
  type OperationLine,
  type OperationType,
  type PricedItem,
  type PricedQuote,
  type QuoteInput,
  type RateRef,
  type RateSnapshot,
  type ThreadRate,
  type TotalsByType,
} from "./types";
import { lotLine, priceWeldingOnly } from "./welding-block";
import { PRICING_ENGINE_VERSION } from "./version";

export type MarketPricingOptions = {
  costRates: RateSnapshot | null;
  /** The cost-mode pricer (price-quote.ts priceCostQuote), used on costRates. */
  priceCost: (input: QuoteInput, rates: RateSnapshot, machines: MachinePark) => PricedQuote;
};

const EPS = 1e-9;

/** Cost-mode flags the market rules replace (their market counterparts carry the message). */
const REPLACED_COST_FLAGS: ReadonlySet<FlagCode> = new Set<FlagCode>([
  "laser.no_rate_row",
  "laser.subcontract",
  "laser.thickness_over_limit",
  "laser.slow_contours",
  "material.no_price",
  "bend.no_rate_row",
  "roll.no_rate_row",
  "weld.no_rate_row",
  "tube.no_rate_row",
  "thread.no_rate_row",
  "feature.no_rate_row",
  "finish.no_rate_row",
  "finish.minimum_applied",
]);

function quoteFlag(code: FlagCode, severity: FlagSeverity, params: Record<string, number | string> = {}): Flag {
  return { code, severity, partId: null, itemId: null, params, overridable: severity === "amber" };
}

function partFlag(ctx: PartContext, code: FlagCode, severity: FlagSeverity, params: Record<string, number | string> = {}): Flag {
  return { code, severity, partId: ctx.part.id, itemId: ctx.item.id, params, overridable: severity === "amber" };
}

/* ─── Rate references ─────────────────────────────────────── */

function finishRef(rate: FinishRate): RateRef {
  return {
    table: "rate_finish",
    key: rate.code,
    values: {
      code: rate.code,
      unit: rate.unit,
      price: rate.price,
      minimum: rate.minimum,
      minimumScope: rate.minimumScope,
      setupPerOrderEur: rate.setupPerOrderEur,
      setupPerLineEur: rate.setupPerLineEur,
      pricePerPartEur: rate.pricePerPartEur,
      minLeadTimeDays: rate.minLeadTimeDays,
      tierMultiplierApplies: rate.tierMultiplierApplies,
      minPartMm: rate.minPartMm,
      materialCodes: rate.materialCodes ? rate.materialCodes.join(",") : null,
      minThicknessMm: rate.minThicknessMm,
      maxThicknessMm: rate.maxThicknessMm,
      placeholder: rate.placeholder,
    },
  };
}

function threadRef(rate: ThreadRate, priceEach: number, thicknessMm: number | null): RateRef {
  return {
    table: "rate_thread",
    key: rate.size,
    values: {
      size: rate.size,
      priceEach,
      thicknessMm,
      setupPerLineEur: rate.setupPerLineEur,
      materialCodes: rate.materialCodes ? rate.materialCodes.join(",") : null,
      placeholder: rate.placeholder,
    },
  };
}

function featureRef(rate: FeatureRate): RateRef {
  return {
    table: "rate_feature",
    key: rate.code,
    values: {
      code: rate.code,
      priceEach: rate.priceEach,
      setupPerLineEur: rate.setupPerLineEur,
      materialCodes: rate.materialCodes ? rate.materialCodes.join(",") : null,
      minThicknessMm: rate.minThicknessMm,
      maxThicknessMm: rate.maxThicknessMm,
      placeholder: rate.placeholder,
    },
  };
}

function bendRef(rate: BendRate, factor: number, source: BendRateSource): RateRef {
  return {
    table: "rate_bend",
    key: `${rate.thicknessMm}/${rate.lengthClassMm}`,
    values: {
      rateBendId: rate.id ?? null,
      source,
      thicknessMm: rate.thicknessMm,
      lengthClassMm: rate.lengthClassMm,
      pricePerBend: rate.pricePerBend,
      setupPerPartType: rate.setupPerPartType,
      setupPerBendLineEur: rate.setupPerBendLineEur,
      pricePerBendPerM: rate.pricePerBendPerM,
      benchmarkedMaxLengthMm: rate.benchmarkedMaxLengthMm,
      familyFactor: factor,
      materialCodes: rate.materialCodes ? rate.materialCodes.join(",") : null,
      placeholder: rate.placeholder,
    },
  };
}

/* ─── Gates ───────────────────────────────────────────────── */

/** (material, thickness) group of a line for the laser setup split; null when the line has no laser row. */
export function laserSetupGroupKey(ctx: PartContext): string | null {
  const row = ctx.laser?.row;
  return row ? `${row.materialCode}/${row.thicknessMm}` : null;
}

/** The finish options of a line resolved against the version. */
export type PlannedFinish = {
  /** Index of the extra on the item; null for engraving implied by the geometry. */
  index: number | null;
  rate: FinishRate;
  /** "ok" prices the finish; "size" / "family" leave it unavailable (amber, no charge). */
  availability: Exclude<FinishEligibility, "material" | "thickness">;
  colour: string | null;
  selected: boolean;
};

export type PlannedBend = {
  rate: BendRate;
  factor: number;
  /** The part's own row, or the same-thickness steel row (amber market.bend_rate_from_steel). */
  source: BendRateSource;
  count: number;
  longestMm: number;
  bendIds: string[];
  /** Length of every bend line (mm), each priced with its own length. */
  lengthsMm: number[];
  /** Bends longer than the row's benchmarked length (priced by extrapolation). */
  extrapolated: number;
};
export type PlannedThread = { rate: ThreadRate; size: string; count: number; priceEach: number; loopIds: string[] };
export type PlannedFeature = { index: number; rate: FeatureRate; count: number };

type Verdict = {
  /** Red flags that make the part unpriceable. */
  refusals: Flag[];
  /** Amber / green notes on a priced part. */
  notes: Flag[];
  /** False when the part has no exact laser row (material / thickness missing or not benchmarked). */
  priceable: boolean;
  bend: PlannedBend | null;
  /** Welds priced cost-plus from the cost version (the market version has no rate_weld row). */
  weldingCostPlus: boolean;
  threads: PlannedThread[];
  features: PlannedFeature[];
  finishes: PlannedFinish[];
};

/** What market mode may price cost-plus when the version has no rows: the cost version and the quote's margin. */
type CostPlusFallback = { costRates: RateSnapshot | null; marginPct: number };

const FINISH_KEY = (code: string): string => code.trim().toLowerCase();

function colourOf(colour: string | null | undefined): string | null {
  const text = colour?.trim() ?? "";
  return text === "" ? null : text;
}

function assessPart(ctx: PartContext, fallback: CostPlusFallback): Verdict {
  const { rates, material, thicknessMm, annotations, item, geometry } = ctx;
  const refusals: Flag[] = [];
  const notes: Flag[] = [];
  let priceable = true;
  const materialCode = material?.code ?? ctx.part.materialCode;
  const notBenchmarked = (operation: string, extra: Record<string, number | string> = {}) =>
    refusals.push(partFlag(ctx, "market.not_benchmarked", "red", { operation, ...extra }));
  const noRate = (what: string, extra: Record<string, number | string> = {}) =>
    refusals.push(partFlag(ctx, "market.no_benchmark_rate", "red", { what, materialCode: materialCode ?? "", thicknessMm: thicknessMm ?? 0, ...extra }));

  if (ctx.isTubePart) {
    priceable = false;
    if (rates.tubeLaser.length === 0) notBenchmarked("tube");
  } else if (!material || thicknessMm === null) {
    // geometry.no_material / geometry.no_thickness are already red; a material
    // code the version does not list is also "not benchmarked" (Cu-ETP, …).
    priceable = false;
    if (!material && ctx.part.materialCode) noRate("material");
  } else if (!ctx.laser?.row) {
    priceable = false;
    noRate("laser");
  } else if (!ctx.priceBand) {
    priceable = false;
    noRate("material");
  } else if (!ctx.laser.row.inHouse) {
    notes.push(partFlag(ctx, "market.subcontract", "amber", { materialCode: material.code, thicknessMm, supplier: ctx.laser.row.supplier ?? "" }));
  }

  // Bending: every bend line of the part, priced from the row that matches
  // exactly, else from the same-thickness steel row (amber, never silent).
  let bend: PlannedBend | null = null;
  const bends = ctx.bends.filter((b) => b.lengthMm > 0);
  if (bends.length > 0) {
    const longestMm = Math.max(...bends.map((b) => b.lengthMm));
    const resolved = resolveBendRateForMaterial(rates, materialCode, ctx.family, thicknessMm, longestMm, BEND_FALLBACK_APPLY_FAMILY_FACTOR);
    if (resolved.rate && resolved.source) {
      const rate = resolved.rate;
      const extrapolated = bends.filter((b) => bendExtrapolated(rate, b.lengthMm)).length;
      bend = { rate, factor: resolved.factor, source: resolved.source, count: bends.length, longestMm, bendIds: bends.map((b) => b.id), lengthsMm: bends.map((b) => b.lengthMm), extrapolated };
      if (resolved.source === "steel_fallback") {
        notes.push(
          partFlag(ctx, "market.bend_rate_from_steel", "amber", {
            thicknessMm: rate.thicknessMm,
            factor: resolved.factor,
            family: ctx.family ?? "",
            materialCode: materialCode ?? "",
            count: bends.length,
          })
        );
      }
      if (extrapolated > 0) {
        notes.push(
          partFlag(ctx, "market.extrapolated_rate", "amber", {
            operation: "bending",
            count: extrapolated,
            longestMm,
            benchmarkedMaxMm: rate.benchmarkedMaxLengthMm ?? 0,
            pricePerM: rate.pricePerBendPerM,
          })
        );
      }
    } else if (resolved.tooLong) {
      refusals.push(partFlag(ctx, "market.bend_too_long", "red", { longestMm, limitMm: resolved.limitMm ?? 0, count: bends.length, materialCode: materialCode ?? "", thicknessMm: thicknessMm ?? 0 }));
    } else {
      notBenchmarked("bending", { count: bends.length, longestMm, materialCode: materialCode ?? "", thicknessMm: thicknessMm ?? 0 });
    }
  } else if (annotations.forming === "bent") {
    // Marked as bent but no bend line recognised: never price it as a flat part.
    notBenchmarked("bending", { count: 0, longestMm: 0, materialCode: materialCode ?? "", thicknessMm: thicknessMm ?? 0 });
  }
  if (annotations.roll && rates.roll.length === 0) notBenchmarked("rolling");
  let weldingCostPlus = false;
  if (annotations.welds.length > 0 && rates.weld.length === 0) {
    // No benchmarked welding rate: the seams are priced cost-plus from the cost
    // version when it has a row for every seam's process, else the part is refused.
    const cost = fallback.costRates;
    if (cost && cost.weld.length > 0 && annotations.welds.every((w) => findWeldRate(cost, w.process, w.beadMm) !== null)) {
      weldingCostPlus = true;
      notes.push(partFlag(ctx, "market.cost_plus", "amber", { operation: "welding", marginPct: fallback.marginPct, count: annotations.welds.length }));
    } else {
      notBenchmarked("welding", { count: annotations.welds.length });
    }
  }

  // Threads: size row + price at exactly this thickness for this material.
  const threads: PlannedThread[] = [];
  for (const group of ctx.confirmedThreads) {
    const rate = findThreadRate(rates, group.size);
    const priceEach = rate ? threadPriceFor(rate, materialCode, thicknessMm) : null;
    if (rate && priceEach !== null) {
      threads.push({ rate, size: group.size, count: group.loopIds.length, priceEach, loopIds: group.loopIds });
    } else {
      noRate(`thread ${group.size}`, { size: group.size, count: group.loopIds.length });
    }
  }

  // Features and finishes typed on the line.
  const features: PlannedFeature[] = [];
  const finishes: PlannedFinish[] = [];
  const finishExtras = item.extras
    .map((extra, index) => ({ extra, index }))
    .filter((e): e is { extra: Extract<PricingItemExtra, { type: "finish" }>; index: number } => e.extra.type === "finish");
  const coatingCodes = new Set<string>();
  for (const { extra } of finishExtras) {
    const rate = resolveFinishRate(rates, extra.code, materialCode);
    const base = rate ? (finishVariantBase(rate.code) ?? FINISH_KEY(rate.code)) : FINISH_KEY(extra.code);
    if (base in FINISHES_INCLUDING_EDGE_BREAKING) coatingCodes.add(base);
  }
  const implied = new Set<string>();
  for (const coating of coatingCodes) for (const code of FINISHES_INCLUDING_EDGE_BREAKING[coating]) implied.add(FINISH_KEY(code));
  const impliedBy = [...coatingCodes].join(", ");

  item.extras.forEach((extra, index) => {
    if (extra.type === "feature") {
      const rate = findFeatureRate(rates, extra.code);
      if (!rate) {
        notBenchmarked(`feature ${extra.code}`, { code: extra.code, index });
        return;
      }
      const eligibility = featureEligibility(rate, materialCode, thicknessMm);
      if (eligibility !== "ok") {
        noRate(`feature ${rate.code}`, { code: rate.code, count: extra.count, index, reason: eligibility });
        return;
      }
      features.push({ index, rate, count: extra.count });
    } else if (extra.type === "finish") {
      const key = FINISH_KEY(extra.code);
      if (implied.has(key) && !coatingCodes.has(key)) {
        notes.push(partFlag(ctx, "market.finish_implied", "green", { code: extra.code, by: impliedBy, index }));
        return;
      }
      const rate = resolveFinishRate(rates, extra.code, materialCode);
      if (!rate) {
        notBenchmarked(`finish ${extra.code}`, { code: extra.code, index });
        return;
      }
      const { width, height } = geometry.measures.bbox;
      const eligibility = finishEligibility(rate, { materialCode, thicknessMm, family: ctx.family, widthMm: width, heightMm: height });
      if (eligibility === "material" || eligibility === "thickness") {
        notBenchmarked(`finish ${rate.code}`, { code: rate.code, index, reason: eligibility, materialCode: materialCode ?? "", thicknessMm: thicknessMm ?? 0 });
        return;
      }
      finishes.push({ index, rate, availability: eligibility, colour: colourOf(extra.colour), selected: true });
    } else if (extra.type === "machining") {
      notes.push(partFlag(ctx, "market.manual_price", "amber", { what: "machining", minutes: extra.minutes, index }));
    } else if (extra.type === "other") {
      notes.push(partFlag(ctx, "market.manual_price", "amber", { what: extra.label, amount: extra.unitCost, index }));
    } else if (extra.type === "handling") {
      notes.push(partFlag(ctx, "market.manual_price", "amber", { what: "handling", amount: extra.unitCost, index }));
    }
  });
  const engraveSelected = finishes.some((f) => FINISH_KEY(f.rate.code) === OPERATION_LABELS.engrave);
  if (!engraveSelected && geometry.measures.engraveLengthMm > 0) {
    const rate = resolveFinishRate(rates, OPERATION_LABELS.engrave, materialCode);
    if (!rate || finishRefused(finishEligibility(rate, { materialCode, thicknessMm, family: ctx.family }))) {
      notBenchmarked(`finish ${OPERATION_LABELS.engrave}`, { code: OPERATION_LABELS.engrave });
    } else {
      finishes.push({ index: null, rate, availability: "ok", colour: null, selected: false });
    }
  }

  return { refusals, notes, priceable: priceable && refusals.length === 0, bend, weldingCostPlus, threads, features, finishes };
}

type PricingItemExtra = QuoteInput["items"][number]["extras"][number];

/* ─── Per-line builders ───────────────────────────────────── */

function marketMaterialLine(ctx: PartContext): OperationLine | null {
  const { material, thicknessMm, priceBand, netMassKg, geometry } = ctx;
  if (!material || thicknessMm === null || !priceBand || netMassKg === null) return null;
  const { width, height } = geometry.measures.bbox;
  if (width <= 0 || height <= 0) return null;
  return makeLine(ctx, {
    suffix: "material",
    type: "material",
    label: OPERATION_LABELS.material,
    driverQty: netMassKg,
    driverUnit: "kg",
    unitCost: netMassKg * priceBand.pricePerKg,
    rateRef: {
      table: "materials",
      key: `${material.code}/${priceBand.maxThicknessMm}`,
      values: {
        code: material.code,
        family: material.family,
        densityKgM3: material.densityKgM3,
        pricePerKg: priceBand.pricePerKg,
        bandMaxThicknessMm: priceBand.maxThicknessMm,
        scrapPct: 0,
        basis: "net_mass",
        placeholder: material.placeholder,
      },
    },
    details: {
      netAreaMm2: geometry.measures.netAreaMm2,
      netMassKg,
      thicknessMm,
      pricePerKg: priceBand.pricePerKg,
      bboxWidthMm: width,
      bboxHeightMm: height,
    },
  });
}

function laserSetupLine(ctx: PartContext, groupPieces: ReadonlyMap<string, number>): OperationLine | null {
  const row = ctx.laser?.row;
  const key = laserSetupGroupKey(ctx);
  if (!row || !key || row.setupEur <= 0) return null;
  const pieces = Math.max(1, groupPieces.get(key) ?? ctx.item.qty);
  const share = row.setupEur / pieces;
  return makeLine(ctx, {
    suffix: "laser-setup",
    type: "setup",
    label: OPERATION_LABELS.laserSetup,
    driverQty: 1,
    driverUnit: "lot",
    unitCost: share,
    setupShare: share,
    rateRef: {
      table: "rate_laser",
      key,
      values: { materialCode: row.materialCode, thicknessMm: row.thicknessMm, setupEur: row.setupEur, placeholder: row.placeholder },
    },
    details: { setupEur: row.setupEur, piecesInGroup: pieces, qty: ctx.item.qty },
  });
}

function orderChargeLine(ctx: PartContext, totalPieces: number): OperationLine | null {
  const general = ctx.rates.general;
  if (general.orderChargeEur <= 0 || totalPieces <= 0) return null;
  const share = general.orderChargeEur / totalPieces;
  return makeLine(ctx, {
    suffix: "order",
    type: "order",
    label: OPERATION_LABELS.orderCharge,
    driverQty: 1,
    driverUnit: "lot",
    unitCost: share,
    rateRef: {
      table: "rate_general",
      key: "order_charge_eur",
      values: { orderChargeEur: general.orderChargeEur, pieces: totalPieces, placeholder: general.placeholder },
    },
    details: { orderChargeEur: general.orderChargeEur, pieces: totalPieces, qty: ctx.item.qty },
  });
}

/** Bending (rule 14): set-up per part type, set-up per bend line and the per-bend price (with the per-metre extension), family factor on the last two. */
function bendLinesMarket(ctx: PartContext, plan: PlannedBend): OperationLine[] {
  const { rate, factor, source, count, longestMm, bendIds, lengthsMm, extrapolated } = plan;
  const qty = ctx.item.qty;
  const ref = bendRef(rate, factor, source);
  const lines: OperationLine[] = [];
  if (rate.setupPerPartType > 0) {
    const share = rate.setupPerPartType / qty;
    lines.push(
      makeLine(ctx, {
        suffix: "bend-setup",
        type: "setup",
        label: OPERATION_LABELS.bendSetup,
        driverQty: 1,
        driverUnit: "lot",
        unitCost: share,
        setupShare: share,
        rateRef: ref,
        details: { setupPerPartType: rate.setupPerPartType, qty, bendCount: count },
      })
    );
  }
  if (rate.setupPerBendLineEur > 0) {
    const share = (count * rate.setupPerBendLineEur * factor) / qty;
    lines.push(
      makeLine(ctx, {
        suffix: "bend-line-setup",
        type: "setup",
        label: OPERATION_LABELS.bendLineSetup,
        driverQty: count,
        driverUnit: "bend",
        unitCost: share,
        setupShare: share,
        rateRef: ref,
        details: { setupPerBendLineEur: rate.setupPerBendLineEur, factor, bendCount: count, qty },
      })
    );
  }
  lines.push(
    makeLine(ctx, {
      suffix: "bends",
      type: "bend",
      label: OPERATION_LABELS.bend,
      driverQty: count,
      driverUnit: "bend",
      unitCost: lengthsMm.reduce((sum, lengthMm) => sum + bendPricePerPiece(rate, lengthMm, factor), 0),
      rateRef: ref,
      details: {
        bendCount: count,
        longestMm,
        lengthClassMm: rate.lengthClassMm,
        benchmarkedMaxLengthMm: rate.benchmarkedMaxLengthMm,
        pricePerBend: rate.pricePerBend,
        pricePerBendPerM: rate.pricePerBendPerM,
        extrapolatedBends: extrapolated,
        factor,
        rateSource: source,
        rateBendId: rate.id ?? null,
        bendIds: bendIds.join(","),
      },
    })
  );
  return lines;
}

/** Threads (rule 15): per-line set-up and count × the price at this thickness. */
function threadLinesMarket(ctx: PartContext, plans: readonly PlannedThread[]): OperationLine[] {
  const lines: OperationLine[] = [];
  for (const plan of plans) {
    const key = normaliseThreadSize(plan.size);
    const ref = threadRef(plan.rate, plan.priceEach, ctx.thicknessMm);
    if (plan.rate.setupPerLineEur > 0) {
      const share = plan.rate.setupPerLineEur / ctx.item.qty;
      lines.push(
        makeLine(ctx, {
          suffix: `thread-setup:${key}`,
          type: "setup",
          label: OPERATION_LABELS.threadSetup,
          driverQty: 1,
          driverUnit: "lot",
          unitCost: share,
          setupShare: share,
          rateRef: ref,
          details: { size: plan.rate.size, setupPerLineEur: plan.rate.setupPerLineEur, qty: ctx.item.qty },
        })
      );
    }
    lines.push(
      makeLine(ctx, {
        suffix: `thread:${key}`,
        type: "thread",
        label: plan.rate.size,
        driverQty: plan.count,
        driverUnit: "each",
        unitCost: plan.count * plan.priceEach,
        rateRef: ref,
        details: { size: plan.rate.size, count: plan.count, priceEach: plan.priceEach, thicknessMm: ctx.thicknessMm ?? 0, loopIds: plan.loopIds.join(",") },
      })
    );
  }
  return lines;
}

/** Features (rule 16): per-line set-up and count × price_each. */
function featureLinesMarket(ctx: PartContext, plans: readonly PlannedFeature[]): OperationLine[] {
  const lines: OperationLine[] = [];
  for (const plan of plans) {
    const ref = featureRef(plan.rate);
    if (plan.rate.setupPerLineEur > 0) {
      const share = plan.rate.setupPerLineEur / ctx.item.qty;
      lines.push(
        makeLine(ctx, {
          suffix: `feature-setup:${plan.index}`,
          type: "setup",
          label: OPERATION_LABELS.featureSetup,
          driverQty: 1,
          driverUnit: "lot",
          unitCost: share,
          setupShare: share,
          auto: false,
          rateRef: ref,
          details: { code: plan.rate.code, setupPerLineEur: plan.rate.setupPerLineEur, qty: ctx.item.qty },
        })
      );
    }
    lines.push(
      makeLine(ctx, {
        suffix: `feature:${plan.index}`,
        type: "feature",
        label: plan.rate.name,
        driverQty: plan.count,
        driverUnit: "each",
        unitCost: plan.count * plan.rate.priceEach,
        auto: false,
        rateRef: ref,
        details: { code: plan.rate.code, count: plan.count, priceEach: plan.rate.priceEach },
      })
    );
  }
  return lines;
}

function finishType(code: string): OperationType {
  const c = FINISH_KEY(code);
  if (c === OPERATION_LABELS.engrave) return "engrave";
  if (c.startsWith(OPERATION_LABELS.deburr) || c === "edge_round") return "finish_deburr";
  if (c === "powder") return "finish_powder";
  if (c === "zinc" || c === "hot_dip") return "finish_zinc";
  return "finish_other";
}

function notAvailableFlag(ctx: PartContext, rate: FinishRate, availability: "size" | "family", rules: readonly MinPartRule[]): Flag {
  const { width, height } = ctx.geometry.measures.bbox;
  if (availability === "family") {
    return partFlag(ctx, "finish.not_for_family", "amber", { code: rate.code, family: ctx.family ?? "", rule: rate.minPartMm ?? "" });
  }
  const applicable = applicableMinPartRules(rules, ctx.family);
  return partFlag(ctx, "finish.part_too_small", "amber", {
    code: rate.code,
    widthMm: width,
    heightMm: height,
    minimum: applicable.map(describeMinPartSizes).join(" / "),
    family: ctx.family ?? "",
  });
}

/** Units a finish is charged on (rule 17): m = cut length, m2 = net area × 2, kg = net mass, part / each = 1. */
function finishUnits(ctx: PartContext, rate: FinishRate): { units: number; unit: DriverUnit } {
  const m = ctx.geometry.measures;
  switch (rate.unit) {
    case "m":
      return { units: mmToM(m.cutLengthMm), unit: "m" };
    case "m2":
      return { units: (m.netAreaMm2 * 2) / 1e6, unit: "m2" };
    case "kg":
      return { units: ctx.netMassKg ?? 0, unit: "kg" };
    default:
      return { units: 1, unit: "part" };
  }
}

type FinishLines = { lines: OperationLine[]; flag: Flag | null; /** Lines outside the lead-time multiplier (certificates). */ exempt: OperationLine[] };

/**
 * One finish on a line (rules 17–22): its per-line set-up (÷ qty per
 * piece), then price_per_part + units × price per piece. Not available by
 * the size rule → the flag, no lines.
 */
function finishLinesMarket(ctx: PartContext, plan: PlannedFinish): FinishLines {
  const { rate, availability, colour, selected, index } = plan;
  if (availability !== "ok") return { lines: [], flag: notAvailableFlag(ctx, rate, availability, parseMinPartRule(rate.minPartMm)), exempt: [] };
  const lines: OperationLine[] = [];
  const suffix = index === null ? rate.code : `${rate.code}:${index}`;
  const ref = finishRef(rate);
  if (rate.setupPerLineEur > 0) {
    const share = rate.setupPerLineEur / ctx.item.qty;
    lines.push(
      makeLine(ctx, {
        suffix: `${suffix}-setup`,
        type: "setup",
        label: OPERATION_LABELS.finishSetup,
        driverQty: 1,
        driverUnit: "lot",
        unitCost: share,
        setupShare: share,
        auto: !selected,
        rateRef: ref,
        details: { code: rate.code, setupPerLineEur: rate.setupPerLineEur, qty: ctx.item.qty, colour, tierExempt: rate.tierMultiplierApplies ? 0 : 1 },
      })
    );
  }
  const { units, unit } = finishUnits(ctx, rate);
  const perPiece = rate.pricePerPartEur + units * rate.price;
  if (perPiece > 0) {
    lines.push(
      makeLine(ctx, {
        suffix,
        type: finishType(rate.code),
        label: rate.code,
        driverQty: units,
        driverUnit: unit,
        unitCost: perPiece,
        auto: !selected,
        rateRef: ref,
        details: { code: rate.code, unit: rate.unit, units, price: rate.price, pricePerPartEur: rate.pricePerPartEur, colour, tierExempt: rate.tierMultiplierApplies ? 0 : 1 },
      })
    );
  }
  return { lines, flag: null, exempt: rate.tierMultiplierApplies ? [] : lines };
}

/** Lines the user typed (minutes, lump sums): priced as typed, flagged manual. */
function manualLines(ctx: PartContext): OperationLine[] {
  const lines: OperationLine[] = [];
  const general = ctx.rates.general;
  ctx.item.extras.forEach((extra, index) => {
    if (extra.type === "machining") {
      lines.push(
        makeLine(ctx, {
          suffix: `machining:${index}`,
          type: "machining",
          label: OPERATION_LABELS.machining,
          driverQty: extra.minutes,
          driverUnit: "min",
          unitCost: machiningCost(extra.minutes, general.machiningRateEurH),
          auto: false,
          notes: extra.note,
          rateRef: { table: "rate_general", key: "machining_rate_eur_h", values: { machiningRateEurH: general.machiningRateEurH, placeholder: general.placeholder } },
          details: { minutes: extra.minutes },
        })
      );
    } else if (extra.type === "other") {
      lines.push(
        makeLine(ctx, {
          suffix: `other:${index}`,
          type: "other",
          label: extra.label,
          driverQty: 1,
          driverUnit: "lot",
          unitCost: extra.unitCost,
          auto: false,
          rateRef: { table: "manual", key: "other", values: { placeholder: false } },
          details: { label: extra.label },
        })
      );
    } else if (extra.type === "handling") {
      lines.push(
        makeLine(ctx, {
          suffix: `handling:${index}`,
          type: "handling",
          label: OPERATION_LABELS.handling,
          driverQty: 1,
          driverUnit: "lot",
          unitCost: extra.unitCost,
          auto: false,
          rateRef: { table: "manual", key: "handling", values: { placeholder: false } },
          details: {},
        })
      );
    }
  });
  return lines;
}

function leadTimeLine(ctx: PartContext, lines: readonly OperationLine[], exempt: ReadonlySet<string>, lead: LeadTimeResolution, days: number | null): OperationLine | null {
  if (Math.abs(lead.multiplier - 1) < EPS) return null;
  const base = lines.filter((l) => !exempt.has(l.id)).reduce((sum, l) => sum + l.unitCost, 0);
  if (base <= 0) return null;
  return makeLine(ctx, {
    suffix: "lead-time",
    type: "leadtime",
    label: OPERATION_LABELS.leadTime,
    driverQty: lead.multiplier,
    driverUnit: "lot",
    unitCost: base * (lead.multiplier - 1),
    rateRef: {
      table: "rate_leadtime",
      key: String(lead.row?.workingDays ?? "-"),
      values: {
        workingDays: days,
        tierDays: lead.row?.workingDays ?? null,
        multiplier: lead.multiplier,
        placeholder: Boolean(lead.row?.placeholder),
      },
    },
    details: { workingDays: days, multiplier: lead.multiplier, baseUnitPrice: base },
  });
}

function packagingLine(ctxs: readonly PartContext[], rates: RateSnapshot): OperationLine | null {
  if (ctxs.length === 0) return null;
  const decision = decidePackaging(
    ctxs.map((ctx) => ({
      maxSideMm: Math.max(ctx.geometry.measures.bbox.width, ctx.geometry.measures.bbox.height),
      massKg: ctx.netMassKg,
      qty: ctx.item.qty,
    }))
  );
  const general = rates.general;
  const box = decision.kind === "box";
  const price = box ? general.packagingBoxEur : general.packagingPalletEur;
  if (price <= 0) return null;
  return lotLine(
    "quote:packaging",
    "packaging",
    box ? OPERATION_LABELS.packagingBox : OPERATION_LABELS.packagingPallet,
    1,
    "lot",
    {
      table: "rate_general",
      key: box ? "packaging_box_eur" : "packaging_pallet_eur",
      values: { packagingBoxEur: general.packagingBoxEur, packagingPalletEur: general.packagingPalletEur, kind: decision.kind, placeholder: general.placeholder },
    },
    price,
    0,
    {
      kind: decision.kind,
      maxSideMm: decision.maxSideMm,
      totalMassKg: decision.totalMassKg,
      maxSideLimitMm: decision.maxSideLimitMm,
      massLimitKg: decision.massLimitKg,
    }
  );
}

/* ─── Finish minimums and limits (quote level) ────────────── */

type FinishUse = { rate: FinishRate; colour: string | null; /** Amount charged on the line for this finish, after the lead-time multiplier. */ charged: number; netMassKg: number };

function finishGroupKey(rate: FinishRate, colour: string | null): string {
  return rate.minimumScope === "colour" ? `${FINISH_KEY(rate.code)}|${colour ?? ""}` : FINISH_KEY(rate.code);
}

/** One top-up line per (finish, scope key) whose charged amounts stay below the minimum. */
function finishMinimumLines(uses: readonly FinishUse[], skip: ReadonlySet<string>): OperationLine[] {
  const groups = new Map<string, { rate: FinishRate; colour: string | null; charged: number }>();
  for (const use of uses) {
    if (use.rate.minimum <= 0 || skip.has(FINISH_KEY(use.rate.code))) continue;
    const key = finishGroupKey(use.rate, use.colour);
    const group = groups.get(key) ?? { rate: use.rate, colour: use.colour, charged: 0 };
    group.charged += use.charged;
    groups.set(key, group);
  }
  const lines: OperationLine[] = [];
  for (const [key, group] of groups) {
    const topUp = group.rate.minimum - group.charged;
    if (topUp <= EPS) continue;
    lines.push(
      lotLine(`quote:finish-minimum:${key}`, finishType(group.rate.code), OPERATION_LABELS.finishMinimum, 1, "lot", finishRef(group.rate), topUp, 0, {
        code: group.rate.code,
        colour: group.colour,
        minimum: group.rate.minimum,
        charged: group.charged,
        scope: group.rate.minimumScope,
      })
    );
  }
  return lines;
}

/* ─── Totals ──────────────────────────────────────────────── */

function addAmount(map: Partial<Record<OperationType, number>>, type: OperationType, amount: number): void {
  map[type] = (map[type] ?? 0) + amount;
}

/**
 * Cost-mode lines → selling lines at the quote's margin (price = cost ÷ (1 − m),
 * the cost-mode rule) for an operation the market version has no rows for.
 * The audit fields say so: source = cost_plus, the cost version, the margin
 * and the cost each line started from.
 */
function costPlusLines(lines: readonly OperationLine[], marginPct: number, costRateVersionId: string): OperationLine[] {
  return lines.map((line) => ({
    ...line,
    unitCost: priceFromCost(line.unitCost, marginPct),
    setupShare: priceFromCost(line.setupShare, marginPct),
    rateRef: { ...line.rateRef, values: { ...line.rateRef.values, source: "cost_plus", costRateVersionId, marginPct, costEur: line.unitCost } },
    details: { ...line.details, source: "cost_plus", costRateVersionId, marginPct, costEur: line.unitCost },
  }));
}

function accumulateMarket(map: Partial<Record<OperationType, number>>, operations: readonly OperationLine[], qty: number): void {
  for (const op of operations) {
    const total = op.unitCost * qty;
    const setup = op.setupShare * qty;
    if (op.type === "setup") {
      addAmount(map, "setup", total);
      continue;
    }
    addAmount(map, op.type, total - setup);
    if (setup !== 0) addAmount(map, "setup", setup);
  }
}

/* ─── Public API ──────────────────────────────────────────── */

export function priceMarketQuote(input: QuoteInput, rates: RateSnapshot, machines: MachinePark, options: MarketPricingOptions): PricedQuote {
  const general = rates.general;
  const partsById = new Map(input.parts.map((p) => [p.id, p] as const));

  const ctxs: PartContext[] = input.items.map((item) => {
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      throw new PricingError("invalid_qty", `item ${item.id}: qty must be > 0, got ${String(item.qty)}`, {
        itemId: item.id,
        qty: Number.isFinite(item.qty) ? item.qty : String(item.qty),
      });
    }
    const part = partsById.get(item.partId);
    if (!part) {
      throw new PricingError("missing_part", `item ${item.id} refers to unknown part ${item.partId}`, { itemId: item.id, partId: item.partId });
    }
    return buildPartContext(part, item, rates, machines, { exactRates: true });
  });

  const leadTimeDays = input.leadTimeDays ?? null;
  const lead = resolveLeadTimeMultiplier(rates.leadtime, leadTimeDays);
  const verdicts = ctxs.map((ctx) => assessPart(ctx, { costRates: options.costRates, marginPct: input.marginPct }));

  // Finishes with a minimum lead time (coatings): the quote cannot be offered below the largest one.
  const finishMinLead = new Map<string, number>();
  verdicts.forEach((v) => {
    if (!v.priceable) return;
    for (const f of v.finishes) if (f.availability === "ok" && f.rate.minLeadTimeDays > 0) finishMinLead.set(f.rate.code, f.rate.minLeadTimeDays);
  });
  const minLeadDays = Math.max(0, ...finishMinLead.values());
  const finishLeadOk = leadTimeDays === null || minLeadDays <= 0 || leadTimeDays + EPS >= minLeadDays;
  const leadOffered = lead.offered && finishLeadOk;
  const priceable = ctxs.map((_, i) => verdicts[i].priceable && leadOffered);

  // Pieces of the order: Σ qty over the priceable lines, per (material,
  // thickness) group for the laser set-up and overall for the order charge.
  let totalPieces = 0;
  const groupPieces = new Map<string, number>();
  ctxs.forEach((ctx, i) => {
    if (!priceable[i]) return;
    totalPieces += ctx.item.qty;
    const key = laserSetupGroupKey(ctx);
    if (key) groupPieces.set(key, (groupPieces.get(key) ?? 0) + ctx.item.qty);
  });

  const costPriced = options.costRates ? options.priceCost(input, options.costRates, machines) : null;
  const costItems = new Map(costPriced?.items.map((i) => [i.itemId, i] as const) ?? []);

  const finishUses: FinishUse[] = [];
  const items: PricedItem[] = ctxs.map((ctx, index) => {
    const verdict = verdicts[index];
    const contextFlags = evaluateContextFlags(ctx).filter((f) => !REPLACED_COST_FLAGS.has(f.code) && !(f.code === "material.mass_handling" && general.handlingSurchargeEur <= 0));
    const unitCost = costItems.get(ctx.item.id)?.unitCost ?? 0;
    if (!priceable[index]) {
      return {
        itemId: ctx.item.id,
        partId: ctx.part.id,
        qty: ctx.item.qty,
        operations: [],
        unitCost,
        unitPrice: null,
        batchCost: unitCost * ctx.item.qty,
        batchPrice: null,
        flags: [...contextFlags, ...verdict.refusals, ...verdict.notes],
      };
    }

    const lines: OperationLine[] = [];
    const exempt = new Set<string>();
    const flags: Flag[] = [...contextFlags, ...verdict.notes];
    const push = (line: OperationLine | null): void => {
      if (line) lines.push(line);
    };
    push(laserLine(ctx));
    push(marketMaterialLine(ctx));
    push(laserSetupLine(ctx, groupPieces));
    push(orderChargeLine(ctx, totalPieces));
    if (verdict.bend) lines.push(...bendLinesMarket(ctx, verdict.bend));
    // Rolls only when the version benchmarks them (assessPart refused them otherwise).
    push(rollLine(ctx));
    // Welds: the version's rows, else cost-plus from the cost version (assessPart decided; refused when neither).
    if (verdict.weldingCostPlus && options.costRates) {
      const costCtx = buildPartContext(ctx.part, ctx.item, options.costRates, machines);
      lines.push(...costPlusLines(weldLines(costCtx), input.marginPct, options.costRates.versionId));
    } else {
      lines.push(...weldLines(ctx));
    }
    lines.push(...threadLinesMarket(ctx, verdict.threads));
    lines.push(...featureLinesMarket(ctx, verdict.features));
    for (const plan of verdict.finishes) {
      const result = finishLinesMarket(ctx, plan);
      lines.push(...result.lines);
      for (const line of result.exempt) exempt.add(line.id);
      if (result.flag) flags.push(result.flag);
      if (plan.availability === "ok") {
        const factor = plan.rate.tierMultiplierApplies ? lead.multiplier : 1;
        const charged = result.lines.reduce((sum, l) => sum + l.unitCost, 0) * ctx.item.qty * factor;
        finishUses.push({ rate: plan.rate, colour: plan.colour, charged, netMassKg: (ctx.netMassKg ?? 0) * ctx.item.qty });
      }
    }
    lines.push(...manualLines(ctx));
    push(leadTimeLine(ctx, lines, exempt, lead, leadTimeDays));

    const unitPrice = lines.reduce((sum, l) => sum + l.unitCost, 0);
    return {
      itemId: ctx.item.id,
      partId: ctx.part.id,
      qty: ctx.item.qty,
      operations: lines,
      unitCost,
      unitPrice,
      batchCost: unitCost * ctx.item.qty,
      batchPrice: unitPrice * ctx.item.qty,
      flags,
    };
  });

  const quoteFlags: Flag[] = [];
  if (!lead.offered) {
    const shortest = [...rates.leadtime].sort((a, b) => a.workingDays - b.workingDays)[0];
    quoteFlags.push(quoteFlag("market.leadtime_not_offered", "red", { workingDays: leadTimeDays ?? 0, minDays: shortest?.workingDays ?? 0, reason: "rate_leadtime" }));
  } else if (!finishLeadOk) {
    const codes = [...finishMinLead.entries()].filter(([, days]) => days >= minLeadDays).map(([code]) => code);
    quoteFlags.push(quoteFlag("market.leadtime_not_offered", "red", { workingDays: leadTimeDays ?? 0, minDays: minLeadDays, reason: codes.join(", ") }));
  }

  // Finish limits (hot-dip: net mass of the order) → red at quote level, no minimum top-up for that finish.
  const overLimit = new Set<string>();
  const massByFinish = new Map<string, { rate: FinishRate; massKg: number }>();
  for (const use of finishUses) {
    const key = FINISH_KEY(use.rate.code);
    const entry = massByFinish.get(key) ?? { rate: use.rate, massKg: 0 };
    entry.massKg += use.netMassKg;
    massByFinish.set(key, entry);
  }
  for (const [key, { rate, massKg }] of massByFinish) {
    const limit = rate.limits.maxOrderNetKg;
    if (typeof limit === "number" && Number.isFinite(limit) && massKg > limit + EPS) {
      overLimit.add(key);
      quoteFlags.push(quoteFlag("market.not_benchmarked", "red", { operation: `${rate.code} (> ${limit} kg)`, code: rate.code, massKg, limitKg: limit }));
    }
  }

  const quoteLines: OperationLine[] = [];
  const pricedCtxs = ctxs.filter((_, i) => priceable[i]);
  const packaging = packagingLine(pricedCtxs, rates);
  if (packaging) quoteLines.push(packaging);
  quoteLines.push(...finishMinimumLines(finishUses, overLimit));

  let welding: PricedQuote["welding"] = null;
  let weldingFlags: Flag[] = [];
  if (input.weldingOnly) {
    if (rates.weld.length > 0) {
      const block = priceWeldingOnly(input.weldingOnly, rates, general.defaultMarginPct);
      welding = { operations: block.operations, cost: block.cost, price: block.price, minOrderApplied: block.minOrderApplied };
      weldingFlags = block.flags;
    } else if (options.costRates && options.costRates.weld.length > 0) {
      // No benchmarked welding rate: the block is priced cost-plus from the cost version at the quote's margin.
      const block = priceWeldingOnly(input.weldingOnly, options.costRates, input.marginPct);
      welding = { operations: costPlusLines(block.operations, input.marginPct, options.costRates.versionId), cost: block.cost, price: block.price, minOrderApplied: block.minOrderApplied };
      weldingFlags = [...block.flags, quoteFlag("market.cost_plus", "amber", { operation: "welding", marginPct: input.marginPct, count: input.weldingOnly.seams.length })];
    } else {
      quoteFlags.push(quoteFlag("market.not_benchmarked", "red", { operation: "welding" }));
    }
  }

  const marketByType: Partial<Record<OperationType, number>> = {};
  for (const item of items) accumulateMarket(marketByType, item.operations, item.qty);
  for (const line of quoteLines) addAmount(marketByType, line.type, line.unitCost);
  if (welding) for (const op of welding.operations) addAmount(marketByType, op.type, op.unitCost);
  const totalsByType: TotalsByType = {};
  const costTotals = costPriced?.totalsByType ?? {};
  const types = new Set<OperationType>([...(Object.keys(marketByType) as OperationType[]), ...(Object.keys(costTotals) as OperationType[])]);
  for (const type of types) totalsByType[type] = { cost: costTotals[type]?.cost ?? 0, price: marketByType[type] ?? 0 };

  const subtotalPrice = items.reduce((sum, i) => sum + (i.batchPrice ?? 0), 0) + quoteLines.reduce((sum, l) => sum + l.unitCost, 0) + (welding?.price ?? 0);
  const subtotalCost = costPriced?.subtotalCost ?? 0;
  const marginPct = costPriced && subtotalPrice > 0 ? (1 - subtotalCost / subtotalPrice) * 100 : 0;
  const markupPct = costPriced && subtotalCost > 0 ? marginToMarkup(marginPct) : 0;

  const allLines = [...items.flatMap((i) => i.operations), ...quoteLines, ...(welding?.operations ?? [])];
  const usesPlaceholderRates = allLines.some((op) => op.rateRef.values.placeholder === true);

  const flags: Flag[] = [...items.flatMap((i) => i.flags), ...weldingFlags, ...evaluateQuoteFlags({ items, welding }), ...quoteFlags];
  if (!costPriced) {
    flags.push(quoteFlag("market.no_cost_version", "amber"));
  } else if (subtotalPrice > 0 && marginPct < general.defaultMarginPct - EPS) {
    flags.push(quoteFlag("market.margin_below_default", "red", { marginPct, minPct: general.defaultMarginPct, price: subtotalPrice, cost: subtotalCost }));
  }

  return {
    items,
    welding,
    totalsByType,
    subtotalCost,
    subtotalPrice,
    marginPct,
    markupPct,
    flags,
    usesPlaceholderRates,
    rateVersionId: rates.versionId,
    engineVersion: PRICING_ENGINE_VERSION,
    pricingMode: "market",
    costRateVersionId: options.costRates?.versionId ?? null,
    leadTimeDays,
    leadTimeMultiplier: lead.multiplier,
    quoteLines,
  };
}
