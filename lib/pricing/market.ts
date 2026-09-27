/**
 * Pricing engine — MARKET mode: the version's rate tables are benchmarked
 * selling prices (247TailorSteel standard tier × 1.10), nothing is added on
 * top, and whatever the version does not benchmark is REFUSED, never
 * approximated.
 * File path: /lib/pricing/market.ts
 *
 * Unit price of a part line (qty pieces), all from the active snapshot:
 *   setup_eur(material, t) ÷ pieces in the same (material, thickness) group
 *   + order_charge_eur ÷ pieces in the quote
 *   + net area × t × density × price_per_kg(t)          (material on NET area)
 *   + cut length × price_per_m + pierces × price_per_pierce
 *   + finishes: setup_per_line ÷ qty + cut length × price (unit m) | price (unit part)
 *   + threads:  setup_per_line ÷ qty + count × price_each
 *   + manual lines typed by the user (machining minutes, lump sums)
 *   × lead-time multiplier (one "leadtime" line = (multiplier − 1) × the rest)
 * Quote level: packaging once (box ≤ 5 kg and ≤ 600 mm, else pallet), not
 * multiplied by the lead time.
 *
 * Gates and refusals (red flag, unitPrice null, no lines — the quote
 * cannot be sent and no number is shown for the part):
 * - market.no_benchmark_rate: no rate_laser row with exactly this material
 *   and thickness (context.ts exactRates → lookup.ts findExactLaserRate),
 *   or no material band at exactly this thickness. Never the nearest
 *   thickness, never a time-mode row, never a placeholder;
 * - market.not_benchmarked {operation}: bends with no rate_bend rows,
 *   rolling / welding / tube parts / features / finishes / thread sizes the
 *   version has no row for, engraved geometry without an engrave rate,
 *   welding-only quotes without weld rows;
 * - market.leadtime_not_offered: a lead time shorter than the shortest tier
 *   (market-rules.ts resolveLeadTimeMultiplier is a step function).
 * Amber (informational, priced): market.subcontract for in_house = false
 * rows, market.manual_price for user-typed lines, finish.part_too_small /
 * finish.not_for_family when a finish is not available for the part (no
 * charge, price unchanged). The cost-mode "*.no_rate_row" / subcontract
 * flags are replaced by these; geometry, bend-geometry and bed-size flags
 * still apply.
 *
 * Decisions:
 * - Pieces = Σ qty over the PRICEABLE lines (a refused part is not in the
 *   order); set-ups and the order charge are per piece, so quantity
 *   discounts fall out of the split and there is no other quantity logic.
 * - per_m rows only. The cut length is charged plain: the benchmark's
 *   per-pierce prices were fitted on the Ø10-hole test part and already
 *   carry small-contour handling, so slow_contour_factor is not applied on
 *   top (it belongs to time-mode rows, which market versions do not use).
 * - No margin on market prices; the margin shown is 1 − cost ÷ price with
 *   the cost version (options.costRates, machine-hour model). Below the
 *   version's default_margin_pct → red market.margin_below_default (0 in
 *   the benchmark versions, so only a negative margin fires it).
 * - A finish's min_part_mm text also carries family eligibility: a rate
 *   whose rules name no family of the part (deburr_one_side on mild steel)
 *   is not available for it.
 */

