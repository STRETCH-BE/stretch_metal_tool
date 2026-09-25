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

1. Create a project (region EU), then apply the schema: `supabase link --project-ref <ref>` and `supabase db push`, or paste `supabase/migrations/20260925000000_init.sql` into the SQL editor.
2. Run `supabase/seed.sql` once in the SQL editor — it loads the machine park and the placeholder rate version `v1` (every value tagged `[CONFIRM]`, shown with a yellow badge in the admin rate editor until edited).
3. Create your account in Authentication → Users → "Add user" (auto-confirm). **The first account ever created becomes the admin**; every later account is `sales` until an admin changes it under Users.
4. Optional, for magic-link sign-in: Authentication → URL configuration → Site URL `https://quote.stretchmetal.pl`, redirect URL `https://quote.stretchmetal.pl/auth/callback`.

## Environment variables

Required for a working app: the Supabase URL, a public key and the server key. Everything else is optional — the build succeeds with none of them set. Copy `env.example` to `.env.local` locally; on Vercel add them under Project Settings → Environment Variables.

| Variable | Purpose | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Absolute links in e-mails and the PDF footer | `https://quote.stretchmetal.pl` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` **or** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client key (legacy `anon` JWT or the newer `sb_publishable_…`) — either name works | Supabase → Project Settings → API keys |
| `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_SECRET_KEY` | Server-only key (legacy `service_role` JWT or `sb_secret_…`): storage signed URLs, audit log, server-side re-pricing, user invites. Never expose with a `NEXT_PUBLIC_` prefix | Supabase → Project Settings → API keys |
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
5. In Supabase → Authentication → URL configuration set the site URL and the `/auth/callback` redirect if magic links are wanted.
6. Confirm every `[CONFIRM]` value with the owner, then walk the admin rate editor: clone `v1`, enter the real rates (TRUMPF cutting data, supplier tariffs, machine-hour calculator result), activate the new version.
7. Optional: `ANTHROPIC_API_KEY` for the PDF pre-fill, `MS_GRAPH_*` + `QUOTE_FROM_ADDRESS` for sending quotes by e-mail.
