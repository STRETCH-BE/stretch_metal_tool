# Assembly mode — design and contracts

File path: /docs/assembly-mode-design.md

Branch `fix/assembly-mode`. This document is the contract every part of the
build codes against. The owner of a file listed under "Ownership" is the
only one who edits it; everything else is read-only for that stream.

## 1. Why

Quote SM-2026-0021-v2 priced one welded S235 box (heat store box rev 3,
375×375×250 mm, 11.2 kg, parts P1–P8) at €679.85 net; a realistic price is
€290–320. Root causes (verified in the code map): per-part-line setup lines
(8 laser + 7 weld setups = 15), every part paying for its own seam (9.55 m
counted for 3.76 m of real weld), the 247 loose-part model applied to parts
of an assembly, mixed grades unnoticed, a rolled part priced flat, eight
part lines on the PDF, pallet packaging for a carton, B2B terms for a
private customer, placeholder company data. A second RFQ needed a price
scale and the customer's inquiry number.

## 2. Data model (migration `20260930100000_assembly_mode.sql`)

### customers
- `customer_type customer_type not null default 'b2b'` — enum `('b2b','b2c')`.
- `contact_person text`, `requested_terms text` (customer's own payment wish, e.g. "30 days net, 2 % within 14 days").

### quotes
- `customer_reference text` (inquiry number, e.g. N260580), `contact_person text` (per quote; defaults from the customer).
- `shipping jsonb` — `ShippingInput` (see §4).
- `price_scale integer[] not null default '{}'` — quantities to quote in addition to the line quantities, e.g. `{20,50,100,200,500,1000}`.

### assemblies (new)
`id, quote_id, position, name, drawing_ref, qty (>0), material_code, thickness_mm, notes, created_at`. RLS like quote_items (select all authenticated, write via `can_edit_quote(quote_id)`).

### quote_items
- `assembly_id uuid null → assemblies` (a member of an assembly; null = loose part).
- `qty_per_assembly integer not null default 1 (>0)` — for members. The order quantity of a member is `assembly.qty × qty_per_assembly`; for members `quote_items.qty` is kept equal to that product by the server (reprice recomputes it).
- `material_override boolean default false` — the member deliberately differs from the assembly material.
- `material_note text` — mandatory when DC01 replaces a requested S235 (printed on the quote).
- `forming jsonb not null default '[]'` — `FormingOperation[]` (see §4).

### assembly_seams (new)
`id, assembly_id, position, label, part_id (nullable), entity_ids text[], points jsonb, length_mm, process weld_process, thickness_mm, seam_type ('continuous'|'stitch'|'tack'), stitch_bead_mm, stitch_pitch_mm, tack_count, sides (1|2), paired_seam_id (self FK), created_at`.
A seam marked from a part edge stores `part_id` + `entity_ids`/`points`. When the matching edge of the NEIGHBOUR part is marked (same assembly, different part, |length difference| ≤ max(1 mm, 0.5 %), same process), it is stored with `paired_seam_id` = the first seam and is NOT counted (`lib/quotes/seams.ts matchSeam`).

### Admin settings tables (non-versioned, admin-edited, RLS select all / write `is_admin()`)
- `company_settings` (single row id = 1): brand, legal_name, street, postal_code, city, country, phone, email, website, nip, regon, krs, bank_name, iban_pln, iban_eur, swift, `oss_active bool`, `assembly_margin_pct` (30), `subcontract_margin_pct` (15). Seeded with the owner's data.
- `vat_rates` (country pk, rate_pct): PL 23, FI 25.5, BE 21, NL 21, DE 19, AT 20, FR 20.
- `packaging_rates` (code pk, name, max_side_mm, max_mass_kg, price_eur, position, placeholder): carton 400/5/2.75, carton_foam 600/15/6.50, crate 1200/60/24.00, pallet 3000/1000/36.78 — the first row in position order whose limits hold; else the last.
- `shipping_rates` (id, country, max_kg, price_eur, carrier, position, placeholder; unique country+max_kg): weight bands per country; the first band of the destination with max_kg ≥ gross kg; no row → shipping must be entered manually.
- `job_setup_rates` (code pk in laser_nest|press_brake|roll|weld_fitup, name, cost_eur, placeholder): laser_nest 17.50, press_brake 23.33, roll 23.33, weld_fitup 12.50.
- `assembly_rates` (single row): labour_rate_eur_h 25, gas_wire_eur_h 8, tack_seconds 60, fitup_min_per_part 6, deburr_min_per_part 1.5, handling_min_per_assembly 10, distortion_factor 1.3, step_bend_seconds_per_hit 25, roll_min_per_m 6.
- `weld_speeds` (id, process, thickness_mm, speed_mm_min, placeholder; unique process+thickness): EFFECTIVE speeds incl. stops and repositioning: mig_mag 1→150, 2→120, 3→100, 4→80, 6→60; tig 1→60, 2→50, 3→40; laser 1→400, 2→300, 3→250; mma 3→60, 6→45. Lookup: rows of the process, smallest thickness ≥ t, else the largest.

All seeded numbers are CALIBRATION PLACEHOLDERS (`placeholder = true`, `-- [CONFIRM]`), tuned so the regression case gives ≈ 3.6 h of welding and fit-up and lands in €270–340 net.

## 3. Pricing rules

### Loose parts
Unchanged: the 247TailorSteel + 10 % market model (laser, material, laser setup per nest, order charge, bends, cost-plus welding …). Packaging now comes from `packaging_rates` (packed size = largest part side, gross mass = net mass + 5 % packaging allowance), shipping from `shipping_rates` or the manual entry, VAT from §3.4.

### Welded assembly (`lib/pricing/assembly.ts`)
Members are NOT priced as loose lines. Per assembly (per piece, `qty` pieces):
1. Parts at cost: for every member, the COST version's material + cutting lines (the `costRates` snapshot, `buildItemOperations` without setups) × qty_per_assembly.
2. Assembly labour (`assembly_rates`): fit-up = fitup_min_per_part × parts per assembly (Σ qty_per_assembly); tacks = tack_seconds × Σ tack_count; welding = Σ over counted seams of effective length ÷ speed(process, thickness) where effective length = length × (bead ÷ pitch for stitch) × sides; deburr = deburr_min_per_part × parts; handling = handling_min_per_assembly; forming = step-bend hits × step_bend_seconds_per_hit, rolling = roll_min_per_m × width. Total minutes × distortion_factor (fit-up, tacks, welding only) → hours × labour_rate_eur_h; arc hours × gas_wire_eur_h on top.
3. Job setups (`job_setup_rates`), charged ONCE PER JOB and spread over the assembly quantity: laser_nest per distinct (material, thickness) nest of the whole quote (shared with loose parts' nests: a nest counted once), press_brake once when any member has a bend or step-bend operation, roll once when any member is rolled in-house, weld_fitup once per assembly type.
4. Subcontracted forming: the manual cost × (1 + subcontract_margin_pct/100), extra lead days reported.
5. Price = cost ÷ (1 − margin) with margin = max(quote margin, company assembly_margin_pct) — at least 30 % on revenue.
6. Cost and margin breakdown returned in `PricedAssembly` (admin-only in the UI).

### Forming (`lib/pricing/forming.ts`)
Operations live on the item (`FormingOperation[]`). Feasibility against the machine park: roll → `RollLimits` (minRadiusMm 200, maxThicknessMm 6, maxWidthMm 3200); bend → `PressBrakeLimits` (bendLengthMm 4420; force from the 3200 kN rule of `feasibility.ts`). Not feasible in-house → red `forming.not_feasible` until a resolution is picked: `step_bend` (hits suggested = ceil(arc length ÷ 15 mm), R90 × 180° → 19; priced as press-brake time) or `subcontract` (supplier, cost, extra lead days). An unresolved infeasible operation makes the item/assembly unpriceable (unitPrice null) and blocks the PDF. A part whose DXF or annotations say forming (annotations.forming rolled/bent, a roll annotation, bend lines, or a `ROLL`/`BEND` layer) but has no forming operation and no explicit `{ kind: "none_needed" }` confirmation → red `forming.suspected`.

### Material consistency
Members inherit `assemblies.material_code/thickness_mm` unless `material_override`. Mixed grades inside an assembly → amber `assembly.mixed_materials`. DC01 where the assembly (or the drawing) says S235 → amber `material.substituted`, and `material_note` is required (printed on the PDF).

### 3.4 VAT (`lib/pricing/vat.ts`)
Inputs: customer country, VAT ID, customer type, `oss_active`, `vat_rates`, home country PL. The owner's rule (29 Sep 2026): the RATE follows the VAT number and the country; the customer type only decides how the PDF presents it.
- no customer → mode `none` (PDF export blocked by the guard).
- country PL (with or without VAT ID) → `pl_domestic`: 23 % (the PL row of `vat_rates`).
- country ≠ PL with a VAT ID → 0 %: `reverse_charge` inside the EU (note "Intra-Community supply – reverse charge / WDT, art. 138 Directive 2006/112/EC"), `export` outside the EU (note "Export – 0 % VAT").
- country ≠ PL without a VAT ID → 23 % (`b2c_domestic`, the PL rate), except a B2C customer in another EU country while OSS is active → `b2c_oss`: the destination rate from `vat_rates` (unknown country → PL rate + amber). A B2B customer abroad without a VAT ID also gets amber `customer.vat_id_missing`.
Result: `{ mode, ratePct, countryCode, netTotal, vatAmount, grossTotal }` on `PricedQuote.vat`. The PDF always prints net, VAT and gross when the rate is above 0 and the 0 % note otherwise; a B2C customer additionally gets the payment terms defaulted to 100 % prepayment against a pro forma, a B2B customer keeps editable terms and the customer's `requested_terms` is printed when set.

### Price scale (`lib/pricing/scale.ts`)
For every quantity in `QuoteInput.priceScale` the quote is re-priced with that quantity on each item / assembly (setups spread over it); `PricedQuote.priceScale` holds `{ subjectId, kind, entries: [{ qty, unitPrice, total }] }` per subject.

## 4. Engine contracts (lib/pricing/types.ts)

See the types `AssemblySeam`, `FormingOperation`, `FormingResolution`, `PricingAssembly`, `PricingItem` (assemblyId, qtyPerAssembly, materialOverride, materialNote, forming), `QuoteInput` (assemblies, customerType, customerCountry, customerVatId, shipping, priceScale), `JobRates` (+ `PriceQuoteOptions.jobRates`), `PricedAssembly`, `VatResult`, `PriceScale`, and the new `FlagCode`s: `forming.not_feasible`, `forming.suspected`, `forming.step_bend`, `forming.subcontract`, `assembly.mixed_materials`, `assembly.no_seams`, `material.substituted`, `customer.vat_id_missing`, `shipping.missing`.

`rowsToJobRates(rows)` (pure, `lib/pricing/job-rates.ts`) maps the DB rows to `JobRates`; `loadJobRates(supabase)` (`lib/rates/load.ts`) reads the seven tables. `JobRates.placeholder` is true when any used row is a placeholder.

## 5. Server, UI, PDF, admin

- Bundle: `QuoteBundle.assemblies: AssemblyRow[]`, `QuoteBundle.seams: AssemblySeamRow[]`, `QuoteBundle.company: CompanySettingsRow | null`.
- Actions: assembly create/update/remove, member add/remove/qty, seam add/update/remove (+ `addSeamFromPart` used by the viewer's weld tool when the part belongs to an assembly, applying `matchSeam`), forming operation set/resolve/confirm-none, header fields (customer_reference, contact_person, shipping, price_scale), customer type/contact/terms.
- Export guards (`lib/quotes/send-guard.ts` + PDF route): `customer_missing` (name or address), `customer_type_missing`, `company_placeholders` (any company setting containing `000-000`, `PL00`, `XXXX`, `[CONFIRM]`), `forming_unresolved`; each with PL/EN copy.
- PDF: an assembly is ONE line (name, drawing reference, material, qty, unit price, total); members only in the optional appendix; shipping as its own line; VAT block per §3.4; customer reference and contact person in the meta grid; price-scale table when `priceScale` is set; company block from `company_settings`; lead time once.
- Admin: pages for company settings, VAT rates, packaging, shipping, job setups, assembly rates, weld speeds (pattern: machines / sheet-metal tables).

## 6. Regression case (test/pricing/assembly-regression.test.ts)

Welded assembly "U-shape heat store box rev 3", qty 1, S235: P1 3 mm 375×375 base; P2 2 mm 365×365 lid (member, no seams); P3 375×247; 2× P4 373×247; 2× P5 93.5×247; 2× P6 80×247; P7 2 mm 285.9×247 rolled to inside R90 over 180° (width 247); 11× P8 30×20 tabs. Seams: 3,760 mm continuous MIG on 2 mm (e.g. 1,250 + 1,250 + 1,260) counted once, plus one tack seam with tack_count 11. Expected: rolling flagged not feasible in-house (R90 < 200) and `step_bend` chosen with 19 hits; setups once per operation (one laser nest for S235 3 mm, one for S235 2 mm, one press brake, one weld_fitup; no roll setup); every seam counted once (the neighbour's edge paired); net price excluding shipping between €270 and €340; welding + fit-up ≈ 3.6 h; the PDF shows one assembly line; a B2C customer in Finland with OSS off → 23 % VAT and a gross total.

## 7. Ownership

| Stream | Owns |
|---|---|
| contracts (done) | migration, `lib/db/types.ts`, `lib/pricing/types.ts`, `lib/quotes/types.ts`, flags (types + content + catalogues), this doc |
| engine | `lib/pricing/{assembly,forming,packaging,shipping,vat,scale,job-rates}.ts`, `market.ts`, `price-quote.ts`, `index.ts`, `README.md`, `lib/pricing/*.test.ts`, `test/pricing/assembly*.test.ts`, `test/helpers/rates.ts` (JOB_RATES fixture) |
| server | `lib/quotes/{mapper,reprice,queries,actions,schema,create,seams}.ts`, `lib/rates/load.ts`, `lib/customers/*`, `lib/parts/actions.ts` (seam hand-off), `test/quotes/*` |
| ui | `components/quote/*`, `components/customers/*`, `components/parts/part-workspace.tsx` (seam hand-off), `content/quote.ts`, `content/en/quote.ts`, `app/(app)/quotes/*` |
| pdf | `lib/pdf/*`, `lib/quotes/send-guard.ts`, `app/api/quotes/[id]/pdf/route.ts`, `content/pdf.ts`, `content/en/pdf.ts`, `test/pdf/*` |
| admin | `lib/admin/settings*.ts`, `components/admin/settings-*.tsx`, `app/(app)/admin/settings/**`, `content/admin.ts`, `content/en/admin.ts`, `content/common.ts`, `content/en/common.ts` (nav), `test/admin/*` |
