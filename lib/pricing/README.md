# Pricing engine (`lib/pricing`)

Pure, deterministic TypeScript that turns parts + quantities + a rate
snapshot + the machine park into priced operation lines, totals and
feasibility flags. No I/O, no `Date`, no randomness, no rates or machine
limits as constants — everything numeric comes from the `RateSnapshot` /
`MachinePark` passed in (loaded by `lib/rates/load.ts` from the rate
version the quote is pinned to). Money is EUR, unrounded; the UI/PDF
converts and rounds.

```
priceQuote(input, rates, machines)          → PricedQuote
buildItemOperations(part, item, rates, m)   → { operations, flags }
evaluatePartFlags(part, item, rates, m)     → Flag[]
evaluateQuoteFlags(priced)                  → Flag[]      (quote-level)
resolveMarginPct(rates, customerClass, ovr) → number
rowsToRateSnapshot(rows) / rowsToMachinePark(rows)         (DB rows → engine input)
```

Files: `types.ts` (contract), `formulas.ts`, `lookup.ts`, `context.ts`
(per-part resolution shared by rules and lines), `validate.ts` (user
numbers), `bend-checks.ts` (vector math), `finish.ts`, `feasibility.ts`,
`operations.ts`, `price-quote.ts`, `snapshot.ts` (zod), `labels.ts`,
`errors.ts`, `index.ts`. Test fixtures for everyone: `test/helpers/rates.ts`
(`RATE_SNAPSHOT_V1`, `MACHINE_PARK`, `rateSnapshotToRows`,
`machineParkToRows`), `test/helpers/geometry.ts`
(`makeRectPartGeometry`, `makeAnnotations`), `test/helpers/parts.ts`
(`make200164Like`, `make200005Like`), `test/helpers/quote.ts`.

## Formulas (units in brackets)

