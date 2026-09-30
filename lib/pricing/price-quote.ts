/**
 * Pricing engine — priceQuote: the one entry point the server (and the
 * client preview) call. Pure, deterministic; build prompt Step 9.
 * File path: /lib/pricing/price-quote.ts
 *
 * Per item: unitCost = Σ operations.unitCost, unitPrice = unitCost /
 * (1 − margin), batch = unit × qty. Margin is on PRICE (input.marginPct,
 * resolved by the caller with resolveMarginPct); markupPct is the
 * equivalent markup on cost for the UI, inputMarginPct records the margin
 * the run used (the same number here; market mode keeps them apart).
 *
 * Welding-only block (input.weldingOnly, priced whenever present): each
 * seam = effective length × qty × €/mm, one setup per process used,
 * handling = weldHandlingPerPart × partsCount, then the largest minOrder
 * among the processes used — a shortfall becomes a "weld_min_order" line
 * and a green weld.min_order_applied flag. The block has no per-part
 * quantity, so its lines are lot lines (unitCost = line total).
 * MinOrder is compared with COST (rate tables are cost tables; margin is
 * applied afterwards).
 *
 * totalsByType: each line's cost goes to its OperationType bucket minus
 * its setupShare, which goes to the "setup" bucket, so Σ buckets =
 * subtotalCost exactly. Prices per bucket use the same margin.
 *
 * Invalid input throws PricingError: qty ≤ 0, margin ≥ 100 % or non-finite,
 * an item whose part is missing, and (validate.ts) any NaN / Infinity /
 * negative user number in an extra, an annotation or a welding-only seam.
 * No rounding anywhere.
 *
 * Pricing mode: everything above is COST mode (rates.general.pricingMode
 * "cost"). A version in "market" mode (its tables are selling prices)
 * is delegated to lib/pricing/market.ts, which reuses this cost pricer on
 * options.costRates to compute the margin. The welding-only block lives in
 * welding-block.ts, shared by both.
 *
 * Assembly mode (options.jobRates given — docs/assembly-mode-design.md;
 * without job rates every result is byte-for-byte the pre-assembly one):
 * - Members of assemblies (items with assemblyId) are taken OUT of the
 *   loose-line pricing; the loose lines are priced by the mode's pricer as
 *   before (market: order charge and laser set-ups split over the loose
 *   pieces only), then lib/pricing/assembly.ts prices each assembly as one
 *   line (parts at cost from options.costRates — cost mode: the same
 *   snapshot — labour, job set-ups, forming, ÷ (1 − max(margin, assembly
 *   margin))). A member's PricedItem has operations [], unitCost = its
 *   parts-at-cost per piece, unitPrice null, qty = assembly.qty ×
 *   qtyPerAssembly; the assembly's batchCost already holds the parts, so
 *   members are NOT added to the subtotals.
 * - Laser-nest set-ups are charged once per (material, thickness) nest of
 *   the whole quote: the loose lines keep their per-nest laser_setup lines
 *   (market mode) and an assembly does not charge a nest a loose line
 *   already charged (their laser_setup rateRef.key IS the nest key); a
 *   nest shared by two assemblies is charged by the first. In cost mode
 *   loose lines carry no laser set-up, so an assembly nest is always
 *   charged there.
 * - Loose items whose drawing hints at forming that nothing prices
 *   (forming.ts formingHint, not a roll annotation — the loose model
 *   prices / refuses those itself) get red forming.suspected until a
 *   forming operation or a none_needed confirmation is set.
 * - Packaging comes from packaging_rates (packaging.ts; the market box /
 *   pallet rule is switched off), shipping from ShippingInput /
 *   shipping_rates (shipping.ts), VAT from vat.ts on the net total
 *   INCLUDING shipping, and the price scale (scale.ts) re-prices the quote
 *   at each extra quantity. Packaging and shipping are pass-throughs (cost
 *   = price) counted in subtotalCost and subtotalPrice.
 * - subtotalPrice = loose lines + assemblies + quote lines + shipping (+
 *   the welding-only block). Cost mode keeps marginPct = the header margin
 *   (the rule the lines were priced with; assemblies carry their own
 *   PricedAssembly.marginPct); market mode reports the realised margin
 *   over everything. usesPlaceholderRates is also true when
 *   JobRates.placeholder.
 */

