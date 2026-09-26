/**
 * Test fixture — a synthetic QuoteBundle (200164-like part × 50, Polish or
 * German customer, PLN or EUR) with a real PricedQuote from the pricing
 * engine, plus row builders shared by the quote and PDF tests.
 * File path: /test/quotes/fixtures.ts
 */

import type { CustomerRow, OverrideRow, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { priceQuote } from "@/lib/pricing/price-quote";
import type { Flag, PricedQuote } from "@/lib/pricing/types";
import { toJson } from "@/lib/quotes/mapper";
import type { QuoteBundle } from "@/lib/quotes/types";
import { makeAnnotations } from "@/test/helpers/geometry";
import { make200164Like } from "@/test/helpers/parts";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID } from "@/test/helpers/rates";

export const QUOTE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PART_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const CUSTOMER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const ADMIN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

export function makeCustomer(over: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: CUSTOMER_ID,
    name: "Acme Metal Sp. z o.o.",
    vat_id: "PL5250001234",
    country: "PL",
    address: "ul. Przemysłowa 12\n42-200 Częstochowa",
    email: "zakupy@acme-metal.pl",
    phone: null,
    customer_class: "standard",
    preferred_locale: null,
    notes: null,
    created_by: USER_ID,
    created_at: "2026-09-20T08:00:00Z",
    updated_at: "2026-09-20T08:00:00Z",
    ...over,
  };
}

export function makeQuoteRow(over: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: QUOTE_ID,
    number: "SM-2026-0001",
    version: 1,
    type: "fabrication",
    status: "draft",
    customer_id: CUSTOMER_ID,
    currency: "PLN",
    fx_rate: 4.3,
    margin_pct: 30,
    validity_days: 30,
    lead_time_text: "10–15 dni roboczych",
    payment_terms_text: "Przelew 14 dni",
    rate_version_id: RATE_VERSION_ID,
    geometry_locked: false,
    subtotal_cost: 0,
    subtotal_price: 0,
    pricing: null,
    flags: [],
    show_operations_on_pdf: false,
    welding_separate: false,
    welding_only: null,
    notes: null,
    created_by: USER_ID,
    created_at: "2026-09-25T10:00:00Z",
    updated_at: "2026-09-25T10:00:00Z",
    priced_at: null,
    sent_at: null,
    decided_at: null,
    ...over,
  };
}

/** 200164-like part with the Step 14 (3) stitch weld, as a parts row. */
export function makePartRow(over: Partial<PartRow> = {}): PartRow {
  const geometry = make200164Like();
  const annotations = makeAnnotations({
    welds: [
      {
        id: "w1",
        entityIds: ["outer"],
        points: null,
        lengthMm: 554.3,
        process: "mig_mag",
        beadMm: 4,
        pattern: "stitch",
        stitch: { beadLengthMm: 30, pitchMm: 60 },
        sides: 1,
        effectiveLengthMm: 277.15,
      },
    ],
  });
  return {
    id: PART_ID,
    quote_id: QUOTE_ID,
    name: "200164",
    source: "dxf",
    file_id: null,
    pdf_file_id: null,
    file_hash: "abc",
    material_code: "DC01",
    thickness_mm: 2,
    geometry: toJson(geometry),
    annotations: toJson(annotations),
    triage: null,
    thumbnail_svg: null,
    pdf_text: null,
    ai_suggestions: null,
    created_at: "2026-09-25T10:01:00Z",
    updated_at: "2026-09-25T10:01:00Z",
    ...over,
  };
}

export function makeItemRow(over: Partial<QuoteItemRow> = {}): QuoteItemRow {
  return {
    id: ITEM_ID,
    quote_id: QUOTE_ID,
    part_id: PART_ID,
    position: 0,
    qty: 50,
    unit_cost: 0,
    unit_price: 0,
    extras: [],
    scrap_pct: null,
    flags: [],
    notes: null,
    created_at: "2026-09-25T10:02:00Z",
    ...over,
  };
}

export function makeOverride(over: Partial<OverrideRow> = {}): OverrideRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    quote_id: QUOTE_ID,
    part_id: PART_ID,
    quote_item_id: ITEM_ID,
    rule_code: "bend.hole_near_bend",
    requested_by: USER_ID,
    note: "ok",
    status: "pending",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    created_at: "2026-09-25T11:00:00Z",
    ...over,
  };
}

/** The engine result for the fixture part × 50 at 30 % margin. */
export function priceFixture(marginPct = 30): PricedQuote {
  const partRow = makePartRow();
  const part = makePricingPart({
    id: PART_ID,
    geometry: make200164Like(),
    materialCode: "DC01",
    thicknessMm: 2,
    annotations: JSON.parse(JSON.stringify(partRow.annotations)),
  });
  const input = makeQuoteInput({ marginPct, parts: [part], items: [makeItem({ id: ITEM_ID, partId: PART_ID, qty: 50 })] });
  return priceQuote(input, RATE_SNAPSHOT_V1, MACHINE_PARK);
}

export type BundleOptions = {
  quote?: Partial<QuoteRow>;
  customer?: Partial<CustomerRow> | null;
  overrides?: OverrideRow[];
  flags?: Flag[];
  priced?: PricedQuote | null;
  items?: QuoteItemRow[];
  parts?: PartRow[];
};

export function makeBundle(options: BundleOptions = {}): QuoteBundle {
  const priced = options.priced === undefined ? priceFixture() : options.priced;
  const flags = options.flags ?? priced?.flags ?? [];
  const quote = makeQuoteRow({ pricing: priced ? toJson(priced) : null, flags: toJson(flags), ...options.quote });
  const customer = options.customer === null ? null : makeCustomer(options.customer ?? {});
  return {
    quote,
    customer,
    items: options.items ?? [makeItemRow()],
    parts: options.parts ?? [makePartRow()],
    operations: [],
    overrides: options.overrides ?? [],
    rateVersionLabel: RATE_SNAPSHOT_V1.label,
    pricing: priced,
    flags,
    weldingOnly: null,
  };
}

export function amberFlag(over: Partial<Flag> = {}): Flag {
  return {
    code: "bend.hole_near_bend",
    severity: "amber",
    partId: PART_ID,
    itemId: ITEM_ID,
    params: { bendId: "bend-up-1", count: 1, distanceMm: 3.2, minMm: 5, loopIds: "h1" },
    overridable: true,
    ...over,
  };
}

export function redFlag(over: Partial<Flag> = {}): Flag {
  return {
    code: "bend.force_over_limit",
    severity: "red",
    partId: PART_ID,
    itemId: ITEM_ID,
    params: { bendId: "b1", forceKN: 4000, limitKN: 3200, lengthMm: 4000, thicknessMm: 12, dieVMm: 96, rmNmm2: 510 },
    overridable: false,
    ...over,
  };
}
