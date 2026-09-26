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
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, hasRole, WRITE_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import { isPricingError } from "@/lib/pricing/errors";
import { loadActiveRateVersionId } from "@/lib/rates/load";
import type { Json, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { QuoteAccessError, requireQuoteEditor, requireQuoteReader } from "./access";
import { createDraftQuote } from "./create";
import { toJson } from "./mapper";
import { listQuoteVersions } from "./queries";
import { repriceQuote } from "./reprice";
import {
  decisionStatusSchema,
  fail,
  firstErrorCode,
  itemUpdateSchema,
  OK,
  overrideRequestSchema,
  parseFlags,
  parseNewQuoteForm,
  quoteHeaderSchema,
  readNewQuoteForm,
  weldingOnlySchema,
  type ItemUpdateInput,
  type NewQuoteFormState,
  type OverrideRequestInput,
  type QuoteActionResult,
  type QuoteHeaderInput,
} from "./schema";
import { sendQuote } from "./send";
import { isUuid, nextVersionNumber, overrideMatchesFlag } from "./shared";
import type { SendBlockReason } from "./types";

const CONFIRMATION_NOTE = "confirmed by sales";

function revalidateQuote(id: string) {
  revalidatePath(routes.quotes);
  revalidatePath(routes.quote(id));
}

function accessFailure(error: unknown): QuoteActionResult | null {
  if (error instanceof QuoteAccessError) {
    if (error.code === "unauthenticated") redirect(routes.login);
    return fail(error.code);
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

  const update = {
    customer_id: data.customerId,
    currency: data.currency,
    fx_rate: data.currency === "EUR" ? 1 : data.fxRate,
    margin_pct: data.marginPct,
    validity_days: data.validityDays,
    lead_time_text: data.leadTimeText,
    payment_terms_text: data.paymentTermsText,
    notes: data.notes,
    show_operations_on_pdf: data.showOperationsOnPdf,
    welding_separate: data.weldingSeparate,
  };
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
    lead_time_text: quote.lead_time_text,
    payment_terms_text: quote.payment_terms_text,
    notes: quote.notes,
    show_operations_on_pdf: quote.show_operations_on_pdf,
    welding_separate: quote.welding_separate,
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
      lead_time_text: quote.lead_time_text,
      payment_terms_text: quote.payment_terms_text,
      rate_version_id: activeVersionId,
      show_operations_on_pdf: quote.show_operations_on_pdf,
      welding_separate: quote.welding_separate,
      welding_only: quote.welding_only,
      notes: quote.notes,
      created_by: session.user.id,
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
  for (const item of (items ?? []) as QuoteItemRow[]) {
    const partId = partMap.get(item.part_id);
    if (!partId) continue;
    const { error } = await supabase.from("quote_items").insert({
      quote_id: newId,
      part_id: partId,
      position: item.position,
      qty: item.qty,
      extras: item.extras,
      scrap_pct: item.scrap_pct,
      notes: item.notes,
    });
    if (error) {
      console.error("[quotes] duplicate item failed", error);
      return fail("generic");
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
  | { ok: true; sent: true; mailed: boolean; pdfPath: string }
  | { ok: true; sent: false; reasons: SendBlockReason[] }
  | { ok: false; error: "notFound" | "forbidden" | "locked" | "noRates" | "pricing" | "generic"; message?: string };

export async function sendQuoteAction(quoteId: string, input: { locale?: "pl" | "en" | null } = {}): Promise<SendActionResult> {
  const locale = z.enum(["pl", "en"]).nullable().optional().safeParse(input.locale);
  try {
    const result = await sendQuote(quoteId, { locale: locale.success ? locale.data : null });
    revalidateQuote(quoteId);
    if (!result.sent) return { ok: true, sent: false, reasons: result.reasons };
    return { ok: true, sent: true, mailed: result.mailed, pdfPath: result.pdfPath };
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
    return { ok: false, error: "generic" };
  }
}

/** Explicit "recalculate" from the builder (also used after edits made on the part page). */
export async function repriceQuoteAction(quoteId: string): Promise<QuoteActionResult> {
  try {
    await requireQuoteEditor(quoteId, { editableOnly: true });
  } catch (error) {
    return accessFailure(error) ?? fail("generic");
  }
  return repriceAndRevalidate(quoteId);
}
