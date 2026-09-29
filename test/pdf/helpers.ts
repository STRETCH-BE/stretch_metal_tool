/**
 * PDF test helpers — an assembly-mode QuoteBundle with a hand-built,
 * internally consistent PricedQuote: one welded assembly with two member
 * items (one carrying a material note), one loose item priced by the real
 * engine (priceFixture), optional shipping line, VAT result and price
 * scale. The PDF prints whatever the engine gives it, so the numbers here
 * are literals chosen to be easy to assert on, not engine output.
 * File path: /test/pdf/helpers.ts
 */

import type { CompanySettingsRow, CustomerRow, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { OPERATION_LABELS } from "@/lib/pricing/labels";
import type { OperationLine, PricedAssembly, PricedItem, PricedQuote, PriceScale, VatMode, VatResult } from "@/lib/pricing/types";
import type { QuoteBundle } from "@/lib/quotes/types";
import { ASSEMBLY_ID, ITEM_ID, ITEM_ID_2, PART_ID, PART_ID_2, makeAssemblyRow, makeBundle, makeItemRow, makePartRow, priceFixture } from "@/test/quotes/fixtures";

export const LOOSE_PART_ID = "44444444-4444-4444-8444-444444444444";
export const LOOSE_ITEM_ID = "55555555-5555-4555-8555-555555555555";

export const MEMBER_NAME_1 = "200164";
export const MEMBER_NAME_2 = "P2 lid 365x365";
export const LOOSE_NAME = "Bracket 300";
export const MATERIAL_NOTE = "DC01 quoted for S235 (equivalent cold-rolled grade)";
export const ASSEMBLY_UNIT_PRICE_EUR = 300;
export const SHIPPING_EUR = 35;

function costLine(id: string, type: OperationLine["type"], label: string, unitCost: number): OperationLine {
  return {
    id: `${ASSEMBLY_ID}:${id}`,
    type,
    label,
    driverQty: 1,
    driverUnit: "lot",
    rateRef: { table: "manual", key: id, values: {} },
    unitCost,
    setupShare: 0,
    auto: true,
    notes: null,
    details: {},
  };
}

/** A priced assembly line (unit price 300 € by default; pass unitPrice null for an unpriceable one). */
export function makePricedAssembly(over: Partial<PricedAssembly> = {}): PricedAssembly {
  const qty = over.qty ?? 1;
  const unitPrice = over.unitPrice === undefined ? ASSEMBLY_UNIT_PRICE_EUR : over.unitPrice;
  return {
    assemblyId: ASSEMBLY_ID,
    name: "Heat store box rev 3",
    drawingRef: "HSB-3",
    materialCode: "S235",
    thicknessMm: 3,
    qty,
    memberItemIds: [ITEM_ID, ITEM_ID_2],
    operations: [
      costLine("parts", "material", OPERATION_LABELS.assemblyParts, 60),
      costLine("cut", "laser_cut", OPERATION_LABELS.laserCut, 40),
      costLine("weld", "weld", OPERATION_LABELS.assemblyWeld, 80),
      costLine("setup-weld-fitup", "setup", OPERATION_LABELS.setupWeldFitup, 12.5),
    ],
    unitCost: 192.5,
    unitPrice,
    batchCost: 192.5 * qty,
    batchPrice: unitPrice === null ? null : unitPrice * qty,
    marginPct: 30,
    labour: { fitupMin: 30, tackMin: 11, weldMin: 31, deburrMin: 8, handlingMin: 10, formingMin: 8, totalMin: 120, arcMin: 42 },
    seamLengthMm: 3760,
    flags: [],
    ...over,
  };
}

export function vatResult(mode: VatMode, ratePct: number, netTotal: number): VatResult {
  const vatAmount = (netTotal * ratePct) / 100;
  const countryCode = mode === "pl_domestic" || mode === "b2c_domestic" ? "PL" : mode === "b2c_oss" ? "FI" : null;
  return { mode, ratePct, countryCode, netTotal, vatAmount, grossTotal: netTotal + vatAmount };
}

export function shippingLine(costEur: number): OperationLine {
  return {
    id: "quote:shipping",
    type: "shipping",
    label: OPERATION_LABELS.shipping,
    driverQty: 12.4,
    driverUnit: "kg",
    rateRef: { table: "manual", key: "shipping_rates/FI/30", values: { countryCode: "FI", maxKg: 30, priceEur: costEur } },
    unitCost: costEur,
    setupShare: 0,
    auto: true,
    notes: null,
    details: { countryCode: "FI", grossKg: 12.4, source: "table" },
  };
}

export type AssemblyBundleOptions = {
  /** VAT result on the net total; null = no VAT block (today's notice). Default 23 % pl_domestic. */
  vat?: ((netTotalEur: number) => VatResult) | null;
  /** Shipping line cost; null = no shipping line. */
  shippingEur?: number | null;
  /** Quantities of the price scale (empty = no scale). */
  priceScale?: number[];
  /** Assembly unit price (null = unpriceable). */
  assemblyUnitPrice?: number | null;
  quote?: Partial<QuoteRow>;
  customer?: Partial<CustomerRow> | null;
  company?: CompanySettingsRow | null;
  /** Extra item / part rows appended after the fixture ones. */
  items?: QuoteItemRow[];
  parts?: PartRow[];
};

/**
 * Bundle: assembly "Heat store box rev 3" (qty 1) with members 200164 ×2
 * (material note) and "P2 lid" ×1 (no material of its own), plus the
 * loose "Bracket 300" × 50 priced by the engine.
 */
export function makeAssemblyBundle(options: AssemblyBundleOptions = {}): QuoteBundle {
  const base = priceFixture();
  const loosePriced: PricedItem = { ...base.items[0], itemId: LOOSE_ITEM_ID, partId: LOOSE_PART_ID, flags: [] };
  const assembly = makePricedAssembly({ unitPrice: options.assemblyUnitPrice === undefined ? ASSEMBLY_UNIT_PRICE_EUR : options.assemblyUnitPrice });
  const members: PricedItem[] = [
    { itemId: ITEM_ID, partId: PART_ID, qty: 2, operations: [], unitCost: 12, unitPrice: null, batchCost: 24, batchPrice: null, flags: [] },
    { itemId: ITEM_ID_2, partId: PART_ID_2, qty: 1, operations: [], unitCost: 20, unitPrice: null, batchCost: 20, batchPrice: null, flags: [] },
  ];
  const shipping = options.shippingEur === null ? null : shippingLine(options.shippingEur ?? SHIPPING_EUR);
  const subtotalPrice = (loosePriced.batchPrice ?? 0) + (assembly.batchPrice ?? 0) + (shipping?.unitCost ?? 0);
  const subtotalCost = loosePriced.batchCost + assembly.batchCost + (shipping?.unitCost ?? 0);
  const vatFn = options.vat === undefined ? (net: number) => vatResult("pl_domestic", 23, net) : options.vat;
  const scaleQty = options.priceScale ?? [];
  const priceScale: PriceScale[] =
    scaleQty.length === 0
      ? []
      : [
          {
            subjectId: LOOSE_ITEM_ID,
            kind: "item",
            entries: scaleQty.map((qty) => ({ qty, unitPrice: (loosePriced.unitPrice ?? 0) * (50 / qty) ** 0.1, total: (loosePriced.unitPrice ?? 0) * (50 / qty) ** 0.1 * qty })),
          },
          {
            subjectId: ASSEMBLY_ID,
            kind: "assembly",
            entries: scaleQty.map((qty) => ({ qty, unitPrice: ASSEMBLY_UNIT_PRICE_EUR - qty, total: (ASSEMBLY_UNIT_PRICE_EUR - qty) * qty })),
          },
        ];
  const priced: PricedQuote = {
    ...base,
    items: [...members, loosePriced],
    assemblies: [assembly],
    shipping,
    vat: vatFn ? vatFn(subtotalPrice) : null,
    priceScale,
    subtotalCost,
    subtotalPrice,
    flags: [],
  };

  const items: QuoteItemRow[] = [
    makeItemRow({ id: ITEM_ID, part_id: PART_ID, position: 0, qty: 2, assembly_id: ASSEMBLY_ID, qty_per_assembly: 2, material_note: MATERIAL_NOTE }),
    makeItemRow({ id: ITEM_ID_2, part_id: PART_ID_2, position: 1, qty: 1, assembly_id: ASSEMBLY_ID, qty_per_assembly: 1 }),
    makeItemRow({ id: LOOSE_ITEM_ID, part_id: LOOSE_PART_ID, position: 2, qty: 50 }),
    ...(options.items ?? []),
  ];
  const parts: PartRow[] = [
    makePartRow({ id: PART_ID, name: MEMBER_NAME_1 }),
    makePartRow({ id: PART_ID_2, name: MEMBER_NAME_2, material_code: null, thickness_mm: null, geometry: null }),
    makePartRow({ id: LOOSE_PART_ID, name: LOOSE_NAME }),
    ...(options.parts ?? []),
  ];
  return makeBundle({
    priced,
    flags: [],
    items,
    parts,
    assemblies: [makeAssemblyRow()],
    quote: { currency: "EUR", fx_rate: 1, customer_reference: "N260580", price_scale: scaleQty, ...options.quote },
    customer: options.customer === null ? null : { contact_person: "Anna Nowak", ...options.customer },
    company: options.company ?? null,
  });
}
