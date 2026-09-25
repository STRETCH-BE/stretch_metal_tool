# StretchMetal quoting tool — build brief (v0.4, 25 Sep 2026)

## 1. Mission

Give the StretchMetal sales team one visual tool that turns a customer's DXF (plus PDF/STEP when available) into a priced quote for laser cutting, bending, rolling, welding, threads, machining and finishing — with the rate tables locked so a salesperson cannot break a formula. It replaces the current Excel, which is too complicated and error-prone to hand to new sales staff. The company has just started, so the tool is also where the first price list is born: there is no quote history to copy from.

Buy-vs-build conclusion (24 Sep 2026): laser + bending quoting can be bought (CutQuote $95–900/mo, AutoCut from $83/mo, NanoQuote, Tempus ToolBox), but no SaaS lets a user click weld seams on the drawing with full/stitch patterns, none is PL/EN, and MP LaserCalc (900 PLN/yr, the only "mark bend and weld lines on the part" product) is a single-seat Polish Windows desktop app. WycenaCNC (app.wycenacnc.pl) is a CNC-machining cost sheet, not a geometry tool. Decision: build, on the same stack and design system as the StretchMetal website. Implementation order and details: `quoting-tool-build-prompt.md`.

## 2. Users and roles

| Role | Can | Cannot |
|---|---|---|
| Admin (Michael) | edit rate tables, machines, feasibility rules, users, margin policy; approve overrides | — |
| Sales | upload files, mark operations, set quantities, generate and send quotes, request overrides with a note | edit any rate or formula; release a quote with an unapproved override |
| Viewer (optional) | read quotes and history | change anything |

Decisions (25 Sep 2026): UI in Polish and English from day one (Dutch later); overrides are approved by the admin; currencies PLN and EUR — default PLN for Polish customers, EUR for all others, changeable per quote, with the exchange rate stored on the quote.

## 3. Inputs

1. **DXF** — the primary input. Flat pattern at 1:1 in millimetres. Ideal case observed on the 200009_A enquiry: Autodesk Inventor exports (AC1018, `$INSUNITS` 4, layers `IV_OUTER_PROFILE`, `IV_INTERIOR_PROFILES`, `IV_BEND`, `IV_BEND_DOWN`, `IV_TANGENT`, `IV_FEATURE_PROFILES*`, `IV_ARC_CENTERS`, no text or dimensions, geometry often offset from the origin).
2. **PDF drawing** — secondary, read for title block (part no., material, thickness, weight, finish), bend angles, threads, tolerances, quantity. Text extraction plus AI reading of the drawing image; every extracted value is a suggestion until confirmed.
3. **STEP** — phase 3: thickness and bounding box for sheet parts (unfolding later); for tube-laser parts the profile, length and cut features.
4. **Quick part** — manual entry (L × W × thickness, holes, bends; or profile × length × number of cuts for tubes) so a quote is never blocked by a bad file; flagged "manual geometry".
5. **Welding-only job** — the customer supplies the parts; the input is a DXF/PDF/sketch used only to mark seams, or a plain list of seams with lengths.
6. DWG is not parsed: the upload screen tells the user to save as DXF (converter can be added later).

## 4. Geometry engine

TypeScript engine (`dxf-parser` + own healing and measurement) behind a `GeometryEngine` interface; a Python `ezdxf` + `shapely` service can replace it later. Results cached by file hash.

- Parse LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, SPLINE (flattened), ELLIPSE, INSERT (exploded); ignore POINT, TEXT/MTEXT, DIMENSION, HATCH unless tagged.
- Heal: join endpoints within tolerance (default 0.01 mm), remove duplicate/overlapping segments, drop zero-length entities, close near-closed loops, report what was changed.
- Classify loops: outer contour = largest closed loop; interior loops = holes; open interior lines = bend/engrave/weld candidates; entities outside the outer loop = frame/dimensions/other parts.
- Multi-part files: every closed outer loop that is not inside another becomes a part; user assigns quantities or merges.
- Measures per part: total cut length (outer + interior), pierce count (1 + interior loops), bounding box, net flat area, mass (area × t × density), hole list with diameters, bend line list (layer, length, position), smallest contour size (for slow-cut surcharge).
- Thread suggestion from hole diameter (Inventor models tapped holes at the ISO minor diameter D1 = d − 1.0825·P; tolerance ±0.05 mm). Also match common tap-drill sizes for customers who model drilled holes.

