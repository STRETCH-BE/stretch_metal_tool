"use server";

/**
 * Sheet-metal admin server actions: bend-table versions (clone, activate)
 * and rows (test bends), press-brake tools, hardware names. Admin only,
 * writes through RLS, every change audit-logged.
 * File path: /lib/admin/sheetmetal-actions.ts
 *
 * Row saves are upserts on the natural key (bend_table: version + family +
 * thickness + radius + angle; tools: code; hardware names: pattern) so
 * "add or correct" is one form. A bend row entered from a test bend
 * (flat length + measured legs) gets its allowance computed here
 * (lib/admin/sheetmetal.ts allowanceFromTestBend) and source = test_bend.
 * The database refuses edits of a version a quote pins ("immutable") →
 * error code versionUsed.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_ONLY, getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/types";
import { parseNumberInput } from "@/lib/number-input";
import { MATERIAL_FAMILIES } from "@/lib/admin/tables";
import { allowanceFromTestBend, type SheetFormState } from "@/lib/admin/sheetmetal";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function adminSession(): Promise<Session | null> {
  const session = await getCurrentUser();
  return session && hasRole(session, ADMIN_ONLY) ? session : null;
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (raw === "") return null;
  return parseNumberInput(raw);
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function dbError(message: string): SheetFormState {
  if (/immutable/i.test(message)) return { status: "error", error: "versionUsed" };
  if (/duplicate key|23505/i.test(message)) return { status: "error", error: "duplicate" };
  return { status: "error", error: "db", message };
}

function revalidateSheet(): void {
  revalidatePath(routes.adminBendTable);
  revalidatePath(routes.adminTooling);
  revalidatePath(routes.adminHardware);
  revalidatePath(routes.admin);
}

/* ─── Bend table versions ────────────────────────────────── */

export async function cloneBendTableVersionAction(sourceId: string, _prev: SheetFormState, formData: FormData): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const label = text(formData, "label").slice(0, 120);
  if (!label) return { status: "error", error: "validation", field: "label" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clone_bend_table_version", { p_source: sourceId, p_label: label });
  if (error || !data) return dbError(error?.message ?? "no id");
  await logAudit({ actor: session.user.id, action: "bend_table_version.clone", entity: "bend_table_versions", entityId: data, before: asJson({ source: sourceId }), after: asJson({ label }) });
  revalidateSheet();
  redirect(routes.adminBendTableVersion(data));
}

export async function activateBendTableVersionAction(versionId: string): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_bend_table_version", { p_version: versionId });
  if (error) return dbError(error.message);
  await logAudit({ actor: session.user.id, action: "bend_table_version.activate", entity: "bend_table_versions", entityId: versionId, before: null, after: asJson({ active: true }) });
  revalidateSheet();
  revalidatePath(routes.adminBendTableVersion(versionId));
  return { status: "saved" };
}

const bendRowSchema = z.object({
  material_family: z.enum(MATERIAL_FAMILIES),
  thickness_mm: z.number().positive(),
  inner_radius_mm: z.number().nonnegative(),
  v_die_mm: z.number().positive().nullable(),
  angle_deg: z.number().gt(0).lt(180),
  bend_allowance_mm: z.number().nonnegative(),
  note: z.string().max(200).nullable(),
});

