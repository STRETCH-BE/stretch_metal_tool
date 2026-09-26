"use server";

/**
 * Rate-editor server actions — clone / activate / delete a version, save
 * or delete one row of a draft version, import a CSV into a draft.
 * File path: /lib/admin/rates-actions.ts
 *
 * Admin only: every action re-checks the role (getCurrentUser + hasRole)
 * before touching the database; form actions redirect to /forbidden,
 * JSON-result actions return { ok: false, error: "forbidden" }. Writes go
 * through the RLS server client (the *_admin_write policies allow
 * admins); clone/activate use the SECURITY DEFINER functions
 * clone_rate_version / activate_rate_version.
 *
 * Draft rule: rows may be changed only in a version that is neither
 * active nor referenced by a quote (the trigger forbid_rate_edit_if_used
 * enforces the second half at the DB; the first is product policy — "edit
 * a clone, then activate"). Saving a row sets placeholder = false and
 * logs rate_<table>.insert|update|delete with before/after. CSV import
 * upserts by natural key and logs one rate_<table>.import entry.
 *
 * Errors are CODES from content.admin.rates.errors; "db" carries the raw
 * message for the notice.
 *
 * Two guards around the database's own behaviour:
 *   - activate_rate_version() deactivates EVERY version before it updates
 *     the requested id and does not check that the id exists, so a stale
 *     id (a draft another admin deleted meanwhile) would leave no active
 *     version at all. The action verifies the row first.
 *   - rate_laser references materials ON DELETE CASCADE: deleting a
 *     material silently removes every laser row of that material in the
 *     version. deleteRateRow refuses unless the caller passes cascade
 *     (the grid asks with the count) and audits each cascaded row.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_ONLY, getCurrentUser, hasRole, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import type { Json } from "@/lib/db/types";
import { dbErrorCode, looseClient, type LooseRow } from "@/lib/admin/db";
import { detectDelimiter, parseCsvRecords } from "@/lib/admin/csv";
import { countQuotesByVersion, getRateVersion, loadRateTableRows } from "@/lib/admin/rates";
import {
  CSV_MAX_BYTES,
  type CsvImportError,
  type CsvImportState,
  type DeleteRateRowInput,
  type DeleteRateRowResult,
  type RateRowRef,
  type SaveRateRowInput,
  type SaveRateRowResult,
} from "@/lib/admin/rates-types";
import { RATE_TABLES, isRateTableName, rateRowKey, validateRateRow, type RateTableName } from "@/lib/admin/tables";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asJson(value: unknown): Json | null {
  return value === undefined || value === null ? null : (JSON.parse(JSON.stringify(value)) as Json);
}

async function adminSession(): Promise<Session | null> {
  const session = await getCurrentUser();
  return hasRole(session, ADMIN_ONLY) ? session : null;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateVersion(id?: string) {
  revalidatePath(routes.adminRates);
  revalidatePath(routes.admin);
  if (id) {
    revalidatePath(routes.adminRateVersion(id));
    revalidatePath(routes.adminRateVersionDiff(id));
  }
}

type DraftCheck =
  | { ok: true }
  | { ok: false; error: "notFound" | "versionActive" | "versionHasQuotes" };

async function checkDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  versionId: string
): Promise<DraftCheck> {
  if (!UUID.test(versionId)) return { ok: false, error: "notFound" };
  const version = await getRateVersion(supabase, versionId);
  if (!version) return { ok: false, error: "notFound" };
  if (version.active) return { ok: false, error: "versionActive" };
  const quotes = await countQuotesByVersion(supabase, [versionId]);
  if ((quotes.get(versionId) ?? 0) > 0) return { ok: false, error: "versionHasQuotes" };
  return { ok: true };
}

/* ─── Versions (form actions) ─────────────────────────────── */

