# Assembly mode — server stream notes

File path: /docs/assembly-mode-notes/server.md

Stream **server** of `docs/assembly-mode-design.md`. Files owned and changed:
`lib/quotes/{schema,seams,mapper,queries,reprice,actions}.ts`,
`lib/customers/{schema,actions}.ts`, `test/quotes/{fixtures,fake-supabase,seams.test,schema.test,mapper.test,actions.test,reprice.test,send.test,price-route.test}.ts`,
`test/ui/{customer-actions,customer-schema}.test.ts`. Untouched on purpose:
`lib/parts/actions.ts` (the viewer hand-off calls `addSeamFromPart` from
`lib/quotes/actions.ts`; `saveAnnotations` needs nothing new),
`lib/rates/load.ts` (`loadJobRates` / `loadCompanySettings` were already
there), `lib/quotes/send.ts`, `lib/quotes/create.ts`.

## What was built

### Bundle (`lib/quotes/queries.ts` → `QuoteBundle`)
`loadQuoteBundle` now fills `assemblies` (by quote, position order), `seams`
(for those assemblies, ordered assembly → position) and `company`
(`company_settings` id 1, numeric/boolean columns coerced by
`companyRowToSettings` in the mapper). A database without the migration
(PGRST205 / 42P01) reads `[]` / `null` with a `console.warn`; any other
error throws like every other table. `company_settings` is selected
directly (not through `lib/rates/load`) so the tests that mock the rate
loader keep working. `CustomerOption` gained `customer_type` and
`contact_person` (additive; `listCustomerOptions` selects them).

### Mapper (`lib/quotes/mapper.ts`, pure)
- `buildQuoteInput(source)` maps `assemblies` + `seams` → `QuoteInput.assemblies`
  (`PricingAssembly` with `AssemblySeam[]`, seam `type` from `seam_type`,
  `stitch` from `stitch_bead_mm/pitch` for stitch seams only, `tackCount`
  for tack seams (0 when null), `sides`, `pairedSeamId`), items →
  `assemblyId / qtyPerAssembly / materialOverride / materialNote / forming`
  (`parseForming`), customer → `customerType / customerCountry (upper-cased) /
  customerVatId`, `quote.shipping` → `parseShipping`, `quote.price_scale` →
  `normalisePriceScale` (positive ints, unique, ascending).
- **Member qty rule**: a member's input qty is `assembly.qty × qty_per_assembly`
  whatever `quote_items.qty` holds; an item whose `assembly_id` points at an
  assembly that is not in the quote is priced loose. `memberQtyUpdates(items,
  assemblies)` lists rows whose stored qty disagrees; `repriceQuote` writes
  them back before pricing.
- All new source fields are OPTIONAL (`QuoteInputSource.quote` needs only the
  old four columns, `customer` only `customer_class`): the client preview and
  `test/rates/market-247` compile unchanged and get `assemblies: []`,
  `customerType: null`, `shipping: null`, `priceScale: []`.
- `pricedToPersistence(priced, quote, allItemIds?)`: items the engine did not
  return as a line (members priced inside their assembly, if the engine
  drops them) get `unit_cost 0 / unit_price null / flags []` instead of a
  stale loose price; a refused item keeps `unit_price null` (today's rule —
  null was never turned into 0 and still is not). Without the third
  argument the behaviour is exactly as before.

### Re-price (`lib/quotes/reprice.ts`)
Loads `jobRates` with `loadJobRates(reader)` inside a try/catch
(`loadJobRatesTolerant`): a loader failure is logged and prices WITHOUT job
rates (`null`) rather than failing the save. Passes `{ costRates, jobRates }`
to `priceQuote`. Member qty write-back as above; `bundle.assemblies/seams`
go into the input; `pricedToPersistence` receives every item id.

### Actions (`lib/quotes/actions.ts`, `"use server"`)
All zod-validated (`lib/quotes/schema.ts`), editor + editable checks via
`requireQuoteEditor(quoteId, { editableOnly: true })`, `revalidatePath` of the
quote + list, `repriceQuote` after every change that affects price, audited.

### Customers (`lib/customers/schema.ts`, `actions.ts`)
`customer_type` (`"b2b" | "b2c"`, REQUIRED — a missing/unknown value reports
`required` on the field), `contact_person` (≤ 200), `requested_terms` (≤ 500)
added to `customerSchema` and `CUSTOMER_FIELDS` (form field names = these
snake_case keys). `CustomerFormValues / CustomerFieldErrors / CustomerFormState`
contracts unchanged in shape (the field union grew). `updateCustomer`
additionally audits `customer.type_change` when the type flips.

