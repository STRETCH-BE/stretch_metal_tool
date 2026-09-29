# Assembly mode — admin stream notes

File path: /docs/assembly-mode-notes/admin.md

Branch `fix/assembly-mode`, stream **admin** (design: `docs/assembly-mode-design.md` §2 "Admin settings tables", §5 "Admin").

## What was built

Admin pages for the seven non-versioned settings tables of migration `20260930100000_assembly_mode.sql`, following the machines / sheet-metal admin pattern (role check first, audit on every write, PL/EN copy, design tokens only).

| Page | Route | Table | Editor |
|---|---|---|---|
| Overview | `/admin/settings` | all | row / placeholder counts, status chip, links |
| Company | `/admin/settings/company` | `company_settings` (id 1) | sectioned `.field` form (identity, address, contact, registers, bank, pricing: OSS, margins) |
| VAT | `/admin/settings/vat` | `vat_rates` | inline row table + add row |
| Packaging | `/admin/settings/packaging` | `packaging_rates` | inline row table + add row |
| Shipping | `/admin/settings/shipping` | `shipping_rates` | inline row table + add row |
| Job setups | `/admin/settings/setups` | `job_setup_rates` | inline row table (fixed codes, no add / delete) |
| Assemblies | `/admin/settings/assembly` | `assembly_rates` (id 1) | `.field` grid |
| Weld speeds | `/admin/settings/weld-speeds` | `weld_speeds` | inline row table + add row |

- Every table page: eyebrow + `.page-title`, the one-line hint of what the numbers do as subtitle, the `.toolbar` / `.tool-btn` sub-navigation (`components/admin/settings-nav.tsx`), a "run the migration" notice when the table is missing, the placeholder hint.
- Placeholder state: rows with `placeholder = true` show the amber chip `placeholder — confirm` (`.chip chip-amber`), confirmed rows the green `confirmed` chip. **Every save sets `placeholder = false`** on the row it writes (saving is the confirmation). `company_settings` and `vat_rates` have no placeholder column; the company page instead flags fields containing the §5 markers `000-000` / `PL00` / `XXXX` / `[CONFIRM]` (invalid input + amber chip + notice listing the fields).
- Admin dashboard: new "Quoting settings" card (`components/admin/admin-cards.tsx`) with a chip — red when a settings table is missing, placeholder-yellow with the count of unconfirmed values, green when everything is confirmed. `lib/admin/dashboard.ts` gained `settings: AdminDashboardSettings | null` (additive; null when the overview read fails).
- Routes: `routes.adminSettings`, `routes.adminSettingsTable(slug)` in `lib/routes.ts`. Nav label `common.nav.settings` (PL "Ustawienia", EN "Settings") added to `content/common.ts` + `content/en/common.ts`.
- Copy: new `admin.settings` section and `admin.index.cards.settings` in `content/admin.ts` + `content/en/admin.ts` (titles, tabs, columns, field labels, hints, chips, errors, buttons). `npx vitest run content` passes.

## Files

New: `lib/admin/settings-types.ts`, `lib/admin/settings.ts`, `lib/admin/settings-actions.ts`, `components/admin/settings-table.tsx`, `components/admin/settings-row-tables.tsx`, `components/admin/settings-company-form.tsx`, `components/admin/settings-assembly-form.tsx`, `components/admin/settings-nav.tsx`, `components/admin/settings-frame.tsx`, `app/(app)/admin/settings/page.tsx` + `{company,vat,packaging,shipping,setups,assembly,weld-speeds}/page.tsx`, `test/admin/settings-actions.test.ts`, `test/admin/settings-queries.test.ts`, `test/admin/settings-routes.test.ts`.

Changed (additive): `lib/routes.ts`, `lib/admin/dashboard.ts`, `components/admin/admin-cards.tsx`, `content/admin.ts`, `content/en/admin.ts`, `content/common.ts`, `content/en/common.ts`.

## Exported API

### `lib/admin/settings-types.ts` (pure)