import { accumulateAssemblyCosts, effectiveMemberPart, partitionItems, priceAssemblies } from "./assembly";
import { PricingError } from "./errors";
import { evaluateQuoteFlags } from "./feasibility";
import { isReferenceBodyFlag } from "./reference-body";
import { assessForming, formingHint, formingSuspected, type FormingAssessment } from "./forming";
import { OPERATION_LABELS } from "./labels";
import { priceMarketQuote } from "./market";
import { buildItemOperations } from "./operations";
import { packagingForParts, packedPart, type PackedPart } from "./packaging";
import { priceScale as computePriceScale } from "./scale";
import { shippingLine } from "./shipping";
import { computeVat } from "./vat";
import { priceWeldingOnly } from "./welding-block";
import { PRICING_ENGINE_VERSION } from "./version";
import {
  marginToMarkup,
  priceFromCost,
  type Flag,
  type JobRates,
  type PricingAssembly,
  type PricingItem,
  type MachinePark,
  type OperationLine,
  type OperationType,
  type PricedItem,
  type PricedQuote,
  type PriceQuoteOptions,
  type QuoteInput,
  type RateSnapshot,
  type TotalsByType,
} from "./types";

/** Explicit override → customer-class margin → default margin. */
export function resolveMarginPct(
  rates: RateSnapshot,
  customerClass: string | null,
  override: number | null | undefined
): number {
  if (override !== null && override !== undefined && Number.isFinite(override)) return override;
  if (customerClass) {
    const byClass = rates.general.marginByClass[customerClass];
    if (typeof byClass === "number" && Number.isFinite(byClass)) return byClass;
  }
  return rates.general.defaultMarginPct;
}

function assertMargin(marginPct: number): void {
  if (!Number.isFinite(marginPct) || marginPct >= 100) {
    throw new PricingError("invalid_margin", `margin must be a finite percentage below 100, got ${String(marginPct)}`, {
      marginPct: Number.isFinite(marginPct) ? marginPct : String(marginPct),
    });
  }
}

function addTotal(totals: TotalsByType, type: OperationType, cost: number, marginPct: number): void {
  const bucket = totals[type] ?? { cost: 0, price: 0 };
  bucket.cost += cost;
  bucket.price = priceFromCost(bucket.cost, marginPct);
  totals[type] = bucket;
}

function accumulate(totals: TotalsByType, operations: OperationLine[], qty: number, marginPct: number): void {
  for (const op of operations) {
    const setup = op.setupShare * qty;
    const base = op.unitCost * qty - setup;
    if (op.type === "setup") {
      addTotal(totals, "setup", op.unitCost * qty, marginPct);
      continue;
    }
    addTotal(totals, op.type, base, marginPct);
    if (setup !== 0) addTotal(totals, "setup", setup, marginPct);
  }
}

/**
 * Price a whole quote from its parts, items, rate snapshot and machine
 * park. Cost mode unless the version says "market" (see file header);
 * assembly mode on top when job rates are given.
 */
export function priceQuote(
  input: QuoteInput,
  rates: RateSnapshot,
  machines: MachinePark,
  options: PriceQuoteOptions = {}
): PricedQuote {
  const jobRates = options.jobRates ?? null;
  if (jobRates) return priceJobQuote(input, rates, machines, { costRates: options.costRates ?? null, jobRates });
  if (rates.general.pricingMode === "market") {
    return priceMarketQuote(input, rates, machines, { costRates: options.costRates ?? null, priceCost: priceCostQuote });
  }
  return priceCostQuote(input, rates, machines);
}

