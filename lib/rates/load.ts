/**
 * Rate loading — the server-side glue between Supabase and the pure
 * pricing engine: reads a rate version's rows and the machine park and
 * hands them to rowsToRateSnapshot / rowsToMachinePark.
 * File path: /lib/rates/load.ts
 *
 * Works with either client (RLS server client for previews, admin client
 * for re-pricing on save/send) — only their TYPES are imported here, so
 * this module never touches env or cookies itself. Every rate table is
 * queried filtered by rate_version_id; `loadRateSnapshot()` without a
 * version id uses the active one and throws PricingError
 * "no_active_rate_version" when there is none. DB errors surface as
 * PricingError "db_error" naming the table — except a MISSING
 * press_brake_tools table (PGRST205 / 42P01: the sheet-metal migration not
 * applied yet), which loadMachinePark logs and treats as "no tools": the
 * tooling only feeds two DFM rules, and a schema that lags the code must
 * not take the machine park, and with it the part page's material list,
 * down.
 */

import type {
  AssemblyRatesRow,
  BendTableRowDb,
  BendTableVersionRow,
  CompanySettingsRow,
  HardwareNameRow,
  JobSetupRateRow,
  MachineRow,
  MaterialRow,
  PackagingRateRow,
  PressBrakeToolRow,
  RateBendRow,
  RateFeatureRow,
  RateFinishRow,
  RateGeneralRow,
  RateLaserRow,
  RateLeadtimeRow,
  RateRollRow,
  RateThreadRow,
  RateTubeLaserRow,
  RateVersionRow,
  RateWeldRow,
  ShippingRateRow,
  VatRateRow,
  WeldSpeedRow,
} from "@/lib/db/types";
import { PricingError } from "@/lib/pricing/errors";
import { rowsToMachinePark, rowsToRateSnapshot, type Loose, type RateRows } from "@/lib/pricing/snapshot";
import { rowsToJobRates, type JobRateRows } from "@/lib/pricing/job-rates";
import type { JobRates, MachinePark, PressBrakeTool, RateSnapshot } from "@/lib/pricing/types";
import type { BendTableLookup, BendTableRow, HardwareNameRule } from "@/lib/geometry/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";

export type RatesClient = ServerSupabase | AdminSupabase;

type DbError = { message: string; code?: string } | null;

/** PostgREST ("not in the schema cache") and Postgres (undefined_table) codes for a table that does not exist. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

/**
 * The row types are given explicitly (not inferred from the query): the
 * PostgREST response is a success | failure union and inference across it
 * collapses to `never`. The snapshot mapper re-validates every column
 * anyway (Number() + zod), so the cast is safe.
 */
async function rows<T>(
  query: PromiseLike<{ data: unknown; error: DbError }>,
  table: string
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new PricingError("db_error", `${table}: ${error.message}`, { table });
  return (data ?? []) as T[];
}

async function single<T>(
  query: PromiseLike<{ data: unknown; error: DbError }>,
  table: string
): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new PricingError("db_error", `${table}: ${error.message}`, { table });
  return (data ?? null) as T | null;
}

/** Id of the active rate version; throws when none is active. */
export async function loadActiveRateVersionId(supabase: RatesClient): Promise<string> {
  const row = await single<Pick<RateVersionRow, "id">>(
    supabase.from("rate_versions").select("id").eq("active", true).maybeSingle(),
    "rate_versions"
  );
  if (!row) {
    throw new PricingError("no_active_rate_version", "no active rate version — activate one in Admin → Rates");
  }
  return row.id;
}

/** Full rate snapshot for a version (the active one when omitted). */
export async function loadRateSnapshot(
  supabase: RatesClient,
  versionId?: string | null
): Promise<RateSnapshot> {
  const id = versionId ?? (await loadActiveRateVersionId(supabase));
  const byVersion = <T extends { eq: (column: "rate_version_id", value: string) => T }>(q: T): T =>
    q.eq("rate_version_id", id);

  const [version, general, materials, laser, tubeLaser, bend, roll, weld, thread, feature, finish, leadtime] =
    await Promise.all([
      single<Pick<RateVersionRow, "id" | "label">>(
        supabase.from("rate_versions").select("id, label").eq("id", id).maybeSingle(),
        "rate_versions"
      ),
      single<Loose<RateGeneralRow>>(byVersion(supabase.from("rate_general").select("*")).maybeSingle(), "rate_general"),
      rows<Loose<MaterialRow>>(byVersion(supabase.from("materials").select("*")).order("code"), "materials"),
      rows<Loose<RateLaserRow>>(
        byVersion(supabase.from("rate_laser").select("*")).order("material_code").order("thickness_mm"),
        "rate_laser"
      ),
      rows<Loose<RateTubeLaserRow>>(
        byVersion(supabase.from("rate_tube_laser").select("*")).order("profile_family").order("wall_mm"),
        "rate_tube_laser"
      ),
      rows<Loose<RateBendRow>>(
        byVersion(supabase.from("rate_bend").select("*")).order("thickness_mm").order("length_class_mm"),
        "rate_bend"
      ),
      rows<Loose<RateRollRow>>(
        byVersion(supabase.from("rate_roll").select("*")).order("thickness_mm").order("radius_class_mm"),
        "rate_roll"
      ),
      rows<Loose<RateWeldRow>>(byVersion(supabase.from("rate_weld").select("*")).order("process").order("bead_mm"), "rate_weld"),
      rows<Loose<RateThreadRow>>(byVersion(supabase.from("rate_thread").select("*")).order("size"), "rate_thread"),
      rows<Loose<RateFeatureRow>>(byVersion(supabase.from("rate_feature").select("*")).order("code"), "rate_feature"),
      rows<Loose<RateFinishRow>>(byVersion(supabase.from("rate_finish").select("*")).order("code"), "rate_finish"),
      rows<Loose<RateLeadtimeRow>>(
        byVersion(supabase.from("rate_leadtime").select("*")).order("working_days"),
        "rate_leadtime"
      ),
    ]);

  if (!version) {
    throw new PricingError("rate_version_not_found", `rate version ${id} does not exist`, { versionId: id });
  }
  if (!general) {
    throw new PricingError("rate_version_not_found", `rate version ${id} has no rate_general row`, {
      versionId: id,
    });
  }

  const rateRows: RateRows = {
    version,
    general,
    materials,
    laser,
    tubeLaser,
    bend,
    roll,
    weld,
    thread,
    feature,
    finish,
    leadtime,
  };
  return rowsToRateSnapshot(rateRows);
}