## Exported API (exact signatures)

```ts
// lib/quotes/schema.ts
export const SEAM_TYPES: readonly ["continuous", "stitch", "tack"];
export const PRICE_SCALE_MAX = 12;
export const formingResolutionSchema, formingOperationSchema, formingInputSchema; // zod
export type FormingOperationInput;                       // op with optional id
export function parseForming(json: Json | null | undefined): FormingOperation[];   // tolerant: bad entries dropped
export function parseFormingResolution(value: unknown): FormingResolution | null;
export const shippingInputSchema; export type ShippingInputValues;
export function parseShipping(json: Json | null | undefined): ShippingInput | null;
export const priceScaleSchema;                            // → number[] sorted unique, ≤ 12, "invalidQty" / "tooLong"
export function normalisePriceScale(values: ReadonlyArray<unknown> | null | undefined): number[];
export const assemblyInputSchema, assemblyUpdateSchema, itemAssemblySchema, itemMaterialOverrideSchema;
export type AssemblyInput = { name: string; drawingRef?: string | null; qty: number; materialCode?: string | null; thicknessMm?: number | null; notes?: string | null };
export type SeamInput = { label?: string | null; partId?: string | null; entityIds?: string[]; points?: { x: number; y: number }[] | null; lengthMm: number; process: WeldProcess; thicknessMm?: number | null; seamType: "continuous" | "stitch" | "tack"; stitchBeadMm?: number | null; stitchPitchMm?: number | null; tackCount?: number | null; sides?: 1 | 2 };
export const seamInputSchema;   // full seam; stitch → bead+pitch required, tack → tackCount required (error "required")
export const seamPatchSchema;   // Partial<SeamInput>, no defaults
export type SeamInputValues;    // z.output<typeof seamInputSchema>
// quoteHeaderSchema / QuoteHeaderInput additionally accept (all optional = keep stored value):
//   customerReference?: string | null; contactPerson?: string | null; shipping?: ShippingInputValues | null; priceScale?: number[]

// lib/quotes/seams.ts (pure)
export function matchSeam(existing: ReadonlyArray<AssemblySeamRow>, candidate: { partId: string | null; entityIds: string[]; lengthMm: number; process: WeldProcess }):
  { kind: "duplicate"; seam: AssemblySeamRow } | { kind: "paired"; seam: AssemblySeamRow } | { kind: "new" };
export function seamLengthTolerance(a: number, b: number): number;         // max(1, 0.5 % of the longer)
export function seamEffectiveLengthMm(seam): number;                        // length × (bead/pitch for stitch) × sides; tack → 0
export function seamTotals(seams: ReadonlyArray<AssemblySeamRow>, assemblyThicknessMm?: number | null):
  { counted: number; paired: number; tackCount: number; lengthMm: number; effectiveLengthMm: number;
    byProcess: { process: WeldProcessDb; thicknessMm: number | null; seams: number; lengthMm: number; effectiveLengthMm: number }[] };
export function seamInputToColumns(input: SeamInputValues): SeamColumns;   // insert/update columns
export function seamRowToInput(row: AssemblySeamRow): SeamInputValues;
export function seamRowToPricingSeam(row: AssemblySeamRow): AssemblySeam;

// lib/quotes/mapper.ts (pure)
export function memberQty(assembly: Pick<AssemblyRow, "qty">, item: Pick<QuoteItemRow, "qty_per_assembly">): number;
export function itemRowToPricingItem(row: QuoteItemRow, assembly?: Pick<AssemblyRow, "id" | "qty"> | null): PricingItem;
export function assemblyRowsToPricing(assemblies: ReadonlyArray<AssemblyRow>, seams: ReadonlyArray<AssemblySeamRow>): PricingAssembly[];
export function memberQtyUpdates(items: ReadonlyArray<QuoteItemRow>, assemblies: ReadonlyArray<AssemblyRow>): { id: string; qty: number }[];
export type QuoteInputSource = { quote: Pick<QuoteRow, "type" | "margin_pct" | "welding_only" | "lead_time_days"> & Partial<Pick<QuoteRow, "shipping" | "price_scale">>;
  customer: (Pick<CustomerRow, "customer_class"> & Partial<Pick<CustomerRow, "customer_type" | "country" | "vat_id">>) | null;
  items: QuoteItemRow[]; parts: PartRow[]; rates: RateSnapshot; assemblies?: ReadonlyArray<AssemblyRow>; seams?: ReadonlyArray<AssemblySeamRow> };
export function buildQuoteInput(source: QuoteInputSource): QuoteInput;
export function companyRowToSettings(row: Record<string, unknown> | null | undefined): CompanySettingsRow | null;
export function pricedToPersistence(priced: PricedQuote, quote: { currency: CurrencyCode; fx_rate: number | string }, allItemIds?: ReadonlyArray<string>): Persistence;

// lib/quotes/actions.ts ("use server")
export type AssemblyActionResult = QuoteActionResult | { ok: true; assemblyId: string };
export type SeamActionResult = { ok: true; seamId: string; pairedSeamId: string | null } | { ok: false; error: QuoteErrorCode; message?: string };
export async function createAssembly(quoteId: string, input: AssemblyInput): Promise<AssemblyActionResult>;           // position = next; audit "assembly.create"
export async function updateAssembly(assemblyId: string, input: Partial<AssemblyInput>): Promise<QuoteActionResult>; // audit "assembly.update"
export async function removeAssembly(assemblyId: string): Promise<QuoteActionResult>;                                // members → loose (assembly_id null, qty_per_assembly 1, qty kept); seams cascade; audit "assembly.remove"
export async function setItemAssembly(itemId: string, input: { assemblyId: string | null; qtyPerAssembly?: number }): Promise<QuoteActionResult>; // in: qty = assembly.qty × qpa; out: loose, qty kept; audit "quote.item.assembly"
export async function setItemMaterialOverride(itemId: string, input: { materialOverride: boolean; materialNote: string | null }): Promise<QuoteActionResult>; // audit "quote.item.material_override"
export async function setItemForming(itemId: string, forming: unknown): Promise<QuoteActionResult>;                 // replaces the list; ids kept / generated; audit "quote.item.forming"
export async function resolveForming(itemId: string, operationId: string, resolution: unknown): Promise<QuoteActionResult>; // "notFound" for an unknown op; audit "forming.resolve"
export async function confirmNoForming(itemId: string): Promise<QuoteActionResult>;                                  // audit "forming.confirm_none"
export async function addSeam(assemblyId: string, input: SeamInput): Promise<SeamActionResult>;                       // never matched; audit "seam.add"
export async function addSeamFromPart(partId: string, input: SeamInput): Promise<SeamActionResult>;                   // "notFound" when the part is not a member; matchSeam applied
export async function updateSeam(seamId: string, input: Partial<SeamInput>): Promise<QuoteActionResult>;              // patch merged over the row, re-validated; audit "seam.update"
export async function removeSeam(seamId: string): Promise<QuoteActionResult>;                                         // unpairs seams paired to it; audit "seam.remove"
export async function unpairSeam(seamId: string): Promise<QuoteActionResult>;                                         // EXTRA: puts a wrongly paired seam back into the count; audit "seam.unpair"
// updateQuoteHeader(quoteId, input: QuoteHeaderInput) — input additionally takes customerReference / contactPerson / shipping / priceScale

// lib/customers/schema.ts
export const CUSTOMER_TYPES: readonly ["b2b", "b2c"];
// customerSchema / CUSTOMER_FIELDS: + customer_type (required), contact_person, requested_terms

// lib/quotes/queries.ts
export type CustomerOption = Pick<CustomerRow, "id" | "name" | "country" | "customer_class" | "email" | "preferred_locale" | "customer_type" | "contact_person">;

// test/quotes/fixtures.ts
export const ASSEMBLY_ID, SEAM_ID, PART_ID_2, ITEM_ID_2;
export function makeAssemblyRow(over?: Partial<AssemblyRow>): AssemblyRow;      // "Heat store box rev 3", S235 3 mm, qty 1
export function makeSeamRow(over?: Partial<AssemblySeamRow>): AssemblySeamRow;  // 1 250 mm continuous MIG from PART_ID's edge ["e1","e2"]
export function makeCompanySettings(over?: Partial<CompanySettingsRow>): CompanySettingsRow;
// makeBundle(options) additionally takes assemblies / seams / company
```

