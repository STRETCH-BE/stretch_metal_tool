# Assembly mode — UI stream notes

File path: /docs/assembly-mode-notes/ui.md

Stream **ui** of `docs/assembly-mode-design.md` §5, branch `fix/assembly-mode`.
Owned and changed: `components/quote/**`, `components/customers/**`,
`components/parts/{part-workspace,welds-table}.tsx`, `app/(app)/parts/[id]/page.tsx`
(assembly membership props only), `app/(app)/quotes/[id]/page.tsx`,
`app/(app)/customers/[id]/page.tsx`, `content/quote.ts`, `content/en/quote.ts`,
`test/ui/*` (not `customer-actions.test.ts` / `customer-schema.test.ts`).

## What was built

### Quote header (`components/quote/quote-builder.tsx`, `header-state.ts`)
- Quote kind toggle "Part list | Welded assembly" (`.toolbar` / `.tool-btn`,
  `aria-pressed`). UI convenience only: "Welded assembly" reveals the
  assembly panel with "Add assembly"; a quote with ≥ 1 assembly is an
  assembly quote (the "Part list" button is then disabled).
- Customer reference (inquiry number), contact person (defaults from the
  selected customer's `contact_person` when the field is empty or still holds
  the previous customer's default), customer type hint under the customer
  select, lead time unchanged (shown once).
- Shipping editor (`shipping-editor.tsx`): destination country (defaults to
  the customer's), gross mass typed or computed (the engine's packaging /
  shipping line `details.grossKg` is shown), cost manual or "from the carrier
  table" with the resolved band (`pickShippingBand` on the page's JobRates, so
  the label always matches the engine), carrier, extra lead days. Null = no
  shipping (collection).
- Price scale editor (`price-scale-editor.tsx`, `price-scale.ts`): toggle +
  the editable list; enabling an empty list seeds 20/50/100/200/500/1000;
  invalid tokens are a field error and never posted; capped at
  `PRICE_SCALE_MAX`. `PriceScaleTable` renders `PricedQuote.priceScale` per
  subject (part / assembly name) in its own panel.
- All of it is saved with the header through `updateQuoteHeader` (the input
  now always carries `customerReference`, `contactPerson`, `shipping`,
  `priceScale`); the server re-prices as before; the staleness banner is
  unchanged. `shippingInvalid` blocks a save with a manual block without a
  cost.

### Assembly editor (`assembly-editor.tsx`, `assembly-seams-editor.tsx`, `forming-editor.tsx`, `assembly-cost-panel.tsx`, `assembly-view.ts`)
- Per assembly: name, drawing ref, qty, material (choices from the pinned
  rate snapshot, "— per part —" = none), thickness, notes → `updateAssembly`;
  remove (confirm) → `removeAssembly`; "Add assembly" → `createAssembly` with a
  default name "Assembly n", qty 1.
- Members table: part link, pieces per assembly (blur/Enter →
  `setItemAssembly(itemId, { assemblyId, qtyPerAssembly })`), order qty =
  assembly qty × pieces, effective material / thickness (inherited when the
  part has none; "differs" chip when its own grade / thickness differs),
  forming chips + a "Forming" toggle that opens the FormingEditor row, member
  flags (item / part flags from the preview or the bundle), remove from
  assembly (→ loose). Material row (shown when the material differs, an
  override is stored, or DC01 replaces S235): override checkbox + material
  note; the note is mandatory (field error, save disabled) when DC01 replaces
  S235 → `setItemMaterialOverride`.
- "Add parts": a select of the loose items + pieces per assembly →
  `setItemAssembly`. Members never appear in the loose parts table
  (`QuotePartsTable.hiddenItemIds`), but their parts still count as attached.
- Seams: table with label, part (or "by hand"), length, process, thickness
  (or "per assembly"), type (continuous / stitch bead-pitch / tack count),
  sides, counted — a paired seam is greyed "= edge of <part>" + "not counted"
  with "Count separately" (`unpairSeam`); totals row + per-process groups from
  `seamTotals`. One inline form adds (`addSeam`; the success toast says
  "added" or "added as the second edge — not counted" from `pairedSeamId`) or
  edits (`updateSeam`); remove (confirm) → `removeSeam`.