| Thread | D1 (mm) | Tap drill (mm) |
|---|---|---|
| M3×0.5 | 2.459 | 2.5 |
| M4×0.7 | 3.242 | 3.3 |
| M5×0.8 | 4.134 | 4.2 |
| M6×1 | 4.917 | 5.0 |
| M8×1.25 | 6.647 | 6.8 |
| M10×1.5 | 8.376 | 8.5 |
| M10×1 | 8.917 | 9.0 |
| M12×1.75 | 10.106 | 10.2 |
| M12×1.5 | 10.376 | 10.5 |
| M16×2 | 13.835 | 14.0 |
| M20×2.5 | 17.294 | 17.5 |

Validated on 200009_A: part 200005 (15 mm S355) → 500 × 220 mm, 2 224.5 mm cut, 26 pierces, Ø6.647 ×8 = M8, Ø8.917 ×6 = M10×1, mass 11.99 kg vs 11.69 kg on the drawing (finished-part machining explains the gap). Part 200164 (2 mm DC01) → 554.3 × 60 mm, 1 796.1 mm cut, 33 pierces, 4 bend lines of 60 mm (1 up, 3 down), mass 0.509 vs 0.51 kg.

## 5. File-quality workflow

### 5.1 Triage on upload (automatic)

Every file lands in one of five states, shown as a green/amber/red checklist:

| State | Detection | Result |
|---|---|---|
| Flat pattern with named bend layers | layer names matched against the convention list (Inventor `IV_BEND*`, SolidWorks `BEND LINES`/`BENDLINES`, Fusion, Trumpf, Lantek, own convention) | green — fully automatic |
| Flat pattern with unnamed interior lines | open lines inside the outline, often dashed or on layer 0 | amber — "these N lines look like bend lines: bend / ignore / cut?" |
| Outline + holes only | no open interior lines | amber if PDF or part name suggests forming — "Is this part bent or rolled? Add bend lines or attach the PDF." |
| Folded 2D drawing | several views, DIMENSION/TEXT entities, title block, scale ≠ 1 | red — not a cutting file; explain, offer to pick one view as the flat part and discard the rest |
| Unit or scale doubt | `$INSUNITS` missing/inches, bbox far from PDF blank size | amber — confirm size, or two-click calibration on a known dimension |

Healing runs underneath every state and its report is visible ("joined 3 gaps, removed 2 duplicates, flattened 1 spline").

### 5.2 Telling the user how to supply the file

- Export guide per CAD system on the upload screen and on the website: Inventor (Flat Pattern → Save Copy As DXF, bend lines on), SolidWorks (flat-pattern DXF with "Bend lines" ticked), Fusion 360, AutoCAD (bends on layer `BEND`), plus "save DWG as DXF".
- Published layer convention the tool recognises: `BEND_UP`, `BEND_DOWN`, `ENGRAVE`, `WELD`, `IGNORE`, and the vendor names above.
- Downloadable example DXF.
- "Attach the PDF": angles, finish, threads, quantities are read from it.

### 5.3 Adjusting inside the tool

- Tag any entity: cut / bend up / bend down (angle) / weld seam (full or stitch) / engrave / ignore.
- Draw a bend line: two clicks on the outline with snapping (endpoints, midpoints, perpendicular constraint); length automatic, angle typed.
- Mark rolling on the whole part: radius or diameter, axis direction, arc angle; cone detected automatically when the flat pattern is an annular sector.
- Clean-up: lasso-select and ignore, "keep largest closed contour and its holes", join, delete, mirror, split multi-part file.
- Quick-part fallback (section 3).
- Save the annotated DXF with added layers as the production file; annotations are also stored against the file hash so a re-upload restores them.

### 5.4 AI assistance (suggests, never decides)

Reads the PDF text and image to pre-fill bend count/angles, finish, threads, quantity; proposes bend candidates (lines spanning the part, parallel to an edge, dashed linetype); recognises a folded drawing sheet from the thumbnail. Everything it proposes is amber until a person confirms.

### 5.5 Rules that keep sales safe

No quote leaves with a red flag. Amber flags need a confirmation or an override request with a note; the admin approves or rejects overrides, and a quote with a pending override cannot be sent. Overrides and rate changes are logged with user and timestamp. Rate tables are admin-only. Every quote stores the geometry snapshot and rate-table version it was priced with.