/** <form>: source (uuid), label, next ("version" opens the clone, else the list). */
export async function cloneRateVersionAction(formData: FormData): Promise<void> {
  const session = await adminSession();
  if (!session) redirect(routes.forbidden);
  const source = readString(formData, "source");
  const label = readString(formData, "label").slice(0, 120);
  if (!UUID.test(source)) redirect(`${routes.adminRates}?error=clone`);
  if (!label) redirect(`${routes.adminRates}?error=label`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clone_rate_version", { p_source: source, p_label: label });
  if (error || !data) {
    console.error("[admin/rates] clone failed", error);
    redirect(`${routes.adminRates}?error=clone`);
  }
  const newId = data as string;
  await logAudit({
    actor: session.user.id,
    action: "rate_version.clone",
    entity: "rate_versions",
    entityId: newId,
    before: { source },
    after: { id: newId, label },
  });
  revalidateVersion(newId);
  redirect(`${routes.adminRateVersion(newId)}?notice=cloned`);
}

/** Bound: activateRateVersionAction.bind(null, id). */
export async function activateRateVersionAction(id: string): Promise<void> {
  const session = await adminSession();
  if (!session) redirect(routes.forbidden);
  if (!UUID.test(id)) redirect(`${routes.adminRates}?error=activateMissing`);

  const supabase = await createClient();
  // The RPC has no "not found" check and deactivates everything first —
  // never call it for an id that is not a current version.
  const version = await getRateVersion(supabase, id);
  if (!version) redirect(`${routes.adminRates}?error=activateMissing`);
  if (version.active) redirect(`${routes.adminRates}?notice=activated`);
  const { data: previous } = await supabase.from("rate_versions").select("id, label").eq("active", true).maybeSingle();
  const { error } = await supabase.rpc("activate_rate_version", { p_version: id });
  if (error) {
    console.error("[admin/rates] activate failed", error);
    redirect(`${routes.adminRates}?error=activate`);
  }
  await logAudit({
    actor: session.user.id,
    action: "rate_version.activate",
    entity: "rate_versions",
    entityId: id,
    before: previous ? { activeId: previous.id, label: previous.label } : null,
    after: { activeId: id },
  });
  revalidateVersion(id);
  if (previous?.id) revalidatePath(routes.adminRateVersion(previous.id));
  redirect(`${routes.adminRates}?notice=activated`);
}

/** Bound: deleteRateVersionAction.bind(null, id). Only unused, non-active versions. */
export async function deleteRateVersionAction(id: string): Promise<void> {
  const session = await adminSession();
  if (!session) redirect(routes.forbidden);
  if (!UUID.test(id)) redirect(routes.adminRates);

  const supabase = await createClient();
  const draft = await checkDraft(supabase, id);
  if (!draft.ok) redirect(`${routes.adminRates}?error=delete`);
  const version = await getRateVersion(supabase, id);
  const { error } = await supabase.from("rate_versions").delete().eq("id", id);
  if (error) {
    console.error("[admin/rates] delete failed", error);
    redirect(`${routes.adminRates}?error=delete`);
  }
  await logAudit({
    actor: session.user.id,
    action: "rate_version.delete",
    entity: "rate_versions",
    entityId: id,
    before: asJson(version),
  });
  revalidateVersion(id);
  redirect(`${routes.adminRates}?notice=deleted`);
}

/* ─── Rows ────────────────────────────────────────────────── */

function refFilter(table: RateTableName, versionId: string, ref: RateRowRef): Record<string, unknown> | null {
  const def = RATE_TABLES[table];
  if (def.singleRow) return { rate_version_id: versionId };
  if (def.hasId) return ref.id && UUID.test(ref.id) ? { id: ref.id, rate_version_id: versionId } : null;
  // materials: keyed by (version, code)
  return ref.key ? { rate_version_id: versionId, code: ref.key } : null;
}

export async function saveRateRow(input: SaveRateRowInput): Promise<SaveRateRowResult> {
  const session = await adminSession();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isRateTableName(input.table)) return { ok: false, error: "unknownTable" };
  const validated = validateRateRow(input.table, input.values ?? {});
  if (!validated.ok) return { ok: false, error: "validation", fieldErrors: validated.fieldErrors };

  const supabase = await createClient();
  const draft = await checkDraft(supabase, input.versionId);
  if (!draft.ok) return { ok: false, error: draft.error };

  const def = RATE_TABLES[input.table];
  const loose = looseClient(supabase);
  const filter = refFilter(input.table, input.versionId, input.ref ?? {});
  const isUpdate = def.singleRow || Boolean(filter && (input.ref?.id || input.ref?.key));

  try {
    if (isUpdate && filter) {
      let read = loose.from(def.dbTable).select("*");
      for (const [column, value] of Object.entries(filter)) read = read.eq(column, value);
      const before = await read.maybeSingle();
      if (before.error) return { ok: false, error: "db", message: before.error.message };
      if (!before.data) return { ok: false, error: "notFound" };

      let write = loose.from(def.dbTable).update({ ...validated.values, placeholder: false });
      for (const [column, value] of Object.entries(filter)) write = write.eq(column, value);
      const after = await write.select("*").single();
      if (after.error || !after.data) {
        return { ok: false, error: after.error ? dbErrorCode(after.error) : "db", message: after.error?.message };
      }
      await logAudit({
        actor: session.user.id,
        action: `rate_${input.table}.update`,
        entity: def.dbTable,
        entityId: entityIdOf(input.table, input.versionId, after.data),
        before: asJson(before.data),
        after: asJson(after.data),
      });
      revalidateVersion(input.versionId);
      return { ok: true, row: after.data };
    }

    const inserted = await loose
      .from(def.dbTable)
      .insert({ ...validated.values, rate_version_id: input.versionId, placeholder: false })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      return {
        ok: false,
        error: inserted.error ? dbErrorCode(inserted.error) : "db",
        message: inserted.error?.message,
      };
    }
    await logAudit({
      actor: session.user.id,
      action: `rate_${input.table}.insert`,
      entity: def.dbTable,
      entityId: entityIdOf(input.table, input.versionId, inserted.data),
      after: asJson(inserted.data),
    });
    revalidateVersion(input.versionId);
    return { ok: true, row: inserted.data };
  } catch (error) {
    console.error("[admin/rates] save row failed", error);
    return { ok: false, error: "generic" };
  }
}

