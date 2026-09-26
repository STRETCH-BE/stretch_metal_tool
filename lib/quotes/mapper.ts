/**
 * Pure mapping between database rows and the pricing engine: rows →
 * QuoteInput (what priceQuote consumes) and PricedQuote → the row updates
 * the persistence step writes. No I/O, so the whole re-pricing contract is
 * unit-testable without a database (test/quotes/mapper.test.ts).
 * File path: /lib/quotes/mapper.ts
 *
 * Decisions:
 *   - A part whose geometry JSON is missing or fails the light guard is
 *     priced with an EMPTY geometry (zero measures, triage
 *     red_no_closed_contour). The engine then raises the red
 *     `geometry.triage_red` flag, so such a part blocks sending and shows
 *     0 € material/cutting instead of crashing the whole quote or being
 *     silently skipped.
 *   - Items are ordered by `position`; the engine keeps that order, and the
 *     persisted operations get `position` = index inside the item.
 *   - Only items whose part exists are priced (an item pointing at a
 *     deleted part cannot happen with the FK, but the mapper stays total).
 *   - Money: `quote_items.unit_*` and `operations.unit_cost` are EUR as the
 *     engine emits them; `quotes.subtotal_*` are converted to the quote
 *     currency with the stored fx rate (list views display them with
 *     `quote.currency`). The full PricedQuote (EUR) is kept in
 *     quotes.pricing.
 *   - `toJson` round-trips through JSON so NaN/Infinity (which cannot
 *     appear after validation anyway) become null instead of breaking the
 *     jsonb insert, and class instances/undefined are stripped.
 */

