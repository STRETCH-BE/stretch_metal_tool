# StretchMetal Quote

The internal quoting tool of **StretchMetal** — the metal-fabrication unit of the Belgian Stretchgroup in Częstochowa. A salesperson uploads a customer's DXF flat pattern (plus the PDF drawing when there is one), confirms or marks operations on a drawing viewer, sets quantities and sends a branded quote PDF for laser cutting, material, bending, rolling, welding, threads, machining and finishing. Every price comes from admin-only, versioned rate tables; a salesperson can never edit a formula. Polish and English, PLN and EUR, deployed on **Vercel + Supabase** at `quote.stretchmetal.pl`.

Built with Next.js 15 (App Router) + React 19 + TypeScript (strict) + Tailwind CSS v4 + Vitest, on the STRETCH design system of the public website. Product brief: `docs/quoting-tool-spec.md`; implementation order: `docs/quoting-tool-build-prompt.md`; working conventions for anyone touching the code: `CLAUDE.md`.

## Quick start

```bash
npm install
cp env.example .env.local        # fill in the Supabase values (below)
npm run dev                      # http://localhost:3000
npm run typecheck                # tsc --noEmit (strict mode)
npm run lint                     # eslint
npm run test                     # vitest — geometry fixtures, pricing, content parity, UI logic
npm run build                    # production build
```

### Local Supabase (database, auth, storage)

Prerequisites: Docker and the Supabase CLI (`brew install supabase/tap/supabase` or `npm i -g supabase`).

```bash
supabase start          # applies supabase/migrations/*.sql, then supabase/seed.sql
supabase status         # prints the API URL, anon/publishable key and service_role key
```

Put those three values into `.env.local`, then create the local admin (deliberately not part of the automatic seed because it carries a public password):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed-local-admin.sql
```

Sign in at `/login` with `admin@stretchmetal.local` / `stretchmetal`. `supabase db reset` rebuilds the database from the migration + seed at any time. Full details, including how to validate the SQL without Docker: `supabase/README.md`.

### Cloud Supabase (first-time setup)

1. Create a project (region EU), then apply the schema: `supabase link --project-ref <ref>` and `supabase db push`, or paste every file in `supabase/migrations/` (in name order) into the SQL editor.
2. Run `supabase/seed.sql` once in the SQL editor — it loads the machine park and the placeholder rate version `v1` (every value tagged `[CONFIRM]`, shown with a yellow badge in the admin rate editor until edited).
3. Create your account in Authentication → Users → "Add user" (auto-confirm). **The first account ever created becomes the admin**; every later account is `sales` until an admin changes it under Users. A role can never be set through sign-up metadata (the profile trigger only reads app metadata, which the service role alone can write).
4. Authentication → Sign In / Providers → Email: switch **"Allow new users to sign up" off**. Accounts are created by an admin (Admin → Users → invite) or in the dashboard; public sign-up would let anyone create a `sales` account.
5. Optional, for magic-link sign-in: Authentication → URL configuration → Site URL `https://quote.stretchmetal.pl`, redirect URL `https://quote.stretchmetal.pl/auth/callback`.

## Environment variables

Required for a working app: the Supabase URL, a public key and the server key. Everything else is optional — the build succeeds with none of them set. Copy `env.example` to `.env.local` locally; on Vercel add them under Project Settings → Environment Variables.

