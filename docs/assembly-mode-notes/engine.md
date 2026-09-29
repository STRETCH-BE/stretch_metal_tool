# Assembly mode — engine stream notes

File path: /docs/assembly-mode-notes/engine.md

Branch `fix/assembly-mode`, stream **engine** (lib/pricing). Design: `docs/assembly-mode-design.md` §3, §4, §6.

## What was built

| File | Status | What |
|---|---|---|
| `lib/pricing/vat.ts` (+ `vat.test.ts`) | new | `computeVat` — the owner's rule §3.4, EU member set as a constant, `customer.vat_id_missing` amber |
| `lib/pricing/packaging.ts` (+ test) | new | `pickPackaging` (first row in position order whose limits hold, else last), `packedPart`, `packagingEnvelope`, `packagingLine`, `packagingForParts`; gross = net × 1.05 |
| `lib/pricing/shipping.ts` (+ test) | new | `shippingLine`, `pickShippingBand`; manual / table / `shipping.missing` |
| `lib/pricing/forming.ts` (+ test) | new | `assessForming`, `formingFeasibility`, `suggestedStepBendHits` (R90 × 180° → 19), `formingHint`, `formingSuspected`, `rollArcLengthMm` |
| `lib/pricing/assembly.ts` | new | `priceAssemblies`, `partitionItems`, `memberQty`, `nestKey`, `effectiveMemberPart`, `accumulateAssemblyCosts`, `PARTS_AT_COST_EXCLUDED_TYPES` |
| `lib/pricing/scale.ts` | new | `priceScale`, `scaledInput`, `scaleQuantities` |
| `lib/pricing/price-quote.ts` | changed | `priceQuote(input, rates, machines, { costRates, jobRates })`: with `jobRates` → the assembly-mode layer (`priceJobQuote`); without → byte-for-byte the old path |
| `lib/pricing/market.ts` | changed | `MarketPricingOptions.skipPackaging` (assembly mode replaces the rate_general box / pallet line) |
| `lib/pricing/market-rules.ts` | changed | `PACKAGING_ALLOWANCE_PCT = 5` (+ `grossMassKg`), `STEP_BEND_PITCH_MM = 15` — both `[CONFIRM]` |
| `lib/pricing/version.ts` | changed | `PRICING_ENGINE_VERSION = 3` (history line added) |
| `lib/pricing/index.ts` | changed | exports of every new module (+ `JOB_RATE_DEFAULTS`, `rowsToJobRates`, `weldSpeedFor`) |
| `lib/pricing/README.md` | changed | API block, "Assembly mode" section, flag rows (`forming.*`, `assembly.*`, `weld.no_rate_row` for seams, `rates.placeholder`, `customer.vat_id_missing`, `shipping.missing` params), line ids |
| `test/helpers/quote.ts` | changed | `makeAssembly`, `makeSeam`, `makeForming` added (existing signatures untouched) |
| `test/pricing/assembly-regression.test.ts` | new | the heat store box of design §6 (12 tests) |
| `test/pricing/assembly.test.ts` | new | behaviours: members, nest dedupe, set-ups once per job, material flags, seams, forming.suspected, VAT / shipping wiring, legacy path, invalid input (22 tests) |
| `test/pricing/price-scale.test.ts` | new | AlMg3 1.5 mm at [20, 50, 100, 200, 500, 1000] strictly decreasing; loose + assembly scale; no recursion (5 tests) |

Validation (30 Sep 2026): `npx tsc --noEmit | grep -E "^(lib/pricing|test/pricing|test/helpers)"` → empty (the whole tree compiled at the time); `npx eslint lib/pricing test/pricing test/helpers` → clean; `npx vitest run lib/pricing test/pricing` → 24 files, 389 tests passed (315 pre-existing + 74 new); `test/quotes/stale.test.ts` (foreign) still passes with version 3.

## Exported API (exact signatures)

