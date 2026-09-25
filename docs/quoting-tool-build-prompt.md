# Build the StretchMetal quoting tool

## Mission

Build a production-ready internal web application for **StretchMetal** (metal fabrication unit of the Belgian Stretchgroup, Częstochowa, Poland) that turns a customer's DXF flat pattern — plus an optional PDF drawing — into a priced quote for laser cutting, material, bending, rolling, welding, threads, machining and finishing. Sales staff upload files, confirm or mark operations on a drawing viewer, set quantities and send a branded quote PDF. All prices come from admin-only, versioned rate tables; a salesperson can never edit a formula. The app lives at **quote.stretchmetal.pl**, on Vercel + Supabase, bilingual **Polish + English**, in the STRETCH industrial design identity.

The full product brief is `quoting-tool-spec.md` (same folder as this prompt). This prompt is the implementation order; where the two differ, this prompt wins. Create the project in the current empty directory.

## Step 1 — Study the reference codebases before writing any code

Sibling repos should exist next to this directory. Explore them first and reuse their patterns aggressively:

**`../stretch-sufit` — architecture donor.** Next.js 15 + React 19 + TypeScript + Tailwind CSS v4. Mirror `lib/site-config.ts`, `lib/i18n-routes.ts`, `lib/email.ts` (Microsoft Graph sender — port for sending quotes later), `components/ui/*`, the header-comment discipline on every file, the README standard, and the `npm` scripts (`dev`, `build`, `start`, `lint`, `typecheck`, plus `test`).

**`../stretchmetal` (the website built from `claude-code-build-prompt.md`) — design donor.** Reuse its `app/globals.css` `@theme` tokens, Archivo font setup (`wdth 125` for display), hairline-grid pattern, hard-edged buttons, eyebrow pattern and `components/ui/*` verbatim where possible. If it is absent, take the tokens from `../stretch_website/src/app/globals.css` or from the design section of `claude-code-build-prompt.md`.

If a repo is missing, proceed anyway — this prompt contains everything essential.

## Step 2 — Product decisions (fixed)