## 6. Operations model

A quote is a list of operations per part. Each operation has a driver (quantity) that comes from geometry, from the user, or both, and a rate looked up by material/thickness/machine. Adding a new operation later is a rate-table row, not new code.

| Operation | Driver from geometry | User adds | Priced by |
|---|---|---|---|
| Laser cutting (flat) | cut length, pierces, blank size, smallest contour | — | €/m + €/pierce by material and thickness (or time × machine rate); slow-cut surcharge for small contours |
| Tube / profile laser cutting | from STEP: profile, length, number and length of cuts/holes; else manual | profile, length, cut count | setup + per metre of cut + per part handling, by wall thickness |
| Material | blank rectangle × t × density; net mass; tube: profile × length | material grade, scrap % | €/kg on blank mass × (1 + scrap); tubes per metre |
| Bending | bend lines (layers or drawn), lengths | angle, up/down | per bend by thickness and length class + setup per part type |
| Rolling | roll-axis length, developed width; cone geometry | radius, axis, arc angle | setup + per metre of roll axis by thickness/radius class |
| Threads / tapping | holes matching D1 or tap-drill table | confirm | per thread by size |
| Countersinks, H7/G6 bores, milled faces | from PDF text or tagged holes | minutes for faces | per feature; per minute for machining |
| Welding | seam length of tagged lines; stitch = length × bead/pitch; sides ×1/×2 | seam selection, process (MIG/MAG, TIG, laser, MMA stick), bead size | €/mm by process and bead; also sold stand-alone (section 9) |
| Deburring | cut length | — | per metre |
| Powder coating | net area × 2 + edges | RAL, masking | per m² + masking minutes |
| Zinc plating / galvanising | mass | — | per kg (supplier tariff) |
| Engraving / marking | tagged line length | — | per metre |
| Subcontracted cutting (beyond own laser limits) | same drivers as laser | supplier | supplier tariff per m / per kg |
| Assembly, packing, transport, other | — | minutes or lump sum | per hour / fixed |

Setup costs are spread over the quantity; batch price breaks come from that automatically.

## 7. Rate tables (admin-only, versioned)

- `laser_rates`: material × thickness → cut speed (m/min), pierce time (s), gas (O2/N2), €/m, €/pierce, min contour size; in-house or subcontract flag.
- `tube_laser_rates`: profile family × wall thickness → €/m of cut, handling per part, setup.
- `materials`: grade, density, €/kg by thickness band, sheet formats, scrap default; tube profiles per metre.
- `bend_rates`: thickness × length class → €/bend; setup €/part type; machine limits (section 8).
- `roll_rates`: thickness × radius class → €/m; setup; machine limits (section 8).
- `weld_rates`: process × bead → €/mm; setup; stitch defaults; minimum order for stand-alone welding.
- `thread_rates`, `feature_rates` (countersink, bore, insert, stud), `machining_rate` (€/h).
- `finishing_rates`: powder coat €/m², zinc €/kg, deburr €/m, minimums.
- `machine_rate` (€/h in-house, built from the machine-hour model in section 13), `labour_rate` (€/h), `margin_policy` (default margin plus per-customer-class overrides, admin-set), `currency` (PLN/EUR rate per quote).
- Every table row carries "in-house" or "subcontract (supplier name)"; a subcontracted operation is priced from the supplier's tariff, an in-house one from time × rate.

## 8. Machine park and feasibility rules (all machine data confirmed by Michael, 25 Sep 2026)

### 8.1 Flat-bed laser — own machine, TRUMPF, TruFiber 12001 (12 kW)

- Working range X 3000 mm × Y 1500 mm × Z 120 mm.
- Maximum sheet thickness: mild steel 12.7 mm, stainless 12.7 mm, aluminium 6 mm, brass 6 mm, copper 6 mm.
- Cutting speeds and pierce times in `laser_rates` to be taken from the TRUMPF 12 kW cutting data for this machine.
- Rules: blank must fit 3000 × 1500 mm minus edge margin (red otherwise; suggest splitting or subcontract); thickness above the limit for the material → red "own laser cannot cut — subcontract" and the subcontract rate applies; contour smaller than ~10 × t → slow-cut surcharge.
- Consequence for the 200009_A test set: 200003 and 200005 (15 mm) and 200044 and 200062 (20 mm) exceed 12.7 mm and must be flagged for subcontracted cutting (plasma/laser) or plate machining.

