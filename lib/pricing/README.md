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
| `bend.hole_crosses_bend` | red | a hole edge crosses the bend line (per bend, aggregated) | `bendId`, `count`, `loopIds` |
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
| `rates.placeholder` | green | any used rate row is still a `[CONFIRM]` placeholder | `count` |

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
