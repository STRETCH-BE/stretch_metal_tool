/**
 * Test fixture — a synthetic QuoteBundle (200164-like part × 50, Polish or
 * German customer, PLN or EUR) with a real PricedQuote from the pricing
 * engine, plus row builders shared by the quote and PDF tests.
 * File path: /test/quotes/fixtures.ts
 */

import type { AssemblyRow, AssemblySeamRow, CompanySettingsRow, CustomerRow, OverrideRow, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { priceQuote } from "@/lib/pricing/price-quote";
import type { Flag, PricedQuote } from "@/lib/pricing/types";
import { toQuoteCurrency } from "@/lib/format";
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
export const ASSEMBLY_ID = "a55e3b1e-0000-4000-8000-000000000001";
export const SEAM_ID = "5ea30000-0000-4000-8000-000000000001";
export const PART_ID_2 = "22222222-2222-4222-8222-222222222222";
export const ITEM_ID_2 = "33333333-cccc-4ccc-8ccc-cccccccccccc";

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
    customer_type: "b2b",
    contact_person: null,
    requested_terms: null,
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
    bend_table_version_id: null,
    cost_rate_version_id: null,
    lead_time_days: 11,
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
    customer_reference: null,
    contact_person: null,
    shipping: null,
    price_scale: [],
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
    source_file_id: null,
    flat_file_id: null,
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
    assembly_id: null,
    qty_per_assembly: 1,
    material_override: false,
    material_note: null,
    forming: [],
    created_at: "2026-09-25T10:02:00Z",
    ...over,
  };
}

/** A welded assembly of the fixture quote (S235 3 mm box, qty 1). */
export function makeAssemblyRow(over: Partial<AssemblyRow> = {}): AssemblyRow {
  return {
    id: ASSEMBLY_ID,
    quote_id: QUOTE_ID,
    position: 0,
    name: "Heat store box rev 3",
    drawing_ref: "HSB-3",
    qty: 1,
    material_code: "S235",
    thickness_mm: 3,
    notes: null,
    created_at: "2026-09-25T10:03:00Z",
    ...over,
  };
}

/** A continuous 1 250 mm MIG seam on the fixture assembly, marked from PART_ID's edge. */
export function makeSeamRow(over: Partial<AssemblySeamRow> = {}): AssemblySeamRow {
  return {
    id: SEAM_ID,
    assembly_id: ASSEMBLY_ID,
    position: 0,
    label: null,
    part_id: PART_ID,
    entity_ids: ["e1", "e2"],
    points: null,
    length_mm: 1250,
    process: "mig_mag",
    thickness_mm: null,
    seam_type: "continuous",
    stitch_bead_mm: null,
    stitch_pitch_mm: null,
    tack_count: null,
    sides: 1,
    paired_seam_id: null,
    created_at: "2026-09-25T10:04:00Z",
    ...over,
  };
}

/** The seeded company_settings row (placeholders replaced by plausible data; see the migration for the real seed). */
export function makeCompanySettings(over: Partial<CompanySettingsRow> = {}): CompanySettingsRow {
  return {
    id: 1,
    brand: "STRETCHMETAL",
    legal_name: "Alto Design Sp. z o.o.",
    street: "ul. Legionów 59",
    postal_code: "42-200",
    city: "Częstochowa",
    country: "PL",
    phone: "+32 485 48 30 35",
    email: "info@stretchmetal.pl",
    website: "https://stretchmetal.pl",
    nip: "PL5732911703",
    regon: "383390837",
    krs: "0000786996",
    bank_name: "ING Bank Śląski",
    iban_pln: "PL05 1050 1142 1000 0090 3188 9240",
    iban_eur: "PL05 1050 1142 1000 0090 3188 9240",
    swift: "INGBPLPW",
    oss_active: false,
    assembly_margin_pct: 30,
    subcontract_margin_pct: 15,
    updated_by: null,
    updated_at: "2026-09-25T00:00:00Z",
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
  assemblies?: AssemblyRow[];
  seams?: AssemblySeamRow[];
  company?: CompanySettingsRow | null;
};

export function makeBundle(options: BundleOptions = {}): QuoteBundle {
  const priced = options.priced === undefined ? priceFixture() : options.priced;
  const flags = options.flags ?? priced?.flags ?? [];
  // quotes.subtotal_* as the persistence step writes them (quote currency at
  // the stored fx rate), so a bundle is consistent unless a test says otherwise.
  const base = makeQuoteRow(options.quote);
  const fx = Number(base.fx_rate) || 1;
  const subtotals = priced
    ? { subtotal_cost: toQuoteCurrency(priced.subtotalCost, base.currency, fx), subtotal_price: toQuoteCurrency(priced.subtotalPrice, base.currency, fx) }
    : {};
  const quote = makeQuoteRow({ pricing: priced ? toJson(priced) : null, flags: toJson(flags), ...subtotals, ...options.quote });
  const customer = options.customer === null ? null : makeCustomer(options.customer ?? {});
  return {
    quote,
    customer,
    items: options.items ?? [makeItemRow()],
    parts: options.parts ?? [makePartRow()],
    operations: [],
    overrides: options.overrides ?? [],
    rateVersionLabel: RATE_SNAPSHOT_V1.label,
    ratesUpdatedAt: null,
    costRateVersionLabel: null,
    pricing: priced,
    flags,
    weldingOnly: null,
    assemblies: options.assemblies ?? [],
    seams: options.seams ?? [],
    company: options.company ?? null,
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
