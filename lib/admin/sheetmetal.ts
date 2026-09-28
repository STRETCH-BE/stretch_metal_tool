/**
 * Sheet-metal admin reads + form-state contracts: bend-table versions and
 * rows, press-brake tooling, hardware names — SERVER reads through RLS,
 * the state types shared with the client forms.
 * File path: /lib/admin/sheetmetal.ts
 *
 * The bend table is versioned like the rate tables (bend_table_versions:
 * one active, clone to edit, immutable once a quote pins it). Tooling and
 * hardware names are plain admin tables (like machines).
 */

import type { BendTableRowDb, BendTableVersionRow, HardwareNameRow, PressBrakeToolRow } from "@/lib/db/types";
import type { SheetAdminError } from "@/content/admin";
import type { ServerSupabase } from "@/lib/supabase/server";

export type SheetFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: SheetAdminError; message?: string; field?: string };

export const INITIAL_SHEET_FORM_STATE: SheetFormState = { status: "idle" };

export type BendVersionSummary = BendTableVersionRow & { rowCount: number; usedByQuotes: number; createdByName: string | null };

export async function listBendTableVersions(supabase: ServerSupabase): Promise<BendVersionSummary[]> {
  const [versions, rows, quotes] = await Promise.all([
    supabase.from("bend_table_versions").select("*").order("created_at", { ascending: false }),
    supabase.from("bend_table").select("version_id"),
    supabase.from("quotes").select("bend_table_version_id").not("bend_table_version_id", "is", null),
  ]);
  if (versions.error) throw new Error(`bend_table_versions: ${versions.error.message}`);
  const rowCount = new Map<string, number>();
  for (const r of rows.data ?? []) rowCount.set(r.version_id, (rowCount.get(r.version_id) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const q of quotes.data ?? []) if (q.bend_table_version_id) used.set(q.bend_table_version_id, (used.get(q.bend_table_version_id) ?? 0) + 1);
  const creatorIds = Array.from(new Set((versions.data ?? []).map((v) => v.created_by).filter((id): id is string => Boolean(id))));
  const profiles = creatorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", creatorIds) : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name] as const));
  return (versions.data ?? []).map((v) => ({
    ...v,
    rowCount: rowCount.get(v.id) ?? 0,
    usedByQuotes: used.get(v.id) ?? 0,
    createdByName: v.created_by ? (names.get(v.created_by) ?? null) : null,
  }));
}

export type BendVersionDetail = { version: BendTableVersionRow; rows: BendTableRowDb[]; usedByQuotes: number };

export async function loadBendTableVersion(supabase: ServerSupabase, id: string): Promise<BendVersionDetail | null> {
  const [version, rows, quotes] = await Promise.all([
    supabase.from("bend_table_versions").select("*").eq("id", id).maybeSingle(),
    supabase.from("bend_table").select("*").eq("version_id", id).order("material_family").order("thickness_mm").order("inner_radius_mm").order("angle_deg"),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("bend_table_version_id", id),
  ]);
  if (version.error) throw new Error(`bend_table_versions: ${version.error.message}`);
  if (!version.data) return null;
  if (rows.error) throw new Error(`bend_table: ${rows.error.message}`);
  return {
    version: version.data,
    rows: (rows.data ?? []).map((r) => ({
      ...r,
      thickness_mm: Number(r.thickness_mm),
      inner_radius_mm: Number(r.inner_radius_mm),
      v_die_mm: r.v_die_mm === null ? null : Number(r.v_die_mm),
      angle_deg: Number(r.angle_deg),
      bend_allowance_mm: Number(r.bend_allowance_mm),
    })),
    usedByQuotes: quotes.count ?? 0,
  };
}

export async function listPressBrakeTools(supabase: ServerSupabase): Promise<PressBrakeToolRow[]> {
  const { data, error } = await supabase.from("press_brake_tools").select("*").order("kind").order("code");
  if (error) throw new Error(`press_brake_tools: ${error.message}`);
  return (data ?? []).map((t) => ({
    ...t,
    height_mm: t.height_mm === null ? null : Number(t.height_mm),
    tip_radius_mm: t.tip_radius_mm === null ? null : Number(t.tip_radius_mm),
    throat_depth_mm: t.throat_depth_mm === null ? null : Number(t.throat_depth_mm),
    v_mm: t.v_mm === null ? null : Number(t.v_mm),
    min_flange_mm: t.min_flange_mm === null ? null : Number(t.min_flange_mm),
  }));
}

export async function listHardwareNames(supabase: ServerSupabase): Promise<HardwareNameRow[]> {
  const { data, error } = await supabase.from("hardware_names").select("*").order("pattern");
  if (error) throw new Error(`hardware_names: ${error.message}`);
  return data ?? [];
}

/** Test-bend arithmetic: BA = flat − legA − legB + 2·(r + t) (outside legs measured after a 90° bend). */
export function allowanceFromTestBend(flatLengthMm: number, legAMm: number, legBMm: number, innerRadiusMm: number, thicknessMm: number): number {
  return flatLengthMm - legAMm - legBMm + 2 * (innerRadiusMm + thicknessMm);
}