/** The cost-mode pricer: unitCost = Σ operations, unitPrice = cost ÷ (1 − margin). */
export function priceCostQuote(input: QuoteInput, rates: RateSnapshot, machines: MachinePark): PricedQuote {
  const marginPct = input.marginPct;
  assertMargin(marginPct);
  const partsById = new Map(input.parts.map((p) => [p.id, p] as const));

  const items: PricedItem[] = input.items.map((item) => {
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
    const { operations, flags } = buildItemOperations(part, item, rates, machines);
    // A suspected CAD reference body is left out of the total: no lines, no price (reference-body.ts).
    if (flags.some((f) => f.severity === "red" && isReferenceBodyFlag(f.code))) {
      return { itemId: item.id, partId: part.id, qty: item.qty, operations: [], unitCost: 0, unitPrice: null, batchCost: 0, batchPrice: null, flags };
    }
    const unitCost = operations.reduce((sum, op) => sum + op.unitCost, 0);
    const unitPrice = priceFromCost(unitCost, marginPct);
    return {
      itemId: item.id,
      partId: part.id,
      qty: item.qty,
      operations,
      unitCost,
      unitPrice,
      batchCost: unitCost * item.qty,
      batchPrice: unitPrice * item.qty,
      flags,
    };
  });

  const weldingBlock = input.weldingOnly ? priceWeldingOnly(input.weldingOnly, rates, marginPct) : null;
  const welding: PricedQuote["welding"] = weldingBlock
    ? {
        operations: weldingBlock.operations,
        cost: weldingBlock.cost,
        price: weldingBlock.price,
        minOrderApplied: weldingBlock.minOrderApplied,
      }
    : null;

  const totalsByType: TotalsByType = {};
  for (const item of items) accumulate(totalsByType, item.operations, item.qty, marginPct);
  if (welding) accumulate(totalsByType, welding.operations, 1, marginPct);

  const subtotalCost = items.reduce((sum, i) => sum + i.batchCost, 0) + (welding?.cost ?? 0);
  const subtotalPrice = items.reduce((sum, i) => sum + (i.batchPrice ?? 0), 0) + (welding?.price ?? 0);

  const allOperations = [...items.flatMap((i) => i.operations), ...(welding?.operations ?? [])];
  const usesPlaceholderRates = allOperations.some((op) => op.rateRef.values.placeholder === true);

  const flags: Flag[] = [
    ...items.flatMap((i) => i.flags),
    ...(weldingBlock?.flags ?? []),
    ...evaluateQuoteFlags({ items, welding }),
  ];

  return {
    items,
    welding,
    totalsByType,
    subtotalCost,
    subtotalPrice,
    marginPct,
    markupPct: marginToMarkup(marginPct),
    inputMarginPct: marginPct,
    flags,
    usesPlaceholderRates,
    rateVersionId: rates.versionId,
    engineVersion: PRICING_ENGINE_VERSION,
    pricingMode: "cost",
    costRateVersionId: null,
    leadTimeDays: input.leadTimeDays ?? null,
    leadTimeMultiplier: 1,
    quoteLines: [],
    assemblies: [],
    shipping: null,
    vat: null,
    priceScale: [],
  };
}

/* ─── Assembly mode ───────────────────────────────────────── */

type JobQuoteOptions = { costRates: RateSnapshot | null; jobRates: JobRates };

/** Nest keys the loose lines already charge a laser set-up for (market mode: laser_setup lines, rateRef.key = "<material>/<t>"). */
function looseChargedNests(items: readonly PricedItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) for (const op of item.operations) if (op.label === OPERATION_LABELS.laserSetup) keys.add(op.rateRef.key);
  return keys;
}

/** Loose parts: a forming hint the loose model does not price (a roll annotation is priced / refused by the roll rules). */
function looseFormingSuspected(part: Parameters<typeof formingSuspected>[0], forming: Parameters<typeof formingSuspected>[1]): boolean {
  return formingSuspected(part, forming) && formingHint(part) !== "roll_annotation";
}

/** A forming line of a loose item (kept apart from the mode's own lines in the totals). */
function isLooseFormingLine(line: OperationLine): boolean {
  return line.details.looseForming === true;
}

/**
 * Forming operations of a LOOSE item (design §3: operations live on the
 * item; an unresolved infeasible one makes it unpriceable). Step bending
 * and in-house rolling are labour at the assembly labour rate, priced
 * cost-plus at the header margin like every non-benchmarked line;
 * subcontracting is the supplier's cost × (1 + subcontract margin), a
 * pass-through. The same label keys as the assembly lines.
 */
