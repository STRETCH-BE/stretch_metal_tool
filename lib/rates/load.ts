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
 * PricingError "db_error" naming the table.
 */

import type {
  BendTableRowDb,
  BendTableVersionRow,
  HardwareNameRow,
  MachineRow,
  MaterialRow,
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
} from "@/lib/db/types";
import { PricingError } from "@/lib/pricing/errors";
import { rowsToMachinePark, rowsToRateSnapshot, type Loose, type RateRows } from "@/lib/pricing/snapshot";
import type { MachinePark, PressBrakeTool, RateSnapshot } from "@/lib/pricing/types";
import type { BendTableLookup, BendTableRow, HardwareNameRule } from "@/lib/geometry/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";

export type RatesClient = ServerSupabase | AdminSupabase;

type DbError = { message: string } | null;

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

/** The machine park with validated limits (throws on malformed limits JSON); the press brake carries its tools. */
export async function loadMachinePark(supabase: RatesClient): Promise<MachinePark> {
  const [machines, tools] = await Promise.all([
    rows<MachineRow>(supabase.from("machines").select("*").order("code"), "machines"),
    rows<Loose<PressBrakeToolRow>>(supabase.from("press_brake_tools").select("*").order("code"), "press_brake_tools"),
  ]);
  const park = rowsToMachinePark(machines);
  const toolList = rowsToPressBrakeTools(tools);
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