export async function saveBendRowAction(versionId: string, _prev: SheetFormState, formData: FormData): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const thickness = num(formData, "thickness_mm");
  const radius = num(formData, "inner_radius_mm");
  let allowance = num(formData, "bend_allowance_mm");
  const flat = num(formData, "flat_length_mm");
  const legA = num(formData, "leg_a_mm");
  const legB = num(formData, "leg_b_mm");
  if (allowance === null && flat !== null && legA !== null && legB !== null && thickness !== null && radius !== null) {
    allowance = Math.round(allowanceFromTestBend(flat, legA, legB, radius, thickness) * 10000) / 10000;
  }
  const parsed = bendRowSchema.safeParse({
    material_family: text(formData, "material_family"),
    thickness_mm: thickness,
    inner_radius_mm: radius,
    v_die_mm: num(formData, "v_die_mm"),
    angle_deg: num(formData, "angle_deg") ?? 90,
    bend_allowance_mm: allowance,
    note: text(formData, "note") || null,
  });
  if (!parsed.success) return { status: "error", error: "validation", field: parsed.error.issues[0]?.path.join(".") };
  const supabase = await createClient();
  const existing = await supabase
    .from("bend_table")
    .select("*")
    .eq("version_id", versionId)
    .eq("material_family", parsed.data.material_family)
    .eq("thickness_mm", parsed.data.thickness_mm)
    .eq("inner_radius_mm", parsed.data.inner_radius_mm)
    .eq("angle_deg", parsed.data.angle_deg)
    .maybeSingle();
  if (existing.error) return dbError(existing.error.message);
  const row = { ...parsed.data, source: "test_bend" as const, version_id: versionId, created_by: session.user.id };
  const result = existing.data
    ? await supabase.from("bend_table").update(row).eq("id", existing.data.id).select("*").single()
    : await supabase.from("bend_table").insert(row).select("*").single();
  if (result.error || !result.data) return dbError(result.error?.message ?? "no row");
  await logAudit({
    actor: session.user.id,
    action: existing.data ? "bend_table.update" : "bend_table.insert",
    entity: "bend_table",
    entityId: result.data.id,
    before: existing.data ? asJson(existing.data) : null,
    after: asJson(result.data),
  });
  revalidateSheet();
  revalidatePath(routes.adminBendTableVersion(versionId));
  return { status: "saved" };
}

export async function deleteBendRowAction(versionId: string, rowId: string): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const supabase = await createClient();
  const before = await supabase.from("bend_table").select("*").eq("id", rowId).maybeSingle();
  if (before.error) return dbError(before.error.message);
  if (!before.data) return { status: "error", error: "notFound" };
  const { error } = await supabase.from("bend_table").delete().eq("id", rowId);
  if (error) return dbError(error.message);
  await logAudit({ actor: session.user.id, action: "bend_table.delete", entity: "bend_table", entityId: rowId, before: asJson(before.data), after: null });
  revalidateSheet();
  revalidatePath(routes.adminBendTableVersion(versionId));
  return { status: "saved" };
}

/* ─── Press-brake tools ──────────────────────────────────── */

const toolSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("punch"),
    code: z.string().min(1).max(60),
    name: z.string().min(1).max(160),
    height_mm: z.number().positive(),
    type: z.enum(["straight", "gooseneck"]),
    tip_radius_mm: z.number().nonnegative().nullable(),
    throat_depth_mm: z.number().nonnegative().nullable(),
  }),
  z.object({
    kind: z.literal("die"),
    code: z.string().min(1).max(60),
    name: z.string().min(1).max(160),
    v_mm: z.number().positive(),
    min_flange_mm: z.number().nonnegative(),
  }),
]);

