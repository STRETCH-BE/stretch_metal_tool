# Supabase — database, auth, storage

File path: `/supabase/README.md`

Everything the quoting tool stores lives in one Supabase project: Postgres
(schema in `migrations/`, data in `seed.sql`), Auth (email + password) and
Storage (private bucket `quote-files`, created by the migration). This folder
is what the Supabase CLI reads.

| File | Purpose |
|---|---|
| `config.toml` | CLI configuration — minimal on purpose, see below. |
| `migrations/20260925000000_init.sql` | The schema: enums, tables, RLS, helper functions, storage bucket. Never edit an applied migration; add a new timestamped file. |
| `seed.sql` | Machine park + placeholder rate tables (rate version `v1`). One atomic `DO` block, idempotent. Runs on `supabase db reset`; run once by hand in the cloud. |
| `seed-local-admin.sql` | Local-dev admin user `admin@stretchmetal.local` / `stretchmetal`. **Local stacks only, never run automatically.** |

`config.toml` sets only `project_id` and `[db.seed]`. The CLI fills every key
you leave out with its defaults — the same values `supabase init` would have
written — so the local stack comes up on the standard ports: API
`http://127.0.0.1:54321`, Postgres `127.0.0.1:54322` (`postgres`/`postgres`),
Studio `http://127.0.0.1:54323`. If you ever run `supabase init` here, decline
the overwrite of `config.toml`.

## Run locally

Prerequisites: Docker and the Supabase CLI (`npm i -g supabase` or `brew
install supabase/tap/supabase`). The CLI is not a project dependency.

```bash
supabase start            # first start: pulls images, applies migrations/, then seed.sql
supabase status           # prints API URL, anon key, service_role key, DB URL
supabase db reset         # drops + recreates the local DB, re-applies migrations/ + seed.sql
```

Put the values from `supabase status` into `.env.local` (see `/env.example`):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. Then create the local admin — this is **not** part
of the automatic seed because it carries a public password:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed-local-admin.sql
# or paste the file into Studio → SQL editor
```

Sign in at `/login` with `admin@stretchmetal.local` / `stretchmetal`. The
script is idempotent (skips existing users, always re-applies the admin role),
so it is safe after every `db reset`. Additional local users: Admin → Users
inside the app, or Studio → Authentication.

### Validating SQL without Docker

The build container has no Docker, only a bare Postgres 16 with stand-ins for
the `auth` / `storage` schemas (`/test/supabase-stub.sql`). The database
tests use it and are skipped everywhere else:

```bash
SMTOOL_LOCAL_PG=1 npx vitest run test/db
```

`test/db/pg.ts` drops and recreates a scratch database (`smtool_seed_test`
by default, `SMTOOL_PG_DATABASE` to change it), applies the stub, every
migration and `seed.sql`, then `test/db/seed.test.ts` asserts the row counts,
the JSON shapes against `lib/pricing/types.ts`, idempotency (edited seed on a
referenced version, failure rollback), the laser ladder through the real
`findLaserRate`, and `next_quote_number()`. The same sequence by hand (files
must be readable by the `postgres` OS user, so copy them to `/tmp` first):

```bash
cp supabase/seed.sql /tmp/seed.sql && chmod 644 /tmp/seed.sql
su postgres -c "psql -p 5433 -h /tmp -d smtool -v ON_ERROR_STOP=1 --single-transaction -f /tmp/seed.sql"
```

`--single-transaction` (`-1`) is belt and braces: the seed is one `DO` block,
so Postgres already applies it atomically, but the flag also covers anything
someone later appends after the block.

`seed-local-admin.sql` cannot run on the stub (no token columns, no
`auth.identities`); it targets the real local stack only.

## Apply to the cloud project

1. `supabase login`, then `supabase link --project-ref <ref>` (Dashboard →
   Project Settings → General). The link is stored in `supabase/.temp/`,
   which is git-ignored.
2. `supabase db push` applies every migration in `migrations/` that the
   project has not seen (tracked in `supabase_migrations.schema_migrations`).
   `npm run db:push` is the same command.
3. Seed **once**: open Dashboard → SQL editor, paste `seed.sql`, run. It is
   safe to run again later — see "Idempotency": an edited seed replaces `v1`
   only while no quote references it, and inserts nothing otherwise — but the
   cloud project is never seeded automatically (`[db.seed]` only applies to
   `db reset`).
4. Create the first admin: Dashboard → Authentication → Users → Invite user.
   Accepting the invite creates the `profiles` row as `sales`; promote it in
   the SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'michael@stretchmetal.pl';  -- [CONFIRM] admin e-mail
   ```
   Do **not** run `seed-local-admin.sql` in the cloud.
