/**
 * Audit log reads — paginated, filtered by entity, action prefix, actor
 * and date range, with actor names resolved.
 * File path: /lib/admin/audit.ts
 *
 * RLS lets only admins read audit_log (audit_select), so the RLS server
 * client is enough. The entity filter options come from a bounded scan
 * of recent rows (PostgREST has no DISTINCT) unioned with the entities the
 * app writes, so the select never misses one.
 */

import type { AuditLogRow, ProfileRow } from "@/lib/db/types";
import type { AdminClient } from "@/lib/admin/rates";

export const AUDIT_PAGE_SIZE = 50;

/** Entities the app writes (lib/audit.ts callers); shown even before any row exists. */
export const KNOWN_AUDIT_ENTITIES = [
  "quotes",
  "customers",
  "rate_versions",
  "rate_general",
  "materials",
  "rate_laser",
  "rate_tube_laser",
  "rate_bend",
  "rate_roll",
  "rate_weld",
  "rate_thread",
  "rate_feature",
  "rate_finish",
  "machines",
  "profiles",
  "overrides",
] as const;

export type AuditFilters = {
  entity?: string;
  actionPrefix?: string;
  actor?: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  from?: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  to?: string;
  page?: number;
  pageSize?: number;
};

export type AuditListRow = AuditLogRow & { actorName: string | null };

export type AuditListResult = {
  rows: AuditListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

/** PostgREST pattern filters treat % and _ as wildcards — escape user input. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listAuditLog(supabase: AdminClient, filters: AuditFilters = {}): Promise<AuditListResult> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? AUDIT_PAGE_SIZE, 1), 200);
  const page = Math.max(1, Math.floor(filters.page ?? 1));

  let query = supabase.from("audit_log").select("*", { count: "exact" }).order("at", { ascending: false });
  const entity = filters.entity?.trim().slice(0, 64);
  if (entity) query = query.eq("entity", entity);
  const prefix = filters.actionPrefix?.trim().slice(0, 64);
  if (prefix) query = query.like("action", `${escapeLike(prefix)}%`);
  if (filters.actor && UUID.test(filters.actor)) query = query.eq("actor", filters.actor);
  if (filters.from && DATE.test(filters.from)) query = query.gte("at", `${filters.from}T00:00:00Z`);
  if (filters.to && DATE.test(filters.to)) query = query.lte("at", `${filters.to}T23:59:59.999Z`);

  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) fail("listAuditLog", error);
  const rows = (data ?? []) as AuditLogRow[];
  const total = count ?? 0;

  const actorIds = [...new Set(rows.map((r) => r.actor).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const profiles = await supabase.from("profiles").select("id, full_name, email").in("id", actorIds);
    if (profiles.error) fail("listAuditLog profiles", profiles.error);
    for (const p of (profiles.data ?? []) as Pick<ProfileRow, "id" | "full_name" | "email">[]) {
      names.set(p.id, p.full_name?.trim() || p.email);
    }
  }

  return {
    rows: rows.map((row) => ({ ...row, actorName: row.actor ? (names.get(row.actor) ?? null) : null })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
  };
}

/** Entities present in the log (recent 1000 rows) ∪ the known list, sorted. */
export async function listAuditEntities(supabase: AdminClient): Promise<string[]> {
  const { data, error } = await supabase.from("audit_log").select("entity").order("at", { ascending: false }).limit(1000);
  if (error) fail("listAuditEntities", error);
  const set = new Set<string>(KNOWN_AUDIT_ENTITIES);
  for (const row of (data ?? []) as Pick<AuditLogRow, "entity">[]) set.add(row.entity);
  return [...set].sort();
}

export async function listAuditActors(supabase: AdminClient): Promise<Pick<ProfileRow, "id" | "full_name" | "email">[]> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, email").order("email");
  if (error) fail("listAuditActors", error);
  return (data ?? []) as Pick<ProfileRow, "id" | "full_name" | "email">[];
}