- Forming per member: add roll {insideRadiusMm, angleDeg, widthMm} / bend
  {bends, angleDeg, lengthMm}, edit, remove, "Save forming" →
  `setItemForming`. A `forming.not_feasible` flag matched to a stored op shows
  the translated reason (`{reason}: {value} against the limit {limit}`) and
  two resolutions: step bending (hits prefilled from `suggestedStepBendHits`
  for a roll, the bend count for a bend; editable) and subcontracting
  (supplier, EUR / piece, extra lead days) → `resolveForming`. A
  `forming.suspected` flag shows "Add forming" / "Confirm: no forming needed"
  → `confirmNoForming(itemId)` (the server stores the single `none_needed`
  op with the drawing's geometry — it documents exactly the behaviour the
  brief asked for, so the UI does not build that op itself). Saving a real op
  drops a stored `none_needed` placeholder.
- Cost panel: admins see parts at cost (per member), labour minutes by kind
  (fit-up, tacks, welding, gas + wire, deburr, handling, forming) with EUR,
  setups (once per job, "spread over n assemblies"), subcontracting, unit
  cost, applied margin %, unit price, total, arc minutes, counted seam length;
  everyone else sees only unit price / total. `unitPrice === null` →
  "cannot be priced — resolve the red flags".
- Quote-level assembly flags (`params.assemblyId`) are chips on the card.

### Totals / VAT (`vat-summary.tsx`, `vat-summary-model.ts`)
Under the totals: net, "incl. shipping" line when a shipping line exists,
`VAT {rate}` + amount + gross when `ratePct > 0`; otherwise the mode note
(reverse charge / export / none …); "VAT unknown" note when `pricing.vat` is
null; the placeholder chip when `usesPlaceholderRates`.

### Export guard
The page computes `exportBlockReasons(bundle)` and the builder disables the
PDF PL/EN downloads (rendered as disabled buttons) with the reasons listed
(copy `content.quote.builder.send.reasons`, heading `actions.exportBlocked`).
The builder recomputes it client-side when the prop is missing.

### Customers (`components/customers/*`, `app/(app)/customers/[id]/page.tsx`)
Customer type radio B2B / B2C (required, no default; error copy from
`errors.required`), contact person, requested payment terms (textarea with the
"recorded and printed on B2B quotes" hint), VAT id hint per §3.4. The list
gets a type column (`customerTypeLabel` / `customerTypeSeverity`), the detail
page a type chip in the header. Form field names = the server's
`customer_type`, `contact_person`, `requested_terms`.

### Seam hand-off (`components/parts/welds-table.tsx`, `part-workspace.tsx`, `app/(app)/parts/[id]/page.tsx`, `components/quote/seam-handoff.ts`)
The part page loads the item's assembly (`assemblies` id + name) and its
seams with the page's RLS client (read-only; missing tables / errors → no
membership). The workspace passes `assembly: { id, name, seams } | null`; the
welds panel shows "Member of assembly: <name>" and an "Add as assembly seam"
button per weld → `addSeamFromPart(partId, weldToSeamInput(weld, partId,
thicknessMm))` (entity ids / points / length / process / pattern → seamType,
stitch bead + pitch, sides). States per weld: idle → pending (button disabled,
every other button disabled too) → "added" / "paired with the neighbour's
edge (not counted)" / "already added" (a weld whose entity set — or drawn
points — already exists as a seam of this part). The assembly name is
appended to the part header eyebrow (`quoteNumber · assembly`).

### Preview (`preview.ts`)
`computePreview(bundle, rates, machines, draft, { costRates, jobRates })`
passes the bundle's assemblies + seams, the customer's type / country / VAT id
and the draft's shipping + price scale through `buildQuoteInput`, and the
page's `JobRates` through `PriceQuoteOptions`, so the local preview prices
assemblies, packaging, shipping, VAT and the scale like the server. The 5th
argument still accepts a bare cost snapshot (old callers).

## Exported API (exact signatures)