function looseFormingLines(item: PricedItem, assessment: FormingAssessment, jobRates: JobRates, marginPct: number): { lines: OperationLine[]; unitCost: number; unitPrice: number } {
  const a = jobRates.assembly;
  const perMin = a.labourRateEurH / 60;
  const factor = marginPct < 100 ? 1 / (1 - marginPct / 100) : 1;
  const lines: OperationLine[] = [];
  let unitCost = 0;
  let unitPrice = 0;
  const base = { setupShare: 0, auto: true, notes: null } as const;
  for (const charge of assessment.charges) {
    if (charge.kind === "step_bend") {
      const cost = charge.minutes * perMin;
      lines.push({
        ...base,
        id: `${item.itemId}:step-bend:${charge.opId}`,
        type: "bend",
        label: OPERATION_LABELS.stepBend,
        driverQty: charge.hits,
        driverUnit: "bend",
        rateRef: { table: "manual", key: "assembly_rates/step_bend_seconds_per_hit", values: { stepBendSecondsPerHit: a.stepBendSecondsPerHit, labourRateEurH: a.labourRateEurH, placeholder: jobRates.placeholder } },
        unitCost: cost,
        details: { looseForming: true, opId: charge.opId, hits: charge.hits, radiusMm: charge.radiusMm, angleDeg: charge.angleDeg, secondsPerHit: a.stepBendSecondsPerHit, minutes: charge.minutes, priceEur: cost * factor },
      });
      unitCost += cost;
      unitPrice += cost * factor;
    } else if (charge.kind === "roll") {
      const cost = charge.minutes * perMin;
      lines.push({
        ...base,
        id: `${item.itemId}:roll-forming:${charge.opId}`,
        type: "roll",
        label: OPERATION_LABELS.rollForming,
        driverQty: charge.metres,
        driverUnit: "m",
        rateRef: { table: "manual", key: "assembly_rates/roll_min_per_m", values: { rollMinPerM: a.rollMinPerM, labourRateEurH: a.labourRateEurH, placeholder: jobRates.placeholder } },
        unitCost: cost,
        details: { looseForming: true, opId: charge.opId, widthMm: charge.widthMm, rollMinPerM: a.rollMinPerM, minutes: charge.minutes, priceEur: cost * factor },
      });
      unitCost += cost;
      unitPrice += cost * factor;
    } else if (charge.kind === "subcontract") {
      lines.push({
        ...base,
        id: `${item.itemId}:subcontract:${charge.opId}`,
        type: charge.operation === "roll" ? "roll" : "bend",
        label: OPERATION_LABELS.subcontractForming,
        driverQty: 1,
        driverUnit: "part",
        rateRef: { table: "manual", key: "company_settings/subcontract_margin_pct", values: { supplier: charge.supplier, costEur: charge.costEur, marginPct: charge.marginPct, placeholder: false } },
        unitCost: charge.pricedEur,
        details: { looseForming: true, opId: charge.opId, operation: charge.operation, supplier: charge.supplier, costEur: charge.costEur, marginPct: charge.marginPct, pricedEur: charge.pricedEur, extraLeadDays: charge.extraLeadDays, subcontract: true, priceEur: charge.pricedEur },
      });
      unitCost += charge.pricedEur;
      unitPrice += charge.pricedEur;
    }
    // "bend": a feasible in-house bend operation — the part's bend lines already price it.
  }
  return { lines, unitCost, unitPrice };
}