### 8.2 Tube laser — own machine, TRUMPF, 12 kW

- Round tube up to Ø273 mm; rectangular profile up to 254 mm side / 290 mm circumscribed circle.
- Loader and unloader 6.5 m: raw material length ≤ 6500 mm, finished part length ≤ 6500 mm; maximum 40 kg/m; raw material weight ≤ 260 kg with automatic loading.
- Wall thickness limits (manufacturer figures for the 9 kW source, used as the conservative minimum until 12 kW data is entered): mild steel 14 / 10 mm, stainless 12.5 / 8 mm, aluminium 12.5 / 8 mm, copper 5 mm, brass 5 mm — the two figures are the manufacturer's two cutting modes; the tool stores both and uses the lower one for the feasibility check unless the admin edits the machine row.
- Rules: profile envelope, length, kg/m and wall thickness checked against these values; otherwise red.

### 8.3 Press brake

- Press force 3200 kN, bending length 4420 mm, width between columns 3680 mm, usable open height 615 mm; all V-die sizes available.
- Rules: bend length ≤ 4420 mm (parts needing tools between the columns ≤ 3680 mm); required force from the air-bending formula F = 1.42 × Rm × t² × L / V (N; Rm in N/mm², t, L, V in mm) must stay ≤ 3200 kN; minimum flange ≥ V/2 + bend radius + margin; hole edge to bend line ≥ 2.5 × t (warn), hole crossing a bend (red); box height limited by the 615 mm open height minus tooling.
- Derived maximum bend length at 3200 kN, S355 (Rm ≈ 510 N/mm²), air bending with V = 8 × t: 3 mm → full length; 6 mm → full length; 8 mm → ≈ 4.4 m (full length, at the limit); 10 mm → ≈ 3.5 m; 12 mm → ≈ 2.9 m; 15 mm → ≈ 2.4 m; 20 mm → ≈ 1.8 m. S235 (Rm ≈ 400) allows about 27 % more. The tool computes this per part from the chosen V-die rather than from this table.

### 8.4 Rolling machine

- Maximum width 3200 mm, minimum radius 200 mm, maximum thickness 6 mm.
- Rules: roll-axis length ≤ 3200 mm; radius < 200 mm → red; thickness > 6 mm → red "cannot roll in-house — subcontract".

### 8.5 Welding

- Processes in-house: MIG/MAG, TIG, laser welding, MMA stick welding (coated electrode; "bagette").
- Rate table per process and bead size in €/mm; stitch welds priced on effective bead length (length × bead ÷ pitch); sides ×1/×2 chosen by the user.

### 8.6 General

- Sheet formats and stock list drive the "blank fits a sheet" check and material price band.
- Weight above single-person handling limit → handling surcharge suggestion.

## 9. Quote builder and output

