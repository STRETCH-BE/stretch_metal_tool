/**
 * Pricing engine — MARKET mode: the version's rate tables are selling
 * prices (e.g. 247TailorSteel × 1.10), no margin is added on top, and
 * the margin is measured against a cost version instead.
 * File path: /lib/pricing/market.ts
 *
 * Per part line (differences from cost mode, price-quote.ts):
 * - material  = NET mass (net area × t × density, geometry.measures) × €/kg
 *               — no blank rectangle, no scrap factor;
 * - laser     = cut length × €/m + pierces × €/pierce from the per-metre
 *               row (the slow-contour factor never applies; a time-mode
 *               row still prices the cost-mode way as a fallback);
 * - setup     = rate_laser.setup_eur once per distinct (material,
 *               thickness) in the quote, split equally over the part LINES
 *               with that combination — per line, not per piece, so the
 *               per-piece unitCost is share ÷ qty;
 * - order     = rate_general.order_charge_eur split equally over all part
 *               lines, an "order" line on each (same per-line spread);
 * - deburring (finish extra "deburr", both sides): its own setup line =
 *               setup_per_order_eur split over the lines that carry it, plus
 *               €/m × the part's total cut length; REFUSED — red
 *               finish.part_too_small, no line — when the bbox is below the
 *               rate's min_part_mm rule (market-rules.ts);
 * - engraving = the engrave rate's price per part when the item selects it
 *               (finish extra "engrave") or the geometry carries engrave
 *               lines, for a "part"/"each" rate; an "m" rate falls back to
 *               length pricing;
 * - lead time = one "leadtime" line per part = (multiplier − 1) × the sum of
 *               its other lines (absent when the multiplier is 1), so the
 *               lines still add up to the unit price and the PDF folds it
 *               into the part price like 247 does;
 * - bends, rolling, welds, threads, features, machining, tubes and other
 *   finishes use the cost-mode builders on the version's rows (a market
 *   version copies them from its source; they stay placeholders until
 *   confirmed, so rates.placeholder says so).
 * Quote level: one packaging line (box / pallet, market-rules.ts) in
 * quoteLines, included in subtotalPrice.
 *
 * Money: unitPrice = Σ lines. unitCost / subtotalCost come from pricing the
 * SAME input with the cost version (options.costRates, the machine-hour
 * model) through the cost pricer handed in (options.priceCost — passed in
 * rather than imported so market.ts and price-quote.ts do not import each
 * other). marginPct = 1 − cost ÷ price; below the market version's
 * default_margin_pct → red market.margin_below_default. Without a cost
 * version the cost is 0, the margin is reported as 0 and an amber
 * market.no_cost_version says why. totalsByType: market price per bucket,
 * cost version's cost per bucket.
 *
 * Welding-only blocks keep cost semantics (weld rows are costs in every
 * version): price = cost ÷ (1 − default margin of the market version).
 */

import type { MaterialFamily } from "./types";
import { buildPartContext, type PartContext } from "./context";
import { PricingError } from "./errors";
import { evaluateContextFlags, evaluateQuoteFlags } from "./feasibility";
import { mmToM, setupShare } from "./formulas";
import { OPERATION_LABELS } from "./labels";
import { findFinishRate } from "./lookup";
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
import { bendLines, engraveLine, extraLines, laserLine, makeLine, rollLine, threadLines, weldLines } from "./operations";
import {
  marginToMarkup,
  priceFromCost,
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
  type TotalsByType,
} from "./types";
import { lotLine, priceWeldingOnly } from "./welding-block";

export type MarketPricingOptions = {
  costRates: RateSnapshot | null;
  /** The cost-mode pricer (price-quote.ts priceCostQuote), used on costRates. */
  priceCost: (input: QuoteInput, rates: RateSnapshot, machines: MachinePark) => PricedQuote;
};