| Operation | Formula |
|---|---|
| Laser, mode `time` | `cutTimeMin = adjustedCutLengthM / speedMMin + pierces × pierceS / 60`; `cost = cutTimeMin / 60 × machineRateEurH + pierces × pricePerPierce` |
| Laser, mode `per_m` (in-house per-metre rows and every supplier row) | `cost = cutLengthM × pricePerM + pierces × pricePerPierce` — the **plain** cut length: Step 9 attaches the slow-contour factor to mode `time` only (it models our machine's feed rate; a per-metre tariff does not vary with it). `details.slowFactorApplied` records which branch priced the line |
| Adjusted cut length (mode `time` only) | `cutLengthM + slowLengthM × (slowContourFactor − 1)` — slow contours are interior closed loops with bbox max side < `laser.minContourMm ?? 10 × t` (spec §8.1); their length is part of the cut length and is *weighted*, not added |
| Material (sheet) | `blankMassKg = (bboxW + 2·blankMarginMm) × (bboxH + 2·blankMarginMm) × t × density × 1e-9`; `cost = blankMassKg × (1 + scrapPct/100) × pricePerKg(band)` |
| Material (tube) | `metres × pricePerMTube` from the tube extra |
| Bending | per bend `pricePerBend(t class, length class)`; one `setup` line `setupPerPartType / qty` per part with bends. Force `F [N] = 1.42 × Rm [N/mm²] × t² × L / V`, `V = bend.dieVMm ?? dieFactor × t`; min flange `V/2 + r + 2 mm`; hole edge ≥ `2.5 × t` |
| Rolling | `setup / qty + pricePerM(t class, radius class) × axisLengthM` |
| Welding | `effectiveMm = lengthMm × (bead/pitch if stitch, capped at 1) × sides`; `cost = effectiveMm × pricePerMm`; one `setup` line `setup / qty` per process used |
| Threads / features | `count × priceEach` (threads only when confirmed in `annotations.threads`) |
| Machining | `minutes / 60 × machiningRateEurH` |
| Powder (`unit m2`) | `netAreaM2 × 2 × price + maskingMin / 60 × labourRateEurH`, batch minimum |
| Zinc (`unit kg`) | `netMassKg × price` (+ masking), batch minimum |
| Deburr (`unit m`) | `cutLengthM × price` (+ masking), batch minimum |
| Finish `unit each` | `price` per part (+ masking), batch minimum |
| Engraving | `engraveLengthM × price` from rate_finish code `engrave` (unit `m`) |
| Tube cutting | `pricePerMCut × cutLengthM + handlingPerPart + setup / qty` |
| Batch minimum | when `unitCost × qty < minimum` the unit cost becomes `minimum / qty` (green `finish.minimum_applied`) |
| Setup share | `setup / qty`, recorded in `OperationLine.setupShare` |
| Price | `unitPrice = unitCost / (1 − margin/100)`; `markupPct = margin / (1 − margin)`; batch = unit × qty |
| Welding-only | seams `effectiveMm × qty × pricePerMm`, one setup per process, handling `weldHandlingPerPart × partsCount`, then the largest `minOrder` of the processes used tops up the COST with a `weld_min_order` line |

Formula constants that live in `formulas.ts` (all quoted from the spec):
`1.42` air-bending factor, `2.5 × t` hole distance, `10 × t` slow contour,
`2 mm` flange margin, `2` powder-coated faces. Machine capacities and every
price live only in the tables.

## Lookup fallback order (`lookup.ts`)

- **material** — code, case-insensitive. **price band** — first band with
  `maxThicknessMm ≥ t`, else the thickest band, else none (red).
- **laser** — (1) `t ≤` flat-laser limit for the family **and** an in-house
  row at exactly `(material, t)` → in-house; (2) else the supplier row
  (`inHouse = false`) at exactly `(material, t)` → `subcontract_cutting`
  (amber `laser.subcontract` when `t` is allowed, `laser.thickness_over_limit`
  when it is not); (3) **only beyond our laser** (over the limit, or no flat
  laser in the park): the next **thicker** supplier row for the material →
  subcontract, `exactThickness = false` and `rowThicknessMm` in the flag —
  never a thinner row (it would under-price), and no distance cap because
  the next row up is the next step of the supplier's ladder; (4) else none →
  red `laser.no_rate_row`. An **allowed** thickness with no row at exactly
  `t` is therefore red, not priced from a plate tariff: the in-house table
  must carry every stock gauge (seed.sql does). Rows that cannot price (time
  without speed, per_m without €/m) are skipped. `reason` is `in_house |
  over_limit | supplier_row | no_machine | none`.
- **bend / roll** — rows of the smallest thickness class `≥ t`, then the
  smallest length (radius) class `≥` the bend length (radius); none → null
  (red `*.no_rate_row`, line omitted).
- **weld** — rows of the process, smallest bead `≥` bead, else the largest;
  no rows → null (red).
- **tube laser** — rows of the family, smallest wall `≥` wall; none → null.
- **thread** — size normalised (`M10x1` = `m10 × 1`). **feature / finish** —
  code, case-insensitive. **machineOf(park, kind)** — first of the kind.

## Flag catalogue

Severity: **red** blocks sending (`overridable = false`), **amber** needs a
confirmation or approved override (`overridable = true`), **green** is
information. `partId`/`itemId` are set on part flags, null on quote flags.
Messages live in `content/flags.ts` and interpolate `params`.

| Code | Sev. | When | params |
|---|---|---|---|
| `geometry.manual` | amber | `part.source = "manual"` | — |
| `geometry.triage_amber` | amber | triage `amber_forming_unknown` (until `annotations.forming` set) or `amber_bend_candidates` (until every candidate entity has a role) | `state`, `count` |
| `geometry.units_unconfirmed` | amber | triage `amber_units` and `!annotations.unitsConfirmed` | `state` |
| `geometry.triage_red` | red | triage `red_*` | `state` |
| `geometry.no_material` | red | no material code, or code not in the snapshot | `code` |
| `geometry.no_thickness` | red | no thickness on the part or geometry | — |
| `laser.thickness_over_limit` | amber | `t >` flat-laser limit of the family; cut priced from a supplier row ("subcontract — above 12.7 mm") | `limitMm`, `thicknessMm`, `family`, `rowThicknessMm`, `supplier` |
| `laser.subcontract` | amber | allowed thickness but only a supplier row prices it (or no flat laser in the park) | `thicknessMm`, `rowThicknessMm`, `supplier`, `reason` |
| `laser.no_rate_row` | red | no usable in-house or supplier row | `materialCode`, `thicknessMm`, `limitMm`, `family`, `reason` |
| `laser.blank_exceeds_bed` | red | in-house cut and the blank does not fit `(bed − 2·edgeMargin)` in either orientation | `blankLengthMm`, `blankWidthMm`, `bedLengthMm`, `bedWidthMm`, `edgeMarginMm`, `machine` |
| `laser.slow_contours` | green | slow contours present **and** the factor applied, i.e. the priced row is mode `time` (a per-metre row prices the plain length, so no info) | `count`, `factor`, `lengthMm`, `thresholdMm` |
| `material.no_price` | red | material has no price band | `code`, `thicknessMm` |
| `material.mass_handling` | green | net part mass `> handlingMassLimitKg` | `massKg`, `limitKg`, `surchargeEur` |
| `bend.force_over_limit` | red | `F > forceKN × 1000` | `bendId`, `forceKN`, `limitKN`, `lengthMm`, `thicknessMm`, `dieVMm`, `rmNmm2` |
| `bend.length_over_limit` | red | bend length `> bendLengthMm` | `bendId`, `lengthMm`, `limitMm` |
| `sheet.bend_deduction_unverified` | amber | STEP sheet part: a bend unfolded with a DIN 6935 allowance (table row or formula), not a test bend | `count`, `source`, `allowanceMm` |
| `sheet.masking_not_priced` | amber | paint-mask recesses / split faces in the model (no masking rate yet) | `count`, `areaMm2`, `confirmed` |
| `sheet.hardware_mismatch` | amber | drawing parts list quantity ≠ hardware detected in the model | `item`, `drawingQty`, `modelQty` |
| `sheet.revision_mismatch` | amber | revision letter of the file name ≠ latest row of the drawing's revision table | `fileRevision`, `drawingRevision` |
| `sheet.not_sheet_metal` | amber | STEP file without a sheet body (machined / solid part) | `bodies` |
| `sheet.service_unavailable` | amber | external geometry service down, built-in analysis used | — |
| `dfm.relief_too_narrow` | amber | bend relief / slit narrower than max(kerf, t); carries the proposed fix | `count`, `widthMm`, `minMm`, `proposedWidthMm`, `proposedDepthMm`, `reliefs`, `entityIds` |
| `dfm.hole_near_bend` | amber | hole edge closer than `2t + r` to a bend line (STEP sheet parts; replaces `bend.hole_near_bend` there) | `bendId`, `count`, `distanceMm`, `minMm`, `loopIds` |
| `dfm.flange_too_short` | amber | flange outside dimension < smallest `min_flange_mm` of a die with `v_mm ≥ 6t` (replaces `bend.short_flange` on STEP sheet parts) | `bendId`, `flangeMm`, `minMm`, `vMm` |
| `dfm.bend_collision` | amber | two same-direction bends: no straight punch ≥ W + 10 mm and no gooseneck with throat ≥ min(legs) | `bendA`, `bendB`, `widthMm`, `legMm`, `punchMm`, `thicknessMm` |
| `dfm.laser_cannot_make` | amber | countersinks (`what = countersink`), blind pockets that are not stud seats (`pocket`), modelled threads (`thread`) | `what`, `count`, `sizeMm`, `topMm`, `depthMm` |
| `dfm.flat_mass_mismatch` | amber | flat net volume × (1 ± 2 %) does not contain the model's body volume | `flatMm3`, `solidMm3`, `deltaPct`, `thicknessMm` |
| `dfm.open_contour` | red | flat pattern without a closed outline | — |
| `dfm.overlapping_cuts` | red | two cut loops intersect | `count` |
| `bend.hole_crosses_bend` | red | a hole edge crosses the bend line (per bend, aggregated; circles by centre/radius, other holes by their loop polygon) | `bendId`, `count`, `loopIds` |
| `bend.hole_near_bend` | amber | hole edge `< 2.5 × t` from the bend line (per bend, nearest distance) | `bendId`, `count`, `distanceMm`, `minMm`, `loopIds` |
| `bend.short_flange` | amber | smaller flange (outline extent or distance to a parallel bend) `< V/2 + r + 2` | `bendId`, `flangeMm`, `minMm`, `dieVMm`, `radiusMm` |
| `bend.no_rate_row` | red | no bend row for `(t, length)` — line omitted, so it must block sending (an override would ship the bend at 0 €) | `bendId`, `thicknessMm`, `lengthMm` |
| `roll.radius_too_small` | red | `radius < minRadiusMm` | `radiusMm`, `minRadiusMm` |
| `roll.axis_too_long` | red | `axisLength > maxWidthMm` | `axisLengthMm`, `maxWidthMm` |
| `roll.thickness_over_limit` | red | `t > maxThicknessMm` ("cannot roll in-house — subcontract") | `thicknessMm`, `maxThicknessMm` |
| `roll.no_rate_row` | red | no roll row — line omitted, so it must block sending | `thicknessMm`, `radiusMm` |
| `weld.no_rate_row` | red | no weld row for the process (part seams: `weldId`; welding-only seams: `seamId`) | `weldId`/`seamId`, `process`, `beadMm` |
| `weld.min_order_applied` | green | welding-only total topped up to the minimum order | `minOrder`, `shortfall`, `totalBefore` |
| `tube.over_limit` | red | tube extra beyond the tube laser: `what` = `length`, `wall` (lower of the two manufacturer values), `envelope`, `circumscribed`, `kg_per_m`, `raw_weight` (the last four only when the optional fields are given) | `index`, `profileFamily`, `what`, `value`, `limit`, `family` |
| `tube.no_rate_row` | red | no tube row for `(family, wall)` | `index`, `profileFamily`, `wallMm` |
| `thread.no_rate_row` | red | confirmed thread size without a row | `size`, `count` |
| `feature.no_rate_row` | red | feature extra without a row | `code`, `index` |
| `finish.no_rate_row` | red | finish extra without a row, or engraving without an `engrave` row | `code`, `index` |
| `finish.minimum_applied` | green | batch minimum raised the unit cost | `code`, `minimum`, `batchCost`, `batchBefore`, `index` |
| `finish.part_too_small` | amber | market mode: a finish (deburr / edge_round / deburr_one_side) is not available for the part — the bbox is below the rate's `min_part_mm` rule; no charge, the part keeps its price | `code`, `widthMm`, `heightMm`, `minimum`, `family` |
| `finish.not_for_family` | amber | market mode: the finish's `min_part_mm` rule names no family of the part; no charge | `code`, `family`, `rule` |
| `market.no_benchmark_rate` | red | market mode: no `rate_laser` row with exactly this material and thickness, no material band at exactly this thickness, a material code the version does not list, a thread size with no `price_by_thickness` entry at this thickness / material, or a feature outside its `material_codes` / thickness range — the part is REFUSED (`unitPrice = null`, no lines) | `what` (`laser` / `material` / `thread M6` / `feature csk_m6`), `materialCode`, `thicknessMm` (+ `size`, `count`, `code`, `reason`) |
| `market.not_benchmarked` | red | market mode: an operation the version has no rows for — `bending` (no `rate_bend` row for exactly this thickness listing the material NOR a mild-steel row at that thickness — see `market.bend_rate_from_steel`; also a part marked bent with 0 bend lines), `rolling`, `welding` (no `rate_weld` row AND no cost version to price it cost-plus — see `market.cost_plus`; also welding-only quotes), `tube`, `feature <code>` (no row), `finish <code>` (no row, or outside `material_codes` / thickness range), `hot_dip (> 10 kg)` (quote level: net mass above `limits.maxOrderNetKg`) — the part is REFUSED | `operation` (+ `count`, `longestMm`, `code`, `index`, `reason`, `massKg`, `limitKg`) |
| `market.leadtime_not_offered` | red | market mode, quote level: the promised lead time is shorter than the shortest `rate_leadtime` tier (`reason = rate_leadtime`) or than the largest `min_lead_time_days` of the quote's finishes (`reason` = the finish codes) — every part is refused | `workingDays`, `minDays`, `reason` |
| `market.subcontract` | amber | market mode: the exact laser row has `in_house = false` — priced from that row, the supplier text is shown | `materialCode`, `thicknessMm`, `supplier` |
| `market.manual_price` | amber | market mode: a user-typed line (machining minutes, "other" lump sum, handling) is in the price as typed | `what`, `minutes` / `amount`, `index` |
| `market.bend_too_long` | red | market mode: the longest bend line exceeds every `rate_bend.length_class_mm` for the material / thickness (the press brake) — the part is REFUSED | `longestMm`, `limitMm`, `count`, `materialCode`, `thicknessMm` |
| `market.extrapolated_rate` | amber | market mode: bends longer than the row's `benchmarked_max_length_mm` are priced with the `price_per_bend_per_m` extension — check before sending | `operation`, `count`, `longestMm`, `benchmarkedMaxMm`, `pricePerM` |
| `market.bend_rate_from_steel` | amber | market mode: no `rate_bend` row lists the part's material at its thickness, so the bends are priced from the same-thickness row that lists a mild-steel material, × the family factor (`family_multipliers[family]` of that row, else of any other row of the version, else 1; `BEND_FALLBACK_APPLY_FAMILY_FACTOR = false` → 1) on `setup_per_bend_line_eur`, `price_per_bend` and `price_per_bend_per_m` — never on `setup_per_part_type`; not benchmarked, check before sending | `thicknessMm`, `factor`, `family`, `materialCode`, `count` |
| `market.cost_plus` | amber | market mode: an operation the version has no rows for (welding, part seams or the welding-only block) priced from the COST version's lines × 1 ÷ (1 − the quote's margin) instead of being refused; the lines carry `source = cost_plus`, the cost version, the margin and `costEur` — check before sending | `operation`, `marginPct`, `count` |
| `market.finish_implied` | green | market mode: a coating that includes edge breaking (powder, zinc) dropped a deburring option on the same line — nothing charged for it | `code`, `by`, `index` |
| `market.margin_below_default` | red | market mode: 1 − cost ÷ price is below the version's `default_margin_pct` (0 in the benchmark versions → only a negative margin) | `marginPct`, `minPct`, `price`, `cost` |
| `market.no_cost_version` | amber | market mode priced without a cost version — no margin could be computed | — |
| `rates.placeholder` | green | any used rate row is still a `[CONFIRM]` placeholder | `count` |