## Decisions and assumptions

- **"Confirmed: no forming needed"** is stored as ONE forming operation whose
  `resolution` is `{ kind: "none_needed" }`, carrying the geometry the drawing
  suggested: the roll annotation's radius / arc angle / axis length as a
  `roll` op; else the bend lines (annotated bends, or the DXF's layer/drawn
  bend lines — triage candidates excluded) as a `bend` op with the count,
  the first angle (90° when unknown) and the longest length; else a `roll`
  op with zeros. Existing forming operations are REPLACED by the
  confirmation ("none needed" contradicts them). Nothing was added to the
  contract; the engine's `formingSuspected()` must treat any op resolved
  `none_needed` as the confirmation.
- **matchSeam** pairs only against counted seams (`paired_seam_id` null) that
  have no partner yet (a joint has two edges), closest length wins; a
  hand-typed seam (`partId` null) never matches. This is a heuristic (a box
  has many equal edges) — hence `unpairSeam`. `addSeam` from the builder is
  never matched (contract); only `addSeamFromPart` is.
- **Seam pattern rules**: `seamInputSchema` requires `stitchBeadMm` +
  `stitchPitchMm` for `stitch` and `tackCount` for `tack` (error `required`);
  the stored columns of the other patterns are nulled on write
  (`seamInputToColumns`). `sides` defaults to 1, `entityIds` to `[]`.