```ts
// lib/pricing/price-quote.ts
priceQuote(input: QuoteInput, rates: RateSnapshot, machines: MachinePark, options: PriceQuoteOptions = {}): PricedQuote
//   options.jobRates: JobRates | null → assembly mode; options.costRates as before

// lib/pricing/assembly.ts
priceAssemblies(input: QuoteInput, ctx: AssemblyPricingContext): AssemblyPricingResult
type AssemblyPricingContext = { rates: RateSnapshot; costRates: RateSnapshot | null; machines: MachinePark; jobRates: JobRates; chargedNests?: ReadonlySet<string> }
type AssemblyPricingResult = { assemblies: PricedAssembly[]; items: PricedItem[]; flags: Flag[]; nests: Set<string>; usesPressBrake: boolean; usesRoll: boolean }
partitionItems(input: Pick<QuoteInput, "items" | "assemblies">): { loose: PricingItem[]; members: PricingItem[]; assemblies: PricingAssembly[]; membersByAssembly: Map<string, PricingItem[]> }
memberQty(assembly: Pick<PricingAssembly, "qty">, item: Pick<PricingItem, "qtyPerAssembly">): number
nestKey(materialCode: string, thicknessMm: number): string            // "S235/3"
effectiveMemberPart(part: PricingPart, item: PricingItem, assembly: PricingAssembly): PricingPart
accumulateAssemblyCosts(map: Partial<Record<OperationType, number>>, assembly: PricedAssembly): void
PARTS_AT_COST_EXCLUDED_TYPES: ReadonlySet<OperationType>              // setup, weld, roll

// lib/pricing/forming.ts
assessForming(ops: readonly FormingOperation[] | null | undefined, ctx: FormingContext): FormingAssessment
type FormingContext = { thicknessMm: number | null; materialCode: string | null; machines: MachinePark; partId: string | null; itemId: string | null; rates?: RateSnapshot | null; jobRates?: Pick<JobRates, "assembly" | "subcontractMarginPct"> | null }
type FormingAssessment = { flags: Flag[]; unresolved: boolean; labourMin: number; subcontractCostEur: number; extraLeadDays: number; usesPressBrake: boolean; usesRoll: boolean; charges: FormingCharge[] }
formingFeasibility(op: FormingOperation, ctx: Pick<FormingContext, "thicknessMm" | "materialCode" | "machines" | "rates">): FormingFeasibility
suggestedStepBendHits(op: Extract<FormingOperation, { kind: "roll" }>): number   // ceil(arc ÷ 15 mm)
rollArcLengthMm(op: Extract<FormingOperation, { kind: "roll" }>): number
formingHint(part: PricingPart): FormingHint | null   // "roll_annotation" | "forming_rolled" | "layer_roll" | "forming_bent" | "layer_bend"
formingSuspected(part: PricingPart, forming: readonly FormingOperation[] | null | undefined = null): boolean

// lib/pricing/packaging.ts
pickPackaging(rates: readonly PackagingRate[], largestSideMm: number, grossKg: number): PackagingRate | null
packedPart(part: PricingPart, item: Pick<PricingItem, "qty">, rates: RateSnapshot): PackedPart
packagingEnvelope(parts: readonly PackedPart[]): PackagingEnvelope       // { largestSideMm, netKg, grossKg, parts }
packagingLine(rate: PackagingRate, envelope: PackagingEnvelope, placeholder: boolean): OperationLine | null
packagingForParts(parts: readonly PackedPart[], rates: readonly PackagingRate[], placeholder: boolean): { line: OperationLine | null; envelope: PackagingEnvelope; rate: PackagingRate | null }

// lib/pricing/shipping.ts
shippingLine(input: ShippingInput | null | undefined, rates: readonly ShippingRate[], computedGrossKg: number, ctx: { customerCountry: string | null; homeCountry: string; placeholder?: boolean }): { line: OperationLine | null; flags: Flag[] }
pickShippingBand(rates: readonly ShippingRate[], countryCode: string, grossKg: number): ShippingRate | null

// lib/pricing/vat.ts
computeVat(input: { customerType: CustomerType | null; customerCountry: string | null; customerVatId: string | null; netTotalEur: number }, rates: Pick<JobRates, "vatRates" | "ossActive" | "homeCountry">): { vat: VatResult; flags: Flag[] } | null
EU_COUNTRY_CODES: ReadonlySet<string>; isEuCountry(code): boolean; hasVatId(id): boolean; normaliseCountry(code): string | null

// lib/pricing/scale.ts
priceScale(input: QuoteInput, priceFn: (input: QuoteInput) => PricedQuote): PriceScale[]
scaledInput(input: QuoteInput, qty: number): QuoteInput
scaleQuantities(priceScale: readonly number[] | null | undefined): number[]

// lib/pricing/market-rules.ts
PACKAGING_ALLOWANCE_PCT = 5; grossMassKg(netKg): number; STEP_BEND_PITCH_MM = 15

// test/helpers/quote.ts
makeAssembly(overrides?: Partial<PricingAssembly>): PricingAssembly       // qty 1, S235 3 mm, no seams
makeSeam(overrides?: Partial<AssemblySeam>): AssemblySeam                 // 1 000 mm continuous MIG, 1 side, not paired
makeForming(overrides): FormingOperation                                  // roll R90 × 180° × 247 by default; { kind: "bend", ... } for a bend op
```