export async function saveToolAction(_prev: SheetFormState, formData: FormData): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const kind = text(formData, "kind");
  const parsed = toolSchema.safeParse(
    kind === "die"
      ? { kind, code: text(formData, "code"), name: text(formData, "name"), v_mm: num(formData, "v_mm"), min_flange_mm: num(formData, "min_flange_mm") ?? 0 }
      : {
          kind: "punch",
          code: text(formData, "code"),
          name: text(formData, "name"),
          height_mm: num(formData, "height_mm"),
          type: text(formData, "type") || "straight",
          tip_radius_mm: num(formData, "tip_radius_mm"),
          throat_depth_mm: num(formData, "throat_depth_mm"),
        }
  );
  if (!parsed.success) return { status: "error", error: "validation", field: parsed.error.issues[0]?.path.join(".") };
  const row =
    parsed.data.kind === "punch"
      ? { code: parsed.data.code, kind: "punch" as const, name: parsed.data.name, height_mm: parsed.data.height_mm, type: parsed.data.type, tip_radius_mm: parsed.data.tip_radius_mm, throat_depth_mm: parsed.data.throat_depth_mm, v_mm: null, min_flange_mm: null }
      : { code: parsed.data.code, kind: "die" as const, name: parsed.data.name, height_mm: null, type: null, tip_radius_mm: null, throat_depth_mm: null, v_mm: parsed.data.v_mm, min_flange_mm: parsed.data.min_flange_mm };
  const supabase = await createClient();
  const before = await supabase.from("press_brake_tools").select("*").eq("code", row.code).maybeSingle();
  if (before.error) return dbError(before.error.message);
  const result = await supabase
    .from("press_brake_tools")
    .upsert({ ...row, placeholder: false, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: "code" })
    .select("*")
    .single();
  if (result.error || !result.data) return dbError(result.error?.message ?? "no row");
  await logAudit({ actor: session.user.id, action: before.data ? "press_brake_tool.update" : "press_brake_tool.insert", entity: "press_brake_tools", entityId: row.code, before: before.data ? asJson(before.data) : null, after: asJson(result.data) });
  revalidateSheet();
  return { status: "saved" };
}

export async function deleteToolAction(code: string): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const supabase = await createClient();
  const before = await supabase.from("press_brake_tools").select("*").eq("code", code).maybeSingle();
  if (before.error) return dbError(before.error.message);
  if (!before.data) return { status: "error", error: "notFound" };
  const { error } = await supabase.from("press_brake_tools").delete().eq("code", code);
  if (error) return dbError(error.message);
  await logAudit({ actor: session.user.id, action: "press_brake_tool.delete", entity: "press_brake_tools", entityId: code, before: asJson(before.data), after: null });
  revalidateSheet();
  return { status: "saved" };
}

/* ─── Hardware names ─────────────────────────────────────── */

const hardwareSchema = z.object({
  pattern: z.string().min(2).max(120),
  kind: z.enum(["weld_stud", "insert", "unknown"]),
  size: z.string().min(1).max(40),
  feature_code: z.string().max(60).nullable(),
  note: z.string().max(200).nullable(),
});

export async function saveHardwareNameAction(_prev: SheetFormState, formData: FormData): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const parsed = hardwareSchema.safeParse({
    pattern: text(formData, "pattern"),
    kind: text(formData, "kind"),
    size: text(formData, "size").toUpperCase().replace(/×/g, "X"),
    feature_code: text(formData, "feature_code").toLowerCase() || null,
    note: text(formData, "note") || null,
  });
  if (!parsed.success) return { status: "error", error: "validation", field: parsed.error.issues[0]?.path.join(".") };
  const supabase = await createClient();
  const before = await supabase.from("hardware_names").select("*").eq("pattern", parsed.data.pattern).maybeSingle();
  if (before.error) return dbError(before.error.message);
  const result = await supabase
    .from("hardware_names")
    .upsert({ ...parsed.data, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: "pattern" })
    .select("*")
    .single();
  if (result.error || !result.data) return dbError(result.error?.message ?? "no row");
  await logAudit({ actor: session.user.id, action: before.data ? "hardware_name.update" : "hardware_name.insert", entity: "hardware_names", entityId: result.data.id, before: before.data ? asJson(before.data) : null, after: asJson(result.data) });
  revalidateSheet();
  return { status: "saved" };
}

export async function deleteHardwareNameAction(id: string): Promise<SheetFormState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  const supabase = await createClient();
  const before = await supabase.from("hardware_names").select("*").eq("id", id).maybeSingle();
  if (before.error) return dbError(before.error.message);
  if (!before.data) return { status: "error", error: "notFound" };
  const { error } = await supabase.from("hardware_names").delete().eq("id", id);
  if (error) return dbError(error.message);
  await logAudit({ actor: session.user.id, action: "hardware_name.delete", entity: "hardware_names", entityId: id, before: asJson(before.data), after: null });
  revalidateSheet();
  return { status: "saved" };
}