5. Storage: the migration creates the private bucket `quote-files` (25 MB
   per file, DXF/PDF/STEP/SVG MIME types) with its policies — nothing to do
   in the dashboard.
6. Vercel → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API) and
   `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC_`), plus the
   rest of `/env.example`.

Schema changes later: `supabase migration new <name>`, write the SQL, test
with `supabase db reset` (or the psql flow above), `supabase db push`,
regenerate the types.

## Regenerate `lib/db/types.ts`

`lib/db/types.ts` is hand-written in the shape `supabase gen types` emits and
must be kept in sync with `migrations/`. After a schema change:

```bash
supabase gen types typescript --local  > lib/db/types.ts    # against the running local stack
supabase gen types typescript --linked > lib/db/types.ts    # against the linked cloud project
```

The generator emits every jsonb column as the loose `Json` type
(`materials.price_per_kg`, `machines.limits`, `quotes.pricing`, …) and does
not know the `Tables` / `TablesInsert` / `TablesUpdate` helpers at the bottom
of the current file, so after regenerating: restore those helpers and any
narrowed JSON column types the data-access layer added, run
`npm run typecheck`, and report the change — the file is a contract owned by
the data-access layer. The seed writes those JSON columns in the
`lib/pricing/types.ts` shapes (`ThicknessBandPrice[]`, `MachineLimits`), which
`test/db/seed.test.ts` checks.

## Rate versions — how the placeholder rates become real ones

Rate tables are immutable per version and quotes pin the version they were
priced with (`quotes.rate_version_id`), so an old quote always re-prices the
same. The seed creates version `v1 — placeholder rates [CONFIRM]` (fixed id
`00000000-0000-4000-8000-000000000001`) with `placeholder = true` on every
row; the admin UI shows those rows with the yellow *placeholder* badge until
they are edited.

The admin rate editor drives two SQL functions from the migration (both
`security definer`, both refuse non-admins):

| Function | What it does |
|---|---|
| `clone_rate_version(p_source uuid, p_label text) → uuid` | Copies every rate row (`rate_general`, `materials`, `rate_laser`, `rate_tube_laser`, `rate_bend`, `rate_roll`, `rate_weld`, `rate_thread`, `rate_feature`, `rate_finish`) of `p_source` into a new **inactive** version and returns its id. |
| `activate_rate_version(p_version uuid)` | Deactivates the current version and activates `p_version`. A partial unique index guarantees exactly one active version. |

Workflow: clone the active version → edit rows in the copy (editing a row
clears its `placeholder` flag) → activate. Rows of a version that any quote
references are protected by the `*_immutable` triggers (update/delete raise),
which is why edits always go through a clone. Pricing loads the active
version for new quotes and the pinned version for existing ones.

**Laser rows and sheet gauges.** `findLaserRate` (`lib/pricing/lookup.ts`)
prices in-house only from an in-house `rate_laser` row at *exactly* the
part's thickness; a gauge without one is priced from the nearest *supplier*
row and flagged as subcontract. So every gauge the shop stocks needs its own
in-house row. The seed covers 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12 and
12.7 mm for mild steel and stainless and 1–6 mm (same steps) for aluminium,
brass and copper; when a new gauge enters stock, add its row in the rate
editor of the active version's clone. Above 12.7 mm only S235/S355 carry a
supplier row (15 and 20 mm); other grades are red `laser.no_rate_row` until
the admin enters a supplier tariff.

From SQL (as an admin):

```sql
select public.clone_rate_version('00000000-0000-4000-8000-000000000001', 'v2 — TRUMPF speeds');
-- … update public.rate_laser set speed_m_min = …, placeholder = false where rate_version_id = '<new id>' and …;
select public.activate_rate_version('<new id>');
```

### Idempotency and atomicity of `seed.sql`

* The file is **one `DO` block = one statement**, so Postgres applies it
  atomically even without a transaction: a typo, a bad value or a schema
  drift rolls everything back and the previous rate set stays in place.
  Add rows inside the block, never as statements after it.
* If no quote references `v1`, the version row is deleted (cascading to every
  rate row) and re-inserted, so an edited seed lands on re-run. The rate
  inserts have no `on conflict` clause: after the delete a conflict can only
  be a duplicate inside the file, which must fail loudly.
* If a quote does reference `v1`, the seed prints a NOTICE and **inserts
  nothing** into it — not even rows that were added to the file later. The
  migration's `*_immutable` triggers guard update/delete only, so the seed
  has to skip inserts itself. Change rates through clone → edit → activate.