import { buildPartContext, type PartContext } from "./context";
import { PricingError } from "./errors";
import { evaluateContextFlags, evaluateQuoteFlags } from "./feasibility";
import { computeFinish } from "./finish";
import { machiningCost, mmToM } from "./formulas";
import { OPERATION_LABELS } from "./labels";
import { findFeatureRate, findFinishRate, findThreadRate, normaliseThreadSize } from "./lookup";
import {
  applicableMinPartRules,
  decidePackaging,
  describeMinPartSizes,
  meetsMinPartSize,
  parseMinPartRule,
  resolveLeadTimeMultiplier,
  type LeadTimeResolution,
  type MinPartRule,
} from "./market-rules";
import { bendLines, laserLine, makeLine, rollLine, weldLines } from "./operations";
import {
  marginToMarkup,
  type FinishRate,
  type Flag,
  type FlagCode,
  type FlagSeverity,
  type MachinePark,
  type MaterialFamily,
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

function finishRef(rate: FinishRate): RateRef {
  return {
    table: "rate_finish",
    key: rate.code,
    values: {
      code: rate.code,
      unit: rate.unit,
      price: rate.price,
      minimum: rate.minimum,
      setupPerOrderEur: rate.setupPerOrderEur,
      setupPerLineEur: rate.setupPerLineEur,
      minPartMm: rate.minPartMm,
      placeholder: rate.placeholder,
    },
  };
}

function threadRef(rate: ThreadRate): RateRef {
  return {
    table: "rate_thread",
    key: rate.size,
    values: { size: rate.size, priceEach: rate.priceEach, setupPerLineEur: rate.setupPerLineEur, placeholder: rate.placeholder },
  };
}

/* ─── Gates ───────────────────────────────────────────────── */

/** (material, thickness) group of a line for the laser setup split; null when the line has no laser row. */
export function laserSetupGroupKey(ctx: PartContext): string | null {
  const row = ctx.laser?.row;
  return row ? `${row.materialCode}/${row.thicknessMm}` : null;
}

export type FinishAvailability = "ok" | "size" | "family";

/**
 * A finish is available for a part when its min_part_mm rules name the
 * part's family (or apply to all) and the bounding box meets one listed
 * size. Rates without rules are available for everything.
 */
export function finishAvailability(rules: readonly MinPartRule[], family: MaterialFamily | null, widthMm: number, heightMm: number): FinishAvailability {
  if (rules.length === 0) return "ok";
  const applicable = applicableMinPartRules(rules, family);
  if (applicable.length === 0) return "family";
  return meetsMinPartSize(applicable, family, widthMm, heightMm) === false ? "size" : "ok";
}

type Verdict = {
  /** Red flags that make the part unpriceable. */
  refusals: Flag[];
  /** Amber notes on a priced part. */
  notes: Flag[];
  /** False when the part has no exact laser row (material / thickness missing or not benchmarked). */
  priceable: boolean;
};

function assessPart(ctx: PartContext): Verdict {
  const { rates, material, thicknessMm, annotations, item } = ctx;
  const refusals: Flag[] = [];
  const notes: Flag[] = [];
  let priceable = true;
  const notBenchmarked = (operation: string, extra: Record<string, number | string> = {}) =>
    refusals.push(partFlag(ctx, "market.not_benchmarked", "red", { operation, ...extra }));

  if (ctx.isTubePart) {
    priceable = false;
    if (rates.tubeLaser.length === 0) notBenchmarked("tube");
  } else if (!material || thicknessMm === null) {
    // geometry.no_material / geometry.no_thickness are already red; a material
    // code the version does not list is also "not benchmarked" (Cu-ETP, …).
    priceable = false;
    if (!material && ctx.part.materialCode) {
      refusals.push(partFlag(ctx, "market.no_benchmark_rate", "red", { materialCode: ctx.part.materialCode, thicknessMm: thicknessMm ?? 0, what: "material" }));
    }
  } else if (!ctx.laser?.row) {
    priceable = false;
    refusals.push(partFlag(ctx, "market.no_benchmark_rate", "red", { materialCode: material.code, thicknessMm, what: "laser" }));
  } else if (!ctx.priceBand) {
    priceable = false;
    refusals.push(partFlag(ctx, "market.no_benchmark_rate", "red", { materialCode: material.code, thicknessMm, what: "material" }));
  } else if (!ctx.laser.row.inHouse) {
    notes.push(
      partFlag(ctx, "market.subcontract", "amber", {
        materialCode: material.code,
        thicknessMm,
        supplier: ctx.laser.row.supplier ?? "",
      })
    );
  }

  if (ctx.bends.length > 0 && rates.bend.length === 0) notBenchmarked("bending", { count: ctx.bends.length });
  if (annotations.roll && rates.roll.length === 0) notBenchmarked("rolling");
  if (annotations.welds.length > 0 && rates.weld.length === 0) notBenchmarked("welding", { count: annotations.welds.length });

  for (const group of ctx.confirmedThreads) {
    if (!findThreadRate(rates, group.size)) notBenchmarked(`thread ${group.size}`, { size: group.size, count: group.loopIds.length });
  }
  item.extras.forEach((extra, index) => {
    if (extra.type === "feature" && !findFeatureRate(rates, extra.code)) notBenchmarked(`feature ${extra.code}`, { code: extra.code, index });
    if (extra.type === "finish" && !findFinishRate(rates, extra.code)) notBenchmarked(`finish ${extra.code}`, { code: extra.code, index });
    if (extra.type === "machining") notes.push(partFlag(ctx, "market.manual_price", "amber", { what: "machining", minutes: extra.minutes, index }));
    if (extra.type === "other") notes.push(partFlag(ctx, "market.manual_price", "amber", { what: extra.label, amount: extra.unitCost, index }));
    if (extra.type === "handling") notes.push(partFlag(ctx, "market.manual_price", "amber", { what: "handling", amount: extra.unitCost, index }));
  });
  const engraveSelected = item.extras.some((e) => e.type === "finish" && e.code.trim().toLowerCase() === OPERATION_LABELS.engrave);
  if (!engraveSelected && ctx.geometry.measures.engraveLengthMm > 0 && !findFinishRate(rates, OPERATION_LABELS.engrave)) {
    notBenchmarked(`finish ${OPERATION_LABELS.engrave}`, { code: OPERATION_LABELS.engrave });
  }

  return { refusals, notes, priceable: priceable && refusals.length === 0 };
}

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

function finishType(code: string): OperationType {
  const c = code.trim().toLowerCase();
  if (c === OPERATION_LABELS.engrave) return "engrave";
  if (c === OPERATION_LABELS.deburr || c === "deburr_one_side" || c === "edge_round") return "finish_deburr";
  if (c === "powder") return "finish_powder";
  if (c === "zinc") return "finish_zinc";
  return "finish_other";
}

function notAvailableFlag(ctx: PartContext, rate: FinishRate, availability: Exclude<FinishAvailability, "ok">, rules: readonly MinPartRule[]): Flag {
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

/**
 * One finish on a line: its per-line set-up (÷ qty per piece) and the
 * finish itself — cut length × €/m, a flat price per part, or the
 * cost-mode driver for other units. Not available → the flag, no lines.
 */
function marketFinishLines(ctx: PartContext, rate: FinishRate, selected: boolean, maskingMinutes: number, index: number | null): { lines: OperationLine[]; flag: Flag | null } {
  const rules = parseMinPartRule(rate.minPartMm);
  const { width, height } = ctx.geometry.measures.bbox;
  const availability = finishAvailability(rules, ctx.family, width, height);
  if (availability !== "ok") return { lines: [], flag: notAvailableFlag(ctx, rate, availability, rules) };

  const lines: OperationLine[] = [];
  const suffix = index === null ? rate.code : `${rate.code}:${index}`;
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
        rateRef: finishRef(rate),
        details: { code: rate.code, setupPerLineEur: rate.setupPerLineEur, qty: ctx.item.qty },
      })
    );
  }
  const cutLengthMm = ctx.geometry.measures.cutLengthMm;
  if (rate.unit === "m") {
    const cutM = mmToM(cutLengthMm);
    lines.push(
      makeLine(ctx, {
        suffix,
        type: finishType(rate.code),
        label: rate.code,
        driverQty: cutM,
        driverUnit: "m",
        unitCost: cutM * rate.price,
        auto: !selected,
        rateRef: finishRef(rate),
        details: { code: rate.code, cutLengthMm, pricePerM: rate.price, unit: rate.unit },
      })
    );
  } else if (rate.unit === "part" || rate.unit === "each") {
    lines.push(
      makeLine(ctx, {
        suffix,
        type: finishType(rate.code),
        label: rate.code,
        driverQty: 1,
        driverUnit: "part",
        unitCost: rate.price,
        auto: !selected,
        rateRef: finishRef(rate),
        details: { code: rate.code, price: rate.price, unit: rate.unit },
      })
    );
  } else {
    const computed = computeFinish(
      rate,
      { netAreaMm2: ctx.geometry.measures.netAreaMm2, massKg: ctx.netMassKg, cutLengthMm },
      maskingMinutes,
      ctx.item.qty,
      ctx.rates.general
    );
    if (computed) {
      lines.push(
        makeLine(ctx, {
          suffix,
          type: finishType(rate.code),
          label: rate.code,
          driverQty: computed.driverQty,
          driverUnit: computed.driverUnit,
          unitCost: computed.unitCost,
          auto: !selected,
          rateRef: finishRef(rate),
          details: { code: rate.code, unit: rate.unit, minimumApplied: computed.minimumApplied ? 1 : 0 },
        })
      );
    }
  }
  return { lines, flag: null };
}