/**
 * The cost version a market-priced quote is compared against: `preferred`
 * when it is a cost-mode version, else the active version when it is in
 * cost mode, else the newest cost-mode version; null when none exists.
 */
export async function loadCostRateVersionId(supabase: RatesClient, preferred?: string | null): Promise<string | null> {
  const generals = await rows<Pick<RateGeneralRow, "rate_version_id" | "pricing_mode">>(
    supabase.from("rate_general").select("rate_version_id, pricing_mode").eq("pricing_mode", "cost"),
    "rate_general"
  );
  const costIds = new Set(generals.map((g) => g.rate_version_id));
  if (costIds.size === 0) return null;
  if (preferred && costIds.has(preferred)) return preferred;
  const versions = await rows<Pick<RateVersionRow, "id" | "active" | "created_at">>(
    supabase.from("rate_versions").select("id, active, created_at").in("id", [...costIds]).order("created_at", { ascending: false }),
    "rate_versions"
  );
  return versions.find((v) => v.active)?.id ?? versions[0]?.id ?? null;
}

/** press_brake_tools rows → the engine's tool list (numeric columns may arrive as strings). */
export function rowsToPressBrakeTools(list: Loose<PressBrakeToolRow>[]): PressBrakeTool[] {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const out: PressBrakeTool[] = [];
  for (const r of list) {
    if (r.kind === "punch") {
      const heightMm = num(r.height_mm);
      if (heightMm === null || heightMm <= 0) continue;
      out.push({
        kind: "punch",
        code: r.code,
        name: r.name,
        heightMm,
        type: r.type === "gooseneck" ? "gooseneck" : "straight",
        tipRadiusMm: num(r.tip_radius_mm) ?? 0,
        throatDepthMm: num(r.throat_depth_mm),
        placeholder: Boolean(r.placeholder),
      });
    } else if (r.kind === "die") {
      const vMm = num(r.v_mm);
      if (vMm === null || vMm <= 0) continue;
      out.push({ kind: "die", code: r.code, name: r.name, vMm, minFlangeMm: num(r.min_flange_mm) ?? 0, placeholder: Boolean(r.placeholder) });
    }
  }
  return out;
}

/**
 * The press-brake tools, or [] when the table does not exist (logged, never
 * silent — see the header). Any other error is a db_error like every table.
 */
async function loadPressBrakeTools(supabase: RatesClient): Promise<PressBrakeTool[]> {
  const { data, error } = (await supabase.from("press_brake_tools").select("*").order("code")) as { data: unknown; error: DbError };
  if (error) {
    if (error.code && MISSING_TABLE_CODES.has(error.code)) {
      console.warn(
        `[rates] press_brake_tools is missing (${error.code}) — apply supabase/migrations/20260928130000_sheetmetal_tables.sql; the DFM tooling rules run without tools until then`
      );
      return [];
    }
    throw new PricingError("db_error", `press_brake_tools: ${error.message}`, { table: "press_brake_tools" });
  }
  return rowsToPressBrakeTools((data ?? []) as Loose<PressBrakeToolRow>[]);
}

/** The machine park with validated limits (throws on malformed limits JSON); the press brake carries its tools (none when the table is missing). */
export async function loadMachinePark(supabase: RatesClient): Promise<MachinePark> {
  const [machines, toolList] = await Promise.all([
    rows<MachineRow>(supabase.from("machines").select("*").order("code"), "machines"),
    loadPressBrakeTools(supabase),
  ]);
  const park = rowsToMachinePark(machines);
  return park.map((m) => (m.kind === "press_brake" ? { ...m, tools: toolList } : m));
}