- **Header keep-when-omitted**: `customerReference`, `contactPerson`,
  `shipping`, `priceScale` omitted → column untouched; `""`/`null` → cleared.
  So the current header form (old shape) keeps working without erasing the
  new columns.
- **Price scale** is normalised (dedup + sort) rather than rejected for order;
  non-positive / non-integer values → `invalidQty`; > 12 distinct → `tooLong`.
- **removeAssembly detaches members BEFORE deleting** — the FK
  `quote_items.assembly_id` is ON DELETE CASCADE, so the reverse order would
  delete the member items. The fake Supabase mirrors that cascade so a wrong
  order fails the test.
- **No new `QuoteErrorCode` / `CustomerErrorCode` values** (content/quote.ts
  hard-codes the key unions the UI indexes with): every new failure maps to
  an existing code (`required`, `invalid`, `invalidQty`, `invalidNumber`,
  `tooLong`, `notFound`, `forbidden`, `locked`, `generic`).
- Error code convention kept: integer checks (`tackCount`, `bends`,
  `extraLeadDays`) report `invalidNumber` like the rest of the schema;
  quantities (`qty`, `qtyPerAssembly`, `hits`, price-scale entries)
  `invalidQty`.
- `unit_price` of a refused / unpriced item stays `null` (checked: today's
  persistence never turned it into 0).
- `test/ui/customer-schema.test.ts` was not in the ownership list but tests
  `lib/customers/schema.ts` and sits in my tsc prefix; it had to change for
  the REQUIRED customer type (added `customer_type` to its fixtures + a
  required-type case). Reported under filesChanged.
- Calibration numbers: none introduced; the tests use `JOB_RATES`
  (`test/helpers/rates.ts`) for the loader mock only.

## Contract requests (files I do not own)

- **engine** (`lib/pricing/price-quote.ts` / `assembly.ts` / `forming.ts`):
  (1) `formingSuspected()` must treat an op with `resolution.kind ===
  "none_needed"` as the confirmation (as designed); (2) please keep
  returning a `PricedItem` for members OR omit them — both are handled
  (omitted members are reset to `unit_cost 0 / unit_price null`); if you
  return them, `unitPrice: null` on a member is persisted as null, not 0.
- **ui**: the customer form must post `customer_type` (`b2b`/`b2c`, no
  default), `contact_person`, `requested_terms`; the header form may post
  the old shape (the new columns are kept) — send `customerReference`,
  `contactPerson`, `shipping`, `priceScale` when it edits them. The viewer's
  weld tool calls `addSeamFromPart(partId, SeamInput)` and gets
  `{ ok, seamId, pairedSeamId }`; show `pairedSeamId !== null` as "paired,
  not counted" and offer `unpairSeam(seamId)`.
- **lib/quotes/README.md** (not listed under any owner): the action table
  should list the new actions; left untouched.

## Tests

`npx vitest run test/quotes test/ui` → 19 files, 201 tests pass
(new: `test/quotes/seams.test.ts` 9; additions in schema, mapper, actions,
reprice, customer-actions, customer-schema). `npx tsc --noEmit` filtered to
`lib/quotes|lib/rates|lib/customers|lib/parts|test/quotes|test/ui` → empty.
`npx eslint lib/quotes lib/customers lib/rates test/quotes test/ui` → clean.

## Left undone

- `lib/quotes/README.md` action table (not owned).
- Nothing else from the stream brief; the engine wiring of the new inputs is
  the engine stream's (the mapper/reprice pass them; existing tests run
  against the current engine, which still returns `assemblies: []`).