/** Finish codes market mode prices itself (extraLines skips them). */
const MARKET_FINISH_CODES: ReadonlySet<string> = new Set([OPERATION_LABELS.deburr, OPERATION_LABELS.engrave]);

const EPS = 1e-9;

function quoteFlag(code: FlagCode, severity: FlagSeverity, params: Record<string, number | string> = {}): Flag {
  return { code, severity, partId: null, itemId: null, params, overridable: severity === "amber" };
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
      minPartMm: rate.minPartMm,
      placeholder: rate.placeholder,
    },
  };
}

function hasFinishExtra(ctx: PartContext, code: string): boolean {
  return ctx.item.extras.some((e) => e.type === "finish" && e.code.trim().toLowerCase() === code);
}

/* ─── Per-line builders ───────────────────────────────────── */

/** (material, thickness) group of a line for the laser setup split; null when the line has no laser row. */
export function laserSetupGroupKey(ctx: PartContext): string | null {
  const row = ctx.laser?.row;
  return row ? `${row.materialCode}/${row.thicknessMm}` : null;
}

function marketMaterialLine(ctx: PartContext): OperationLine | null {
  if (ctx.isTubePart) return null;
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
      key: `${material.code}/<=${priceBand.maxThicknessMm}`,
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

function laserSetupLine(ctx: PartContext, groupSizes: ReadonlyMap<string, number>): OperationLine | null {
  const row = ctx.laser?.row;
  const key = laserSetupGroupKey(ctx);
  if (!row || !key || row.setupEur <= 0) return null;
  const lines = groupSizes.get(key) ?? 1;
  const perLine = row.setupEur / lines;
  const share = setupShare(perLine, ctx.item.qty);
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
    details: { setupEur: row.setupEur, linesInGroup: lines, perLineEur: perLine, qty: ctx.item.qty },
  });
}

function orderChargeLine(ctx: PartContext, lineCount: number): OperationLine | null {
  const general = ctx.rates.general;
  if (general.orderChargeEur <= 0 || lineCount <= 0) return null;
  const perLine = general.orderChargeEur / lineCount;
  return makeLine(ctx, {
    suffix: "order",
    type: "order",
    label: OPERATION_LABELS.orderCharge,
    driverQty: 1,
    driverUnit: "lot",
    unitCost: setupShare(perLine, ctx.item.qty),
    rateRef: {
      table: "rate_general",
      key: "order_charge_eur",
      values: { orderChargeEur: general.orderChargeEur, lines: lineCount, placeholder: general.placeholder },
    },
    details: { orderChargeEur: general.orderChargeEur, lines: lineCount, perLineEur: perLine, qty: ctx.item.qty },
  });
}

type DeburrStatus = "none" | "ok" | "too_small" | "no_rate";

function deburrStatusOf(ctx: PartContext, rate: FinishRate | null, rules: readonly MinPartRule[]): DeburrStatus {
  if (!hasFinishExtra(ctx, OPERATION_LABELS.deburr)) return "none";
  if (!rate) return "no_rate";
  const { width, height } = ctx.geometry.measures.bbox;
  return meetsMinPartSize(rules, ctx.family, width, height) === false ? "too_small" : "ok";
}

function deburrLines(ctx: PartContext, rate: FinishRate, linesWithDeburr: number): OperationLine[] {
  const lines: OperationLine[] = [];
  const cutLengthMm = ctx.geometry.measures.cutLengthMm;
  const cutM = mmToM(cutLengthMm);
  if (rate.setupPerOrderEur > 0 && linesWithDeburr > 0) {
    const perLine = rate.setupPerOrderEur / linesWithDeburr;
    const share = setupShare(perLine, ctx.item.qty);
    lines.push(
      makeLine(ctx, {
        suffix: "deburr-setup",
        type: "setup",
        label: OPERATION_LABELS.deburrSetup,
        driverQty: 1,
        driverUnit: "lot",
        unitCost: share,
        setupShare: share,
        rateRef: finishRef(rate),
        details: { setupPerOrderEur: rate.setupPerOrderEur, linesWithDeburr, perLineEur: perLine, qty: ctx.item.qty },
      })
    );
  }
  const perMetre = rate.unit === "m";
  lines.push(
    makeLine(ctx, {
      suffix: "deburr",
      type: "finish_deburr",
      label: OPERATION_LABELS.deburr,
      driverQty: perMetre ? cutM : 1,
      driverUnit: perMetre ? "m" : "part",
      unitCost: perMetre ? cutM * rate.price : rate.price,
      auto: false,
      rateRef: finishRef(rate),
      details: { cutLengthMm, pricePerM: perMetre ? rate.price : null, sides: 2, unit: rate.unit },
    })
  );
  return lines;
}