```ts
export const SETTINGS_TABLES: readonly ["company", "vat", "packaging", "shipping", "setups", "assembly", "weldSpeeds"];
export type SettingsTable = (typeof SETTINGS_TABLES)[number];
export const SETTINGS_TABLE_SLUGS: Record<SettingsTable, string>;   // weldSpeeds → "weld-speeds"
export const SETTINGS_DB_TABLES: Record<SettingsTable, string>;     // weldSpeeds → "weld_speeds"
export function isSettingsTable(value: unknown): value is SettingsTable;
export function settingsTableFromSlug(slug: string): SettingsTable | null;
export const JOB_SETUP_CODES: readonly JobSetupCodeDb[];
export const WELD_SPEED_PROCESSES: readonly WeldProcessDb[];
export function isJobSetupCode(value: unknown): value is JobSetupCodeDb;
export type SettingsErrorCode = "forbidden" | "validation" | "duplicate" | "notFound" | "missingTable" | "db";
export type SettingsActionResult = { ok: true } | { ok: false; error: SettingsErrorCode; field?: string; message?: string };
export const SETTINGS_MARGIN_MAX_PCT = 90;
export const COMPANY_SETTINGS_PLACEHOLDER_MARKERS: readonly string[];  // "000-000", "PL00", "XXXX", "[CONFIRM]"
export const COMPANY_TEXT_FIELDS: readonly [...16 column names];  export type CompanyTextField;
export const ASSEMBLY_RATE_FIELDS: readonly [...9 column names];  export type AssemblyRateField;
export type CompanySettingsInput = Record<CompanyTextField, string> & { oss_active: boolean | string; assembly_margin_pct: number | string; subcontract_margin_pct: number | string };
export type VatRateInput = { country: string; rate_pct: number | string };
export type PackagingRateInput = { code: string; name: string; max_side_mm: number | string; max_mass_kg: number | string; price_eur: number | string; position?: number | string | null };
export type ShippingRateInput = { id?: string | null; country: string; max_kg: number | string; price_eur: number | string; carrier?: string | null; position?: number | string | null };
export type JobSetupRateInput = { code: string; cost_eur: number | string; name?: string | null };
export type AssemblyRatesInput = Record<AssemblyRateField, number | string>;
export type WeldSpeedInput = { id?: string | null; process: string; thickness_mm: number | string; speed_mm_min: number | string };
export function companySettingsPlaceholderFields(row: Partial<Record<CompanyTextField, string | null>>): CompanyTextField[];
```

### `lib/admin/settings.ts` (server reads, `AdminClient` = RLS server client or service-role client)

```ts
export function isMissingTableError(error: { code?: string | null; message?: string } | null | undefined): boolean;
export type SettingsRows<T> = { rows: T[]; missing: boolean };
export type SettingsRow<T> = { row: T | null; missing: boolean };
export async function getCompanySettings(supabase: AdminClient): Promise<SettingsRow<CompanySettingsRow>>;
export async function listVatRates(supabase: AdminClient): Promise<SettingsRows<VatRateRow>>;
export async function listPackagingRates(supabase: AdminClient): Promise<SettingsRows<PackagingRateRow>>;
export async function listShippingRates(supabase: AdminClient): Promise<SettingsRows<ShippingRateRow>>;
export async function listJobSetupRates(supabase: AdminClient): Promise<SettingsRows<JobSetupRateRow>>;
export async function getAssemblyRates(supabase: AdminClient): Promise<SettingsRow<AssemblyRatesRow>>;
export async function listWeldSpeeds(supabase: AdminClient): Promise<SettingsRows<WeldSpeedRow>>;
export type SettingsTableSummary = { table: SettingsTable; dbTable: string; rowCount: number | null; placeholderCount: number; singleRow: boolean };
export type SettingsOverview = { tables: SettingsTableSummary[]; missing: boolean; placeholderCount: number };
export async function loadSettingsOverview(supabase: AdminClient): Promise<SettingsOverview>;
```

`missing: true` (with empty data) when the table does not exist (`42P01` / `PGRST205`); any other DB error throws. Numeric columns are normalised with `Number()`.

### `lib/admin/settings-actions.ts` ("use server", admin only, audit-logged)

```ts
export async function saveCompanySettings(input: CompanySettingsInput): Promise<SettingsActionResult>;   // audit "settings.company", entity company_settings, id "1"
export async function upsertVatRate(input: VatRateInput): Promise<SettingsActionResult>;                 // "settings.vat", upsert on country
export async function deleteVatRate(country: string): Promise<SettingsActionResult>;                     // "settings.vat", after = null
export async function upsertPackagingRate(input: PackagingRateInput): Promise<SettingsActionResult>;     // "settings.packaging", upsert on code
export async function deletePackagingRate(code: string): Promise<SettingsActionResult>;
export async function upsertShippingRate(input: ShippingRateInput): Promise<SettingsActionResult>;       // "settings.shipping", update by id or upsert on country+max_kg
export async function deleteShippingRate(id: string): Promise<SettingsActionResult>;
export async function saveJobSetupRate(input: JobSetupRateInput): Promise<SettingsActionResult>;         // "settings.setup", upsert on code (name kept unless given)
export async function saveAssemblyRates(input: AssemblyRatesInput): Promise<SettingsActionResult>;       // "settings.assembly", row id 1
export async function upsertWeldSpeed(input: WeldSpeedInput): Promise<SettingsActionResult>;             // "settings.weld_speed", update by id or upsert on process+thickness_mm
export async function deleteWeldSpeed(id: string): Promise<SettingsActionResult>;
```

