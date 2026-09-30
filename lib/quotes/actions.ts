"use server";

/**
 * Quote server actions — every mutation of a quote from the builder UI.
 * File path: /lib/quotes/actions.ts
 *
 * Pattern for each action: zod-validate the input (lib/quotes/schema.ts),
 * resolve the session + quote through requireQuoteEditor (admin or the
 * owning sales user; viewers and strangers get "forbidden"), write with
 * the RLS client as the user, audit-log the change, re-price on the
 * server when a price input changed (lib/quotes/reprice.ts — the client
 * preview is never persisted), and revalidate the quote + list routes.
 * Errors come back as CODES (content.quote.builder.errors); actions never
 * throw to the client except Next's own redirect.
 *
 * Non-obvious decisions:
 *   - removeItem deletes the PART (cascade: item + operations): a part
 *     belongs to exactly one quote and one item, so an orphan part would
 *     only clutter the "unattached" list.
 *   - duplicateAsNewVersion copies header, parts (geometry, annotations,
 *     file references), items and seams; number unchanged, version =
 *     max + 1, status draft, rate_version_id = the ACTIVE version, owner =
 *     the duplicating user. Overrides/confirmations are NOT copied: the
 *     new rate version may change the flags, so acceptance starts over.
 *   - confirmFlag (amber acknowledgement) inserts an override row with
 *     status 'approved', decided_by = requester and the note "confirmed by
 *     sales" through the ADMIN client (the overrides_update policy is
 *     admin-only, and inserting an already-approved row explicitly must
 *     not depend on the insert policy's silence about `status`). Only
 *     flags that are currently on the quote and marked overridable can be
 *     confirmed or overridden; red flags can be neither.
 *   - requestOverride flips quotes.status to pending_override; the admin
 *     queue (admin module) decides and flips it back.
 *   - setQuoteStatus accepts won/lost only from `sent`.
 *
 * Assembly mode (docs/assembly-mode-design.md §2, §5):
 *   - removeAssembly DETACHES the members first (assembly_id null,
 *     qty_per_assembly 1, qty kept) and only then deletes the row: the FK
 *     quote_items.assembly_id is ON DELETE CASCADE, so deleting first would
 *     take the member items with it. Seams cascade in the DB.
 *   - setItemAssembly recomputes quote_items.qty = assembly.qty ×
 *     qty_per_assembly when moving a part in; moving it out keeps the last
 *     computed qty as the loose quantity.
 *   - confirmNoForming stores the confirmation as ONE forming operation
 *     whose resolution is { kind: "none_needed" } carrying the geometry the
 *     drawing suggested (the roll annotation's radius / angle / width, else
 *     the bend lines as a bend operation, else a roll with zeros). The
 *     engine's formingSuspected() treats any none_needed operation as the
 *     confirmation; nothing new was added to the contract for it. Existing
 *     forming operations are replaced by the confirmation — "none needed"
 *     contradicts them.
 *   - addSeamFromPart (the viewer's weld tool) applies matchSeam: the same
 *     edge marked twice returns the existing seam (no duplicate row); the
 *     neighbour part's edge of the same joint is stored paired and not
 *     counted. addSeam (typed in the builder) never matches. unpairSeam
 *     puts a wrongly paired seam back into the count.
 *   - updateQuoteHeader treats the new header fields (customer reference,
 *     contact person, shipping, price scale) as "keep when omitted", so a
 *     client posting the old header shape does not erase them.
 */

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, hasRole, WRITE_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { EnvError } from "@/lib/env";
import { routes } from "@/lib/routes";
import { isPricingError } from "@/lib/pricing/errors";
import { loadActiveRateVersionId } from "@/lib/rates/load";
import type { AssemblyRow, AssemblySeamRow, Json, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import type { FormingOperation } from "@/lib/pricing/types";
import { QuoteAccessError, requireQuoteEditor, requireQuoteReader, type QuoteEditor } from "./access";
import { createDraftQuote } from "./create";
import { memberQty, toJson } from "./mapper";
import { listQuoteVersions } from "./queries";
import { repriceQuote } from "./reprice";
import {
  assemblyInputSchema,
  assemblyUpdateSchema,
  decisionStatusSchema,
  fail,
  firstErrorCode,
  formingInputSchema,
  formingResolutionSchema,
  itemAssemblySchema,
  itemMaterialOverrideSchema,
  itemUpdateSchema,
  OK,
  overrideRequestSchema,
  parseAnnotations,
  parseFlags,
  parseForming,
  parseGeometry,
  parseNewQuoteForm,
  quoteHeaderSchema,
  readNewQuoteForm,
  seamInputSchema,
  seamPatchSchema,
  weldingOnlySchema,
  type AssemblyInput,
  type ItemUpdateInput,
  type NewQuoteFormState,
  type OverrideRequestInput,
  type QuoteActionResult,
  type QuoteErrorCode,
  type QuoteHeaderInput,
  type SeamInput,
} from "./schema";
import { matchSeam, seamInputToColumns, seamRowToInput } from "./seams";
import { sendQuote } from "./send";
import { isUuid, nextVersionNumber, overrideMatchesFlag } from "./shared";
import type { MailOutcome, SendBlockReason } from "./types";

const CONFIRMATION_NOTE = "confirmed by sales";

function revalidateQuote(id: string) {
  revalidatePath(routes.quotes);
  revalidatePath(routes.quote(id));
}

/** The failure half of QuoteActionResult (also the failure half of the assembly / seam results). */
type ActionFailure = { ok: false; error: QuoteErrorCode; message?: string };

function failure(error: QuoteErrorCode, message?: string): ActionFailure {
  return message ? { ok: false, error, message } : { ok: false, error };
}

function accessFailure(error: unknown): ActionFailure | null {
  if (error instanceof QuoteAccessError) {
    if (error.code === "unauthenticated") redirect(routes.login);
    return failure(error.code);
  }
  return null;
}

/** Re-price after a mutation; pricing/rates problems become error codes. */
async function repriceAndRevalidate(quoteId: string): Promise<QuoteActionResult> {
  try {
    await repriceQuote(quoteId);
  } catch (error) {
    revalidateQuote(quoteId);
    if (isPricingError(error)) {
      if (error.code === "no_active_rate_version" || error.code === "rate_version_not_found") return fail("noRates");
      return fail("pricing", error.message);
    }
    const access = accessFailure(error);
    if (access) return access;
    console.error("[quotes] reprice failed", error);
    // A missing server variable (the service-role key on a deployment that
    // lacks it) is a configuration problem, not a bug: name it.
    if (error instanceof EnvError) return fail("config", error.message);
    return fail("generic");
  }
  revalidateQuote(quoteId);
  return OK;
}

/* ─── Create ──────────────────────────────────────────────── */

export async function createQuote(_prev: NewQuoteFormState, formData: FormData): Promise<NewQuoteFormState> {
  const values = readNewQuoteForm(formData);
  const session = await getCurrentUser();
  if (!session) redirect(routes.login);
  if (!hasRole(session, WRITE_ROLES)) return { status: "error", error: "forbidden", values };

  const parsed = parseNewQuoteForm(formData);
  if (!parsed.ok) return { status: "error", error: parsed.error, values };

  let created: { id: string; number: string };
  try {
    created = await createDraftQuote({
      createdBy: session.user.id,
      type: parsed.data.type,
      customerId: parsed.data.customerId,
      currency: parsed.data.currency,
      fxRate: parsed.data.fxRate,
      marginPct: parsed.data.marginPct,
      validityDays: parsed.data.validityDays,
      leadTimeText: parsed.data.leadTimeText,
      paymentTermsText: parsed.data.paymentTermsText,
      notes: parsed.data.notes,
    });
    if (parsed.data.type === "welding_only") {
      const supabase = await createClient();
      await supabase
        .from("quotes")
        .update({ welding_only: { seams: [], partsCount: 0 } })
        .eq("id", created.id);
    }
  } catch (error) {
    console.error("[quotes] create failed", error);
    return { status: "error", error: "generic", values };
  }

  await logAudit({
    actor: session.user.id,
    action: "quote.create",
    entity: "quotes",
    entityId: created.id,
    after: { number: created.number, type: parsed.data.type, currency: parsed.data.currency },
  });
  revalidateQuote(created.id);
  redirect(routes.quote(created.id));
}

/* ─── Header ──────────────────────────────────────────────── */

export async function updateQuoteHeader(quoteId: string, input: QuoteHeaderInput): Promise<QuoteActionResult> {
  const parsed = quoteHeaderSchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  let editor;
  try {
    editor = await requireQuoteEditor(quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase, quote } = editor;
  const data = parsed.data;

  if (data.customerId) {
    const { data: customer } = await supabase.from("customers").select("id").eq("id", data.customerId).maybeSingle();
    if (!customer) return fail("notFound");
  }

  const update: Partial<QuoteRow> = {
    customer_id: data.customerId,
    currency: data.currency,
    fx_rate: data.currency === "EUR" ? 1 : data.fxRate,
    margin_pct: data.marginPct,
    validity_days: data.validityDays,
    lead_time_days: data.leadTimeDays,
    lead_time_text: data.leadTimeText,
    payment_terms_text: data.paymentTermsText,
    notes: data.notes,
    show_operations_on_pdf: data.showOperationsOnPdf,
    welding_separate: data.weldingSeparate,
  };
  // Assembly-mode fields: omitted = keep (see the header).
  if (data.customerReference !== undefined) update.customer_reference = data.customerReference;
  if (data.contactPerson !== undefined) update.contact_person = data.contactPerson;
  if (data.shipping !== undefined) update.shipping = data.shipping === null ? null : toJson(data.shipping);
  if (data.priceScale !== undefined) update.price_scale = data.priceScale;
  const { error } = await supabase.from("quotes").update(update).eq("id", quoteId);
  if (error) {
    console.error("[quotes] header update failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.update",
    entity: "quotes",
    entityId: quoteId,
    before: pickHeader(quote),
    after: toJson(update),
  });
  return repriceAndRevalidate(quoteId);
}

function pickHeader(quote: QuoteRow): Json {
  return toJson({
    customer_id: quote.customer_id,
    currency: quote.currency,
    fx_rate: quote.fx_rate,
    margin_pct: quote.margin_pct,
    validity_days: quote.validity_days,
    lead_time_days: quote.lead_time_days,
    lead_time_text: quote.lead_time_text,
    payment_terms_text: quote.payment_terms_text,
    notes: quote.notes,
    show_operations_on_pdf: quote.show_operations_on_pdf,
    welding_separate: quote.welding_separate,
    customer_reference: quote.customer_reference,
    contact_person: quote.contact_person,
    shipping: quote.shipping,
    price_scale: quote.price_scale,
  });
}

/* ─── Items ───────────────────────────────────────────────── */

async function loadItem(itemId: string): Promise<QuoteItemRow | null> {
  if (!isUuid(itemId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("quote_items").select("*").eq("id", itemId).maybeSingle();
  return data ?? null;
}

export async function updateItem(itemId: string, input: ItemUpdateInput): Promise<QuoteActionResult> {
  const parsed = itemUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  let editor;
  try {
    editor = await requireQuoteEditor(item.quote_id, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase } = editor;
  const data = parsed.data;
  const update: Partial<QuoteItemRow> = {};
  if (data.qty !== undefined) update.qty = data.qty;
  if (data.extras !== undefined) update.extras = toJson(data.extras);
  if (data.scrapPct !== undefined) update.scrap_pct = data.scrapPct;
  if (data.notes !== undefined) update.notes = data.notes;
  if (Object.keys(update).length === 0) return OK;

  const { error } = await supabase.from("quote_items").update(update).eq("id", itemId);
  if (error) {
    console.error("[quotes] item update failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.item.update",
    entity: "quote_items",
    entityId: itemId,
    before: toJson({ quote_id: item.quote_id, qty: item.qty, extras: item.extras, scrap_pct: item.scrap_pct, notes: item.notes }),
    after: toJson({ quote_id: item.quote_id, ...update }),
  });
  return repriceAndRevalidate(item.quote_id);
}

export async function removeItem(itemId: string): Promise<QuoteActionResult> {
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  let editor;
  try {
    editor = await requireQuoteEditor(item.quote_id, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase } = editor;
  const { error } = await supabase.from("parts").delete().eq("id", item.part_id);
  if (error) {
    console.error("[quotes] item remove failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.item.remove",
    entity: "quote_items",
    entityId: itemId,
    before: toJson({ quote_id: item.quote_id, part_id: item.part_id, qty: item.qty }),
  });
  return repriceAndRevalidate(item.quote_id);
}

/** Attach a part of the quote that has no item yet (e.g. right after an upload that created only the part). */
export async function addItem(quoteId: string, partId: string): Promise<QuoteActionResult> {
  if (!isUuid(partId)) return fail("notFound");
  let editor;
  try {
    editor = await requireQuoteEditor(quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase } = editor;
  const { data: part } = await supabase.from("parts").select("id, quote_id").eq("id", partId).maybeSingle();
  if (!part || part.quote_id !== quoteId) return fail("notFound");
  const { data: existing } = await supabase.from("quote_items").select("id").eq("quote_id", quoteId).eq("part_id", partId).maybeSingle();
  if (existing) return OK;
  const { data: last } = await supabase
    .from("quote_items")
    .select("position")
    .eq("quote_id", quoteId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (last?.position ?? -1) + 1;
  const { data: inserted, error } = await supabase
    .from("quote_items")
    .insert({ quote_id: quoteId, part_id: partId, position, qty: 1 })
    .select("id")
    .single();
  if (error || !inserted) {
    console.error("[quotes] add item failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.item.add",
    entity: "quote_items",
    entityId: inserted.id,
    after: { quote_id: quoteId, part_id: partId, position },
  });
  return repriceAndRevalidate(quoteId);
}

export async function reorderItems(quoteId: string, orderedItemIds: string[]): Promise<QuoteActionResult> {
  const ids = z.array(z.string().uuid()).max(500).safeParse(orderedItemIds);
  if (!ids.success) return fail("invalid");
  let editor;
  try {
    editor = await requireQuoteEditor(quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase } = editor;
  for (const [index, id] of ids.data.entries()) {
    const { error } = await supabase.from("quote_items").update({ position: index }).eq("id", id).eq("quote_id", quoteId);
    if (error) {
      console.error("[quotes] reorder failed", error);
      return fail("generic");
    }
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.item.reorder",
    entity: "quotes",
    entityId: quoteId,
    after: { order: ids.data },
  });
  return repriceAndRevalidate(quoteId);
}

/* ─── Assemblies (docs/assembly-mode-design.md) ───────────── */

export type AssemblyActionResult = QuoteActionResult | { ok: true; assemblyId: string };

export type SeamActionResult =
  | { ok: true; seamId: string; pairedSeamId: string | null }
  | { ok: false; error: QuoteErrorCode; message?: string };

async function loadAssembly(assemblyId: string): Promise<AssemblyRow | null> {
  if (!isUuid(assemblyId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("assemblies").select("*").eq("id", assemblyId).maybeSingle();
  return data ?? null;
}

async function loadSeam(seamId: string): Promise<AssemblySeamRow | null> {
  if (!isUuid(seamId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("assembly_seams").select("*").eq("id", seamId).maybeSingle();
  return data ?? null;
}

/** requireQuoteEditor as a result instead of a throw. */
async function editorFor(quoteId: string): Promise<{ editor: QuoteEditor } | { failure: ActionFailure }> {
  try {
    return { editor: await requireQuoteEditor(quoteId, { editableOnly: true }) };
  } catch (error) {
    return { failure: accessFailure(error) ?? failure("generic") };
  }
}

function positionAfter(last: { position?: number | string } | null | undefined): number {
  const value = last?.position;
  return value === undefined || value === null ? 0 : (Number(value) || 0) + 1;
}

async function nextAssemblyPosition(supabase: QuoteEditor["supabase"], quoteId: string): Promise<number> {
  const { data } = await supabase.from("assemblies").select("position").eq("quote_id", quoteId).order("position", { ascending: false }).limit(1).maybeSingle();
  return positionAfter(data);
}

async function nextSeamPosition(supabase: QuoteEditor["supabase"], assemblyId: string): Promise<number> {
  const { data } = await supabase.from("assembly_seams").select("position").eq("assembly_id", assemblyId).order("position", { ascending: false }).limit(1).maybeSingle();
  return positionAfter(data);
}

function assemblyJson(row: AssemblyRow | Partial<AssemblyRow>): Json {
  return toJson({
    quote_id: row.quote_id,
    name: row.name,
    drawing_ref: row.drawing_ref,
    qty: row.qty,
    material_code: row.material_code,
    thickness_mm: row.thickness_mm,
    notes: row.notes,
    position: row.position,
  });
}

/** New welded assembly on a quote; position = next. */
export async function createAssembly(quoteId: string, input: AssemblyInput): Promise<AssemblyActionResult> {
  const parsed = assemblyInputSchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const access = await editorFor(quoteId);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const position = await nextAssemblyPosition(supabase, quoteId);
  const row = {
    quote_id: quoteId,
    position,
    name: parsed.data.name,
    drawing_ref: parsed.data.drawingRef,
    qty: parsed.data.qty,
    material_code: parsed.data.materialCode,
    thickness_mm: parsed.data.thicknessMm,
    notes: parsed.data.notes,
  };
  const { data: inserted, error } = await supabase.from("assemblies").insert(row).select("id").single();
  if (error || !inserted) {
    console.error("[quotes] assembly create failed", error);
    return fail("generic");
  }
  await logAudit({ actor: session.user.id, action: "assembly.create", entity: "assemblies", entityId: inserted.id, after: assemblyJson(row) });
  const repriced = await repriceAndRevalidate(quoteId);
  if (!repriced.ok) return repriced;
  return { ok: true, assemblyId: inserted.id };
}

export async function updateAssembly(assemblyId: string, input: Partial<AssemblyInput>): Promise<QuoteActionResult> {
  const parsed = assemblyUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const assembly = await loadAssembly(assemblyId);
  if (!assembly) return fail("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const data = parsed.data;
  const update: Partial<AssemblyRow> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.drawingRef !== undefined) update.drawing_ref = data.drawingRef;
  if (data.qty !== undefined) update.qty = data.qty;
  if (data.materialCode !== undefined) update.material_code = data.materialCode;
  if (data.thicknessMm !== undefined) update.thickness_mm = data.thicknessMm;
  if (data.notes !== undefined) update.notes = data.notes;
  if (Object.keys(update).length === 0) return OK;
  const { error } = await supabase.from("assemblies").update(update).eq("id", assemblyId);
  if (error) {
    console.error("[quotes] assembly update failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "assembly.update",
    entity: "assemblies",
    entityId: assemblyId,
    before: assemblyJson(assembly),
    after: assemblyJson({ ...assembly, ...update }),
  });
  return repriceAndRevalidate(assembly.quote_id);
}

/** Members become loose parts (assembly_id null, qty_per_assembly 1); the seams cascade in the DB. */
export async function removeAssembly(assemblyId: string): Promise<QuoteActionResult> {
  const assembly = await loadAssembly(assemblyId);
  if (!assembly) return fail("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const { error: detachError } = await supabase.from("quote_items").update({ assembly_id: null, qty_per_assembly: 1 }).eq("assembly_id", assemblyId);
  if (detachError) {
    console.error("[quotes] assembly detach members failed", detachError);
    return fail("generic");
  }
  const { error } = await supabase.from("assemblies").delete().eq("id", assemblyId);
  if (error) {
    console.error("[quotes] assembly remove failed", error);
    return fail("generic");
  }
  await logAudit({ actor: session.user.id, action: "assembly.remove", entity: "assemblies", entityId: assemblyId, before: assemblyJson(assembly) });
  return repriceAndRevalidate(assembly.quote_id);
}

/** Move an item into an assembly (qty = assembly.qty × qtyPerAssembly) or out of it (loose, qty kept). */
export async function setItemAssembly(itemId: string, input: { assemblyId: string | null; qtyPerAssembly?: number }): Promise<QuoteActionResult> {
  const parsed = itemAssemblySchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  const access = await editorFor(item.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const update: Partial<QuoteItemRow> = {};
  if (parsed.data.assemblyId) {
    const assembly = await loadAssembly(parsed.data.assemblyId);
    if (!assembly || assembly.quote_id !== item.quote_id) return fail("notFound");
    const perAssembly = parsed.data.qtyPerAssembly ?? (item.assembly_id === assembly.id ? Math.max(1, Number(item.qty_per_assembly) || 1) : 1);
    update.assembly_id = assembly.id;
    update.qty_per_assembly = perAssembly;
    update.qty = memberQty(assembly, { qty_per_assembly: perAssembly });
  } else {
    update.assembly_id = null;
    update.qty_per_assembly = 1;
  }
  const { error } = await supabase.from("quote_items").update(update).eq("id", itemId);
  if (error) {
    console.error("[quotes] item assembly update failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.item.assembly",
    entity: "quote_items",
    entityId: itemId,
    before: toJson({ quote_id: item.quote_id, assembly_id: item.assembly_id, qty_per_assembly: item.qty_per_assembly, qty: item.qty }),
    after: toJson({ quote_id: item.quote_id, ...update }),
  });
  return repriceAndRevalidate(item.quote_id);
}

export async function setItemMaterialOverride(itemId: string, input: { materialOverride: boolean; materialNote: string | null }): Promise<QuoteActionResult> {
  const parsed = itemMaterialOverrideSchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  const access = await editorFor(item.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const update = { material_override: parsed.data.materialOverride, material_note: parsed.data.materialNote };
  const { error } = await supabase.from("quote_items").update(update).eq("id", itemId);
  if (error) {
    console.error("[quotes] item material override failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.item.material_override",
    entity: "quote_items",
    entityId: itemId,
    before: toJson({ quote_id: item.quote_id, material_override: item.material_override, material_note: item.material_note }),
    after: toJson({ quote_id: item.quote_id, ...update }),
  });
  return repriceAndRevalidate(item.quote_id);
}

/* ─── Forming operations ──────────────────────────────────── */

async function storeForming(editor: QuoteEditor, item: QuoteItemRow, forming: FormingOperation[], action: string): Promise<QuoteActionResult> {
  const { error } = await editor.supabase.from("quote_items").update({ forming: toJson(forming) }).eq("id", item.id);
  if (error) {
    console.error("[quotes] forming update failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: editor.session.user.id,
    action,
    entity: "quote_items",
    entityId: item.id,
    before: toJson({ quote_id: item.quote_id, forming: item.forming }),
    after: toJson({ quote_id: item.quote_id, forming }),
  });
  return repriceAndRevalidate(item.quote_id);
}

/** Replace the item's forming operations (ids kept when given, generated otherwise). */
export async function setItemForming(itemId: string, forming: unknown): Promise<QuoteActionResult> {
  const parsed = formingInputSchema.safeParse(forming);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  const access = await editorFor(item.quote_id);
  if ("failure" in access) return access.failure;
  const seen = new Set<string>();
  const ops: FormingOperation[] = parsed.data.map((op) => {
    let id = op.id ?? randomUUID();
    while (seen.has(id)) id = randomUUID();
    seen.add(id);
    return { ...op, id, resolution: op.resolution ?? null } as FormingOperation;
  });
  return storeForming(access.editor, item, ops, "quote.item.forming");
}

/** Set the resolution of one forming operation (in_house, step_bend, subcontract, none_needed). */
export async function resolveForming(itemId: string, operationId: string, resolution: unknown): Promise<QuoteActionResult> {
  const parsedResolution = formingResolutionSchema.safeParse(resolution);
  if (!parsedResolution.success) return fail(firstErrorCode(parsedResolution.error));
  if (typeof operationId !== "string" || operationId.length === 0 || operationId.length > 80) return fail("invalid");
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  const access = await editorFor(item.quote_id);
  if ("failure" in access) return access.failure;
  const forming = parseForming(item.forming);
  const index = forming.findIndex((op) => op.id === operationId);
  if (index < 0) return fail("notFound");
  const next = forming.map((op, i) => (i === index ? ({ ...op, resolution: parsedResolution.data } as FormingOperation) : op));
  return storeForming(access.editor, item, next, "forming.resolve");
}

/**
 * The user confirms the part needs no forming although the drawing
 * suggested it: stored as one operation resolved none_needed with the
 * suspected geometry (see the header).
 */
export async function confirmNoForming(itemId: string): Promise<QuoteActionResult> {
  const item = await loadItem(itemId);
  if (!item) return fail("notFound");
  const access = await editorFor(item.quote_id);
  if ("failure" in access) return access.failure;
  const { data: part } = await access.editor.supabase.from("parts").select("annotations, geometry").eq("id", item.part_id).maybeSingle();
  const partRow = part as Pick<PartRow, "annotations" | "geometry"> | null;
  const annotations = parseAnnotations(partRow?.annotations);
  const geometry = parseGeometry(partRow?.geometry);
  const resolution = { kind: "none_needed" } as const;
  const clampAngle = (value: unknown) => Math.min(360, Math.max(0, Math.abs(Number(value) || 0)));
  // What the drawing suggested: the roll annotation, else the bend lines
  // (annotated, or on the DXF's layers / drawn — candidates awaiting a
  // triage answer are not a suggestion yet), else a roll with zeros.
  const bendLines = [
    ...annotations.bends.map((b) => ({ lengthMm: Number(b.lengthMm) || 0, angleDeg: Number(b.angleDeg) || 0 })),
    ...(geometry?.measures.bendLines ?? []).filter((b) => b.source !== "candidate").map((b) => ({ lengthMm: Number(b.lengthMm) || 0, angleDeg: Number(b.angleDeg ?? 90) || 0 })),
  ];
  let op: FormingOperation;
  if (annotations.roll) {
    op = {
      id: randomUUID(),
      kind: "roll",
      insideRadiusMm: Math.max(0, Number(annotations.roll.radiusMm) || 0),
      angleDeg: clampAngle(annotations.roll.arcAngleDeg),
      widthMm: Math.max(0, Number(annotations.roll.axisLengthMm) || 0),
      resolution,
    };
  } else if (bendLines.length > 0) {
    op = {
      id: randomUUID(),
      kind: "bend",
      bends: bendLines.length,
      angleDeg: clampAngle(bendLines[0].angleDeg),
      lengthMm: Math.max(0, ...bendLines.map((b) => b.lengthMm)),
      resolution,
    };
  } else {
    op = { id: randomUUID(), kind: "roll", insideRadiusMm: 0, angleDeg: 0, widthMm: 0, resolution };
  }
  return storeForming(access.editor, item, [op], "forming.confirm_none");
}

/* ─── Assembly seams ──────────────────────────────────────── */

function seamJson(row: Partial<AssemblySeamRow>): Json {
  return toJson({
    assembly_id: row.assembly_id,
    part_id: row.part_id,
    label: row.label,
    length_mm: row.length_mm,
    process: row.process,
    seam_type: row.seam_type,
    stitch_bead_mm: row.stitch_bead_mm,
    stitch_pitch_mm: row.stitch_pitch_mm,
    tack_count: row.tack_count,
    sides: row.sides,
    thickness_mm: row.thickness_mm,
    paired_seam_id: row.paired_seam_id,
    entity_ids: row.entity_ids,
  });
}

/**
 * A seam may reference only a part that is a member of its assembly: the
 * foreign key alone (checked as table owner, outside RLS) would accept any
 * part id, even one of a quote the caller cannot see.
 */
async function isMemberPart(supabase: QuoteEditor["supabase"], assemblyId: string, partId: string): Promise<boolean> {
  const { data } = await supabase.from("quote_items").select("id").eq("assembly_id", assemblyId).eq("part_id", partId).limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function insertSeam(editor: QuoteEditor, assembly: AssemblyRow, input: SeamInput, pairedSeamId: string | null): Promise<SeamActionResult> {
  const parsed = seamInputSchema.safeParse(input);
  if (!parsed.success) return failure(firstErrorCode(parsed.error));
  const { session, supabase } = editor;
  if (parsed.data.partId && !(await isMemberPart(supabase, assembly.id, parsed.data.partId))) return failure("notFound");
  const position = await nextSeamPosition(supabase, assembly.id);
  const columns = seamInputToColumns(parsed.data);
  const row = { ...columns, points: toJson(columns.points), assembly_id: assembly.id, position, paired_seam_id: pairedSeamId };
  const { data: inserted, error } = await supabase.from("assembly_seams").insert(row).select("id").single();
  if (error || !inserted) {
    console.error("[quotes] seam add failed", error);
    return failure("generic");
  }
  await logAudit({ actor: session.user.id, action: "seam.add", entity: "assembly_seams", entityId: inserted.id, after: seamJson(row) });
  const repriced = await repriceAndRevalidate(assembly.quote_id);
  if (!repriced.ok) return repriced;
  return { ok: true, seamId: inserted.id, pairedSeamId };
}

/** A seam typed in the builder (never matched against existing seams). */
export async function addSeam(assemblyId: string, input: SeamInput): Promise<SeamActionResult> {
  const parsed = seamInputSchema.safeParse(input);
  if (!parsed.success) return failure(firstErrorCode(parsed.error));
  const assembly = await loadAssembly(assemblyId);
  if (!assembly) return failure("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  return insertSeam(access.editor, assembly, input, null);
}

/**
 * The viewer's weld tool on a part that belongs to an assembly: the same
 * edge twice → the existing seam (idempotent); the neighbour's edge →
 * stored paired and not counted; otherwise a new counted seam.
 */
export async function addSeamFromPart(partId: string, input: SeamInput): Promise<SeamActionResult> {
  if (!isUuid(partId)) return failure("notFound");
  const candidate = seamInputSchema.safeParse({ ...input, partId });
  if (!candidate.success) return failure(firstErrorCode(candidate.error));
  const supabase = await createClient();
  const { data: item } = await supabase.from("quote_items").select("*").eq("part_id", partId).maybeSingle();
  if (!item || !item.assembly_id) return failure("notFound");
  const assembly = await loadAssembly(item.assembly_id);
  if (!assembly || assembly.quote_id !== item.quote_id) return failure("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  const { data: existingRows, error } = await access.editor.supabase.from("assembly_seams").select("*").eq("assembly_id", assembly.id).order("position");
  if (error) {
    console.error("[quotes] seams read failed", error);
    return failure("generic");
  }
  const existing = (existingRows ?? []) as AssemblySeamRow[];
  const match = matchSeam(existing, {
    partId,
    entityIds: candidate.data.entityIds,
    lengthMm: candidate.data.lengthMm,
    process: candidate.data.process,
  });
  if (match.kind === "duplicate") return { ok: true, seamId: match.seam.id, pairedSeamId: match.seam.paired_seam_id };
  return insertSeam(access.editor, assembly, { ...input, partId }, match.kind === "paired" ? match.seam.id : null);
}

export async function updateSeam(seamId: string, input: Partial<SeamInput>): Promise<QuoteActionResult> {
  const patch = seamPatchSchema.safeParse(input);
  if (!patch.success) return failure(firstErrorCode(patch.error));
  const seam = await loadSeam(seamId);
  if (!seam) return failure("notFound");
  const assembly = await loadAssembly(seam.assembly_id);
  if (!assembly) return failure("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const merged: Record<string, unknown> = { ...seamRowToInput(seam) };
  for (const [key, value] of Object.entries(patch.data)) if (value !== undefined) merged[key] = value;
  const full = seamInputSchema.safeParse(merged);
  if (!full.success) return failure(firstErrorCode(full.error));
  if (full.data.partId && full.data.partId !== seam.part_id && !(await isMemberPart(supabase, assembly.id, full.data.partId))) return failure("notFound");
  const columns = seamInputToColumns(full.data);
  const update = { ...columns, points: toJson(columns.points) };
  const { error } = await supabase.from("assembly_seams").update(update).eq("id", seamId);
  if (error) {
    console.error("[quotes] seam update failed", error);
    return failure("generic");
  }
  await logAudit({ actor: session.user.id, action: "seam.update", entity: "assembly_seams", entityId: seamId, before: seamJson(seam), after: seamJson({ ...seam, ...update }) });
  return repriceAndRevalidate(assembly.quote_id);
}

/** Delete a seam; a seam paired to it becomes counted again. */
export async function removeSeam(seamId: string): Promise<QuoteActionResult> {
  const seam = await loadSeam(seamId);
  if (!seam) return failure("notFound");
  const assembly = await loadAssembly(seam.assembly_id);
  if (!assembly) return failure("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const { error: unpairError } = await supabase.from("assembly_seams").update({ paired_seam_id: null }).eq("paired_seam_id", seamId);
  if (unpairError) {
    console.error("[quotes] seam unpair failed", unpairError);
    return failure("generic");
  }
  const { error } = await supabase.from("assembly_seams").delete().eq("id", seamId);
  if (error) {
    console.error("[quotes] seam remove failed", error);
    return failure("generic");
  }
  await logAudit({ actor: session.user.id, action: "seam.remove", entity: "assembly_seams", entityId: seamId, before: seamJson(seam) });
  return repriceAndRevalidate(assembly.quote_id);
}

/** Put a seam matchSeam paired wrongly back into the count. */
export async function unpairSeam(seamId: string): Promise<QuoteActionResult> {
  const seam = await loadSeam(seamId);
  if (!seam) return failure("notFound");
  if (!seam.paired_seam_id) return OK;
  const assembly = await loadAssembly(seam.assembly_id);
  if (!assembly) return failure("notFound");
  const access = await editorFor(assembly.quote_id);
  if ("failure" in access) return access.failure;
  const { session, supabase } = access.editor;
  const { error } = await supabase.from("assembly_seams").update({ paired_seam_id: null }).eq("id", seamId);
  if (error) {
    console.error("[quotes] seam unpair failed", error);
    return failure("generic");
  }
  await logAudit({ actor: session.user.id, action: "seam.unpair", entity: "assembly_seams", entityId: seamId, before: seamJson(seam), after: seamJson({ ...seam, paired_seam_id: null }) });
  return repriceAndRevalidate(assembly.quote_id);
}

/* ─── Welding-only seams ──────────────────────────────────── */

export async function updateWeldingOnly(quoteId: string, input: unknown): Promise<QuoteActionResult> {
  const parsed = weldingOnlySchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  let editor;
  try {
    editor = await requireQuoteEditor(quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase, quote } = editor;
  const block = toJson(parsed.data);
  const { error } = await supabase.from("quotes").update({ welding_only: block }).eq("id", quoteId);
  if (error) {
    console.error("[quotes] welding update failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.welding.update",
    entity: "quotes",
    entityId: quoteId,
    before: quote.welding_only,
    after: block,
  });
  return repriceAndRevalidate(quoteId);
}

/* ─── Duplicate as new version ────────────────────────────── */

export async function duplicateAsNewVersion(quoteId: string): Promise<QuoteActionResult> {
  let reader;
  try {
    reader = await requireQuoteReader(quoteId);
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase, quote } = reader;
  if (!hasRole(session, WRITE_ROLES)) return fail("forbidden");

  let activeVersionId: string;
  try {
    activeVersionId = await loadActiveRateVersionId(supabase);
  } catch {
    return fail("noRates");
  }
  const versions = await listQuoteVersions(supabase, quote.number);
  const version = nextVersionNumber(versions.map((v) => v.version));

  const { data: created, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      number: quote.number,
      version,
      type: quote.type,
      status: "draft",
      customer_id: quote.customer_id,
      currency: quote.currency,
      fx_rate: quote.fx_rate,
      margin_pct: quote.margin_pct,
      validity_days: quote.validity_days,
      lead_time_days: quote.lead_time_days,
      lead_time_text: quote.lead_time_text,
      payment_terms_text: quote.payment_terms_text,
      rate_version_id: activeVersionId,
      show_operations_on_pdf: quote.show_operations_on_pdf,
      welding_separate: quote.welding_separate,
      welding_only: quote.welding_only,
      notes: quote.notes,
      created_by: session.user.id,
      // Assembly-mode header columns; a database without the migration returns
      // no price_scale on the source row, and then must not be sent the columns.
      ...(quote.price_scale === undefined
        ? {}
        : {
            customer_reference: quote.customer_reference ?? null,
            contact_person: quote.contact_person ?? null,
            shipping: quote.shipping ?? null,
            price_scale: quote.price_scale ?? [],
          }),
    })
    .select("id")
    .single();
  if (quoteError || !created) {
    console.error("[quotes] duplicate failed", quoteError);
    return fail("generic");
  }
  const newId = created.id;

  const { data: parts } = await supabase.from("parts").select("*").eq("quote_id", quoteId).order("created_at");
  const { data: items } = await supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("position");
  const partMap = new Map<string, string>();
  for (const part of (parts ?? []) as PartRow[]) {
    const { data: copy, error } = await supabase
      .from("parts")
      .insert({
        quote_id: newId,
        name: part.name,
        source: part.source,
        file_id: part.file_id,
        pdf_file_id: part.pdf_file_id,
        file_hash: part.file_hash,
        material_code: part.material_code,
        thickness_mm: part.thickness_mm,
        geometry: part.geometry,
        annotations: part.annotations,
        triage: part.triage,
        thumbnail_svg: part.thumbnail_svg,
        pdf_text: part.pdf_text,
        ai_suggestions: part.ai_suggestions,
      })
      .select("id")
      .single();
    if (error || !copy) {
      console.error("[quotes] duplicate part failed", error);
      return fail("generic");
    }
    partMap.set(part.id, copy.id);
  }

  // Assemblies (old id → new id) before the items that point at them.
  const { data: assemblyRows } = await supabase.from("assemblies").select("*").eq("quote_id", quoteId).order("position");
  const assemblyMap = new Map<string, string>();
  for (const assembly of (assemblyRows ?? []) as AssemblyRow[]) {
    const { data: copy, error } = await supabase
      .from("assemblies")
      .insert({
        quote_id: newId,
        position: assembly.position,
        name: assembly.name,
        drawing_ref: assembly.drawing_ref,
        qty: assembly.qty,
        material_code: assembly.material_code,
        thickness_mm: assembly.thickness_mm,
        notes: assembly.notes,
      })
      .select("id")
      .single();
    if (error || !copy) {
      console.error("[quotes] duplicate assembly failed", error);
      return fail("generic");
    }
    assemblyMap.set(assembly.id, copy.id);
  }

  for (const item of (items ?? []) as QuoteItemRow[]) {
    const partId = partMap.get(item.part_id);
    if (!partId) continue;
    // Member columns exist only once the assembly-mode migration is applied
    // (the source row then carries qty_per_assembly).
    const memberColumns =
      item.qty_per_assembly === undefined
        ? {}
        : {
            assembly_id: item.assembly_id ? (assemblyMap.get(item.assembly_id) ?? null) : null,
            qty_per_assembly: item.qty_per_assembly,
            material_override: item.material_override,
            material_note: item.material_note,
            forming: item.forming,
          };
    const { error } = await supabase.from("quote_items").insert({
      quote_id: newId,
      part_id: partId,
      position: item.position,
      qty: item.qty,
      extras: item.extras,
      scrap_pct: item.scrap_pct,
      notes: item.notes,
      ...memberColumns,
    });
    if (error) {
      console.error("[quotes] duplicate item failed", error);
      return fail("generic");
    }
  }

  // Seams: part ids through the part map, the pairing through a second pass
  // once every new seam id is known.
  if (assemblyMap.size > 0) {
    const { data: seamRows } = await supabase.from("assembly_seams").select("*").in("assembly_id", [...assemblyMap.keys()]).order("position");
    const seams = (seamRows ?? []) as AssemblySeamRow[];
    const seamMap = new Map<string, string>();
    for (const seam of seams) {
      const assemblyId = assemblyMap.get(seam.assembly_id);
      if (!assemblyId) continue;
      const { data: copy, error } = await supabase
        .from("assembly_seams")
        .insert({
          assembly_id: assemblyId,
          position: seam.position,
          label: seam.label,
          part_id: seam.part_id ? (partMap.get(seam.part_id) ?? null) : null,
          entity_ids: seam.entity_ids,
          points: seam.points,
          length_mm: seam.length_mm,
          process: seam.process,
          thickness_mm: seam.thickness_mm,
          seam_type: seam.seam_type,
          stitch_bead_mm: seam.stitch_bead_mm,
          stitch_pitch_mm: seam.stitch_pitch_mm,
          tack_count: seam.tack_count,
          sides: seam.sides,
          paired_seam_id: null,
        })
        .select("id")
        .single();
      if (error || !copy) {
        console.error("[quotes] duplicate seam failed", error);
        return fail("generic");
      }
      seamMap.set(seam.id, copy.id);
    }
    for (const seam of seams) {
      if (!seam.paired_seam_id) continue;
      const copyId = seamMap.get(seam.id);
      const pairedId = seamMap.get(seam.paired_seam_id);
      if (!copyId || !pairedId) continue;
      const { error } = await supabase.from("assembly_seams").update({ paired_seam_id: pairedId }).eq("id", copyId);
      if (error) {
        console.error("[quotes] duplicate seam pairing failed", error);
        return fail("generic");
      }
    }
  }

  await logAudit({
    actor: session.user.id,
    action: "quote.duplicate",
    entity: "quotes",
    entityId: newId,
    before: { source_quote_id: quoteId, version: quote.version },
    after: { number: quote.number, version, rate_version_id: activeVersionId },
  });
  const result = await repriceAndRevalidate(newId);
  if (!result.ok) return result;
  revalidateQuote(quoteId);
  redirect(routes.quote(newId));
}

/* ─── Overrides + confirmations ───────────────────────────── */

function findFlag(quote: QuoteRow, code: string, partId: string | null) {
  return parseFlags(quote.flags).find((f) => overrideMatchesFlag({ rule_code: code, part_id: partId }, f)) ?? null;
}

export async function requestOverride(input: OverrideRequestInput): Promise<QuoteActionResult> {
  const parsed = overrideRequestSchema.safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const data = parsed.data;
  let editor;
  try {
    editor = await requireQuoteEditor(data.quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase, quote } = editor;
  const flag = findFlag(quote, data.flagCode, data.partId);
  if (!flag || !flag.overridable) return fail("invalid");

  const { data: override, error } = await supabase
    .from("overrides")
    .insert({
      quote_id: data.quoteId,
      part_id: data.partId,
      quote_item_id: data.itemId,
      rule_code: data.flagCode,
      requested_by: session.user.id,
      note: data.note,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !override) {
    console.error("[quotes] override request failed", error);
    return fail("generic");
  }
  const { error: statusError } = await supabase.from("quotes").update({ status: "pending_override" }).eq("id", data.quoteId);
  if (statusError) {
    console.error("[quotes] status update failed", statusError);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "override.request",
    entity: "overrides",
    entityId: override.id,
    after: { quote_id: data.quoteId, rule_code: data.flagCode, part_id: data.partId, note: data.note },
  });
  revalidateQuote(data.quoteId);
  revalidatePath(routes.adminOverrides);
  return OK;
}

export async function confirmFlag(input: {
  quoteId: string;
  flagCode: string;
  partId: string | null;
  itemId: string | null;
}): Promise<QuoteActionResult> {
  const parsed = overrideRequestSchema.omit({ note: true }).safeParse(input);
  if (!parsed.success) return fail(firstErrorCode(parsed.error));
  const data = parsed.data;
  let editor;
  try {
    editor = await requireQuoteEditor(data.quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase, quote } = editor;
  const flag = findFlag(quote, data.flagCode, data.partId);
  if (!flag || flag.severity !== "amber" || !flag.overridable) return fail("invalid");

  const { data: existing } = await supabase
    .from("overrides")
    .select("id, status, part_id")
    .eq("quote_id", data.quoteId)
    .eq("rule_code", data.flagCode)
    .in("status", ["pending", "approved"]);
  const covering = (existing ?? []).filter((o) => (o.part_id ?? null) === data.partId);
  if (covering.length > 0) return OK;

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { data: override, error } = await admin
    .from("overrides")
    .insert({
      quote_id: data.quoteId,
      part_id: data.partId,
      quote_item_id: data.itemId,
      rule_code: data.flagCode,
      requested_by: session.user.id,
      note: CONFIRMATION_NOTE,
      status: "approved",
      decided_by: session.user.id,
      decided_at: now,
      decision_note: CONFIRMATION_NOTE,
    })
    .select("id")
    .single();
  if (error || !override) {
    console.error("[quotes] confirm flag failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "override.confirm",
    entity: "overrides",
    entityId: override.id,
    after: { quote_id: data.quoteId, rule_code: data.flagCode, part_id: data.partId },
  });
  revalidateQuote(data.quoteId);
  return OK;
}

/* ─── Status + send ───────────────────────────────────────── */

export async function setQuoteStatus(quoteId: string, status: "won" | "lost"): Promise<QuoteActionResult> {
  const parsed = decisionStatusSchema.safeParse(status);
  if (!parsed.success) return fail("invalidStatus");
  let editor;
  try {
    editor = await requireQuoteEditor(quoteId);
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const { session, supabase, quote } = editor;
  if (quote.status !== "sent") return fail("invalidStatus");
  const now = new Date().toISOString();
  const { error } = await supabase.from("quotes").update({ status: parsed.data, decided_at: now }).eq("id", quoteId);
  if (error) {
    console.error("[quotes] status change failed", error);
    return fail("generic");
  }
  await logAudit({
    actor: session.user.id,
    action: "quote.status",
    entity: "quotes",
    entityId: quoteId,
    before: { status: quote.status },
    after: { status: parsed.data, decided_at: now },
  });
  revalidateQuote(quoteId);
  return OK;
}

export type SendActionResult =
  | { ok: true; sent: true; mailed: boolean; mail: MailOutcome; pdfPath: string }
  | { ok: true; sent: false; reasons: SendBlockReason[] }
  | { ok: false; error: "notFound" | "forbidden" | "locked" | "noRates" | "sendFailed" | "pricing" | "config" | "generic"; message?: string };

export async function sendQuoteAction(quoteId: string, input: { locale?: "pl" | "en" | null } = {}): Promise<SendActionResult> {
  const locale = z.enum(["pl", "en"]).nullable().optional().safeParse(input.locale);
  try {
    const result = await sendQuote(quoteId, { locale: locale.success ? locale.data : null });
    revalidateQuote(quoteId);
    if (!result.sent) return { ok: true, sent: false, reasons: result.reasons };
    return { ok: true, sent: true, mailed: result.mailed, mail: result.mail, pdfPath: result.pdfPath };
  } catch (error) {
    revalidateQuote(quoteId);
    if (error instanceof QuoteAccessError) {
      if (error.code === "unauthenticated") redirect(routes.login);
      return { ok: false, error: error.code };
    }
    if (isPricingError(error)) {
      if (error.code === "no_active_rate_version" || error.code === "rate_version_not_found") return { ok: false, error: "noRates" };
      return { ok: false, error: "pricing", message: error.message };
    }
    console.error("[quotes] send failed", error);
    // The message reaches the sales user's toast (internal tool): "sendQuote/upload: …" says which step failed.
    return { ok: false, error: "sendFailed", message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Explicit "recalculate" from the builder (also used after edits made on
 * the part page). Unlike the other actions, nothing else changes here, so
 * the re-pricing itself is the audited event ("quote.reprice").
 */
export async function repriceQuoteAction(quoteId: string): Promise<QuoteActionResult> {
  let editor;
  try {
    editor = await requireQuoteEditor(quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  const result = await repriceAndRevalidate(quoteId);
  if (result.ok) {
    await logAudit({
      actor: editor.session.user.id,
      action: "quote.reprice",
      entity: "quotes",
      entityId: quoteId,
      before: { priced_at: editor.quote.priced_at, subtotal_price: editor.quote.subtotal_price },
      after: { source: "builder" },
    });
  }
  return result;
}