## Market mode (`market.ts`, `market-rules.ts`, `eligibility.ts`)

`rate_general.pricing_mode = 'market'` means the version's tables are benchmarked SELLING
prices (247TailorSteel / Laserhub standard tier × 1.10; "market-247+10% v3 (28 Sep 2026)").
`priceQuote()` then delegates to `priceMarketQuote()`. Nothing is added on top, and whatever
the version does not benchmark is REFUSED (red flag, `unitPrice = null`, no lines) — never
approximated. `eligibility.ts` decides which row prices an option and why one does not
(material lists, thickness ranges, finish variants by material family, thread prices by
thickness, the exact bend row); the forms use the same functions to grey out options.

| Line | Rule |
|---|---|
| material | net mass (`netAreaMm2 × t × density`) × €/kg of the band whose `max_thickness_mm` equals t exactly — no blank rectangle, no scrap; no band at t → refused |
| laser_cut / subcontract_cutting | the `rate_laser` row with exactly this material and thickness (`per_m`, not a placeholder; `lookup.ts findExactLaserRate`, no nearest thickness, no time-mode row): cut length × `price_per_m` + pierces × `price_per_pierce`, plain length (no slow-contour factor); `in_house = false` → priced the same, amber `market.subcontract` |
| setup (`laser_setup`) | `rate_laser.setup_eur` once per distinct (material, thickness) in the quote, split over the PIECES (Σ qty) of that group's priceable lines |
| order (`order_charge`) | `rate_general.order_charge_eur` split over all pieces of the quote's priceable lines |
| setup (`bend_setup`) + setup (`bend_line_setup`) + bend | the `rate_bend` row with exactly the part thickness whose `material_codes` holds the material (length class = the longest bend the row prices at all, the 4 400 mm press brake): `setup_per_part_type ÷ qty` + `n × setup_per_bend_line_eur × f ÷ qty` + Σ over bend lines of `(price_per_bend + price_per_bend_per_m × max(0, L − 0.2 m)) × f` per piece, `f = family_multipliers[family]` (1 when absent), n = bend lines, each bend with its own length; angle irrelevant; no row listing the material → the row of the same thickness (± 0.001 mm) whose `material_codes` holds a `mild_steel` material of the version (`eligibility.ts resolveBendRateForMaterial`), `f` = that row's `family_multipliers[family]`, else the factor of any other `rate_bend` row of the version, else 1 (`BEND_FALLBACK_APPLY_FAMILY_FACTOR = false` → 1), amber `market.bend_rate_from_steel`, the line's `rateRef.values` / `details` carry `rateBendId` and `source = steel_fallback`; no steel row at that thickness either → refused (no nearest thickness, no interpolation); a bend longer than every length class → red `market.bend_too_long`; longer than `benchmarked_max_length_mm` → priced, amber `market.extrapolated_rate` |
| setup (`thread_setup`) + thread | confirmed threads: the `rate_thread` row of the size, `setup_per_line_eur ÷ qty` + count × the `price_by_thickness` entry at exactly the part thickness (`material_codes` must hold the material); no entry → refused |
| setup (`feature_setup`) + feature | a feature extra with a `rate_feature` row: `setup_per_line_eur ÷ qty` + count × `price_each`, only within `material_codes` and `min/max_thickness_mm`; else refused |
| setup (`finish_setup`) + finish line | a finish extra: the row by code, or its material variant (`deburr` → `deburr_nonferrous` for aluminium / stainless); eligible within `material_codes` and the thickness range (else refused); available when `min_part_mm` names the part's family and the bbox meets a listed size (else amber, no charge). Per piece: `setup_per_line_eur ÷ qty` + `price_per_part_eur` + units × `price`, units = cut length (m), net area × 2 (m2, both sides), net mass (kg), 1 (part / each). `tier_multiplier_applies = false` (certificates) keeps the lines outside the lead-time multiplier |
| finish implied | a coating that includes edge breaking (`powder`, `zinc`) drops `deburr` / `deburr_one_side` on the same line with green `market.finish_implied` |
| engrave | the `engrave` rate's price per part when selected as an extra or when the geometry carries engraving |
| machining / other / handling | typed by the user, priced as typed (`machining_rate_eur_h`), amber `market.manual_price` |
| leadtime (`lead_time`) | per part: (multiplier − 1) × Σ its tiered lines; the multiplier is the `rate_leadtime` tier with the LARGEST working_days ≤ the promised lead time (steps: 11 → 1.00, 7–10 → 1.12, 4–6 → 1.75); shorter than the shortest tier, or shorter than the largest `min_lead_time_days` of the quote's finishes (powder / zinc 19, hot-dip 22) → red `market.leadtime_not_offered`, every part refused |
| packaging (quote level, `quoteLines`) | once per quote, outside the lead-time multiplier: box when every priceable part fits 600 mm and the total net mass ≤ 5 kg (`PACKAGING_BOX_*` constants [CONFIRM]), else pallet |
| finish_minimum (quote level, `quoteLines`) | per finish with `minimum > 0`: the amounts its lines charge (after the multiplier) are summed per quote (`minimum_scope = order`) or per distinct colour of the finish (`colour`, powder RAL); below the minimum the difference is one top-up line. Hot-dip (price 0, minimum 330.78) is therefore a flat per-quote amount; above `limits.maxOrderNetKg` it is refused at quote level instead |
| rolls, tubes | only when the version has rows for them (the cost-mode builders); with empty tables → red `market.not_benchmarked {operation}` |
| welds | the version's `rate_weld` rows like cost mode (`weldLines`); NO rows → cost-plus: the cost version's weld lines (`options.costRates`, every seam needs a row for its process there) × 1 ÷ (1 − the quote's `marginPct`), amber `market.cost_plus`; the lead-time multiplier applies like any line; no cost version, or a seam process without a cost row → red `market.not_benchmarked welding`. The welding-only block follows the same rule at quote level (its lines mapped the same way, `price = cost ÷ (1 − m)`) |

Pieces = Σ qty over the priceable lines (a refused part is not in the order), so quantity
discounts fall out of the set-up / order-charge / per-line splits and there is no other
quantity logic. The cost-mode `*.no_rate_row`, `laser.subcontract`,
`laser.thickness_over_limit`, `laser.slow_contours`, `material.no_price` and
`finish.minimum_applied` flags are replaced by the market flags above; geometry,
bend-geometry and bed-size flags still apply.

No margin is added: `unitPrice = Σ lines`. `unitCost` / `subtotalCost` come from
pricing the SAME input with the cost version (`options.costRates`, the machine-hour
model); `marginPct = 1 − cost ÷ price`, red `market.margin_below_default` below the
market version's `default_margin_pct`, amber `market.no_cost_version` without a cost
version. `totalsByType` carries the market price and the cost version's cost per
bucket. `PricedQuote.pricingMode`, `costRateVersionId`, `leadTimeDays`,
`leadTimeMultiplier` and `quoteLines` record all of this, and `inputMarginPct` keeps
the quote's own margin (the one the cost-plus lines used) next to the realised
`marginPct`, so a stored snapshot can be compared with the header it came from
(`lib/quotes/shared.ts` `isPricingStale`). `quote_items.unit_price` is nullable for
refused parts; the send guard blocks any quote with a red flag.

Acceptance: `test/pricing/market-v2.test.ts` (E1–E8 on the v2 fixture),
`test/pricing/market-v3.test.ts` (F/B/C/P/Z/K/D on the v3 fixture, one check per rule 14–24)
and `test/rates/market-247.test.ts` (E9: the 38 SMT parts of SM-2026-0004 on v2 and v3).

## Operation lines

`OperationLine.id` is `${itemId}:${kind}` (`:laser`, `:subcontract`,
`:material`, `:bend:${bendId}`, `:bend-setup`, `:roll`, `:weld:${weldId}`,
`:weld-setup:${process}`, `:thread:${SIZE}`, `:feature:${i}`,
`:machining:${i}`, `:finish:${i}`, `:tube:${i}`, `:tube-material:${i}`,
`:other:${i}`, `:handling:${i}`, `:engrave`; welding-only:
`welding:${seamId}`, `welding-setup:${process}`, `welding-handling`,
`welding-min-order`). `label` is a key from `OPERATION_LABELS` for
generated lines, or free text (rate row name, thread size, the user's own
"other" label). `driverQty`/`driverUnit`: laser time → `min`, per-metre →
`m`, material → `kg`, bend → `bend`, roll/tube/deburr/engrave → `m`, weld →
`mm`, threads/features → `each`, machining → `min`, powder → `m2`, setup →
`lot`, handling → `part`. `rateRef` snapshots the row (`table`, `key`,
`values` incl. `placeholder`); `details` carries UI numbers (cut time,
force N, blank, masking …). Setup: bend/weld setups are their own `setup`
lines; roll and tube keep the setup inside `unitCost` with `setupShare`
saying how much. `totalsByType` puts every `setupShare × qty` into the
`setup` bucket, so Σ buckets = `subtotalCost`.

A line whose rate row is missing is omitted and a **red** `*.no_rate_row`
flag is raised — for every operation, bend and roll included — so nothing
ships silently free, not even through an approved override.

## Input validation (`validate.ts`)

The formulas guard their own arithmetic, but a user-typed number that is
copied straight into a line never reached a formula. `buildPartContext`
therefore runs `validatePricingItem` (qty > 0 with code `invalid_qty`;
`scrapPct` null or ≥ 0; every extra: `minutes`, `count` (integer),
`maskingMinutes`, `wallMm`, `cutLengthMm`, `metres`, `pricePerMTube`,
`envelopeMm`, `circumscribedMm`, `kgPerM`, `unitCost` finite and ≥ 0) and
`validatePartAnnotations` (weld `lengthMm`/`beadMm` ≥ 0, `sides` 1|2,
stitch bead ≥ 0 and pitch > 0; bend coordinates/length/angle finite,
`radiusMm`/`dieVMm` ≥ 0 when given; roll radius/axis/width ≥ 0, cone radii
≥ 0) before any line or flag is built; `priceQuote` runs
`validateWeldingOnly` (partsCount integer ≥ 0, seams as welds, qty > 0) on
the welding-only block. A failure throws `PricingError("invalid_input")`
with `details` `{ itemId | partId | seamId, index?, type?, field, value }`
(NaN/±Infinity as strings). Both `priceQuote` and `evaluatePartFlags`
throw — a UI preview must validate its form before calling, or catch
`isPricingError`. Negative "other"/"handling" lines are rejected on
purpose: a discount belongs in the margin, not in a cost line that would
then be marked up.

## Adding an operation type

1. Add the rate table row shape to `types.ts` (`RateSnapshot`) and the DB
   row to `lib/db/types.ts` + a migration; map it in `snapshot.ts`
   (`num()` for numerics, zod for JSON/enums) and query it in
   `lib/rates/load.ts`.
2. Add a `find…Rate` lookup in `lookup.ts` and document its fallback order
   in the header comment.
3. Add the formula to `formulas.ts` with a unit test.
4. Add the `OperationType`, a `FlagCode` (`x.no_rate_row` at least), and if
   the user adds it by hand an `ExtraOperation` variant.
5. Build the line in `operations.ts` (id, label key in `labels.ts`,
   `rateRef`, `details`, `setupShare`) and the rule in `feasibility.ts`.
6. Add the flag messages to `content/flags.ts` and `content/en/flags.ts`,
   the label to `content/quote.ts`, and rows to `supabase/seed.sql` with
   `-- [CONFIRM]`.
7. Extend `test/helpers/rates.ts` and write the scenario test in
   `test/pricing/`.