Signature deviations from the task text (all additive): `assessForming`'s ctx also takes `rates` (Rm for the force rule) and `jobRates` (seconds per hit, min/m, subcontract margin — without them no minutes can be priced); `shippingLine` takes a 4th `ctx` argument (the "customer abroad" rule needs the customer's and the home country); `formingSuspected` takes the item's forming ops as an optional 2nd argument (the part alone cannot know them); `priceAssemblies` returns `items` (the members' PricedItems) in addition to the listed fields and accepts `chargedNests`.

## How price-quote.ts wires it (documented decisions)

1. `jobRates` absent → the old code path, unchanged (every pre-existing test passes untouched).
2. Members are removed from the loose input; the mode's pricer runs on loose items only. Market mode: the order charge and the laser set-ups are split over the LOOSE pieces (the 247 model is a loose-part model; members are not 247 pieces).
3. **Laser-nest dedupe rule:** loose lines keep their per-nest `laser_setup` lines (market) — an assembly does not charge `setup_laser_nest` for a nest a loose line already charged (`rateRef.key` of `laser_setup` = `"<material>/<t>"` = the assembly nest key), nor for a nest an earlier assembly charged. Cost mode has no loose laser set-up, so the assembly always charges its nests there.
4. Members' PricedItems: `operations []`, `unitCost` = parts-at-cost per piece, `unitPrice null`, `batchPrice null`, `qty` = assembly.qty × qtyPerAssembly (the stored `item.qty` is ignored/recomputed). Members are **not** added to `subtotalCost` / `subtotalPrice` (the assembly's `batchCost` / `batchPrice` already hold them).
5. Parts at cost = `buildContextOperations` on the cost snapshot with `setup` lines dropped, folded set-ups subtracted, `weld` lines dropped (seams at assembly level) and `roll` lines dropped (forming ops price rolling). Per-bend prices, threads, extras, engraving stay. This is what makes "a plain in-house bend op charges nothing extra: the bend lines already price it" true.
6. `costRates null`: cost mode → the quote's snapshot (the tables are costs); market mode → the market snapshot stands in for cost (assumption; `market.no_cost_version` already warns; a member the market version has no exact laser row for is then refused, e.g. S235 2 mm on v3).
7. Packaging: over every priced loose part (unitPrice ≠ null) + every member; `quoteLines` = the base quote lines minus the old `packaging` line + the table line. Cost mode gets a packaging line too when job rates are present (it never had one before).
8. Shipping: `PricedQuote.shipping`, pass-through (cost = price), in both subtotals and in `totalsByType.shipping`; never inside any margin. VAT on `subtotalPrice` including shipping.
9. `PricedQuote.marginPct`: cost mode keeps the header margin (the pricing rule; the assembly's own margin is on `PricedAssembly.marginPct`); market mode reports the realised margin over everything (0 without a cost version). `inputMarginPct` = the header margin in both.
10. `rates.placeholder` is recounted over every line (items, assemblies, quote lines, shipping); `usesPlaceholderRates` is also true when `JobRates.placeholder`.
11. `forming.suspected` on loose lines is emitted only in assembly mode (job rates given) and only for hints the loose model does not price (`forming_rolled`, `layer_roll`, `forming_bent` without bend lines, `layer_bend` without bend lines). A loose roll ANNOTATION is priced / refused by the existing roll rules, so it is not "suspected". Members: every hint, including a roll annotation (a member's roll annotation is not priced anywhere — forming is an operation there). **Recognised bend lines are deliberately not a hint** (the design lists them): the bend model prices them wherever the part is priced, so flagging every bent part red would block every bent quote; a part marked "bent" WITHOUT recognised bend lines is flagged. Flip: make `formingHint` return `"bend_lines"` when `hasPricedBends` — a one-line change.
12. Price scale: computed after everything else through `priceQuote` itself with the same rates / machines / options; the scaled copies carry `priceScale []`.

## Regression case (design §6) — full breakdown at the seeded placeholders

Market v3 fixture (`test/fixtures/rates/market-247-v3.json`), cost snapshot `RATE_SNAPSHOT_V1` (parts at cost: blank + 25 % scrap × 1.10 €/kg, laser time mode at 70 €/h), `JOB_RATES = JOB_RATE_DEFAULTS`, `MACHINE_PARK` (roll min R200). Assembly qty 1, S235 3 mm, 21 parts (P1, P2, P3, 2×P4, 2×P5, 2×P6, P7, 11×P8), seams 1 250 + 1 250 + 1 260 mm continuous MIG on 2 mm (the neighbour's 1 250.4 mm edge stored as paired — not counted) + one tack seam with 11 tacks; P7 rolled R90 × 180° × 247 → infeasible (R90 < 200) → `step_bend` 19 hits.

| line | type | driver | min | EUR |
|---|---|---|---|---|
| assembly_parts P1 375×375×3 | material | 1 part | — | 5.22 |
| assembly_parts P2 365×365×2 | material | 1 part | — | 3.31 |
| assembly_parts P3 375×247×3 | material | 1 part | — | 3.55 |
| assembly_parts P4 373×247×3 | material | 2 part | — | 7.07 |
| assembly_parts P5 93.5×247×3 | material | 2 part | — | 2.12 |
| assembly_parts P6 80×247×3 | material | 2 part | — | 1.88 |
| assembly_parts P7 285.9×247×2 | material | 1 part | — | 1.85 |
| assembly_parts P8 30×20×3 | material | 11 part | — | 0.91 |
| assembly_fitup (6 min × 21 parts × 1.3) | weld | 163.8 min | 163.80 | 68.25 |
| assembly_tack (60 s × 11 × 1.3) | weld | 14.3 min | 14.30 | 5.96 |
| assembly_weld (3 760 mm ÷ 120 mm/min × 1.3) | weld | 40.7 min | 40.73 | 16.97 |
| assembly_gas_wire (31.3 + 11 arc min × 8 €/h) | weld | 42.3 min | 42.33 | 5.64 |
| assembly_deburr (1.5 min × 21) | finish_deburr | 31.5 min | 31.50 | 13.13 |
| assembly_handling | handling | 10 min | 10.00 | 4.17 |
| step_bend (19 hits × 25 s) | bend | 19 bend | 7.92 | 3.30 |
| setup_laser_nest S235/2 | setup | 1 lot | — | 17.50 |
| setup_laser_nest S235/3 | setup | 1 lot | — | 17.50 |
| setup_press_brake | setup | 1 lot | — | 23.33 |
| setup_weld_fitup | setup | 1 lot | — | 12.50 |
| **unit cost** | | | **268.3** | **214.17** |
| **unit price (÷ 0.7, 30 % on revenue)** | | | | **305.96** |
| packaging (crate: 375 mm side, 15.97 kg gross) | | | | 24.00 |
| shipping FI 30 kg band | | | | 45.00 |
| net total | | | | 374.96 |
| VAT 23 % (b2c_domestic, FI b2c, OSS off) | | | | 86.24 |
| gross | | | | 461.20 |

Labour: fit-up 126 min, tacks 11, welding 31.33, deburr 31.5, handling 10, forming 7.92; `(fit-up + tacks + welding) × 1.3 = 218.8 min = 3.65 h` (the "welding + fit-up ≈ 3.6 h" of the design); `totalMin = 268.3 min = 4.47 h` (adds deburr, handling and the step bend); `arcMin = 42.3`.

**Net price excluding shipping: 305.96 (assembly) + 24.00 (packaging) = €329.96 — inside €270–340.** The assembly line alone is €305.96. No seed change is needed. Note for the owner: the seeded `deburr_min_per_part` and `handling_min_per_assembly` are NOT inside the design's "≈ 3.6 h"; the test therefore asserts the 3.2–4.0 h window on `(fitupMin + tackMin + weldMin) × distortionFactor` and checks that `totalMin` equals that plus deburr + handling + forming (4.47 h). If the owner meant `totalMin` itself to be ≈ 3.6 h, the single seed change that gets there is `fitup_min_per_part` 6 → 4 (fit-up 84 min → weld+fit-up 2.74 h, total 3.56 h, unit price ≈ €274).

Parts at cost per member piece (cost snapshot, €): P1 5.219, P2 3.312, P3 3.555, P4 3.537, P5 1.061, P6 0.942, P7 1.847, P8 0.083. Members' net mass 15.2 kg (rectangles without openings; the design's 11.2 kg comes from the real DXFs), gross 15.97 kg → crate, not carton (the design's "carton for a box" expects the real 11.2 kg × 1.05 = 11.8 kg — still above the 5 kg carton limit; carton_foam holds 15 kg ≤ 600 mm → with the real parts the pick would be **carton_foam €6.50**).

## Assumptions

- `AssemblyLabour.totalMin` = (fit-up + tacks + welding) × distortion + deburr + handling + forming (the type says "after the distortion / handling factor"); `arcMin` = welding + tacks, undistorted.
- `seamLengthMm` = Σ geometric `lengthMm` of counted continuous / stitch seams (tack seams contribute tacks, not length; sides / stitch ratio enter the effective length used for minutes, recorded in `details.effectiveLengthMm`).
- Seam thickness fallback: `seam.thicknessMm ?? assembly.thicknessMm ?? the marked member's ?? the thickest member`; none → the slowest speed of the process (conservative). No speed row for the process → red `weld.no_rate_row` (quote-level, `assemblyId`, `seamId`) and the assembly is unpriceable — there is no dedicated code for it.
- Subcontract `costEur` is per PART piece → × qtyPerAssembly per assembly piece.
- `{ in_house }` on an infeasible operation stays red (physics is not an override); `none_needed` on an operation is ignored.
- A member with a null material / thickness inherits the assembly's; a member WITH its own material is priced as it is and only flagged (mixed / substituted) — the engine never overrides a stated material.
- `assembly.mixed_materials` and `assembly.no_seams` are quote-level flags (partId / itemId null) carrying `assemblyId` in `params` — `Flag` has no assembly field (types frozen).
- `material.substituted` fires for DC01 in an S235 assembly regardless of `materialOverride` (the note must be printed either way); `params.note` = the item's `materialNote` or "".
- RateRef.table for every settings-table line is `"manual"` (closed union), key `assembly_rates/…`, `job_setup_rates/<code>`, `packaging_rates/<code>`, `shipping_rates/<CC>/<maxKg>`, `parts_at_cost/<versionId>`; `values.placeholder = JobRates.placeholder`.
- `assembly_parts` lines have type `material` (their `details` split `materialEur` / `cuttingEur` / `otherEur`); fit-up / tack / weld / gas-wire lines are type `weld`, deburr `finish_deburr`, handling `handling`, step bend `bend`, roll forming `roll`, subcontract `roll` or `bend`, set-ups `setup`.
- VAT: unknown destination row under OSS → the home rate as `b2c_domestic`, no flag (task instruction); the owner may want an amber later. `vat` is null only when type, country AND VAT id are all unknown; a customer without a country → mode `none`.
- Shipping "abroad" = `customerCountry ≠ JobRates.homeCountry`; a domestic customer without a shipping input gets no line and no flag (collection).
- The price scale recomputes the whole quote per quantity (VAT, shipping included) — cheap enough (ms) for the sizes at hand.

## Contract requests (files I do not own)

- None required. Optional, for a later contract pass: `Flag` could carry `assemblyId: string | null` (today it travels in `params.assemblyId`); `PricedAssembly` could carry `extraLeadDays` (today only in the `forming.subcontract` flag params and the `subcontract_forming` line details); a dedicated `FlagCode` for "no weld speed for the seam's process" instead of reusing `weld.no_rate_row`.
- Server stream (`lib/quotes/mapper.ts`, `reprice.ts`): pass `jobRates: await loadJobRates(supabase)` in `PriceQuoteOptions`; build `QuoteInput.assemblies` from `QuoteBundle.assemblies` + `seams` (position order, `pairedSeamId` kept), set `items[].assemblyId / qtyPerAssembly / materialOverride / materialNote / forming` from the item rows, and `customerType / customerCountry / customerVatId / shipping / priceScale` from the customer and quote rows. Members' `unit_price` will be null and their `operations` empty — persist `PricedQuote.assemblies` in the pricing JSON. The laser-nest dedupe relies on the loose lines' `laser_setup` `rateRef.key` (unchanged).
- PDF / UI streams: `PricedAssembly.operations[].label` uses the new `OPERATION_LABELS` keys; `PricedAssembly.flags` and member `PricedItem.flags` carry the assembly / member flags; quote-level assembly flags have `params.assemblyId`.

## Left undone / open

- No `Flag.assemblyId` (see above); no per-row `placeholder` on `JobRates` (the whole set is one boolean, so any confirmed row still counts as placeholder until all are).
- `forming.suspected` treats recognised bend lines as priced (see decision 11); flip if the owner wants every bent part to need an explicit forming operation.
- The v3 market fixture has no S235 2 mm laser row: a quote WITHOUT a cost version cannot price such a member (refused) — expected, but worth knowing when demoing without a cost version.