* `v1` is inserted active only when no other version is active — it never
  steals activation from a version the admin activated.
* `machines` rows are `on conflict (code) do nothing` and run on every seed,
  independent of the version branch: edits made in the admin machines editor
  survive a re-run. Change limits in the UI, not in the seed.

## `[CONFIRM]` — every placeholder in this folder

Grep: `grep -n "\[CONFIRM\]" supabase/*.sql`. Sources: build prompt Step 9,
spec sections 7, 8 and 13. The machine limits (spec 8) are confirmed by the
owner and are **not** placeholders except where listed.

| Where | Placeholder | Seeded value |
|---|---|---|
| `rate_versions.label` | version label | `v1 — placeholder rates [CONFIRM]` — rename on the first clone |
| `rate_general` | machine rate | 70 €/h (replace with the machine-hour calculator result) |
| `rate_general` | labour rate | 35 €/h |
| `rate_general` | machining rate | 60 €/h |
| `rate_general` | default margin | 30 % on price; `margin_by_class` `{}` (no per-class overrides yet) |
| `rate_general` | blank margin | 10 mm per side |
| `rate_general` | slow-contour factor | 1.5 |
| `rate_general` | default stitch | bead 30 mm / pitch 60 mm |
| `rate_general` | handling | mass limit 25 kg, surcharge 5 € per part |
| `rate_general` | welding-only handling | 3 € per customer-supplied part |
| `materials` | S235 / S355 €/kg | 1.10 / 1.15 / 1.20 and 1.15 / 1.20 / 1.25 for ≤ 3 / ≤ 8 / above mm |
| `materials` | DC01, 1.4301, AlMg3 €/kg | 1.05, 3.60, 4.50 flat |
| `materials` | CuZn37, Cu-ETP €/kg | 8.50, 9.50 flat — no benchmark yet |
| `materials` | scrap default | 25 % (all grades) |
| `rate_laser` | mild-steel speeds / pierce | 1, 2, 3, 4, 5, 6, 8, 10, 12 mm: 25, 16, 11, 7, 5.5, 4.5, 3.0, 2.2, 1.7 m/min; 0.2–2.0 s — replace with TRUMPF 12 kW data |
| `rate_laser` | stock gauges 1.5 / 2.5 / 12.7 mm | 20.5 / 13.5 / 1.5 m/min, 0.25 / 0.35 / 2.2 s — interpolated between the neighbours (12.7 = machine limit, extrapolated) |
| `rate_laser` | stainless / aluminium / brass / copper | 70 % of the mild-steel speed, same pierce, N2 |
| `rate_laser` | gas rule | O2 from 3 mm, N2 below (mild steel) |
| `rate_laser` | €/pierce in-house | 0.05 € |
| `rate_laser` | subcontract S235 / S355 at 15 and 20 mm | 6.00 / 8.00 €/m, 0.50 €/pierce, supplier `[CONFIRM] subcontractor` |
| `rate_tube_laser` | €/m of cut by wall 2–8 mm | 4, 5, 6, 7, 8, 10 €; handling 1.50 €; setup 10 € |
| `rate_bend` | € per bend by length class | 0.90 (≤ 500) / 1.60 (≤ 1500) / 3.00 (≤ 4420 mm); +50 % above 6 mm; setup 8 € |
| `rate_roll` | €/m of roll axis | 12 €/m for every thickness 1–6 mm and radius class 200 / 500 / 1000 / 3000 mm; setup 25 € |
| `rate_weld` | €/mm by process | MIG/MAG 0.045, TIG 0.09, laser 0.06, MMA 0.07 — same for bead 3 / 4 / 6 / 8 mm; setup 15 €; minimum order 60 € |
| `rate_thread` | € each | M3 0.60 … M20 1.50 |
| `rate_feature` | € each | countersink 0.80, counterbore 1.20, H7 bore 4.00, insert 1.50, stud 1.00 |
| `rate_finish` | powder / zinc / deburr / engrave | 14 €/m² min 25; 1.20 €/kg min 30; 0.40 €/m; 0.50 €/m |
| `machines.trufiber-12001` | `edgeMarginMm` | 10 mm kept free around the blank (assumed) |
| `machines.tube-laser-12kw` | `wallThicknessMm` | 9 kW manufacturer figures; enter the 12 kW limits |
| `machines.press-brake-3200`, `roll-3200` | display name | make / model unknown — names describe the capacity only |
| `seed-local-admin.sql` | production admin e-mail | `michael@stretchmetal.pl` in the example `update` |