- Roles: `admin` (edits rate tables, machines, feasibility rules, users, margin policy; approves overrides), `sales` (uploads, marks operations, sets quantities, creates and sends quotes, requests overrides), `viewer` (read-only).
- Languages: PL and EN, per-user preference stored in the profile (admin's default EN, sales default PL). Same typed-content pattern as the website: `content/` (PL) and `content/en/`. No hardcoded copy in components.
- Currencies: PLN and EUR. Default per customer country: Poland → PLN, everything else → EUR; changeable per quote. Every quote stores its currency and the exchange rate used. Rate tables are kept in EUR.
- Quote numbering `SM-YYYY-NNNN`, versions `-v2`, `-v3`. Validity default 30 days. Statuses: `draft → pending_override → sent → won | lost`.
- Quote types: `fabrication` (parts × quantities × operations) and `welding_only` (customer-supplied parts; seams marked on an uploaded drawing or listed manually; priced per mm plus handling, setup and a minimum order).
- No quote can be sent with a red feasibility flag. Amber flags need a confirmation or an override request with a note; the admin approves or rejects; a quote with a pending override cannot be sent. Everything is audit-logged.
- Prices are computed **server-side** by pure, unit-tested functions; the client shows a live preview by calling the same shared pure functions on the geometry + rate snapshot it received. Server result is the source of truth stored on the quote.
- Every quote stores the geometry snapshot, annotations and the rate-table version it was priced with, so reopening an old quote shows the old price.

## Step 3 — Stack and project setup

- Next.js 15 (App Router) + React 19 + TypeScript (strict) + Tailwind CSS v4, identical tooling to `stretch-sufit`, plus **Vitest** for unit tests.
- **Supabase**: Postgres (migrations in `supabase/migrations/*.sql`, applied with the Supabase CLI), Auth (email + password, magic link optional), Storage (private bucket `quote-files`, signed URLs only). Row-level security by role on every table. Ship `supabase/seed.sql` with the machine park, materials and placeholder rate tables from Steps 8–9.
- **Geometry engine in TypeScript** (`lib/geometry/`), using `dxf-parser` for parsing and own code for healing, loop building, measurement and classification. Put it behind a `GeometryEngine` interface so a Python/ezdxf service can replace it later without touching the app. Runs in a Node route handler (`app/api/geometry/route.ts`), results cached by SHA-256 of the file.
- **AI pre-fill** (optional, env-gated by `ANTHROPIC_API_KEY`; no-op without it): sends PDF text (extracted with `pdfjs-dist`) and, when available, a rendered page image to the Claude API and gets back a JSON suggestion object (bends, angles, threads, finish, quantity, material, thickness). Suggestions are shown as amber and never auto-applied.
- Quote PDF with `@react-pdf/renderer` (server route), branded per Step 4.
- Env vars (document all in `env.example`): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (optional), `MS_GRAPH_*` + `QUOTE_FROM_ADDRESS` (optional, for sending), `EXCHANGE_RATE_EUR_PLN_DEFAULT`.
- `README.md` to the `stretch-sufit` standard: quick start with Supabase local dev, migrations, seeding an admin user, env table, project structure, "adding an operation type" and "adding a rate table" how-tos, deploy checklist for Vercel + custom domain `quote.stretchmetal.pl`.

## Step 4 — Design system

Copy the STRETCH identity exactly as specified in `claude-code-build-prompt.md` Step 4: the `@theme` tokens (`--color-red #e00000`, `--color-black #0a0a0a`, `--color-surface #f4f3f1`, borders, muted text), Archivo variable font with `wdth 125` on display headings and eyebrows, **zero border radius**, no gradients, hairline grids, hard-edged uppercase buttons with the red `→`, red as a signal only.

Application-specific rules:

- Dense, table-first layouts; 13–14 px body in tables; numbers right-aligned, tabular figures (`font-variant-numeric: tabular-nums`).
- The drawing viewer is a dark canvas (`--color-black`) with light geometry; layer colours: cut white, holes `--color-on-dark-soft`, bend up red `#e00000`, bend down `#ff1a1a` dashed, weld seams yellow `#ffd400`, engraving grey, ignored entities 25 % opacity. Selected entity: 3 px stroke. Hover: 2 px.
- Status chips are square: green/amber/red flags as `▮` blocks with uppercase labels, never rounded pills.
- Mobile is secondary (tablet in the workshop is the smallest target, 1024 px); desktop 1440 px is the primary layout.

## Step 5 — Data model (Supabase, RLS on every table)

```
profiles(id ← auth.users, email, full_name, role enum(admin,sales,viewer), locale enum(pl,en))
customers(id, name, vat_id, country, address, email, phone, customer_class, notes)
quotes(id, number, version, type enum(fabrication,welding_only), status, customer_id, currency, fx_rate, margin_pct,
       validity_days, lead_time_text, payment_terms_text, rate_version_id, geometry_locked bool,
       subtotal_cost, subtotal_price, created_by, created_at, sent_at)
quote_items(id, quote_id, part_id, position, qty, unit_cost, unit_price, notes)
parts(id, quote_id, name, source enum(dxf,pdf,step,manual,welding_drawing), file_id, file_hash,
      material_code, thickness_mm, geometry jsonb, annotations jsonb, triage jsonb, thumbnail_path)
operations(id, quote_item_id, type, driver_qty numeric, driver_unit, rate_ref jsonb, unit_cost, notes, auto bool)
files(id, storage_path, original_name, mime, size, sha256, uploaded_by)
rate_versions(id, label, created_by, created_at, active bool)
rate_laser(rate_version_id, material_code, thickness_mm, mode enum(time,per_m), speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house bool, supplier)
rate_tube_laser(rate_version_id, profile_family, wall_mm, price_per_m_cut, handling_per_part, setup)
materials(code, name, density_kg_m3, rm_n_mm2, price_per_kg jsonb by thickness band, sheet_formats jsonb, scrap_pct_default)
rate_bend(rate_version_id, thickness_mm, length_class_mm, price_per_bend, setup_per_part_type)
rate_roll(rate_version_id, thickness_mm, radius_class_mm, price_per_m, setup)
rate_weld(rate_version_id, process enum(mig_mag,tig,laser,mma), bead_mm, price_per_mm, setup, min_order)
rate_thread(rate_version_id, size, price_each)
rate_feature(rate_version_id, code, name, price_each)
rate_finish(rate_version_id, code, name, unit enum(m2,kg,m,each), price, minimum)
rate_general(rate_version_id, machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h, default_margin_pct, blank_margin_mm, slow_contour_factor)
machines(code, name, kind enum(flat_laser,tube_laser,press_brake,roll,weld), limits jsonb)
overrides(id, quote_id, part_id, rule_code, requested_by, note, status enum(pending,approved,rejected), decided_by, decided_at)
audit_log(id, actor, action, entity, entity_id, before jsonb, after jsonb, at)
```

Rate rows are immutable per `rate_version`; editing creates a new version and marks it active. Quotes reference the version they were priced with.

## Step 6 — Geometry engine (`lib/geometry/`)

Implement as pure functions with unit tests. Pipeline for a DXF:

1. **Parse** with `dxf-parser`: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE (with bulges), SPLINE (flatten to ≤ 0.05 mm chord error), ELLIPSE (flatten), INSERT (explode blocks with transform). Record layer, linetype, colour per entity. Read `$INSUNITS` (4 = mm, 1 = inch → convert, missing → flag), `$EXTMIN/$EXTMAX`.
2. **Normalise**: drop POINT, TEXT, MTEXT, DIMENSION, HATCH, zero-length entities; keep a list of what was dropped for the triage report.
3. **Heal**: snap endpoints within `tol` (default 0.01 mm, configurable up to 0.5 mm in the UI), remove exact duplicates and fully overlapping collinear segments, report counts.
4. **Build loops**: chain segments by endpoints into closed loops and open chains. Compute loop area (shoelace on flattened points), perimeter, bbox.
5. **Classify**: outer contour = closed loop with the largest area; interior loops = closed loops inside it (holes); open chains inside = candidates (bend / engrave / weld); closed loops outside = other parts (multi-part file) or frames (rectangles enclosing everything → frame); anything else outside = noise.
6. **Layer conventions** (case-insensitive, matched before geometry heuristics):
   - bend up: `IV_BEND`, `BEND`, `BEND_UP`, `BEND LINES`, `BENDLINES`, `BEND-UP`, `BENDUP`
   - bend down: `IV_BEND_DOWN`, `BEND_DOWN`, `BEND-DOWN`, `BENDDOWN`
   - ignore: `IV_TANGENT`, `IV_ARC_CENTERS`, `IV_FEATURE_PROFILES`, `IV_FEATURE_PROFILES_DOWN`, `IV_UNCONSUMED_SKETCHES`, `DEFPOINTS`, `DIM*`, `TEXT*`, `FRAME`, `TITLE*`
   - engrave: `ENGRAVE`, `MARK`, `ETCH`, `IV_ENGRAVE`
   - weld: `WELD`, `WELD_SEAM`
   - cut: `IV_OUTER_PROFILE`, `IV_INTERIOR_PROFILES`, `CUT`, `0` (default)
   Keep the list in `lib/geometry/layer-conventions.ts`, editable by the admin in a later phase.
7. **Measure** per part: `cutLengthMm` (outer + holes), `pierces` (1 + holes), `bbox`, `blank` (bbox + 2 × blank margin), `netAreaMm2` (outer area − hole areas), `massKg` (net area × thickness × density), `holes[]` (diameter, centre; circles and near-circular loops), `bendLines[]` (layer, length, endpoints, up/down), `smallestContourMm`, `slowContours` (interior loops whose bbox max side < 10 × thickness).
8. **Thread suggestion**: a hole whose diameter matches an ISO minor diameter (D1 = d − 1.0825·P) or a tap-drill size within ±0.05 mm becomes a suggested thread. Table: M3 2.459/2.5, M4 3.242/3.3, M5 4.134/4.2, M6 4.917/5.0, M8 6.647/6.8, M10 8.376/8.5, M10×1 8.917/9.0, M12 10.106/10.2, M12×1.5 10.376/10.5, M16 13.835/14.0, M20 17.294/17.5.
9. **Triage state**: `green` (named bend layers or no interior open lines and PDF/name gives no forming hint), `amber_bend_candidates`, `amber_forming_unknown`, `amber_units`, `red_drawing_sheet` (DIMENSION/TEXT count high, several separated view clusters, or `$EXTMAX` inconsistent with 1:1), `red_no_closed_contour`. Each state carries the human message from `content/` in PL/EN.
10. **Annotated DXF export**: write the healed geometry back with `dxf-writer`-style output on layers `CUT`, `HOLES`, `BEND_UP`, `BEND_DOWN`, `WELD`, `ENGRAVE`, `IGNORE`.

**Fixtures and expected results** (put the two customer DXFs in `test/fixtures/` — the owner supplies them from the OneDrive folder `200009_A - výkresy pre výpalky`; both are Inventor AC1018 flat patterns in mm):

- `200005.dxf`, thickness 15, S355: bbox X −42.0…458.0, Y 0…220 → 500 × 220 mm; outer contour 16 LINE + 8 ARC = 1 418.1 mm; 25 interior CIRCLEs = 806.4 mm; total cut 2 224.5 mm; pierces 26; hole diameters 6.647 ×8, 8.917 ×6, 10 ×4, 13 ×6, 32 ×1; suggested threads M8 ×8 and M10×1 ×6; net area 101 824.9 mm²; mass 11.99 kg; bend lines 0; layer `IV_FEATURE_PROFILES_DOWN` (12 LINE, 12 ARC, 2 CIRCLE) and 47 POINTs on `IV_ARC_CENTERS` ignored; triage green.
- `200164.dxf`, thickness 2, DC01: bbox X −338.907…215.397, Y −60…0 → 554.3 × 60 mm; outer 4 LINE + 2 ARC (R5) = 1 224.3 mm; 32 CIRCLEs (30 × Ø5.5 + 2 × Ø8.5) = 571.8 mm; total cut 1 796.1 mm; pierces 33; bend lines 4 × 60 mm: `IV_BEND` at x = 156.926 (up), `IV_BEND_DOWN` at x = −1.131, 39.355, 98.356 (down); 8 `IV_TANGENT` lines ignored; net area 32 421.3 mm²; mass 0.509 kg; triage green.

Tolerance for the assertions: ±0.2 mm on lengths, ±0.005 kg on mass, exact on counts. Also add synthetic fixtures generated in the test itself: a rectangle with a gap of 0.005 mm (must heal), a duplicated line (must dedupe), an inch-unit file (must flag), a file with two separate parts (must split), a DIMENSION-heavy sheet (must be red).

## Step 7 — File intake and triage UI

- Upload page: drag-and-drop for `.dxf .pdf .step .stp` (multiple), 25 MB per file, DWG rejected with the message "save as DXF" and a link to the export guide. Files go to Supabase Storage (private), a `files` row is created, geometry runs, the part appears with its thumbnail and triage chips.
- Triage panel per part: state chip, healing report ("joined 3 gaps, removed 2 duplicates, flattened 1 spline"), dropped-entity summary, unit confirmation, the amber questions as one-click answers ("These 4 lines: Bend / Ignore / Cut"), "Is this part bent or rolled?" prompt, and the red-state explanation with actions ("Pick the view that is the flat part", "Enter as quick part").
- Export guide page (`/guide`) in PL/EN: Inventor, SolidWorks, Fusion 360, AutoCAD, "save DWG as DXF", the recognised layer names, a downloadable example DXF (generate it in the repo from the layer convention).
- PDF companion: when a PDF is uploaded with the same base name as a DXF (e.g. `200005.pdf` with `200005.dxf`) it is attached to that part automatically; its text is extracted and, with the AI key present, the suggestion object is produced and shown as amber chips (thickness, material, bends and angles, threads, finish, quantity). Without the key, show the extracted text in a side panel so the user can read it.
- Quick part form: L × W × thickness, material, number of holes, number of bends (length, angle), rolled (radius, axis length) → creates a `manual` part with the same geometry object shape.

## Step 8 — Viewer and editor (`components/viewer/`)

SVG-based, React, no heavy CAD library.

- Pan (drag / space+drag), zoom (wheel, buttons, fit), grid with mm ticks, coordinates readout, layer toggles, entity hit-testing with a 6 px tolerance, selection (click, shift-click, lasso).
- **Tag tool**: selected entities → Cut / Bend up / Bend down / Weld / Engrave / Ignore. Bend tags open a small form: angle (default 90°), radius (default = thickness), direction.
- **Draw bend line**: two clicks with snapping to endpoints, midpoints, and perpendicular projection onto the nearest edge; line drawn in bend colour; length and position are computed; angle typed.
- **Weld seam tool**: click a chain of entities or two points; form: process (MIG/MAG, TIG, laser, MMA stick), bead mm, full or stitch (bead length, pitch), sides (1/2). Effective length = length × bead/pitch for stitch, × sides.
- **Rolling**: part-level dialog — radius or diameter, axis (X/Y), arc angle; if the outer contour is an annular sector (two concentric arcs + two radial lines) prefill cone data.
- **Clean-up**: "keep largest closed contour and its holes", delete selection, mark selection ignored, join within tolerance, mirror, split into parts.
- **Calibrate units**: click two points, type the real distance → scale factor applied and recorded in annotations.
- Annotations are stored as JSON on the part (`annotations.entities[id].role`, `annotations.bends[]`, `annotations.welds[]`, `annotations.roll`, `annotations.scale`), keyed to stable entity ids (hash of geometry) so a re-upload of the same file restores them.
- Export annotated DXF button (Step 6.10).

## Step 9 — Operations and pricing engine (`lib/pricing/`)

Pure, deterministic, unit-tested functions: `priceQuote(quote, parts, annotations, rates, machines) → { items, operations, flags, totals }`. Never read rates from anywhere but the passed snapshot.

Formulas (all money in EUR, converted at the quote fx rate for display):

- **Laser cutting** (mode `time`): `cutTimeMin = cutLengthM / speed + pierces × pierceS / 60`, where slow contours have their length multiplied by `slow_contour_factor` (default 1.5); `cost = cutTimeMin / 60 × machine_rate + pierces × price_per_pierce`. Mode `per_m`: `cost = cutLengthM × price_per_m + pierces × price_per_pierce`. Thickness/material row missing or `in_house = false` → the operation becomes `subcontract_cutting` priced with the supplier row and flagged.
- **Material**: `blankMassKg = blankL × blankW × t × density × 1e-9`; `cost = blankMassKg × (1 + scrap) × price_per_kg(thickness band)`. Tubes: `metres × price_per_m`.
- **Bending**: per bend `price_per_bend(t, length class)`; plus `setup_per_part_type / qty`. Force check: `F = 1.42 × Rm × t² × L / V` with `V = 8 × t` unless the user picks a die; flag red when `F > 3 200 000 N` or `L > 4420 mm`; amber when a hole edge is closer than `2.5 × t` to a bend line or a flange is shorter than `V/2 + r + 2 mm`; red when a hole crosses a bend line.
- **Rolling**: `setup / qty + price_per_m(t, radius class) × axisLengthM`; red when `radius < 200 mm`, `axisLength > 3200 mm` or `t > 6 mm` (→ subcontract).
- **Welding**: per seam `effectiveLengthMm × price_per_mm(process, bead) × sides` + `setup / qty`; welding-only quotes add `handling_per_part` and apply `min_order`.
- **Threads / features**: `count × price_each`.
- **Machining**: `minutes / 60 × machining_rate`.
- **Finishing**: powder coat `netAreaM2 × 2 × price_per_m2 + masking minutes × labour_rate`, with minimum; zinc `massKg × price_per_kg`, with minimum; deburr `cutLengthM × price_per_m`.
- **Unit cost** = Σ operations; **unit price** = `unitCost / (1 − margin)` (margin is on price; show the equivalent markup); **batch** = unit × qty; totals per operation type; rounding to 0.01 in display only.

**Machine limits** come from the `machines` table seeded in `seed.sql`, never from constants in code (all confirmed by the owner, 25 Sep 2026):

- `flat_laser` — TRUMPF, TruFiber 12001 (12 kW): bed 3000 × 1500 mm, Z 120 mm; max thickness mild steel 12.7, stainless 12.7, aluminium 6, brass 6, copper 6 mm.
- `tube_laser` — TRUMPF, 12 kW: round ≤ Ø273 mm; rectangular ≤ 254 mm side / 290 mm circumscribed; raw and finished length ≤ 6500 mm (6.5 m loader and unloader); ≤ 40 kg/m; raw weight ≤ 260 kg; wall thickness limits stored as two values per material (mild steel 14/10, stainless 12.5/8, aluminium 12.5/8, copper 5/5, brass 5/5 mm) with the lower value used for the feasibility check until the admin edits the row.
- `press_brake` — 3200 kN, bending length 4420 mm, 3680 mm between columns, 615 mm open height, all V-dies.
- `roll` — width ≤ 3200 mm, radius ≥ 200 mm, thickness ≤ 6 mm.
- `weld` — processes `mig_mag`, `tig`, `laser`, `mma`.

Seed rate tables with **placeholder values marked `[CONFIRM]`** in `seed.sql` comments and in the admin UI (yellow "placeholder" badge until the admin edits the row): machine rate 70 €/h, setup 10 €, scrap 25 %, blank margin 10 mm; flat-laser speeds (12 kW, replace with TRUMPF cutting data) mild steel 1 mm 25, 2 mm 16, 3 mm 11, 4 mm 7, 5 mm 5.5, 6 mm 4.5, 8 mm 3.0, 10 mm 2.2, 12 mm 1.7 m/min with pierce 0.2–2.0 s; stainless and aluminium tables at 70 % of those speeds; material S235/S355 1.10–1.20 €/kg, DC01 1.05 €/kg, 1.4301 3.60 €/kg, aluminium 4.50 €/kg; bending 0.90 € per bend up to 500 mm, 1.60 € up to 1500 mm, 3.00 € up to 4420 mm, +50 % above 6 mm, setup 8 €; rolling 12 €/m + 25 € setup; welding MIG/MAG 0.045 €/mm, TIG 0.09 €/mm, laser 0.06 €/mm, MMA 0.07 €/mm, setup 15 €, minimum order 60 €; threads 0.60–1.50 €; powder coating 14 €/m² min 25 €; zinc 1.20 €/kg min 30 €; deburr 0.40 €/m; default margin 30 %; `EXCHANGE_RATE_EUR_PLN_DEFAULT` 4.30.

## Step 10 — Quote builder, PDF and workflow

- Quote page: header (customer, number, version, currency + fx, margin, validity, lead time), parts table (thumbnail, name, material/thickness, qty, unit cost, unit price, flags), per-part operation breakdown (expandable), totals by operation type, welding as a separate block when the customer wants it, internal cost/margin split visible to admin and sales but never on the PDF.
- Actions: duplicate as new version, request override (per flag, with note), send (blocked by red flags or pending overrides), mark won/lost, export PDF.
- PDF (PL or EN by customer preference): StretchMetal header block, customer, quote number/version/date/validity, parts table with quantities and prices in the quote currency, optional operation summary per part (toggle), terms text, footer with company data from `lib/site-config.ts` `[CONFIRM]` values. Identity per Step 4. A4, print-safe.
- Customers: list, create, edit, class, country (drives the default currency); history of quotes per customer.
- Sending: when `MS_GRAPH_*` is configured, send the PDF via the ported Graph mailer with a PL/EN template; otherwise download only.

## Step 11 — Admin

- Rate tables editor per table with version history (view any version, diff against active, create new version from active, activate); yellow placeholder badges until edited; import/export CSV.
- Machines editor (limits JSON with a form on top).
- Machine-hour calculator page: purchase price, residual, useful life, productive hours, service, other fixed, kW × utilisation × energy price, gas, operator share, tooling, overhead → cost per hour and a button "use as machine rate in a new rate version".
- Users: invite by email, set role and locale.
- Overrides queue: pending requests with the quote context and the rule that fired; approve/reject with note.
- Audit log viewer.

## Step 12 — i18n, auth, security

- Locale from the profile, fallback from `Accept-Language`; all UI strings in `content/` (PL) and `content/en/`; numbers and dates formatted per locale (PL: `1 234,56`).
- Supabase Auth; server components read the session; middleware protects everything except `/login` and `/guide`. RLS: sales and viewers read all quotes and customers, sales write their own quotes and any customer, only admin writes rate tables, machines, users, overrides decisions.
- Files: private bucket, signed URLs (10 min), server-side type sniffing (DXF must start with a group code line; PDF `%PDF`), size limits, no public listing.
- Never trust client-side prices; the server re-prices on save and on send.

## Step 13 — Do NOT

- No rates, prices, margins or machine limits hardcoded in code — tables and seeds only.
- No rounded corners, gradients, emoji or Tailwind default colours leaking through.
- No auto-applying AI suggestions; no sending with red flags or pending overrides.
- No public files, no client-only pricing, no `any` types in the geometry or pricing engines.
- No STEP unfolding, no nesting optimiser, no DWG parsing in this phase — stub the STEP path (read bounding box and thickness only if a STEP parser is trivial; otherwise show "manual entry" for STEP).
- Do not stop to ask questions — make reasonable assumptions and list them in the final report.

## Step 14 — Definition of done

Run and pass, in order: `npm run typecheck`, `npm run lint`, `npm run test` (geometry fixtures from Step 6 and pricing unit tests, all green), `npm run build`. Then verify and state in the final report:

1. Upload `200005.dxf` and `200164.dxf`: both go green, numbers match Step 6 within tolerance, threads suggested on 200005, 4 bend lines listed on 200164 with the right directions.
2. Set thickness 15 mm S355 on 200005: the flat-laser rule flags "subcontract — above 12.7 mm" and the pricing switches to the supplier row.
3. On 200164 add a quantity of 50, a 90° angle on each bend, a stitch weld of 30/60 mm on one edge: the quote shows cutting, material, 4 bends, welding and setup spread over 50 pieces; the PDF renders in PL and EN, in PLN for a Polish customer and EUR for a German one.
4. A bend of 4 m in 12 mm S355 is flagged red by the force rule; a hole 5 mm from a bend line in 8 mm is flagged amber; a rolled part in 8 mm is flagged red (above 6 mm).
5. A sales user cannot open the rate editor; an admin can create a new rate version and old quotes keep their old prices.
6. A red-flagged quote cannot be sent; an override request appears in the admin queue and, once approved, the quote can be sent.
7. Desktop 1440 px and tablet 1024 px layouts hold; keyboard-only pass of upload → tag → quote works; PL and EN both complete, no lorem ipsum.

Finish with a report: what was built, every `[CONFIRM]` placeholder (rates, company data, fx default) with file locations, the Supabase setup steps, env vars to set on Vercel, the domain setup for `quote.stretchmetal.pl`, and suggested next steps (Python/ezdxf engine swap, PDF AI pre-fill tuning, STEP intake, website RFQ ingestion).