function entityIdOf(table: RateTableName, versionId: string, row: LooseRow): string {
  const def = RATE_TABLES[table];
  if (def.hasId && typeof row.id === "string") return row.id;
  if (def.singleRow) return versionId;
  return `${versionId}:${rateRowKey(table, row)}`;
}

export async function deleteRateRow(input: DeleteRateRowInput): Promise<DeleteRateRowResult> {
  const session = await adminSession();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isRateTableName(input.table)) return { ok: false, error: "unknownTable" };
  const def = RATE_TABLES[input.table];
  if (def.singleRow) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const draft = await checkDraft(supabase, input.versionId);
  if (!draft.ok) return { ok: false, error: draft.error };

  const filter = refFilter(input.table, input.versionId, input.ref ?? {});
  if (!filter) return { ok: false, error: "notFound" };
  const loose = looseClient(supabase);
  try {
    let read = loose.from(def.dbTable).select("*");
    for (const [column, value] of Object.entries(filter)) read = read.eq(column, value);
    const before = await read.maybeSingle();
    if (before.error) return { ok: false, error: "db", message: before.error.message };
    if (!before.data) return { ok: false, error: "notFound" };

    // materials: the laser rows of this material go with it (FK cascade).
    // Read them first — refuse without an explicit cascade, audit each one.
    let dependants: LooseRow[] = [];
    if (input.table === "materials") {
      const code = typeof before.data.code === "string" ? before.data.code : "";
      const laser = await loose
        .from("rate_laser")
        .select("*")
        .eq("rate_version_id", input.versionId)
        .eq("material_code", code);
      if (laser.error) return { ok: false, error: "db", message: laser.error.message };
      dependants = laser.data ?? [];
      if (dependants.length > 0 && !input.cascade) {
        return { ok: false, error: "materialInUse", count: dependants.length };
      }
    }

    let write = loose.from(def.dbTable).delete();
    for (const [column, value] of Object.entries(filter)) write = write.eq(column, value);
    const result = await write;
    if (result.error) return { ok: false, error: dbErrorCode(result.error), message: result.error.message };

    for (const row of dependants) {
      await logAudit({
        actor: session.user.id,
        action: "rate_laser.delete",
        entity: "rate_laser",
        entityId: entityIdOf("laser", input.versionId, row),
        before: asJson(row),
        after: { cascadedFrom: entityIdOf(input.table, input.versionId, before.data) },
      });
    }
    await logAudit({
      actor: session.user.id,
      action: `rate_${input.table}.delete`,
      entity: def.dbTable,
      entityId: entityIdOf(input.table, input.versionId, before.data),
      before: asJson(before.data),
      after: dependants.length > 0 ? { cascadedLaserRows: dependants.length } : null,
    });
    revalidateVersion(input.versionId);
    return dependants.length > 0 ? { ok: true, cascaded: dependants.length } : { ok: true };
  } catch (error) {
    console.error("[admin/rates] delete row failed", error);
    return { ok: false, error: "generic" };
  }
}