/* ─── Bend table + hardware names (STEP intake) ────────────── */

/** Id of the active bend-table version, or null when none is active. */
export async function loadActiveBendTableVersionId(supabase: RatesClient): Promise<string | null> {
  const row = await single<Pick<BendTableVersionRow, "id">>(
    supabase.from("bend_table_versions").select("id").eq("active", true).maybeSingle(),
    "bend_table_versions"
  );
  return row?.id ?? null;
}

export function rowsToBendTable(list: Loose<BendTableRowDb>[]): BendTableRow[] {
  return list.map((r) => ({
    materialFamily: r.material_family,
    thicknessMm: Number(r.thickness_mm),
    innerRadiusMm: Number(r.inner_radius_mm),
    vDieMm: r.v_die_mm === null || r.v_die_mm === undefined ? null : Number(r.v_die_mm),
    angleDeg: Number(r.angle_deg),
    bendAllowanceMm: Number(r.bend_allowance_mm),
    source: r.source === "test_bend" ? "test_bend" : "din6935",
  }));
}

/**
 * Rows of a bend-table version for the geometry engine (the active one
 * when no id is given). Never throws for a missing version: an empty
 * table makes the engine fall back to the DIN formula (amber flag).
 */
export async function loadBendTable(supabase: RatesClient, versionId?: string | null): Promise<{ versionId: string | null; rows: BendTableRow[] }> {
  const id = versionId ?? (await loadActiveBendTableVersionId(supabase));
  if (!id) return { versionId: null, rows: [] };
  const list = await rows<Loose<BendTableRowDb>>(supabase.from("bend_table").select("*").eq("version_id", id), "bend_table");
  return { versionId: id, rows: rowsToBendTable(list) };
}

export function bendTableLookupFor(materialFamily: string | null, rowsOfVersion: readonly BendTableRow[]): BendTableLookup {
  return { materialFamily, rows: rowsOfVersion };
}

export async function loadHardwareNames(supabase: RatesClient): Promise<HardwareNameRule[]> {
  const list = await rows<HardwareNameRow>(supabase.from("hardware_names").select("*").order("pattern"), "hardware_names");
  return list.map((r) => ({ pattern: r.pattern, kind: r.kind, size: r.size, featureCode: r.feature_code }));
}

/* ─── Job rates (assembly mode settings tables) ───────────── */

/**
 * A settings table that the deployed database does not have yet (the
 * assembly-mode migration not applied) reads as empty: rowsToJobRates then
 * falls back to the seeded defaults and marks the rates as placeholder.
 */
async function optionalRows<T>(query: PromiseLike<{ data: unknown; error: DbError }>, table: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    if (error.code && MISSING_TABLE_CODES.has(error.code)) {
      console.warn(`[rates] ${table} is missing (${error.code}) — apply supabase/migrations/20260930100000_assembly_mode.sql; seeded defaults used`);
      return [];
    }
    throw new PricingError("db_error", `${table}: ${error.message}`, { table });
  }
  return (data ?? []) as T[];
}

/** The admin-edited job rates: setups, assembly labour, weld speeds, packaging, shipping, VAT, company margins. */
export async function loadJobRates(supabase: RatesClient): Promise<JobRates> {
  const [company, vat, packaging, shipping, setups, assembly, weldSpeeds] = await Promise.all([
    optionalRows<Loose<CompanySettingsRow>>(supabase.from("company_settings").select("*").limit(1), "company_settings"),
    optionalRows<Loose<VatRateRow>>(supabase.from("vat_rates").select("*").order("country"), "vat_rates"),
    optionalRows<Loose<PackagingRateRow>>(supabase.from("packaging_rates").select("*").order("position"), "packaging_rates"),
    optionalRows<Loose<ShippingRateRow>>(supabase.from("shipping_rates").select("*").order("country").order("max_kg"), "shipping_rates"),
    optionalRows<Loose<JobSetupRateRow>>(supabase.from("job_setup_rates").select("*").order("code"), "job_setup_rates"),
    optionalRows<Loose<AssemblyRatesRow>>(supabase.from("assembly_rates").select("*").limit(1), "assembly_rates"),
    optionalRows<Loose<WeldSpeedRow>>(supabase.from("weld_speeds").select("*").order("process").order("thickness_mm"), "weld_speeds"),
  ]);
  const rows: JobRateRows = { company: company[0] ?? null, vat, packaging, shipping, setups, assembly: assembly[0] ?? null, weldSpeeds };
  return rowsToJobRates(rows);
}

/** The company_settings row (PDF company block, OSS flag, margins), or null when the table is empty or missing. */
export async function loadCompanySettings(supabase: RatesClient): Promise<CompanySettingsRow | null> {
  const rows = await optionalRows<Loose<CompanySettingsRow>>(supabase.from("company_settings").select("*").limit(1), "company_settings");
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    id: Number(r.id),
    assembly_margin_pct: Number(r.assembly_margin_pct),
    subcontract_margin_pct: Number(r.subcontract_margin_pct),
    oss_active: r.oss_active === true || (r.oss_active as unknown) === "true",
  } as CompanySettingsRow;
}
