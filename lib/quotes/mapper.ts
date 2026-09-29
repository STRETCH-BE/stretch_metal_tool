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
 *   - Assembly mode (docs/assembly-mode-design.md §2): assemblies and
 *     their seams map to QuoteInput.assemblies, the member columns of an
 *     item (assembly_id, qty_per_assembly, material_override,
 *     material_note, forming) to the PricingItem, the customer's type /
 *     country / VAT id and the quote's shipping + price scale to the
 *     quote-level inputs. A MEMBER's order quantity in the input is
 *     assembly.qty × qty_per_assembly whatever quote_items.qty holds;
 *     `memberQtyUpdates` lists the rows whose stored qty disagrees so the
 *     re-price writes them back. All of it is optional on the source: the
 *     client preview and older callers pass none of it and get the same
 *     input as before (assemblies [], no customer type, no shipping).
 *   - pricedToPersistence takes the ids of ALL items: an item the engine
 *     did not price as a line (a member priced inside its assembly) gets
 *     unit_cost 0 / unit_price null / no flags instead of keeping a stale
 *     loose-part price; a refused item keeps null as before.
 */

import type { PartGeometry } from "@/lib/geometry/types";
import type { AssemblyRow, AssemblySeamRow, CompanySettingsRow, CurrencyCode, CustomerRow, Json, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { resolveMarginPct } from "@/lib/pricing/price-quote";
import type {
  OperationLine,
  PricedQuote,
  PricingAssembly,
  PricingItem,
  PricingPart,
  QuoteInput,
  RateSnapshot,
} from "@/lib/pricing/types";
import { toQuoteCurrency } from "@/lib/format";
import { normalisePriceScale, parseAnnotations, parseExtras, parseForming, parseGeometry, parseShipping, parseWeldingOnly } from "./schema";
import { seamRowToPricingSeam } from "./seams";

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

/** Order quantity of an assembly member: assembly.qty × qty_per_assembly (≥ 1 each). */
export function memberQty(assembly: Pick<AssemblyRow, "qty">, item: Pick<QuoteItemRow, "qty_per_assembly">): number {
  const perAssembly = Math.max(1, Math.floor(num(item.qty_per_assembly) ?? 1));
  return Math.max(1, Math.floor(num(assembly.qty) ?? 1)) * perAssembly;
}

/**
 * quote_items row → PricingItem. With its assembly given, a member's qty is
 * the derived order quantity (assembly.qty × qty_per_assembly); the stored
 * column is only trusted for loose parts.
 */
export function itemRowToPricingItem(row: QuoteItemRow, assembly: Pick<AssemblyRow, "id" | "qty"> | null = null): PricingItem {
  const member = assembly && row.assembly_id === assembly.id;
  return {
    id: row.id,
    partId: row.part_id,
    qty: member ? memberQty(assembly, row) : Number(row.qty),
    extras: parseExtras(row.extras),
    scrapPct: num(row.scrap_pct),
    assemblyId: member ? assembly.id : null,
    qtyPerAssembly: Math.max(1, Math.floor(num(row.qty_per_assembly) ?? 1)),
    materialOverride: Boolean(row.material_override),
    materialNote: row.material_note ?? null,
    forming: parseForming(row.forming),
  };
}

/** assemblies + assembly_seams rows → PricingAssembly[] in position order (seams per assembly in position order). */
export function assemblyRowsToPricing(assemblies: ReadonlyArray<AssemblyRow>, seams: ReadonlyArray<AssemblySeamRow>): PricingAssembly[] {
  const seamsByAssembly = new Map<string, AssemblySeamRow[]>();
  for (const seam of seams) {
    const list = seamsByAssembly.get(seam.assembly_id) ?? [];
    list.push(seam);
    seamsByAssembly.set(seam.assembly_id, list);
  }
  return [...assemblies]
    .sort((a, b) => num(a.position)! - num(b.position)! || a.created_at.localeCompare(b.created_at))
    .map((row, index) => ({
      id: row.id,
      position: index,
      name: row.name,
      drawingRef: row.drawing_ref,
      qty: Math.max(1, Math.floor(num(row.qty) ?? 1)),
      materialCode: row.material_code,
      thicknessMm: num(row.thickness_mm),
      seams: (seamsByAssembly.get(row.id) ?? [])
        .sort((a, b) => num(a.position)! - num(b.position)! || a.created_at.localeCompare(b.created_at))
        .map(seamRowToPricingSeam),
    }));
}

/** Members whose stored quote_items.qty disagrees with assembly.qty × qty_per_assembly (the re-price writes these back). */
export function memberQtyUpdates(items: ReadonlyArray<QuoteItemRow>, assemblies: ReadonlyArray<AssemblyRow>): { id: string; qty: number }[] {
  const byId = new Map(assemblies.map((a) => [a.id, a] as const));
  const out: { id: string; qty: number }[] = [];
  for (const item of items) {
    const assembly = item.assembly_id ? byId.get(item.assembly_id) : undefined;
    if (!assembly) continue;
    const qty = memberQty(assembly, item);
    if (Number(item.qty) !== qty) out.push({ id: item.id, qty });
  }
  return out;
}

export type QuoteInputSource = {
  quote: Pick<QuoteRow, "type" | "margin_pct" | "welding_only" | "lead_time_days"> & Partial<Pick<QuoteRow, "shipping" | "price_scale">>;
  customer: (Pick<CustomerRow, "customer_class"> & Partial<Pick<CustomerRow, "customer_type" | "country" | "vat_id">>) | null;
  items: QuoteItemRow[];
  parts: PartRow[];
  rates: RateSnapshot;
  /** Welded assemblies of the quote and their seams (absent = none). */
  assemblies?: ReadonlyArray<AssemblyRow>;
  seams?: ReadonlyArray<AssemblySeamRow>;
};

/** Assemble the engine input for a quote. Items are sorted by position. */
export function buildQuoteInput(source: QuoteInputSource): QuoteInput {
  const partsById = new Map(source.parts.map((p) => [p.id, p] as const));
  const assembliesById = new Map((source.assemblies ?? []).map((a) => [a.id, a] as const));
  const items = [...source.items]
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    .filter((item) => partsById.has(item.part_id))
    .map((item) => itemRowToPricingItem(item, item.assembly_id ? (assembliesById.get(item.assembly_id) ?? null) : null));
  const usedPartIds = new Set(items.map((i) => i.partId));
  const parts = source.parts.filter((p) => usedPartIds.has(p.id)).map(partRowToPricingPart);
  const customerClass = source.customer?.customer_class ?? null;
  const weldingOnly = parseWeldingOnly(source.quote.welding_only);
  const customerType = source.customer?.customer_type === "b2c" ? "b2c" : source.customer?.customer_type === "b2b" ? "b2b" : null;
  return {
    type: source.quote.type,
    marginPct: resolveMarginPct(source.rates, customerClass, num(source.quote.margin_pct)),
    customerClass,
    items,
    parts,
    weldingOnly: source.quote.type === "welding_only" ? weldingOnly ?? { seams: [], partsCount: 0 } : weldingOnly,
    leadTimeDays: num(source.quote.lead_time_days),
    assemblies: assemblyRowsToPricing(source.assemblies ?? [], source.seams ?? []),
    customerType,
    customerCountry: source.customer?.country ? String(source.customer.country).toUpperCase() : null,
    customerVatId: source.customer?.vat_id ?? null,
    shipping: parseShipping(source.quote.shipping),
    priceScale: normalisePriceScale(source.quote.price_scale),
  };
}

/** company_settings row → CompanySettingsRow with the numeric / boolean columns coerced (PostgREST sends numerics as strings). */
export function companyRowToSettings(row: Record<string, unknown> | null | undefined): CompanySettingsRow | null {
  if (!row || typeof row !== "object") return null;
  const oss = row.oss_active;
  return {
    ...(row as unknown as CompanySettingsRow),
    id: Number(row.id ?? 1),
    assembly_margin_pct: num(row.assembly_margin_pct as number | string | null) ?? 0,
    subcontract_margin_pct: num(row.subcontract_margin_pct as number | string | null) ?? 0,
    oss_active: oss === true || oss === "true",
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
  /** null = refused (market mode, not benchmarked). */
  unit_price: number | null;
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

/**
 * PricedQuote → the row updates persisted by repriceQuote. `allItemIds`
 * (the quote's item rows) lets an item the engine did not return as a line
 * — a member priced inside its assembly — be reset instead of keeping a
 * stale loose price (see the header).
 */
export function pricedToPersistence(
  priced: PricedQuote,
  quote: { currency: CurrencyCode; fx_rate: number | string },
  allItemIds: ReadonlyArray<string> = []
): Persistence {
  const fx = Number(quote.fx_rate) || 1;
  const items: ItemUpdate[] = priced.items.map((item) => ({
    id: item.itemId,
    unit_cost: item.unitCost,
    unit_price: item.unitPrice,
    flags: toJson(item.flags),
  }));
  const priced_ids = new Set(items.map((i) => i.id));
  for (const id of allItemIds) {
    if (!priced_ids.has(id)) items.push({ id, unit_cost: 0, unit_price: null, flags: [] });
  }
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