```ts
// components/quote/header-state.ts
export type ShippingState = { countryCode: string; grossKg: number | null; costEur: number | null; source: "manual" | "table"; carrier: string; extraLeadDays: number };
export type HeaderState = { …as before; customerReference: string; contactPerson: string; shipping: ShippingState | null; priceScaleEnabled: boolean; priceScale: number[] };
export function shippingFromInput(input: ShippingInput | null): ShippingState | null;
export function defaultShippingState(customerCountry: string | null | undefined): ShippingState;
export function shippingToInput(state: ShippingState | null): ShippingInput | null;
export function shippingInvalid(state: ShippingState | null): boolean;
export function effectivePriceScale(header: Pick<HeaderState, "priceScaleEnabled" | "priceScale">): number[];
export function headerToInput(header: HeaderState): QuoteHeaderInput;   // now always includes customerReference, contactPerson, shipping, priceScale

// components/quote/preview.ts
export type QuoteDraft = { …as before; shipping: ShippingInput | null; priceScale: number[] };
export type PreviewOptions = { costRates?: RateSnapshot | null; jobRates?: JobRates | null };
export function computePreview(bundle, rates, machines, draft, options: PreviewOptions | RateSnapshot | null = null): PreviewResult;

// components/quote/price-scale.ts
export const DEFAULT_PRICE_SCALE: readonly number[];                 // [20, 50, 100, 200, 500, 1000]
export function parsePriceScaleText(text: string): { values: number[]; invalid: string[]; truncated: boolean };
export function formatPriceScale(values: readonly number[]): string;
export function samePriceScale(a: readonly number[], b: readonly number[]): boolean;

// components/quote/vat-summary-model.ts
export function vatSummaryModel(pricing: Pick<PricedQuote, "subtotalPrice"> & { shipping?: Pick<OperationLine, "unitCost"> | null; vat?: VatResult | null }): VatSummaryModel;
export function vatSummaryRows(model, copy: VatSummaryCopy, money, percent, interpolate): { rows: VatSummaryRow[]; note: string | null };

// components/quote/seam-handoff.ts
export type SeamHandoffState = "idle" | "pending" | "added" | "paired" | "already";
export function weldToSeamInput(weld: WeldAnnotation, partId: string, thicknessMm: number | null): SeamInput;
export function seamForWeld(weld, partId, seams: ReadonlyArray<AssemblySeamRow>): AssemblySeamRow | null;
export function seamStateForWeld(weld, partId, seams, pendingWeldId: string | null, outcomes: Record<string, SeamHandoffState>): SeamHandoffState;
export function handoffOutcome(result: SeamActionResult-like, existingSeamIds: ReadonlySet<string>): SeamHandoffState | null;

// components/quote/assembly-view.ts
export function memberItems(items, assemblyId): QuoteItemRow[];  looseItems(items, assemblies): QuoteItemRow[];  memberItemIds(items, assemblies): Set<string>;
export function orderQty(assembly, item): number;  memberView(item, part, assembly): MemberView;
export function materialNoteRequired(assemblyMaterial: string | null, memberMaterial: string | null): boolean;   // S235* → DC01*
export function flagsForItem(flags, itemId, partId): Flag[];  flagMatchesOperation(flag, op): boolean;  notFeasibleFlag(flags, op): Flag | null;
export function formingSummary(op, fmt): string;  newFormingId(): string;  groupAssemblyCosts(priced: Pick<PricedAssembly, "operations">): AssemblyCostGroups;

// components/quote/action-runner.ts
export type ActionRunner = <R extends ActionLike>(fn: () => Promise<R>, success: string | ((result: Exclude<R, ActionFailure>) => string)) => void;

// components
QuoteBuilder props + `jobRates?: JobRates | null`, `exportBlock?: SendBlockReason[]`
QuotePartsTable props + `hiddenItemIds?: ReadonlySet<string>`
PartWorkspace props + `assembly?: { id: string; name: string; seams: AssemblySeamRow[] } | null`
WeldsTable({ welds, handoff?: { assemblyName; states; disabled; onAdd } | null })
AssemblyEditor, AssemblySeamsEditor, FormingEditor, AssemblyCostPanel, ShippingEditor, PriceScaleEditor, PriceScaleTable, VatSummary (see file headers)
customerTypeLabel(content, type), customerTypeSeverity(type) from components/customers/customers-table.tsx
```

