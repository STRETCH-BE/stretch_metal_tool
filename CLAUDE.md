# StretchMetal quoting tool — working conventions

Internal web app (Next.js 15 App Router + React 19 + TypeScript strict + Tailwind v4 + Supabase + Vitest) that turns a customer DXF/PDF into a priced quote. Product brief: `docs/quoting-tool-spec.md`; build order: `docs/quoting-tool-build-prompt.md`. Read the relevant section of both before touching a feature.

## Commands
- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` — all four must pass before a task is done. Filter to your area while others work in parallel: `npx tsc --noEmit 2>&1 | grep "^lib/geometry"`, `npx vitest run lib/pricing`.
- Do NOT run `npm install` / add dependencies. Everything needed is installed; if something is truly missing, stub around it and report it.
- Local Postgres 16 for SQL validation (stub `auth`/`storage` schemas already loaded, migration applied): `su postgres -c "psql -p 5433 -h /tmp -d smtool -f <file>"`. Files must be readable by the postgres user (copy to /tmp first). Reset: drop and recreate `smtool`, re-run `/tmp/supabase-stub.sql` then `supabase/migrations/*.sql`.

## Code rules
- Every file starts with a header comment: what it is, `File path: /…`, and the non-obvious decisions (see `lib/auth.ts`, `components/ui/button.tsx`).
- No `any` in `lib/geometry/**` or `lib/pricing/**` (lint error). Prefer `unknown` + narrowing elsewhere.
- Engines are pure: `lib/geometry` and `lib/pricing` never import Next, Supabase, or read env/rates. Rates and machine limits come only from the `RateSnapshot` / `MachinePark` passed in. No prices, margins or machine limits as constants in code — `supabase/seed.sql` only.
- Server is the source of truth for prices: the client may preview with the same pure functions, but saved/sent prices come from server-side pricing.
- Types are contracts: `lib/geometry/types.ts`, `lib/pricing/types.ts`, `lib/db/types.ts`, `supabase/migrations/*.sql`. Only the owner of an engine changes its types file, and then reports the change.
- Data access: `createClient()` from `lib/supabase/server.ts` (RLS, as the user) for normal reads/writes; `createAdminClient()` from `lib/supabase/admin.ts` only after `assertRole`/`requireRole` (`lib/auth.ts`). Log every rate/override/status/user change with `logAudit` (`lib/audit.ts`).
- Files live in the private bucket `quote-files` (`QUOTE_FILES_BUCKET`), signed URLs only (10 min), browser uploads via signed upload URLs — route handlers never receive file bodies (Vercel 4.5 MB limit).

## Copy and i18n
- Components are copy-free. Every visible string comes from `content/<domain>.ts` (PL, also holds the type) and `content/en/<domain>.ts` (EN). Add keys to BOTH files; `content/parity.test.ts` fails otherwise. Server components: `getContent(await getLocale())`; client components: `useContent()` from `components/providers/locale.tsx`.
- Domains: `common` (shell, actions, statuses), `upload` (intake, triage, quick part), `viewer`, `quote` (builder, customers), `admin`, `guide`, `flags` (feasibility + triage messages by code, `{param}` placeholders), `pdf` (quote PDF + emails).
- Numbers/dates via `lib/i18n.ts` (`formatNumber`, `formatMoney`, `formatMm`, `formatDate`, `interpolate`). Polish: `1 234,56`.
- Unverified business facts carry a `// [CONFIRM]` comment on the line (rates in seed.sql get `-- [CONFIRM]`).

## Design system (STRETCH identity)
- Tokens only (`app/globals.css` `@theme`): red `--color-red` is a signal, black `--color-black`, surface `--color-surface`. Never a raw hex in a component, never a Tailwind default colour (no `bg-gray-100`, `text-blue-500`, …).
- Zero border radius, no gradients, no emoji, no shadows. Hard-edged uppercase buttons with the red `→` (`components/ui/button.tsx`, `.btn`). Eyebrows (`components/ui/eyebrow.tsx`), Archivo `wdth 125` for display headings (`.page-title`, `.h2-sm`).
- Dense, table-first: `.tbl` / `.tbl-dense`, numbers right-aligned with `.num` (tabular figures). Status chips are square `.chip chip-green|amber|red|neutral|placeholder` (▮ block + uppercase label). Panels `.panel` / `.panel-head` / `.panel-body`. Forms `.field`, `.field-label`, `.field-error`. Toolbar `.toolbar` / `.tool-btn`.
- Viewer: dark canvas `.viewer`, layer classes `.geo-cut .geo-hole .geo-bend_up .geo-bend_down .geo-weld .geo-engrave .geo-ignore .geo-unknown .geo-selected`.
- Primary layout 1440 px desktop; tablet 1024 px must hold; keyboard operable (focus-visible ring is global).

## Routes
`lib/routes.ts` is the single route map — never hardcode a path. App pages live under `app/(app)/…` inside the shell layout; `/login`, `/guide`, `/forbidden`, `/api/health` are public.
