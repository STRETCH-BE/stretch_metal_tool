/**
 * Rate-version reads for the admin editor: version list with usage and
 * placeholder counts, one version's state (editable or locked), the rows
 * of one or all rate tables, the active version.
 * File path: /lib/admin/rates.ts
 *
 * Server only; takes the caller's client (RLS server client as the admin,
 * or the admin client from a route handler) so route handlers, pages and
 * actions share one code path. "Editable" = not active AND not referenced
 * by any quote: the DB trigger forbid_rate_edit_if_used enforces the
 * second half, the first is the product rule (edit a clone, then
 * activate). Counts are aggregated in TypeScript from narrow queries —
 * no PostgREST aggregates against the hand-written Database types.
 */

import type { ProfileRow, RateVersionRow } from "@/lib/db/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";
import { looseClient, type LooseRow } from "@/lib/admin/db";
import { RATE_TABLES, RATE_TABLE_NAMES, type RateTableName } from "@/lib/admin/tables";

export type AdminClient = ServerSupabase | AdminSupabase;

export type RateVersionSummary = RateVersionRow & {
  createdByName: string | null;
  quoteCount: number;
  placeholderCount: number;
};

export type RateVersionState = {
  version: RateVersionRow;
  quoteCount: number;
  placeholderCount: number;
  editable: boolean;
  createdByName: string | null;
};

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

/** Quotes per rate version (only versions in `versionIds`). */
export async function countQuotesByVersion(
  supabase: AdminClient,
  versionIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (versionIds.length === 0) return counts;
  const { data, error } = await supabase
    .from("quotes")
    .select("rate_version_id")
    .in("rate_version_id", [...versionIds]);
  if (error) fail("countQuotesByVersion", error);
  for (const row of data ?? []) {
    if (!row.rate_version_id) continue;
    counts.set(row.rate_version_id, (counts.get(row.rate_version_id) ?? 0) + 1);
  }
  return counts;
}

/** Placeholder rows per version, summed over the ten tables. */
export async function countPlaceholdersByVersion(
  supabase: AdminClient,
  versionIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (versionIds.length === 0) return counts;
  const loose = looseClient(supabase);
  const results = await Promise.all(
    RATE_TABLE_NAMES.map((name) =>
      loose
        .from(RATE_TABLES[name].dbTable)
        .select("rate_version_id")
        .eq("placeholder", true)
        .in("rate_version_id", [...versionIds])
    )
  );
  results.forEach((result, index) => {
    if (result.error) fail(`countPlaceholders ${RATE_TABLE_NAMES[index]}`, result.error);
    for (const row of result.data ?? []) {
      const id = typeof row.rate_version_id === "string" ? row.rate_version_id : null;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  });
  return counts;
}

async function profileNames(supabase: AdminClient, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return names;
  const { data, error } = await supabase.from("profiles").select("id, full_name, email").in("id", wanted);
  if (error) fail("profileNames", error);
  for (const row of (data ?? []) as Pick<ProfileRow, "id" | "full_name" | "email">[]) {
    names.set(row.id, row.full_name?.trim() || row.email);
  }
  return names;
}

/** Every version, newest first, with author, quote count and placeholder count. */
export async function listRateVersions(supabase: AdminClient): Promise<RateVersionSummary[]> {
  const { data, error } = await supabase
    .from("rate_versions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail("listRateVersions", error);
  const versions = (data ?? []) as RateVersionRow[];
  const ids = versions.map((v) => v.id);
  const [quotes, placeholders, names] = await Promise.all([
    countQuotesByVersion(supabase, ids),
    countPlaceholdersByVersion(supabase, ids),
    profileNames(
      supabase,
      versions.map((v) => v.created_by)
    ),
  ]);
  return versions.map((version) => ({
    ...version,
    createdByName: version.created_by ? (names.get(version.created_by) ?? null) : null,
    quoteCount: quotes.get(version.id) ?? 0,
    placeholderCount: placeholders.get(version.id) ?? 0,
  }));
}

export async function getRateVersion(supabase: AdminClient, id: string): Promise<RateVersionRow | null> {
  const { data, error } = await supabase.from("rate_versions").select("*").eq("id", id).maybeSingle();
  if (error) fail("getRateVersion", error);
  return (data as RateVersionRow | null) ?? null;
}

export async function getActiveRateVersion(supabase: AdminClient): Promise<RateVersionRow | null> {
  const { data, error } = await supabase.from("rate_versions").select("*").eq("active", true).maybeSingle();
  if (error) fail("getActiveRateVersion", error);
  return (data as RateVersionRow | null) ?? null;
}

/** Version + whether its rows may be edited (draft: not active, no quotes). */
export async function getRateVersionState(supabase: AdminClient, id: string): Promise<RateVersionState | null> {
  const version = await getRateVersion(supabase, id);
  if (!version) return null;
  const [quotes, placeholders, names] = await Promise.all([
    countQuotesByVersion(supabase, [id]),
    countPlaceholdersByVersion(supabase, [id]),
    profileNames(supabase, [version.created_by]),
  ]);
  const quoteCount = quotes.get(id) ?? 0;
  return {
    version,
    quoteCount,
    placeholderCount: placeholders.get(id) ?? 0,
    editable: !version.active && quoteCount === 0,
    createdByName: version.created_by ? (names.get(version.created_by) ?? null) : null,
  };
}

/** Rows of one rate table in a version, ordered by the natural key. */
export async function loadRateTableRows(
  supabase: AdminClient,
  versionId: string,
  table: RateTableName
): Promise<LooseRow[]> {
  const def = RATE_TABLES[table];
  let query = looseClient(supabase).from(def.dbTable).select("*").eq("rate_version_id", versionId);
  for (const column of def.keyColumns) query = query.order(column, { ascending: true });
  const { data, error } = await query;
  if (error) fail(`loadRateTableRows ${table}`, error);
  return data ?? [];
}

export async function loadAllRateTables(
  supabase: AdminClient,
  versionId: string
): Promise<Record<RateTableName, LooseRow[]>> {
  const entries = await Promise.all(
    RATE_TABLE_NAMES.map(async (name) => [name, await loadRateTableRows(supabase, versionId, name)] as const)
  );
  return Object.fromEntries(entries) as Record<RateTableName, LooseRow[]>;
}