Validation (zod): country = ISO-2 via `lib/customers/countries.ts` (`isCountryCode`, upper-cased); weld process ∈ `mig_mag | tig | laser | mma`; setup code ∈ `laser_nest | press_brake | roll | weld_fitup`; margins 0–90; VAT 0–99.99; sizes / masses / thickness / speed > 0; prices ≥ 0; distortion factor ≥ 1. Numbers accept "1,5" / "1.5" / 1.5 (`lib/number-input.ts`). On validation failure `field` is the first failing column. Every write sets `placeholder = false` (where the column exists), `updated_by`, `updated_at`, and revalidates `/admin/settings`, the table page and `/admin`.

### Components

```ts
// components/admin/settings-table.tsx (client)
export type SettingsColumn; export type SettingsEditableRow; export type SettingsTableProps;
export function SettingsTable(props: SettingsTableProps): JSX.Element;
export function settingsErrorText(result, errors, fieldPrefix, fieldLabels): string;
// components/admin/settings-row-tables.tsx (client)
export function VatRatesTable({ rows: VatRateRow[] }); PackagingRatesTable({ rows }); ShippingRatesTable({ rows }); JobSetupRatesTable({ rows }); WeldSpeedsTable({ rows });
// components/admin/settings-company-form.tsx (client)   export function CompanySettingsForm({ row: CompanySettingsRow | null });
// components/admin/settings-assembly-form.tsx (client)  export function AssemblyRatesForm({ row: AssemblyRatesRow | null });
// components/admin/settings-nav.tsx (client)            export function SettingsNav();
// components/admin/settings-frame.tsx (server-safe)     export function SettingsFrame({ content, table?, title, hint, missing?, placeholderHint?, actions?, children });
```

## Decisions and assumptions

- **Writes use `createAdminClient()` after an explicit admin check** (`getCurrentUser` + `hasRole(ADMIN_ONLY)`), as the stream brief asked; the existing machines / sheet-metal actions write through the RLS client instead. Both are safe (the tables have `is_admin()` write policies; the role is verified before the service-role client is created). A non-admin gets `{ ok: false, error: "forbidden" }` — no redirect inside an action, same as the sheet-metal actions. Reads on the pages go through the RLS client (`createClient()`).
- Actions take plain input objects (the brief's signatures) and return `SettingsActionResult`; the client tables call them directly inside `useTransition` and toast the outcome (no `useActionState`), because a `<form>` cannot wrap a `<tr>` and the rows are the forms.
- Inline row editing: every row of the five row tables is an editor (inputs in the cells, Save on Enter or the button, confirm-step Delete), plus a blank add row. Key columns of an existing row are read-only text. Rows are keyed by natural key + `updated_at` so the server refresh after a save remounts the row with the confirmed values.
- Job setups: the four codes are fixed by the migration's check constraint, so no add / delete; a missing code (unseeded database) appears as an add row with its content label as the name. `saveJobSetupRate` keeps the seeded `name` unless the form sends one; a brand-new row without a name is named by its code.
- Deletes log the same seven audit action names with `after: null` (the brief lists exactly seven names).
- Company placeholder detection duplicates the four §5 markers (`COMPANY_SETTINGS_PLACEHOLDER_MARKERS`) instead of importing `lib/pdf/company.ts` (pdf stream, still moving) to avoid a cross-stream compile dependency; the design doc fixes the list.
- Number display in the row editors is text via `formatNumberInput(…, { grouping: false })` (PL "1,5", EN "1.5"); the actions parse both.
- `[CONFIRM]`: all seeded numbers stay the migration's calibration placeholders; this stream invents none.

## Contract requests (files not owned by this stream)

1. `components/shell/sidebar.tsx` — add `{ key: "settings", href: routes.adminSettings }` to `ADMIN_ITEMS` (after `audit`), so the settings pages are reachable from the admin rail; the label `common.nav.settings` and the route already exist. Until then the pages are reachable from the admin dashboard card.
2. `components/shell/breadcrumbs.tsx` — add `settings: c.common.nav.settings` to `adminSections` so `/admin/settings/*` shows "Administracja / Ustawienia".

## Validation run

- `npx tsc --noEmit 2>&1 | grep -E "^(lib/admin|components/admin|app/\(app\)/admin|content/admin|content/common|content/en|lib/routes|test/admin)"` → empty.
- `npx eslint` on every file above → clean.
- `npx vitest run test/admin content` → see the report.

## Left undone

- Sidebar / breadcrumb entries (contract requests above).
- No CSV import/export for the settings tables (not in the brief; the row tables are small).
- No local-Postgres test of the RLS policies for the settings tables (the migration is owned by the contracts stream; `test/admin/db-guards.test.ts` pattern could be extended later).