function priceJobQuote(input: QuoteInput, rates: RateSnapshot, machines: MachinePark, options: JobQuoteOptions): PricedQuote {
  const { jobRates } = options;
  const market = rates.general.pricingMode === "market";
  const partsById = new Map(input.parts.map((p) => [p.id, p] as const));
  const { loose, assemblies, membersByAssembly } = partitionItems(input);
  const memberSource = new Map<string, { item: PricingItem; assembly: PricingAssembly }>();
  for (const assembly of assemblies) for (const member of membersByAssembly.get(assembly.id) ?? []) memberSource.set(member.id, { item: member, assembly });

  // 1. Loose lines by the mode's own pricer (members excluded, no scale, no legacy packaging).
  const looseInput: QuoteInput = { ...input, items: loose, assemblies: [], priceScale: [] };
  const base = market
    ? priceMarketQuote(looseInput, rates, machines, { costRates: options.costRates, priceCost: priceCostQuote, skipPackaging: true })
    : priceCostQuote(looseInput, rates, machines);

  // 1b. Forming on loose items: the suspected-forming guard, then the item's own
  //     operations (flags, labour / subcontract lines, unpriceable while unresolved).
  let looseFormingCost = 0;
  const looseItems: PricedItem[] = base.items.map((item) => {
    const source = loose.find((i) => i.id === item.itemId);
    const part = partsById.get(item.partId);
    if (!source || !part) return item;
    let out = item;
    if (looseFormingSuspected(part, source.forming)) {
      const flag: Flag = { code: "forming.suspected", severity: "red", partId: part.id, itemId: item.itemId, params: { hint: formingHint(part) ?? "" }, overridable: false };
      out = { ...out, flags: [...out.flags, flag] };
    }
    if ((source.forming?.length ?? 0) === 0) return out;
    const assessment = assessForming(source.forming, { thicknessMm: part.thicknessMm, materialCode: part.materialCode, machines, partId: part.id, itemId: item.itemId, rates, jobRates });
    const forming = looseFormingLines(out, assessment, jobRates, input.marginPct);
    const unitCost = out.unitCost + forming.unitCost;
    const unitPrice = assessment.unresolved || out.unitPrice === null ? null : out.unitPrice + forming.unitPrice;
    looseFormingCost += forming.unitCost * out.qty;
    return {
      ...out,
      operations: [...out.operations, ...forming.lines],
      unitCost,
      unitPrice,
      batchCost: unitCost * out.qty,
      batchPrice: unitPrice === null ? null : unitPrice * out.qty,
      flags: [...out.flags, ...assessment.flags],
    };
  });

  // 2. Assemblies (nests already charged by the loose lines are not charged again).
  const costRates = options.costRates ?? (market ? null : rates);
  const assembled = priceAssemblies(input, { rates, costRates, machines, jobRates, chargedNests: looseChargedNests(looseItems) });
  const memberById = new Map(assembled.items.map((i) => [i.itemId, i] as const));
  const looseById = new Map(looseItems.map((i) => [i.itemId, i] as const));
  const items: PricedItem[] = input.items.map((item) => looseById.get(item.id) ?? memberById.get(item.id)).filter((i): i is PricedItem => i !== undefined);

  // 3. Packaging over every priced part (loose lines with a price + members), shipping, VAT.
  const packed: PackedPart[] = [];
  for (const item of looseItems) {
    if (item.unitPrice === null) continue;
    const part = partsById.get(item.partId);
    if (part) packed.push(packedPart(part, item, rates));
  }
  for (const item of assembled.items) {
    const part = partsById.get(item.partId);
    const source = memberSource.get(item.itemId);
    // A member inherits the assembly's material / thickness for its mass too.
    if (part) packed.push(packedPart(source ? effectiveMemberPart(part, source.item, source.assembly) : part, item, rates));
  }
  const packaging = packagingForParts(packed, jobRates.packaging, jobRates.placeholder);
  // Market quote-level lines other than packaging (finish minimums) are
  // selling-price top-ups: kept in quoteLines and subtotalPrice, already in
  // the market totals — never cost, never pass-throughs.
  const topUps: OperationLine[] = base.quoteLines.filter((l) => l.type !== "packaging");
  const quoteLines: OperationLine[] = [...topUps, ...(packaging.line ? [packaging.line] : [])];
  const shipping = shippingLine(input.shipping ?? null, jobRates.shipping, packaging.envelope.grossKg, {
    customerCountry: input.customerCountry ?? null,
    homeCountry: jobRates.homeCountry,
    placeholder: jobRates.placeholder,
  });

  // 4. Totals.
  const welding = base.welding;
  const marginPct = market ? 0 : input.marginPct;
  const totalsByType: TotalsByType = {};
  if (market) {
    for (const [type, bucket] of Object.entries(base.totalsByType) as [OperationType, { cost: number; price: number }][]) totalsByType[type] = { ...bucket };
  } else {
    for (const item of looseItems) accumulate(totalsByType, item.operations.filter((l) => !isLooseFormingLine(l)), item.qty, marginPct);
    if (welding) accumulate(totalsByType, welding.operations, 1, marginPct);
  }
  // Loose forming lines carry their own price (cost-plus labour, pass-through subcontract).
  for (const item of looseItems) {
    for (const l of item.operations.filter(isLooseFormingLine)) {
      const bucket = totalsByType[l.type] ?? { cost: 0, price: 0 };
      bucket.cost += l.unitCost * item.qty;
      bucket.price += Number(l.details.priceEur ?? l.unitCost) * item.qty;
      totalsByType[l.type] = bucket;
    }
  }
  for (const assembly of assembled.assemblies) {
    const costs: Partial<Record<OperationType, number>> = {};
    accumulateAssemblyCosts(costs, assembly);
    const ratio = assembly.unitPrice !== null && assembly.unitCost > 0 ? assembly.unitPrice / assembly.unitCost : 0;
    for (const [type, cost] of Object.entries(costs) as [OperationType, number][]) {
      const bucket = totalsByType[type] ?? { cost: 0, price: 0 };
      bucket.cost += cost;
      bucket.price += cost * ratio;
      totalsByType[type] = bucket;
    }
  }
  // Pass-throughs (cost = price): the packaging and shipping lines this pricer created.
  const passThrough: OperationLine[] = [...(packaging.line ? [packaging.line] : []), ...(shipping.line ? [shipping.line] : [])];
  for (const l of passThrough) {
    const bucket = totalsByType[l.type] ?? { cost: 0, price: 0 };
    bucket.cost += l.unitCost;
    bucket.price += l.unitCost;
    totalsByType[l.type] = bucket;
  }

  const looseCost = market ? base.subtotalCost + looseFormingCost : looseItems.reduce((s, i) => s + i.batchCost, 0) + (welding?.cost ?? 0);
  const loosePrice = looseItems.reduce((s, i) => s + (i.batchPrice ?? 0), 0) + (welding?.price ?? 0);
  const assemblyCost = assembled.assemblies.reduce((s, a) => s + a.batchCost, 0);
  const assemblyPrice = assembled.assemblies.reduce((s, a) => s + (a.batchPrice ?? 0), 0);
  const passThroughEur = passThrough.reduce((s, l) => s + l.unitCost, 0);
  const topUpEur = topUps.reduce((s, l) => s + l.unitCost, 0);
  const subtotalCost = looseCost + assemblyCost + passThroughEur;
  const subtotalPrice = loosePrice + assemblyPrice + passThroughEur + topUpEur;

  const realisedMarginPct = subtotalPrice > 0 ? (1 - subtotalCost / subtotalPrice) * 100 : 0;
  const reportedMarginPct = market ? (options.costRates ? realisedMarginPct : 0) : input.marginPct;
  const markupPct = market ? (options.costRates && subtotalCost > 0 ? marginToMarkup(reportedMarginPct) : 0) : marginToMarkup(input.marginPct);

  // 5. Flags: the base flags minus its rates.placeholder (recounted over everything), members, assemblies, shipping, VAT.
  const allLines: OperationLine[] = [
    ...items.flatMap((i) => i.operations),
    ...assembled.assemblies.flatMap((a) => a.operations),
    ...quoteLines,
    ...(shipping.line ? [shipping.line] : []),
    ...(welding?.operations ?? []),
  ];
  const placeholders = allLines.filter((op) => op.rateRef.values.placeholder === true).length;
  const flags: Flag[] = [
    ...looseItems.flatMap((i) => i.flags),
    ...base.flags.filter((f) => f.partId === null && f.itemId === null && f.code !== "rates.placeholder"),
    ...assembled.flags,
    ...shipping.flags,
  ];
  if (placeholders > 0) flags.push({ code: "rates.placeholder", severity: "green", partId: null, itemId: null, params: { count: placeholders }, overridable: false });

  const vatResult = computeVat(
    { customerType: input.customerType ?? null, customerCountry: input.customerCountry ?? null, customerVatId: input.customerVatId ?? null, netTotalEur: subtotalPrice },
    jobRates
  );
  if (vatResult) flags.push(...vatResult.flags);

  const priced: PricedQuote = {
    items,
    welding,
    totalsByType,
    subtotalCost,
    subtotalPrice,
    marginPct: reportedMarginPct,
    markupPct,
    inputMarginPct: input.marginPct,
    flags,
    usesPlaceholderRates: placeholders > 0 || jobRates.placeholder,
    rateVersionId: rates.versionId,
    engineVersion: PRICING_ENGINE_VERSION,
    pricingMode: market ? "market" : "cost",
    costRateVersionId: market ? (options.costRates?.versionId ?? null) : null,
    leadTimeDays: base.leadTimeDays,
    leadTimeMultiplier: base.leadTimeMultiplier,
    quoteLines,
    assemblies: assembled.assemblies,
    shipping: shipping.line,
    vat: vatResult?.vat ?? null,
    priceScale: [],
  };

  // 6. Price scale (the scaled inputs carry priceScale [] — no recursion).
  if ((input.priceScale?.length ?? 0) > 0 && (loose.length > 0 || assemblies.length > 0)) {
    priced.priceScale = computePriceScale(input, (scaled) => priceQuote(scaled, rates, machines, { costRates: options.costRates, jobRates }));
  }
  return priced;
}