## Content keys added (PL + EN, parity green)
`builder.header.{kind,kindParts,kindAssembly,kindHelp,customerReference,customerReferenceHelp,contactPerson,contactPersonHelp,customerTypeHint}`,
`builder.actions.exportBlocked`, `builder.shipping.*`, `builder.priceScale.*`, `builder.vat.*` (modes per `VatMode`),
`builder.assembly.{title,add,defaultName,…,fields,members,material,seams,handoff,cost,price}`, `builder.forming.*`
(kinds, fields, resolution, reasons per `lib/pricing/forming.ts`), `builder.audit.actions` (13 new action keys),
`customers.list.columns.customerType`, `customers.form.{customerType,customerTypeHelp,contactPerson,contactPersonHelp,requestedTerms,requestedTermsHelp}`,
`customers.form.vatIdHelp` (reworded per §3.4), `customers.types.{b2b,b2c}`. New code types: `VatModeCode`, `SeamTypeCode`,
`FormingKindCode`, `FormingResolutionCode`, `FormingReasonCode`, `CustomerTypeCode`.

## Assumptions
- Forming flags carry no operation id: a `forming.not_feasible` flag is matched to its operation by kind + geometry numbers (`flagMatchesOperation`). Two identical operations on one item would both show the same reason (harmless).
- "Confirm: no forming needed" calls the server's `confirmNoForming(itemId)` rather than posting a `none_needed` op from the client — the server documents exactly the requested behaviour (one op with the suspected geometry, roll r0/a0/w0 when unknown).
- The computed gross mass shown in the shipping editor is the engine's (`shipping.details.grossKg` when `massSource === "computed"`, else the packaging line's `details.grossKg`); before the first pricing run the editor says "computed after pricing".
- `defaultShippingState(null)` falls back to `"PL"` `// [CONFIRM]`; new roll op defaults R200 × 90° × 0 and the seam form defaults (100 mm MIG continuous, stitch 30/60, 4 tacks) are `// [CONFIRM]` UI conveniences, not rates.
- Members' rows are hidden from the loose table but keep their positions in the reorder list (move up/down still works on the loose rows by absolute index).
- The customer type radio uses the `.checkbox` class (red accent, zero radius) — there was no radio precedent in the design system.
- The kind toggle is local UI state (not persisted): it starts on "Welded assembly" when the quote has assemblies.

## Contract requests (files I do not own)
- **server** — `test/quotes/header-state.test.ts` "maps every header field to the action input": `headerToInput` now always posts `customerReference: null, contactPerson: null, shipping: null, priceScale: []` for an empty header (the builder knows the full header, so omit-to-keep would wrongly keep a cleared reference); please extend the `toEqual` expectation with those four keys (or switch to `toMatchObject`). Every other test in `test/quotes` / `test/ui` is unaffected.
- **engine** (`lib/pricing/forming.ts`): please add `opId: op.id` to the params of `forming.not_feasible` / `forming.step_bend` / `forming.subcontract` so the UI can match a flag to its operation by id instead of geometry (the geometry match works today; no blocker).
- **pdf** — none; `exportBlockReasons` was already exported as designed.
- **admin** (`content/common.ts`) — none needed; `common.units.min` / `common.units.mm` reused.

## Validation
- `npx tsc --noEmit | grep -E "^(components/quote|components/customers|components/parts|app/\(app\)/quotes|app/\(app\)/customers|app/\(app\)/parts|content/quote|content/en/quote|test/ui)"` → empty (the whole tree compiled with 0 errors at the time).
- `npx eslint test/ui components/quote components/customers components/parts "app/(app)/quotes" "app/(app)/customers" "app/(app)/parts" content/quote.ts content/en/quote.ts` → clean.
- `npx vitest run test/ui content` → 14 files, 100 tests pass (new: `test/ui/{header-state-assembly,seam-handoff,price-scale,vat-summary,assembly-view}.test.ts`; `content/parity.test.ts` green).
- Foreign: `test/quotes/header-state.test.ts` (server) fails on the extended `headerToInput` shape — see contract requests.

## Left undone
- No browser run (no dev server in this session): the components are typed against the real actions and content, and the pure logic is unit tested, but the layout at 1440 / 1024 px was not eyeballed.
- The new-quote form (`components/quote/new-quote-form.tsx`) does not offer the kind toggle / assembly fields; assemblies are created on the quote page after the parts are uploaded (the flow the brief describes).
- `lib/quotes/README.md` (unowned) still lists only the old builder components.