function tooSmallFlag(ctx: PartContext, rate: FinishRate, rules: readonly MinPartRule[]): Flag {
  const { width, height } = ctx.geometry.measures.bbox;
  const applicable = applicableMinPartRules(rules, ctx.family);
  return {
    code: "finish.part_too_small",
    severity: "red",
    partId: ctx.part.id,
    itemId: ctx.item.id,
    params: {
      code: rate.code,
      widthMm: width,
      heightMm: height,
      minimum: applicable.map(describeMinPartSizes).join(" / "),
      family: (ctx.family ?? "") as MaterialFamily | "",
    },
    overridable: false,
  };
}

function marketEngraveLine(ctx: PartContext): OperationLine | null {
  const selected = hasFinishExtra(ctx, OPERATION_LABELS.engrave);
  const lengthMm = ctx.geometry.measures.engraveLengthMm;
  if (!selected && lengthMm <= 0) return null;
  const rate = findFinishRate(ctx.rates, OPERATION_LABELS.engrave);
  if (!rate) return null; // finish.no_rate_row comes from the feasibility rules
  if (rate.unit === "part" || rate.unit === "each") {
    return makeLine(ctx, {
      suffix: "engrave",
      type: "engrave",
      label: OPERATION_LABELS.engrave,
      driverQty: 1,
      driverUnit: "part",
      unitCost: rate.price,
      auto: !selected,
      rateRef: finishRef(rate),
      details: { engraveLengthMm: lengthMm, selected, basis: "per_part" },
    });
  }
  return engraveLine(ctx);
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
      key: `${lead.lower?.workingDays ?? "-"}-${lead.upper?.workingDays ?? "-"}`,
      values: {
        workingDays: days,
        multiplier: lead.multiplier,
        lowerDays: lead.lower?.workingDays ?? null,
        lowerMultiplier: lead.lower?.multiplier ?? null,
        upperDays: lead.upper?.workingDays ?? null,
        upperMultiplier: lead.upper?.multiplier ?? null,
        placeholder: Boolean(lead.lower?.placeholder || lead.upper?.placeholder),
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
    return buildPartContext(part, item, rates, machines);
  });

  // Splits: setup per (material, thickness) group, order charge over every
  // line, deburring setup over the lines that carry deburring.
  const lineCount = ctxs.length;
  const groupSizes = new Map<string, number>();
  for (const ctx of ctxs) {
    const key = laserSetupGroupKey(ctx);
    if (key) groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  }
  const deburrRate = findFinishRate(rates, OPERATION_LABELS.deburr);
  const deburrRules = parseMinPartRule(deburrRate?.minPartMm);
  const deburrStatus = ctxs.map((ctx) => deburrStatusOf(ctx, deburrRate, deburrRules));
  const linesWithDeburr = deburrStatus.filter((s) => s === "ok").length;
  const leadTimeDays = input.leadTimeDays ?? null;
  const lead = resolveLeadTimeMultiplier(rates.leadtime, leadTimeDays);

  const costPriced = options.costRates ? options.priceCost(input, options.costRates, machines) : null;
  const costItems = new Map(costPriced?.items.map((i) => [i.itemId, i] as const) ?? []);

  const items: PricedItem[] = ctxs.map((ctx, index) => {
    const lines: OperationLine[] = [];
    const push = (line: OperationLine | null): void => {
      if (line) lines.push(line);
    };
    push(laserLine(ctx));
    push(marketMaterialLine(ctx));
    push(laserSetupLine(ctx, groupSizes));
    push(orderChargeLine(ctx, lineCount));
    lines.push(...bendLines(ctx));
    push(rollLine(ctx));
    lines.push(...weldLines(ctx));
    lines.push(...threadLines(ctx));
    lines.push(...extraLines(ctx, { skipFinishCodes: MARKET_FINISH_CODES }));
    if (deburrStatus[index] === "ok" && deburrRate) lines.push(...deburrLines(ctx, deburrRate, linesWithDeburr));
    push(marketEngraveLine(ctx));
    push(leadTimeLine(ctx, lines, lead, leadTimeDays));

    const flags = evaluateContextFlags(ctx);
    if (deburrStatus[index] === "too_small" && deburrRate) flags.push(tooSmallFlag(ctx, deburrRate, deburrRules));

    const unitPrice = lines.reduce((sum, l) => sum + l.unitCost, 0);
    const unitCost = costItems.get(ctx.item.id)?.unitCost ?? 0;
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
  const packaging = packagingLine(ctxs, rates);
  if (packaging) quoteLines.push(packaging);

  const weldingBlock = input.weldingOnly ? priceWeldingOnly(input.weldingOnly, rates, general.defaultMarginPct) : null;
  const welding: PricedQuote["welding"] = weldingBlock
    ? { operations: weldingBlock.operations, cost: weldingBlock.cost, price: weldingBlock.price, minOrderApplied: weldingBlock.minOrderApplied }
    : null;

  const marketByType: Partial<Record<OperationType, number>> = {};
  for (const item of items) accumulateMarket(marketByType, item.operations, item.qty);
  for (const line of quoteLines) addAmount(marketByType, line.type, line.unitCost);
  if (welding) {
    for (const op of welding.operations) addAmount(marketByType, op.type, priceFromCost(op.unitCost, general.defaultMarginPct));
  }
  const totalsByType: TotalsByType = {};
  const costTotals = costPriced?.totalsByType ?? {};
  const types = new Set<OperationType>([
    ...(Object.keys(marketByType) as OperationType[]),
    ...(Object.keys(costTotals) as OperationType[]),
  ]);
  for (const type of types) {
    totalsByType[type] = { cost: costTotals[type]?.cost ?? 0, price: marketByType[type] ?? 0 };
  }

  const subtotalPrice =
    items.reduce((sum, i) => sum + i.batchPrice, 0) + quoteLines.reduce((sum, l) => sum + l.unitCost, 0) + (welding?.price ?? 0);
  const subtotalCost = costPriced?.subtotalCost ?? 0;
  const marginPct = costPriced && subtotalPrice > 0 ? (1 - subtotalCost / subtotalPrice) * 100 : 0;
  const markupPct = costPriced && subtotalCost > 0 ? marginToMarkup(marginPct) : 0;

  const allLines = [...items.flatMap((i) => i.operations), ...quoteLines, ...(welding?.operations ?? [])];
  const usesPlaceholderRates = allLines.some((op) => op.rateRef.values.placeholder === true);

  const flags: Flag[] = [
    ...items.flatMap((i) => i.flags),
    ...(weldingBlock?.flags ?? []),
    ...evaluateQuoteFlags({ items, welding }),
  ];
  if (!costPriced) {
    flags.push(quoteFlag("market.no_cost_version", "amber"));
  } else if (subtotalPrice > 0 && marginPct < general.defaultMarginPct - EPS) {
    flags.push(
      quoteFlag("market.margin_below_default", "red", {
        marginPct,
        minPct: general.defaultMarginPct,
        price: subtotalPrice,
        cost: subtotalCost,
      })
    );
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