- Quote types: **fabrication** (parts × quantities with all operations) and **welding-only** (customer-supplied parts; seams marked on a drawing or listed; priced per mm by process plus handling, setup and a minimum order). Welding can also be shown as a separate block inside a fabrication quote.
- Per-part operation breakdown; totals per operation type; margin; PLN or EUR (default by customer country); validity date (default 30 days, admin-configurable); lead time field; payment terms text from a template.
- Quote numbering: `SM-YYYY-NNNN` with version suffix (`-v2`) unless Michael specifies otherwise.
- Quote PDF in the StretchMetal identity (Archivo wdth 125, red #e00000 on #0a0a0a, hard edges), PL or EN; internal cost sheet never leaves the tool.
- Statuses (draft → pending override → sent → won/lost), versions, customer database, history per customer, duplicate-and-revise.
- Later: send from the tool via Microsoft Graph (same `lib/email.ts` pattern as the website), and ingest RFQ-form submissions from stretchmetal.pl directly.

## 10. Data model (Supabase Postgres)

`users` (role) · `customers` · `quotes` (number, type, status, version, currency, fx, margin, rate_table_version) · `quote_items` (part, qty) · `parts` (file hash, storage path, geometry json, annotations json, thumbnail, triage state) · `operations` (item, type, driver value, rate ref, cost) · `rate_*` tables (versioned) · `machines` (the section 8 limits as data, not code) · `overrides` (request, note, approver, decision) · `audit_log` · `files` (DXF/PDF/STEP originals and annotated exports in Supabase Storage).

## 11. Stack and hosting (confirmed 25 Sep 2026)

- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4, same design tokens and component patterns as the StretchMetal website; deployed on **Vercel**; auth, database and storage on **Supabase**; domain **quote.stretchmetal.pl**.
- Geometry: TypeScript engine first (single deployment); Python `ezdxf` + `shapely` service as a later swap behind the same interface.
- Viewer: SVG in React with pan/zoom, per-entity hit-testing, snapping, layer toggles, thumbnails rendered server-side.
- PDF: text via pdf.js; drawing image + text to the Claude API for pre-fill.
- Quote PDF: React-PDF.
- Running cost: roughly €0–50/month (Vercel + Supabase + AI calls).

## 12. Phases

1. **Laser + bending, priced** — upload, triage and healing, viewer, automatic cut/pierce/blank/mass, bend lines from layers and by drawing, rate tables seeded per section 13, machine limits from section 8, quantities, quote breakdown and PDF, users, history. Exit criterion: the 200009_A set quotes end-to-end and the first-principles prices are reviewed by Michael.
2. **Full operations** — welding by click with stitch patterns and the welding-only quote type, rolling, thread auto-detection, feasibility rules, PDF AI pre-fill, annotated DXF export, multi-part files, customer database, PLN/EUR, Polish UI, subcontract flag for parts beyond own limits, override approval flow.
3. **Intake and integration** — STEP (sheet thickness and bbox; tube-laser parts: profile, length, cuts), customer self-service upload linked to the website RFQ form, email sending, ERP/Odoo export, nesting estimate, sheet unfolding last.

## 13. Seeding the rates without a quote history

The company has just started, so there are no invoiced quotes to calibrate against. The first price list is built from three sources and then tuned on real orders:

1. **Machine-hour cost model per machine** (the calculator the tool itself provides): purchase price and residual value over useful life, productive hours per year, service, energy (the tube laser draws 12–14 kW in production), gas, operator share, tooling, overhead → cost per hour; cut speeds by thickness/material from TRUMPF 12 kW data → €/m and €/pierce. Labour and rent figures Michael already uses in job costing feed the same model.
2. **Market benchmark**: run the 200009_A parts (and a few tube parts) through public instant-quote portals — Staffa.pl LaserQuote, Cool-Met, Klik2Laser, Fractory, Xometry — and record the market price per part; set the default margin so StretchMetal lands where Michael wants against the market.
3. **Supplier tariffs** for everything subcontracted (zinc plating, cutting above 12.7 mm, rolling above 6 mm, powder coating if external).

Every quote then feeds a "quoted vs. actual" record (planned time vs. booked time per operation) so the rates tighten over the first months. Until then the tool shows the price with its cost and margin split, so Michael can judge each quote quickly.

## 14. Known limits

- DXF carries no angles, radii, direction, finish or quantity — they come from the PDF or the user.
- A 2D drawing of a welded assembly shows one view; weld seams on hidden faces must be marked ("×2 sides"). Automatic weld detection from 3D models is out of scope.
- Laser time from length/pierce tables is ±10–15 % of a CAM estimate; small contours and intricate shapes cut slower.
- No true nesting in phase 1–2; material from blank rectangle plus scrap.
- STEP unfolding is the hardest piece in the field and is deliberately last; tube parts without STEP are quoted manually (profile × length × cuts).
- First-principles rates are a starting point, not a calibration; expect to adjust them after the first real orders.
- Custom software: strange files will break things at first; the triage report and quick-part fallback keep quoting possible while fixes land.

## 15. Decisions log and remaining inputs

All product and machine questions are answered as of 25 Sep 2026 (sections 2, 8, 9, 11). Still needed, and enterable by the admin inside the tool after launch rather than before the build:

1. Machine-hour inputs for section 13: purchase prices and useful life per machine, energy price, gas prices, service contracts, productive hours.
2. Subcontractor tariffs (zinc plating, cutting above 12.7 mm, rolling above 6 mm, external powder coating).
3. TRUMPF 12 kW cutting-speed and pierce tables for the flat-bed and tube lasers, and the 12 kW wall-thickness limits for the tube laser.
4. Default margin and any customer-class differences.
5. Company data for the quote footer (legal entity, address, NIP, bank) — same `[CONFIRM]` list as the website.