function threadLinesMarket(ctx: PartContext): OperationLine[] {
  const lines: OperationLine[] = [];
  for (const group of ctx.confirmedThreads) {
    const row = findThreadRate(ctx.rates, group.size);
    if (!row) continue;
    const count = group.loopIds.length;
    const key = normaliseThreadSize(group.size);
    if (row.setupPerLineEur > 0) {
      const share = row.setupPerLineEur / ctx.item.qty;
      lines.push(
        makeLine(ctx, {
          suffix: `thread-setup:${key}`,
          type: "setup",
          label: OPERATION_LABELS.threadSetup,
          driverQty: 1,
          driverUnit: "lot",
          unitCost: share,
          setupShare: share,
          rateRef: threadRef(row),
          details: { size: row.size, setupPerLineEur: row.setupPerLineEur, qty: ctx.item.qty },
        })
      );
    }
    lines.push(
      makeLine(ctx, {
        suffix: `thread:${key}`,
        type: "thread",
        label: row.size,
        driverQty: count,
        driverUnit: "each",
        unitCost: count * row.priceEach,
        rateRef: threadRef(row),
        details: { size: row.size, count, loopIds: group.loopIds.join(",") },
      })
    );
  }
  return lines;
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

function leadTimeLine(ctx: PartContext, lines: readonly OperationLine[], lead: LeadTimeResolution, days: number | null): OperationLine | null {
  if (Math.abs(lead.multiplier - 1) < EPS) return null;
  const base = lines.reduce((sum, l) => sum + l.unitCost, 0);
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

/* ─── Totals ──────────────────────────────────────────────── */

function addAmount(map: Partial<Record<OperationType, number>>, type: OperationType, amount: number): void {
  map[type] = (map[type] ?? 0) + amount;
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

export function priceMarketQuote(
  input: QuoteInput,
  rates: RateSnapshot,
  machines: MachinePark,
  options: MarketPricingOptions
): PricedQuote {
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
      throw new PricingError("missing_part", `item ${item.id} refers to unknown part ${item.partId}`, {
        itemId: item.id,
        partId: item.partId,
      });
    }
    return buildPartContext(part, item, rates, machines, { exactRates: true });
  });

  const leadTimeDays = input.leadTimeDays ?? null;
  const lead = resolveLeadTimeMultiplier(rates.leadtime, leadTimeDays);
  const verdicts = ctxs.map(assessPart);
  const priceable = ctxs.map((_, i) => verdicts[i].priceable && lead.offered);

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

  const items: PricedItem[] = ctxs.map((ctx, index) => {
    const verdict = verdicts[index];
    const contextFlags = evaluateContextFlags(ctx).filter(
      (f) => !REPLACED_COST_FLAGS.has(f.code) && !(f.code === "material.mass_handling" && general.handlingSurchargeEur <= 0)
    );
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
    const flags: Flag[] = [...contextFlags, ...verdict.notes];
    const push = (line: OperationLine | null): void => {
      if (line) lines.push(line);
    };
    push(laserLine(ctx));
    push(marketMaterialLine(ctx));
    push(laserSetupLine(ctx, groupPieces));
    push(orderChargeLine(ctx, totalPieces));
    // Bends / rolls / welds only when the version benchmarks them (assessPart refused them otherwise).
    lines.push(...bendLines(ctx));
    push(rollLine(ctx));
    lines.push(...weldLines(ctx));
    lines.push(...threadLinesMarket(ctx));
    let engraveSelected = false;
    ctx.item.extras.forEach((extra, i) => {
      if (extra.type !== "finish") return;
      const rate = findFinishRate(rates, extra.code);
      if (!rate) return;
      if (rate.code.trim().toLowerCase() === OPERATION_LABELS.engrave) engraveSelected = true;
      const result = marketFinishLines(ctx, rate, true, extra.maskingMinutes, i);
      lines.push(...result.lines);
      if (result.flag) flags.push(result.flag);
    });
    if (!engraveSelected && ctx.geometry.measures.engraveLengthMm > 0) {
      const rate = findFinishRate(rates, OPERATION_LABELS.engrave);
      if (rate) lines.push(...marketFinishLines(ctx, rate, false, 0, null).lines);
    }
    lines.push(...manualLines(ctx));
    push(leadTimeLine(ctx, lines, lead, leadTimeDays));

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

  const quoteLines: OperationLine[] = [];
  const pricedCtxs = ctxs.filter((_, i) => priceable[i]);
  const packaging = packagingLine(pricedCtxs, rates);
  if (packaging) quoteLines.push(packaging);

  const quoteFlags: Flag[] = [];
  if (!lead.offered) {
    const shortest = [...rates.leadtime].sort((a, b) => a.workingDays - b.workingDays)[0];
    quoteFlags.push(quoteFlag("market.leadtime_not_offered", "red", { workingDays: leadTimeDays ?? 0, minDays: shortest?.workingDays ?? 0 }));
  }
  let welding: PricedQuote["welding"] = null;
  let weldingFlags: Flag[] = [];
  if (input.weldingOnly) {
    if (rates.weld.length === 0) {
      quoteFlags.push(quoteFlag("market.not_benchmarked", "red", { operation: "welding" }));
    } else {
      const block = priceWeldingOnly(input.weldingOnly, rates, general.defaultMarginPct);
      welding = { operations: block.operations, cost: block.cost, price: block.price, minOrderApplied: block.minOrderApplied };
      weldingFlags = block.flags;
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

  const subtotalPrice =
    items.reduce((sum, i) => sum + (i.batchPrice ?? 0), 0) + quoteLines.reduce((sum, l) => sum + l.unitCost, 0) + (welding?.price ?? 0);
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
    pricingMode: "market",
    costRateVersionId: options.costRates?.versionId ?? null,
    leadTimeDays,
    leadTimeMultiplier: lead.multiplier,
    quoteLines,
  };
}