/* ─── CSV import ──────────────────────────────────────────── */

/** useActionState reducer, bound to (versionId, table). Field: file. */
export async function importRateCsv(
  versionId: string,
  table: string,
  _prev: CsvImportState,
  formData: FormData
): Promise<CsvImportState> {
  const session = await adminSession();
  if (!session) return { status: "error", error: "forbidden" };
  if (!isRateTableName(table)) return { status: "error", error: "unknownTable" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", error: "noFile" };
  if (file.size > CSV_MAX_BYTES) return { status: "error", error: "tooLarge" };

  const supabase = await createClient();
  const draft = await checkDraft(supabase, versionId);
  if (!draft.ok) return { status: "error", error: draft.error };

  const def = RATE_TABLES[table];
  let parsed: ReturnType<typeof parseCsvRecords>;
  try {
    const text = await file.text();
    parsed = parseCsvRecords(text, { delimiter: detectDelimiter(text) });
  } catch {
    return { status: "error", error: "invalid" };
  }
  if (parsed.records.length === 0) return { status: "error", error: "emptyFile" };
  const missing = def.columns.map((c) => c.name).filter((name) => !parsed.header.includes(name));
  if (missing.length > 0) return { status: "error", error: "missingColumns", missing };

  const existing = await loadRateTableRows(supabase, versionId, table);
  const byKey = new Map(existing.map((row) => [rateRowKey(table, row), row] as const));
  const loose = looseClient(supabase);
  const errors: CsvImportError[] = [];
  const importedKeys: string[] = [];

  for (const record of parsed.records) {
    const validated = validateRateRow(table, record.values);
    if (!validated.ok) {
      for (const [column, code] of Object.entries(validated.fieldErrors)) {
        errors.push({ line: record.line, column, code: code as CsvImportError["code"] });
      }
      continue;
    }
    const key = rateRowKey(table, validated.values);
    const current = def.singleRow ? (existing[0] ?? null) : (byKey.get(key) ?? null);
    const payload = { ...validated.values, placeholder: false };
    let result: { error: { message: string; code?: string } | null };
    if (current) {
      let write = loose.from(def.dbTable).update(payload).eq("rate_version_id", versionId);
      if (def.hasId && typeof current.id === "string") write = write.eq("id", current.id);
      else if (!def.singleRow) for (const column of def.keyColumns) write = write.eq(column, current[column]);
      result = await write;
    } else if (def.singleRow) {
      result = await loose.from(def.dbTable).insert({ ...payload, rate_version_id: versionId });
    } else {
      result = await loose.from(def.dbTable).insert({ ...payload, rate_version_id: versionId });
    }
    if (result.error) {
      errors.push({ line: record.line, code: dbErrorCode(result.error), message: result.error.message });
      continue;
    }
    importedKeys.push(key);
    byKey.set(key, { ...(current ?? {}), ...payload });
  }

  await logAudit({
    actor: session.user.id,
    action: `rate_${table}.import`,
    entity: def.dbTable,
    entityId: versionId,
    after: { imported: importedKeys.length, errors: errors.length, keys: importedKeys.slice(0, 200), file: file.name },
  });
  revalidateVersion(versionId);
  return { status: "done", imported: importedKeys.length, errors };
}