import type { PartGeometry } from "@/lib/geometry/types";
import type { CurrencyCode, CustomerRow, Json, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { resolveMarginPct } from "@/lib/pricing/price-quote";
import type {
  OperationLine,
  PricedQuote,
  PricingItem,
  PricingPart,
  QuoteInput,
  RateSnapshot,
} from "@/lib/pricing/types";
import { toQuoteCurrency } from "@/lib/format";
import { parseAnnotations, parseExtras, parseGeometry, parseWeldingOnly } from "./schema";

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** Valid PartGeometry with nothing in it — prices as a red "no closed contour" part. */
export function emptyGeometry(source: PartGeometry["source"], thicknessMm: number | null): PartGeometry {
  const bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return {
    version: 1,
    source,
    header: { version: null, units: { insunits: null, detected: "unknown", scaleApplied: 1 }, extmin: null, extmax: null, layers: [] },
    entities: [],
    loops: [],
    outerLoopId: null,
    measures: {
      cutLengthMm: 0,
      outerLengthMm: 0,
      holesLengthMm: 0,
      pierces: 0,
      bbox,
      blank: { lengthMm: 0, widthMm: 0, marginMm: 0 },
      outerAreaMm2: 0,
      holesAreaMm2: 0,
      netAreaMm2: 0,
      massKg: null,
      holes: [],
      bendLines: [],
      smallestContourMm: null,
      slowContours: [],
      engraveLengthMm: 0,
    },
    healing: {
      toleranceMm: 0,
      gapsJoined: 0,
      duplicatesRemoved: 0,
      overlapsRemoved: 0,
      zeroLengthRemoved: 0,
      splinesFlattened: 0,
      ellipsesFlattened: 0,
      blocksExploded: 0,
      loopsClosed: 0,
    },
    dropped: [],
    triage: { state: "red_no_closed_contour", reasons: ["no_closed_contour"], candidateEntityIds: [], details: {} },
    partCount: 0,
    material: { thicknessMm, densityKgM3: null },
  };
}

const PART_SOURCE_TO_GEOMETRY: Record<PartRow["source"], PartGeometry["source"]> = {
  dxf: "dxf",
  pdf: "pdf",
  step: "step",
  manual: "manual",
  welding_drawing: "welding_drawing",
};

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** parts row → PricingPart (geometry + annotations parsed through the light guards). */
export function partRowToPricingPart(row: PartRow): PricingPart {
  const thickness = num(row.thickness_mm);
  const geometry = parseGeometry(row.geometry) ?? emptyGeometry(PART_SOURCE_TO_GEOMETRY[row.source], thickness);
  return {
    id: row.id,
    name: row.name,
    source: geometry.source,
    materialCode: row.material_code,
    thicknessMm: thickness,
    geometry,
    annotations: parseAnnotations(row.annotations),
  };
}

/** quote_items row → PricingItem. */
export function itemRowToPricingItem(row: QuoteItemRow): PricingItem {
  return {
    id: row.id,
    partId: row.part_id,
    qty: Number(row.qty),
    extras: parseExtras(row.extras),
    scrapPct: num(row.scrap_pct),
  };
}

export type QuoteInputSource = {
  quote: Pick<QuoteRow, "type" | "margin_pct" | "welding_only">;
  customer: Pick<CustomerRow, "customer_class"> | null;
  items: QuoteItemRow[];
  parts: PartRow[];
  rates: RateSnapshot;
};

/** Assemble the engine input for a quote. Items are sorted by position. */
export function buildQuoteInput(source: QuoteInputSource): QuoteInput {
  const partsById = new Map(source.parts.map((p) => [p.id, p] as const));
  const items = [...source.items]
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    .filter((item) => partsById.has(item.part_id))
    .map(itemRowToPricingItem);
  const usedPartIds = new Set(items.map((i) => i.partId));
  const parts = source.parts.filter((p) => usedPartIds.has(p.id)).map(partRowToPricingPart);
  const customerClass = source.customer?.customer_class ?? null;
  const weldingOnly = parseWeldingOnly(source.quote.welding_only);
  return {
    type: source.quote.type,
    marginPct: resolveMarginPct(source.rates, customerClass, num(source.quote.margin_pct)),
    customerClass,
    items,
    parts,
    weldingOnly: source.quote.type === "welding_only" ? weldingOnly ?? { seams: [], partsCount: 0 } : weldingOnly,
  };
}

/** True when there is anything to price at all. */
export function hasPriceableContent(input: QuoteInput): boolean {
  return input.items.length > 0 || Boolean(input.weldingOnly && input.weldingOnly.seams.length > 0);
}

export type OperationInsert = {
  quote_item_id: string;
  position: number;
  type: string;
  label: string;
  driver_qty: number;
  driver_unit: string;
  rate_ref: Json;
  unit_cost: number;
  setup_share: number;
  details: Json;
  notes: string | null;
  auto: boolean;
};

export type ItemUpdate = {
  id: string;
  unit_cost: number;
  unit_price: number;
  flags: Json;
};

export type QuotePricingUpdate = {
  pricing: Json;
  flags: Json;
  subtotal_cost: number;
  subtotal_price: number;
};

export type Persistence = {
  items: ItemUpdate[];
  operations: OperationInsert[];
  quote: QuotePricingUpdate;
};

export function operationLineToRow(itemId: string, position: number, line: OperationLine): OperationInsert {
  return {
    quote_item_id: itemId,
    position,
    type: line.type,
    label: line.label,
    driver_qty: line.driverQty,
    driver_unit: line.driverUnit,
    rate_ref: toJson(line.rateRef),
    unit_cost: line.unitCost,
    setup_share: line.setupShare,
    details: toJson(line.details),
    notes: line.notes,
    auto: line.auto,
  };
}

/** PricedQuote → the row updates persisted by repriceQuote. */
export function pricedToPersistence(
  priced: PricedQuote,
  quote: { currency: CurrencyCode; fx_rate: number | string }
): Persistence {
  const fx = Number(quote.fx_rate) || 1;
  const items: ItemUpdate[] = priced.items.map((item) => ({
    id: item.itemId,
    unit_cost: item.unitCost,
    unit_price: item.unitPrice,
    flags: toJson(item.flags),
  }));
  const operations: OperationInsert[] = priced.items.flatMap((item) =>
    item.operations.map((line, index) => operationLineToRow(item.itemId, index, line))
  );
  return {
    items,
    operations,
    quote: {
      pricing: toJson(priced),
      flags: toJson(priced.flags),
      subtotal_cost: toQuoteCurrency(priced.subtotalCost, quote.currency, fx),
      subtotal_price: toQuoteCurrency(priced.subtotalPrice, quote.currency, fx),
    },
  };
}

/** The "nothing to price" state written when a quote has no items and no seams. */
export function emptyPersistence(): QuotePricingUpdate {
  return { pricing: null, flags: [], subtotal_cost: 0, subtotal_price: 0 };
}