| Variable | Purpose | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Absolute links in e-mails and the PDF footer | `https://quote.stretchmetal.pl` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` **or** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client key (legacy `anon` JWT or the newer `sb_publishable_…`) — either name works | Supabase → Project Settings → API keys |
| `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_SECRET_KEY` | Server-only key (legacy `service_role` JWT or `sb_secret_…`): storage signed URLs, audit log, sending, user invites, admin actions. Pricing itself runs as the signed-in user and works without it. Set it for the Preview environment too, or uploads and sending fail there. Never expose with a `NEXT_PUBLIC_` prefix | Supabase → Project Settings → API keys |
| `EXCHANGE_RATE_EUR_PLN_DEFAULT` | Default EUR→PLN rate offered on new PLN quotes; the rate used is stored on every quote | `4.30` `[CONFIRM]` |
| `ANTHROPIC_API_KEY` | Optional — AI pre-fill of thickness, material, bends, threads, finish and quantity from the PDF drawing. Without it the tool shows the extracted PDF text and title-block heuristics only | console.anthropic.com |
| `ANTHROPIC_MODEL` | Optional model override for the pre-fill | see `lib/ai/prefill.ts` |
| `MS_GRAPH_TENANT_ID` `MS_GRAPH_CLIENT_ID` `MS_GRAPH_CLIENT_SECRET` `MS_GRAPH_FROM_ADDRESS` | Optional — send quote PDFs from Microsoft 365. Without them "Send" marks the quote sent and offers the PDF download only | Microsoft Entra app registration with `Mail.Send` (Application), restricted by an Exchange Application Access Policy |
| `QUOTE_FROM_ADDRESS` | Sender / reply-to shown on quote e-mails | e.g. `quotes@stretchmetal.pl` `[CONFIRM]` |

## How it works

1. **Intake** (`/quotes/<id>/upload`): files go from the browser straight to the private Storage bucket `quote-files` through a signed upload URL (route handlers never receive file bodies). The server then downloads the file, sniffs its type (a DXF must start with a group-code line, a PDF with `%PDF`), hashes it and runs the geometry engine. DWG is refused with a "save as DXF" message and a link to the export guide (`/guide`).
2. **Geometry** (`lib/geometry`, pure TypeScript behind a `GeometryEngine` interface): parse → normalise → heal → chain loops → classify (outer contour, holes, bend candidates, frames, other parts) → measure (cut length, pierces, blank, net area, mass, holes with ISO thread suggestions, bend lines) → triage (green / amber / red with a human message). Results are cached by the file's SHA-256; user annotations are keyed to stable entity ids so a re-upload restores them.
3. **Viewer** (`components/viewer`): SVG, pan/zoom/grid, tag entities (cut / bend up / bend down / weld / engrave / ignore), draw bend lines with snapping, mark weld seams (full or stitch), rolling, clean-up, unit calibration, annotated DXF export.
4. **Pricing** (`lib/pricing`, pure and unit-tested): `priceQuote(input, rates, machines)` computes every operation from the geometry, the annotations and the rate snapshot pinned to the quote. Feasibility rules (press-brake force and length, hole-to-bend distance, roll limits, laser thickness limits → subcontract) come from the `machines` table, never from code. The server re-prices on every save and on send; the client only previews with the same functions.
5. **Quote** (`/quotes/<id>`): parts × quantities, per-part operation breakdown, totals by operation type, internal cost/margin split (never on the PDF), amber flags need a confirmation or an override request, red flags block sending, a pending override blocks sending. PDF via `@react-pdf/renderer` in PL or EN, PLN or EUR.
6. **Admin** (`/admin`): rate tables with version history (clone → edit → activate; used versions are immutable), machines, machine-hour calculator, users, override queue, audit log.

## Project structure

```
middleware.ts              Session refresh + route protection (public: /login, /guide, /api/health, /auth/callback)
CLAUDE.md                  Working conventions (headers, copy policy, design rules, ownership)

/app
  layout.tsx               Root layout — Archivo font, locale (profile → cookie → Accept-Language)
  globals.css              STRETCH design tokens + application classes (tables, chips, viewer)
  login/ · auth/callback/  Sign-in (password, optional magic link)
  guide/                   Public DXF export guide (PL/EN) with the example DXF
  (app)/                   Authenticated shell: sidebar, top bar, locale switcher
    quotes/                List · new · quote builder · upload into a quote
    parts/[id]/            Part page: viewer, triage panel, measures, AI suggestions
    customers/             Customers and their quote history
    admin/                 Rates, machines, calculator, users, overrides, audit
  api/                     Route handlers: files (sign/complete/url), geometry, parts export,
                           ai/prefill, quotes pdf/price/send, health

/lib
  geometry/                DXF engine (README inside): parse, heal, loops, classify, measure, triage,
                           annotate, quick-part, export-dxf, svg
  pricing/                 Pricing + feasibility engine (README inside): formulas, lookups, flags
  rates/                   Server loaders for the rate snapshot and machine park
  quotes/ · parts/ · files/ · customers/ · admin/   Server actions and queries per domain
  pdf/                     Quote PDF document + renderer
  ai/ · pdf-text.ts        PDF text extraction, title-block heuristics, Claude pre-fill
  supabase/ · auth.ts · audit.ts · env.ts · routes.ts · format.ts · i18n.ts · email.ts

