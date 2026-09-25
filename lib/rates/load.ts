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
  MachineRow,
  MaterialRow,
  RateBendRow,
  RateFeatureRow,
  RateFinishRow,
  RateGeneralRow,
  RateLaserRow,
  RateRollRow,
  RateThreadRow,
  RateTubeLaserRow,
  RateVersionRow,
  RateWeldRow,
} from "@/lib/db/types";
import { PricingError } from "@/lib/pricing/errors";
import { rowsToMachinePark, rowsToRateSnapshot, type Loose, type RateRows } from "@/lib/pricing/snapshot";
import type { MachinePark, RateSnapshot } from "@/lib/pricing/types";
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

  const [version, general, materials, laser, tubeLaser, bend, roll, weld, thread, feature, finish] =
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
  };
  return rowsToRateSnapshot(rateRows);
}

/** The machine park with validated limits (throws on malformed limits JSON). */
export async function loadMachinePark(supabase: RatesClient): Promise<MachinePark> {
  const machines = await rows<MachineRow>(supabase.from("machines").select("*").order("code"), "machines");
  return rowsToMachinePark(machines);
}
