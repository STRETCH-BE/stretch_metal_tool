# Assembly mode — pdf stream notes

File path: /docs/assembly-mode-notes/pdf.md

Stream **pdf** of `docs/assembly-mode-design.md` (§3.4, §5). Files owned and
changed: `lib/pdf/{view-model,quote-document,render}.ts(x)`, new
`lib/pdf/company.ts`, `lib/quotes/send-guard.ts`,
`app/api/quotes/[id]/pdf/route.ts`, `content/pdf.ts`, `content/en/pdf.ts`,
`test/pdf/render.test.ts` (+ snapshot), new `test/pdf/helpers.ts`,
`test/quotes/send-guard.test.ts`. Untouched: `lib/site-config.ts` (the merge
helper lives in `lib/pdf/company.ts` instead), `lib/pdf/fonts*.ts`,
`lib/pdf-text.ts`.

## What was built

### Export guards (`lib/quotes/send-guard.ts`)
- `SendGuardInput` now picks `assemblies` and `company` from `QuoteBundle`
  as well (every caller passes a full bundle).
- New reasons, each in `exportBlockReasons()` AND `canSend()`:
  - `no_customer` — no customer attached (kept as is; ALSO an export block,
    design §3.4 "no customer → mode none, PDF export blocked").
  - `customer_missing` — a customer whose `name` or `address` is blank.
  - `customer_type_missing` — `customer_type` is neither `b2b` nor `b2c`
    (a row read before the migration carries null at runtime; checked as
    `unknown`).
  - `company_placeholders` — any field of the merged company profile
    contains `000-000`, `PL00`, `XXXX` or `[CONFIRM]`
    (`lib/pdf/company.ts`). With `bundle.company` null the site-config
    defaults are checked — they carry no marker today, so nothing changes
    for existing quotes.
  - `forming_unresolved` — any RED `forming.not_feasible` /
    `forming.suspected` flag in `bundle.flags` (the engine's truth).
- `canSend` reason order: `status`, customer reasons, `no_customer_email`,
  `no_items` / `not_priced`, `red_flags`, `pending_override`,
  `amber_unconfirmed`, `company_placeholders`, `forming_unresolved`. Every
  pre-existing case keeps its exact reason list.

### PDF route (`app/api/quotes/[id]/pdf/route.ts`)
- Runs `exportBlockReasons(bundle)` for EVERY status (drafts included) and
  answers **422** `{ error: "export_blocked", reasons: SendBlockReason[],
  message }` — `message` is the localized reason list joined with "; "
  (`content.quote.builder.send.reasons`), so the builder's existing toast
  (`pdfFailed: "… {message}"`) already tells the user what to fix.
- New query flag `parts=1|true` → `showAssemblyParts` (the members
  appendix). `ops` unchanged. `lib/routes.ts` was not touched (not owned):
  `quotePdfExport(id, locale, ops)` has no `parts` argument yet.

### Company profile (`lib/pdf/company.ts`, pure, client-safe)
`resolveCompanyProfile(company_settings | null)` merges the row over
`lib/site-config.ts`: a column wins when non-blank after trimming (the
migration seeds most text columns with `''`), `country` upper-cased,
fallback PL. Used by the view model (header block, footer bank / IBAN /
SWIFT, red `confirmNote`) and by the guard (same placeholder rule) — one
truth for "is the company data confirmed".

### View model (`lib/pdf/view-model.ts`)
- Rows: assemblies FIRST (position order), one `PdfPartRow` each
  (`kind: "assembly"`, name, subline "Welded assembly · drawing HSB-3 ·
  parts: 3", material / thickness of the assembly, qty, unit price and
  total from `PricedQuote.assemblies`; unpriceable → "—"; the operation
  line summarises the assembly's own cost lines when `showOperations`);
  then loose items (`kind: "item"`). Members (an `assembly_id` that matches
  an assembly of the bundle) are never rows; an `assembly_id` pointing
  nowhere is a loose row (mirrors the mapper). Positions are renumbered
  over the printed rows.
- `assemblyParts` (only with `showAssemblyParts`): one appendix per
  assembly — part name, material / thickness (the assembly's when the part
  has none), qty per assembly, material note.
- `customerReference` = `quote.customer_reference`; `contactPerson` =
  `quote.contact_person ?? customer.contact_person`; both trimmed, null
  when blank; printed in the meta grid only when set.
- Totals: `packaging` (quote line, as before), NEW `shipping`
  (`PricedQuote.shipping.unitCost`, printed whenever the line exists),
  `net` = `subtotalPrice` (already includes both), NEW `vat: { rateLabel,
  amount, gross } | null` and `netNotice: string | null`:
  rate > 0 → the block (+ `ossNote` as the notice under `b2c_oss`);
  0 % → `reverseChargeNote` / `exportNote` by mode; `vat` null or mode
  `none` (or an unexpected 0 %) → today's `netNotice`. The parts subtotal
  row now also appears when shipping is printed.
- Terms: `payment` = the typed text, else the B2C `prepayment` default
  (B2B without text → nothing, as before); NEW `requestedTerms` for a B2B
  customer with `requested_terms`. Lead time printed ONCE — in the terms;
  the meta grid no longer repeats it (`model.leadTime` stays for tests).
- `priceScale` (`{ tables: [{ subjectId, kind, subject, rows[] }], note }`
  or null): subject = part name (item) / assembly name.
- Loose rows carry `materialNote` (interpolated "Material note: …").
- `PdfViewModelOptions.showAssemblyParts?: boolean` (default false).

### Document (`lib/pdf/quote-document.tsx`)
Same STRETCH rules (hard edges, Archivo, dense tables, red as the only
accent). New: subline + material note under a row, the shipping row, the
VAT row and a large TOTAL GROSS row (the net figure shrinks to 10 pt when
gross is printed), the notice right-aligned under the totals, price-scale
tables (one per subject, heading grouped with the first table so it never
orphans), "Requested terms" line, the members appendix after the terms
(heading + header + first row never split). Section eyebrows of the parts
and welding tables carry `minPresenceAhead` so they do not sit alone at a
page bottom. Rendered and eyeballed (pdfjs + @napi-rs/canvas raster in the
scratchpad): EN/EUR with VAT + scale + appendix (2 pages), PL/PLN B2C,
EN reverse charge.

### Content (`content/pdf.ts` + `content/en/pdf.ts`, parity green)
New keys: `meta.customerReference`, `meta.contactPerson`,
`parts.materialNote`, `assemblies.{kind, drawingRef, partsCount,
appendixHeading, appendixColumns.{position,name,material,thickness,qtyPerAssembly}}`,
`totals.shipping`, `totals.vat.{rate, gross, reverseChargeNote, exportNote,
ossNote}`, `terms.prepayment`, `terms.requestedTerms`,
`priceScale.{heading, columns.{qty,unitPrice,total}, note}`.
`[CONFIRM]`: the OSS wording and the B2C prepayment default.

## Exported API (exact signatures)

```ts
// lib/quotes/send-guard.ts
export type SendGuardInput = Pick<QuoteBundle, "quote" | "customer" | "items" | "flags" | "overrides" | "pricing" | "weldingOnly" | "assemblies" | "company">;
export type ExportGuardInput = Pick<SendGuardInput, "customer" | "company" | "flags">;
export type SendGuardOptions = { requireEmail?: boolean };
export function exportBlockReasons(bundle: ExportGuardInput): SendBlockReason[];   // no_customer | customer_missing | customer_type_missing | company_placeholders | forming_unresolved
export function canSend(bundle: SendGuardInput, options?: SendGuardOptions): SendCheck; // includes every export reason

// lib/pdf/company.ts (pure, client-safe)
export type CompanyProfile = { brand; legalName; street; postalCode; city; country; phone; email; website; nip; regon; krs; bankName; ibanPln; ibanEur; swift: string };
export const COMPANY_PLACEHOLDER_MARKERS: readonly string[];               // ["000-000", "PL00", "XXXX", "[CONFIRM]"]
export function defaultCompanyProfile(): CompanyProfile;                    // lib/site-config.ts values
export function resolveCompanyProfile(company: CompanySettingsRow | null | undefined): CompanyProfile;
export function companyPlaceholderFields(profile: CompanyProfile): (keyof CompanyProfile)[];
export function hasCompanyPlaceholders(profile: CompanyProfile): boolean;
export function companyAddressLines(profile: CompanyProfile, locale: Locale): string[];
export function companyWebLabel(profile: CompanyProfile): string;

// lib/pdf/view-model.ts
export type PdfRowKind = "item" | "assembly";
export type PdfPartRow = { kind: PdfRowKind; position: number; name: string; subline: string | null; material: string; thickness: string; qty: string; unitPrice: string; total: string; thumbnail: PdfThumbnail | null; operations: { label: string; count: string }[]; weldingMoved: boolean; materialNote: string | null };
export type PdfAssemblyPartRow = { position: number; name: string; material: string; thickness: string; qtyPerAssembly: string; materialNote: string | null };
export type PdfAssemblyAppendix = { assemblyId: string; heading: string; rows: PdfAssemblyPartRow[] };
export type PdfPriceScaleRow = { qty: string; unitPrice: string; total: string };
export type PdfPriceScaleTable = { subjectId: string; kind: "item" | "assembly"; subject: string; rows: PdfPriceScaleRow[] };
export type PdfVatBlock = { rateLabel: string; amount: string; gross: string };
export type PdfViewModel = { …as before…; customerReference: string | null; contactPerson: string | null; assemblyParts: PdfAssemblyAppendix[];
  totals: { partsSubtotal: string | null; weldingSubtotal: string | null; packaging: string | null; shipping: string | null; net: string; vat: PdfVatBlock | null; netNotice: string | null };
  priceScale: { tables: PdfPriceScaleTable[]; note: string } | null;
  terms: { validity: string; leadTime: string | null; payment: string | null; requestedTerms: string | null; notes: string | null; generic: string } };
export type PdfViewModelOptions = { locale: Locale; content: Content; showOperations?: boolean; showAssemblyParts?: boolean; preparedBy?: string | null; now?: Date };
export function buildPdfViewModel(bundle: QuoteBundle, options: PdfViewModelOptions): PdfViewModel;

// lib/pdf/render.ts
export type RenderQuotePdfOptions = { locale: Locale; showOperations?: boolean; showAssemblyParts?: boolean; preparedBy?: string | null; now?: Date };
export async function renderQuotePdf(bundle: QuoteBundle, options: RenderQuotePdfOptions): Promise<Buffer>;

// GET /api/quotes/[id]/pdf?locale=pl|en&ops=1&parts=1
//   200 application/pdf | 404 { error: "not_found" } | 422 { error: "export_blocked", reasons, message } | 500 { error: "pdf_failed", message }

// test/pdf/helpers.ts
export function makeAssemblyBundle(options?: AssemblyBundleOptions): QuoteBundle;   // 1 assembly (2 members, one with a material note) + 1 loose item; VAT 23 %, shipping 35 €, optional price scale
export function makePricedAssembly(over?: Partial<PricedAssembly>): PricedAssembly;
export function vatResult(mode: VatMode, ratePct: number, netTotal: number): VatResult;
export function shippingLine(costEur: number): OperationLine;
```

## Decisions and assumptions

- **`no_customer` blocks the export too** (design §3.4). A draft PDF without
  a customer used to render; it now answers 422. Everything else in the
  export set is new data, so pre-existing quotes are affected only when
  their customer lacks a name / address or the customer type is null.
- **`requested_terms` prints for B2B only** (design: "a B2B customer keeps
  editable terms and the customer's requested_terms is printed when set");
  a B2C customer's requested terms are not printed. B2C with a typed
  `payment_terms_text` keeps the typed text (the default applies only when
  it is empty).
- **Assemblies precede loose parts** on the quote (the assembly is the
  product; loose parts are extras). Positions are renumbered over the rows
  printed.
- **Assembly rows print no thumbnail** (empty drawing box, like manual
  parts) — a member's flat pattern would misrepresent the assembly.
- **The net row keeps its rule when VAT is printed**; the gross row carries
  the large figure. 0 % notes are right-aligned under the net total.
- **`b2c_oss`** (rate > 0) prints the block plus the OSS note; a rate of 0 in
  a domestic mode (impossible with the seeded rows) falls back to the net
  notice rather than inventing a note.
- **Price scale subjects** with no entries are skipped; a null entry prints
  "—" (an unpriceable subject at that quantity).
- Members inherit the assembly's material / thickness in the appendix only
  when the part row has none (the engine's `effectiveMemberPart` rule).
- Text tests compare letter-spaced eyebrows whitespace-free (pdfjs returns
  "P A R T S O F …" for tracked uppercase text).
- Snapshot: the four existing page-count snapshots are unchanged (1 page);
  one new snapshot `pages-assembly-en-EUR` = 2 (VAT + scale + appendix).
- Calibration numbers: none introduced; the test helper's 300 € assembly
  price and 35 € shipping are assertion literals, not rates.

## Contract requests (files I do not own)

- **ui / `lib/routes.ts`**: add a `parts` flag to `quotePdfExport(id,
  locale, ops)` (e.g. a fourth `parts?: boolean` → `&parts=1`) and a
  "with assembly parts" checkbox next to "with operations" in the builder's
  export bar, so the appendix is reachable from the UI. Until then only the
  URL exposes it.
- **ui (`components/quote/quote-builder.tsx`)**: the export links already
  surface the 422 `message`; optionally read `body.reasons` and reuse the
  send-blocked list rendering for a consistent look.
- **server (`lib/quotes/send.ts`)**: nothing required — `canSend` already
  carries the export reasons, so the send action is guarded. If the send
  path should also state "export blocked" separately, call
  `exportBlockReasons` there; not needed for correctness.
- **engine**: `PricedQuote.shipping.unitCost` is printed as the shipping
  price (pass-through, per shipping.ts). If a margin is ever applied to
  shipping, expose the price on the line rather than the cost.

## Tests

`npx vitest run test/pdf test/quotes content/parity.test.ts` → 15 files,
190 tests pass (new: 8 export-guard cases in `send-guard.test.ts`, 13
assembly-mode cases in `render.test.ts`). `npx tsc --noEmit` filtered to
`lib/pdf|lib/quotes/send-guard|app/api/quotes|test/pdf|test/quotes/send-guard`
→ empty (the unfiltered run also reported no errors at the time).
`npx eslint` over every owned file → clean.

## Left undone

- UI wiring of `parts=1` (routes + builder checkbox) — not owned.
- Nothing else from the brief.