/components
  ui/                      Primitives (Button, StatusChip, Panel, Field, Modal, Table, …)
  shell/                   Sidebar, Topbar, Breadcrumbs, LocaleSwitcher
  viewer/                  PartViewer (editor) and PartThumbnail
  intake/ · triage/ · parts/ · quote/ · customers/ · admin/

/content                   Typed Polish copy per domain (common, upload, viewer, quote, admin,
  en/                      guide, flags, pdf) — the English mirror has identical keys (parity test)

/supabase                  migrations/ (schema + RLS), seed.sql (machines + placeholder rates),
                           seed-local-admin.sql, config.toml, README.md
/test                      fixtures/ (customer DXFs 200005, 200164 + PDF texts), engine and UI tests
/public/fonts/pdf          Static Archivo instances for the PDF renderer
/public/downloads          Example DXF generated by scripts/generate-example-dxf.mjs
/docs                      Product brief and build prompt
```

## Adding an operation type

An operation is a rate-table row plus a pure pricing function; the UI renders whatever the engine returns.

1. Add the rate row(s) to a **new rate version** in the admin rate editor (or extend `supabase/seed.sql` for fresh installs). If the operation needs a new table, add a migration in `supabase/migrations/`, the row type in `lib/db/types.ts`, the engine type in `lib/pricing/types.ts` (`RateSnapshot`) and the mapper in `lib/pricing/snapshot.ts` + the loader in `lib/rates/load.ts`.
2. Add the `OperationType` value in `lib/pricing/types.ts`, the formula in `lib/pricing/formulas.ts` (with a unit test) and the line builder in `lib/pricing/operations.ts`. Feasibility rules go into `lib/pricing/feasibility.ts` with a new `FlagCode`.
3. Add the labels: operation names in `content/quote.ts` + `content/en/quote.ts` and `content/pdf.ts`, flag messages in `content/flags.ts` + `content/en/flags.ts` (the typed `Record<FlagCode, …>` fails to compile until both locales have the new code).
4. Run `npm run test` — the pricing scenario tests and the content parity test guard the change.

## STEP sheet-metal import (unfolding, hardware, DFM)

A STEP (or an IFC element) goes through `lib/geometry/step/`: `analyse.ts` →
`sheet.ts` (bodies placed in the assembly frame, sheets vs hardware) →
`unfold.ts` (flange graph, bend allowance, through vs blind features) →
the ordinary DXF pipeline. The result is a `PartGeometry` whose
`sheet` field (`lib/geometry/types.ts` `SheetReport`) carries what the
model held beyond the outline: bends (angle, inner radius, allowance and
its source), hardware lines, stud seats, masking zones, countersinks,
blind pockets, modelled threads, reliefs, the model's volume, and the
drawing cross-check. No separate geometry service was needed: the
TypeScript B-rep evaluator already gives face adjacency and exact
cylinders / cones, so everything runs inside the Vercel function
(`sheet.service_unavailable` is reserved for a future external service).

- **Bend allowance** comes from the admin **bend table**
  (`/admin/bend-table`, tables `bend_table_versions` / `bend_table`,
  migration `20260928130000_sheetmetal_tables.sql`): exact material
  family + thickness + inner radius + angle. A `test_bend` row is trusted;
  a `din6935` row or no row at all falls back to the DIN 6935 formula
  (`k = 0.65 + 0.5·log10(r/t)`, capped at 1; `BA = angle × (r + k·t/2)`) and
  raises the amber `sheet.bend_deduction_unverified` flag. The seed holds
  DIN rows for mild steel 1–6 mm at 90° with placeholder punch radii
  (`-- [CONFIRM]`). The version is pinned on `quotes.bend_table_version_id`
  at the first STEP intake; a pinned version is immutable — clone it to
  edit (RPCs `clone_bend_table_version`, `activate_bend_table_version`).
  Before a material is chosen the intake assumes `mild_steel`
  (`DEFAULT_SHEET_FAMILY` in `lib/parts/intake-deps.ts`); the part page
  re-analyses with the part's family.
- **Hardware** bodies are matched by the **hardware names** table
  (`/admin/hardware`, `hardware_names`: PRODUCT-name fragment → kind, size,
  `rate_feature` code; seeded with SST's `ACAO470ZP` = insert M4 and
  `ACAO610ZP` = insert M6), else by geometry (a cylinder standing on a
  sheet face = weld stud `M<d>x<length>`, a body in a through hole = insert
  sized from the hole, `INSERT_HOLE_SIZES` in `sheet.ts`). Every hardware
  line becomes a `{type: "feature"}` extra on the quote item
  (`insert_m6` prices, `insert_m4` / `stud_m3x8` are refused red by the
  market engine with the quantity). Countersinks map to `csk_m<size>`.
- **Blind features** never cut: pockets ≤ 0.05 mm are paint-mask
  recesses (with split coplanar faces → `sheet.masking_not_priced`), round
  pockets ≤ Ø12 are stud seats (crosses on the `IGNORE` layer of the
  production DXF), the rest are blind pockets (`dfm.laser_cannot_make`).
- **Production DXF** (`writeProductionDxf`, AC1018, `$INSUNITS` 4, layers
  `CUT` / `BEND_UP` / `BEND_DOWN` / `IGNORE`, viewed from the side the
  flanges bend towards) is written at intake as a derived file
  (`parts.flat_file_id`) and offered on the part page.
- **DFM checks** (`lib/pricing/dfm.ts`, flags in the catalogue of
  `lib/pricing/README.md`): relief too narrow (with the proposed fix —
  applied only when an admin approves the override; the approval calls
  `lib/parts/relief-fix.ts`, which rewrites the flat and the DXF), hole
  near bend (2t + r), flange too short (dies), bend collision (punches),
  laser cannot make, flat mass vs model mass (±2 %), open contour and
  overlapping cuts. Tooling lives in `/admin/tooling`
  (`press_brake_tools`, seeded with placeholders `placeholder = true` —
  replace them with the real punches and dies).
- **Reference bodies.** A SolidWorks / Inventor export carries the tool
  bodies of the model (cut and extrude helpers, window blocks) as bodies
  named after the feature that made them (`Schnitt-Linear austragen5`,
  `Cut-Extrude3`). The geometry engine reports facts on every part
  (`sheet.bodyHints`: feature name from `lib/geometry/step/feature-names.ts`,
  solid block, sliver, not a sheet, size, volume); `lib/pricing/reference-body.ts`
  decides with the laser bed: red `geometry.reference_body` (left out of
  the total, blocks sending — the one red flag an admin's approved
  override "real part" clears), amber `geometry.unnamed_body` (a feature
  name alone: confirm it is a part), amber `geometry.solid_block`. The
  intake result and the parts list offer "Remove suspected reference
  bodies (n)" in one click. IFC volumes are the exact mesh volumes, so
  `dfm.flat_mass_mismatch` fires only when the flat really misses material
  — a drawn tray rim the press brake cannot make is reported as
  `dfm.not_press_brake_formable` with its length.
- **Verification report**: the part page's "STEP model report" panel and
  the flat-pattern preview with stud positions, masking zones and the
  flagged spots circled. The SST fixture suite
  (`test/geometry/sst-fixtures.test.ts`) runs when the customer files are
  present in `test/fixtures/sst/` and is skipped otherwise — those files
  are never committed.

## Assembly mode (welded assemblies, forming, VAT, price scale)

Design and contracts: `docs/assembly-mode-design.md`; stream notes:
`docs/assembly-mode-notes/`. Schema: migration
`20260930100000_assembly_mode.sql` (apply it to the cloud project before
using assemblies — the app tolerates a database without it: quotes price
as before, assemblies are simply unavailable and the PDF export asks for
the customer type).

- **Two kinds of quote line.** Loose parts keep the 247TailorSteel + 10 %
  market model. A *welded assembly* (name, drawing reference, qty, material)
  groups member parts (qty per assembly) and owns its seams; it is priced as
  ONE line: member parts at cost (cost version material + cutting) +
  assembly labour (fit-up per part, tacks, seam length ÷ effective weld
  speed, gas and wire, deburr, handling; distortion factor on fit-up, tacks
  and welding) + job setups charged once per job and spread over the qty
  (laser nest per material/thickness, press brake, roll, weld fit-up) +
  subcontracted forming at the subcontract margin; price = cost ÷ (1 −
  max(quote margin, `assembly_margin_pct`)). The cost/margin breakdown is
  admin-only.
- **Seams** are marked from a part edge in the viewer ("add as assembly
  seam") or typed in the assembly editor. The same edge twice is one seam;
  the neighbour part's matching edge is stored *paired* and not counted
  (`lib/quotes/seams.ts`).
- **Forming.** Roll (inside radius, angle, width) and bend (count, angle,
  length) operations on a member are checked against the machine park
  (`machines`: roll min R200 / max t 6 / max width 3200, press brake
  3200 kN / 4420 mm). Infeasible → red `forming.not_feasible` until *step
  bending* (hits = ceil(arc ÷ 15 mm), priced as press-brake time) or
  *subcontracting* (supplier, cost, extra lead days) is chosen. A blank
  whose drawing suggests forming but has no operation is red
  `forming.suspected` until confirmed.
- **Packaging and shipping** come from `packaging_rates` (size/weight table)
  and `shipping_rates` (country × weight band) or a manual shipping cost;
  shipping is its own PDF line.
- **VAT** (`lib/pricing/vat.ts`): Poland → 23 % always; abroad with a VAT ID
  → 0 % (reverse charge / WDT inside the EU, export outside); abroad without
  a VAT ID → 23 %; a B2C customer in another EU country pays that country's
  rate only when `company_settings.oss_active` is on. The PDF prints
  net / VAT / gross, or the 0 % note.
- **Price scale**: `quotes.price_scale` (e.g. 20/50/100/200/500/1000)
  re-prices every line at each quantity (setups spread) into a PDF table.
- **Export guards** (PDF download and send): customer name/address,
  customer type (B2B / B2C), company settings without placeholders
  (`000-000`, `PL00`, `XXXX`, `[CONFIRM]`), no unresolved forming.

Admin → **Settings** (`/admin/settings`) edits the seven settings tables;
every seeded number is a calibration placeholder (`placeholder = true`,
`-- [CONFIRM]` in the migration) until an admin saves the row:

| table | what to fill |
|---|---|
| `company_settings` | legal data, bank, `oss_active`, `assembly_margin_pct` (30), `subcontract_margin_pct` (15) |
| `vat_rates` | country → VAT % (PL 23, FI 25.5, BE 21, NL 21, DE 19, AT 20, FR 20 seeded) |
| `packaging_rates` | carton / carton + foam / crate / pallet: max side, max mass, price |
| `shipping_rates` | country × max kg → price (carrier); no band → manual shipping |
| `job_setup_rates` | laser nest, press brake, roll, weld fit-up: EUR once per job |
| `assembly_rates` | labour €/h, gas + wire €/h, tack s, fit-up min/part, deburr min/part, handling min, distortion factor, step-bend s/hit, roll min/m |
| `weld_speeds` | process × thickness → effective mm/min (incl. stops and repositioning) |

## Changing prices (materials and services)

Admin → Rates → **Current prices** opens the active price list for direct
editing (materials €/kg, laser, bending, welding, finishing, threads,
features, lead-time multipliers). A saved row is written to the database at
once and applies from the next calculation: sent, won and lost quotes keep
the prices stored in their pricing snapshot; open drafts pinned to that
version re-price when opened (`rate_versions.rates_updated_at`, stamped by
the trigger of migration `20260930120000_live_rate_editing.sql`, makes them
stale). Versions remain the tool for bigger changes: clone the active
version, edit the copy, compare (diff) and activate it. A retired version
used by quotes stays read-only as the record of what was quoted.

## Adding a rate table

1. Migration: a `rate_<name>` table with `rate_version_id uuid references rate_versions(id) on delete cascade`, a natural unique key, `placeholder boolean default true`, RLS policies (all read, admin write — copy the block in the initial migration) and a line in `clone_rate_version()` so versions copy the new rows.
2. Types: row type in `lib/db/types.ts`; engine type + `RateSnapshot` field in `lib/pricing/types.ts`; mapper in `lib/pricing/snapshot.ts`; loader in `lib/rates/load.ts`; lookup in `lib/pricing/lookup.ts` (document the fallback order).
3. Admin: register the table in the rate editor's table list (`lib/admin/rates.ts`) with its column definitions and natural key; CSV import/export and the diff view pick it up from that registration.
4. Seed placeholder rows tagged `-- [CONFIRM]` in `supabase/seed.sql`.

## Content and the `[CONFIRM]` policy

Components are copy-free: every visible string lives in `/content/<domain>.ts` (Polish, which also holds the type) and `/content/en/<domain>.ts`; `content/parity.test.ts` fails when the key sets differ. Business facts the owner has not verified carry a greppable marker:

```bash
grep -rn "\[CONFIRM\]" lib content supabase env.example
```

That covers the company data printed on the PDF (`lib/site-config.ts`: legal name, address, NIP/REGON/KRS, bank accounts), every placeholder rate and machine display name in `supabase/seed.sql`, the EUR→PLN default and the quote sender address. Rates additionally carry `placeholder = true` in the database, which the admin editor shows as a yellow badge until the row is edited.

## Deploy checklist (Vercel + `quote.stretchmetal.pl`)

1. Create the Vercel project from the Git repository (framework Next.js, Node 22). Set the environment variables from the table above; the three Supabase variables are required.
2. Apply the migration and seed to the cloud Supabase project and create the first (admin) account — see "Cloud Supabase" above.
3. Add the domain `quote.stretchmetal.pl` under Project Settings → Domains and create the CNAME (`quote` → `cname.vercel-dns.com`) at the DNS provider of `stretchmetal.pl`; Vercel issues the certificate. Set `NEXT_PUBLIC_SITE_URL` to `https://quote.stretchmetal.pl` and redeploy.
4. Vercel "Deployment Protection" blocks the `*.vercel.app` URLs for people without a Vercel login — colleagues use the custom domain, or disable the protection for production.
5. In Supabase → Authentication: switch public sign-ups off (see "Cloud Supabase" step 4) and, if magic links are wanted, set the site URL and the `/auth/callback` redirect under URL configuration.
6. Confirm every `[CONFIRM]` value with the owner, then walk the admin rate editor: clone `v1`, enter the real rates (TRUMPF cutting data, supplier tariffs, machine-hour calculator result), activate the new version.
7. Optional: `ANTHROPIC_API_KEY` for the PDF pre-fill, `MS_GRAPH_*` + `QUOTE_FROM_ADDRESS` for sending quotes by e-mail.
8. **Large IFC / STEP uploads (up to 100 MB, dozens of parts).** Three settings outside the code must line up:
   - **Vercel — Fluid compute must be on** for the project (Project Settings → Functions; `vercel.json` also sets `"fluid": true`). `app/api/files/complete/route.ts` and `app/api/files/[id]/resume-intake/route.ts` export `maxDuration = 300`; without Fluid compute the platform caps functions well below that and a 45-part IFC is cut off mid-intake. Vercel's per-plan maximums for duration and memory were not verifiable from the build environment when this note was written — check them under the project's Functions settings and in the Vercel docs ("Fluid compute" → limits). Memory: reading a 54 MB IFC peaks at about 1.25 GB RSS, so if the plan allows it raise the memory of those two routes (e.g. `"functions": { "app/api/files/complete/route.ts": { "memory": 3009 } }` in `vercel.json`, Pro plan). It is deliberately not set in the repository: a memory value above the plan's maximum fails the deployment on Hobby.
   - **Supabase — Storage → Settings → "Upload file size limit"** (the project-wide cap) must be raised to at least 100 MB by hand; the bucket's own `file_size_limit` is set by migration `20260928110000_quote_files_100mb.sql` but the global cap wins when it is lower. Files above 6 MB are uploaded through the resumable (TUS) endpoint with the signed upload token.
   - **Resuming a cut-off intake.** The upload's `files` row tracks `intake_status` / `parts_expected` / `parts_done` (migration `20260928120000_files_intake_status.sql`); the upload page polls it after a timeout and offers "Resume" (`POST /api/files/[id]/resume-intake`), which stores only the parts still missing and re-prices. Parts stored before that migration carry no `source_file_id` unless they were single-file parts; for an older quote that was cut off, either link its parts to the upload by hand (`update public.parts set source_file_id = '<upload file id>' where quote_id = '<quote>' and source = 'step' and file_id <> '<upload file id>'`) and use Resume, or delete the parts and upload the file again.
