"use server";

/**
 * Part server actions — every write to parts / quote_items that the
 * intake and part pages make. Zod-validated, role + can_edit_quote
 * checked (lib/parts/access.ts), audit-logged for material / thickness /
 * create / delete / accepted suggestions, followed by repriceQuote()
 * and revalidatePath() of the part, the quote upload page and the quote.
 * File path: /lib/parts/actions.ts
 *
 * Results are `ActionResult<T>` with CONTENT-CODED errors (mapped in
 * content.upload.errors) — no copy here. Geometry edits go through
 * lib/parts/reanalyse.ts: the base geometry is re-derived (DXF re-parse
 * with the SHA-256 cache, or the stored synthetic geometry), the new
 * annotations are applied by the engine and geometry / annotations /
 * triage / thumbnail are stored together. AI suggestions are only ever
 * applied by acceptSuggestion(), i.e. by an explicit click.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PartAnnotations, PartGeometry, Triage } from "@/lib/geometry/types";
import { normalizeThreadSize } from "@/lib/ai/threads";
import type { ExtraOperation } from "@/lib/pricing/types";
import { requireRole, WRITE_ROLES } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import { createDraftQuote } from "@/lib/quotes/create";
import { repriceQuote } from "@/lib/quotes/reprice";
import { downloadFile, parseStoragePath } from "@/lib/files/storage";
import { extractPdfText } from "@/lib/pdf-text";
import type { FileRow, Json, PartRow } from "@/lib/db/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import { PartAccessError, requirePartWriter, requireQuoteWriter, type PartAccessCode, type PartWriter } from "./access";
import {
  acceptBendSuggestion,
  acceptFinishSuggestion,
  acceptThreadSuggestions,
  applyTriageAnswer,
  clearThread,
  confirmThread as confirmThreadEdit,
  setBendParams as setBendParamsEdit,
} from "./annotation-edits";
import { parseStoredGeometry, toJson } from "./intake-db";
import { prefillPartSuggestions } from "./prefill";
import { buildQuickPartColumns } from "./quick-part-columns";
import { canEditQuoteAs } from "./quote-editor";
import { loadRatesInfo, parseStoredSuggestions, parseStoredTriage, type RatesInfo } from "./queries";
import { reanalysePart as reanalyseCore, type ReanalysePart } from "./reanalyse";
import { makeReanalyseDeps } from "./server-deps";
import {
  annotationsSchema,
  bendParamsSchema,
  isUuid,
  materialSchema,
  parseStoredAnnotations,
  partNameSchema,
  qtySchema,
  quickPartFormSchema,
  suggestionFieldSchema,
  threadSizeSchema,
  toleranceSchema,
  triageAnswerSchema,
  type QuickPartForm,
  type TriageAnswer,
  type BendParams,
} from "./schema";

export type ActionErrorCode =
  | PartAccessCode
  | "validation"
  | "no_geometry"
  | "no_rates"
  | "bend_not_found"
  | "no_bends"
  | "nothing_to_apply"
  | "no_pdf"
  | "no_item"
  | "generic";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: ActionErrorCode };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof PartAccessError) return { ok: false, error: error.code };
    if (error instanceof ActionFailure) return { ok: false, error: error.code };
    console.error("[parts] action failed", error);
    return { ok: false, error: "generic" };
  }
}

class ActionFailure extends Error {
  constructor(public readonly code: ActionErrorCode) {
    super(`part action: ${code}`);
  }
}

function fail(code: ActionErrorCode): never {
  throw new ActionFailure(code);
}

/* ─── Shared plumbing ─────────────────────────────────────── */

function densityFor(rates: RatesInfo, code: string | null): number | null {
  if (!code) return null;
  return rates.materials.find((m) => m.code.toLowerCase() === code.toLowerCase())?.densityKgM3 ?? null;
}

function thicknessOf(part: Pick<PartRow, "thickness_mm">): number | null {
  return part.thickness_mm === null ? null : Number(part.thickness_mm);
}

async function fileRowOf(supabase: ServerSupabase, fileId: string | null): Promise<FileRow | null> {
  if (!fileId) return null;
  const { data, error } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();
  if (error) throw new Error(`files select: ${error.message}`);
  return data ?? null;
}

type Ctx = PartWriter & { rates: RatesInfo; file: FileRow | null; geometry: PartGeometry | null; annotations: PartAnnotations };

/** A files row is only trusted for this quote when its uploader may edit the quote (lib/parts/quote-editor.ts). */
async function uploaderMayEditQuote(ctx: Ctx, file: FileRow): Promise<boolean> {
  if (!file.uploaded_by) return false;
  const { data, error } = await ctx.supabase.from("profiles").select("id, role").eq("id", file.uploaded_by).maybeSingle();
  if (error) throw new Error(`profiles select: ${error.message}`);
  return canEditQuoteAs(ctx.quote, data ?? null);
}

async function context(partId: string): Promise<Ctx> {
  const writer = await requirePartWriter(partId);
  const [rates, file] = await Promise.all([
    loadRatesInfo(writer.supabase, writer.quote.rate_version_id),
    fileRowOf(writer.supabase, writer.part.file_id),
  ]);
  return {
    ...writer,
    rates,
    file,
    geometry: parseStoredGeometry(writer.part.geometry),
    annotations: parseStoredAnnotations(writer.part.annotations),
  };
}

function toReanalysePart(ctx: Ctx, overrides: Partial<ReanalysePart> = {}): ReanalysePart {
  return {
    id: ctx.part.id,
    source: ctx.part.source,
    name: ctx.part.name,
    storagePath: ctx.file?.storage_path ?? null,
    fileHash: ctx.part.file_hash,
    geometry: ctx.geometry,
    annotations: ctx.annotations,
    pdfText: ctx.part.pdf_text,
    thicknessMm: thicknessOf(ctx.part),
    densityKgM3: densityFor(ctx.rates, ctx.part.material_code),
    ...overrides,
  };
}

/** Re-derive the geometry with `annotations`, store geometry/annotations/triage/thumbnail. */
async function applyAndStore(
  ctx: Ctx,
  annotations: PartAnnotations,
  options: { toleranceMm?: number; partOverrides?: Partial<ReanalysePart> } = {}
): Promise<{ geometry: PartGeometry; fromCache: boolean }> {
  const part = toReanalysePart(ctx, options.partOverrides);
  if (!(part.source === "dxf" && part.storagePath) && !part.geometry) fail("no_geometry");
  const toleranceMm = options.toleranceMm ?? ctx.geometry?.healing.toleranceMm ?? 0.01;
  const result = await reanalyseCore(part, annotations, { toleranceMm, blankMarginMm: ctx.rates.blankMarginMm }, makeReanalyseDeps(ctx.supabase));
  const { error } = await ctx.supabase
    .from("parts")
    .update({
      geometry: toJson(result.geometry),
      annotations: toJson(result.annotations),
      triage: toJson(result.geometry.triage),
      thumbnail_svg: result.thumbnailSvg,
    })
    .eq("id", ctx.part.id);
  if (error) throw new Error(`parts update (geometry): ${error.message}`);
  return { geometry: result.geometry, fromCache: result.fromCache };
}

async function repriceQuietly(quoteId: string): Promise<void> {
  try {
    await repriceQuote(quoteId);
  } catch (error) {
    console.error("[parts] reprice failed", quoteId, error);
  }
}

function revalidate(quoteId: string, partId?: string): void {
  if (partId) revalidatePath(routes.part(partId));
  revalidatePath(routes.quoteUpload(quoteId));
  revalidatePath(routes.quote(quoteId));
  revalidatePath(routes.upload);
}

async function afterChange(quoteId: string, partId?: string): Promise<void> {
  await repriceQuietly(quoteId);
  revalidate(quoteId, partId);
}

function currentTriage(ctx: Ctx): Triage | null {
  return parseStoredTriage(ctx.part.triage) ?? ctx.geometry?.triage ?? null;
}

function parseStoredExtras(value: unknown): ExtraOperation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is ExtraOperation => Boolean(e) && typeof e === "object" && typeof (e as ExtraOperation).type === "string");
}

function rowJson(part: PartRow): Json {
  return toJson({ id: part.id, name: part.name, material_code: part.material_code, thickness_mm: part.thickness_mm, source: part.source });
}

/* ─── Start a quote from the upload page ──────────────────── */

/** <form action> on /upload: creates a draft and opens its upload page. */
export async function startNewQuote(): Promise<void> {
  const session = await requireRole(WRITE_ROLES);
  const quote = await createDraftQuote({ createdBy: session.user.id });
  await logAudit({ actor: session.user.id, action: "quote.create", entity: "quotes", entityId: quote.id, after: toJson({ number: quote.number }) });
  revalidatePath(routes.upload);
  revalidatePath(routes.quotes);
  redirect(routes.quoteUpload(quote.id));
}

/* ─── Annotations ─────────────────────────────────────────── */

export async function saveAnnotations(partId: string, annotationsInput: unknown): Promise<ActionResult<{ triage: Triage }>> {
  return run(async () => {
    const parsed = annotationsSchema.safeParse(annotationsInput);
    if (!parsed.success) fail("validation");
    const ctx = await context(partId);
    const { geometry } = await applyAndStore(ctx, parsed.data);
    await afterChange(ctx.quote.id, partId);
    return { triage: geometry.triage };
  });
}

export async function answerTriage(partId: string, answerInput: TriageAnswer): Promise<ActionResult<{ triage: Triage }>> {
  return run(async () => {
    const parsed = triageAnswerSchema.safeParse(answerInput);
    if (!parsed.success) fail("validation");
    const ctx = await context(partId);
    // Stored (annotated) geometry: its entity coordinates are the space bend annotations live in.
    const next = applyTriageAnswer(ctx.annotations, currentTriage(ctx), parsed.data, ctx.geometry, thicknessOf(ctx.part));
    const { geometry } = await applyAndStore(ctx, next);
    await afterChange(ctx.quote.id, partId);
    return { triage: geometry.triage };
  });
}

export async function confirmThread(partId: string, loopId: string, size: string | null): Promise<ActionResult<null>> {
  return run(async () => {
    const parsed = threadSizeSchema.safeParse(size);
    if (!parsed.success || typeof loopId !== "string" || loopId.length === 0 || loopId.length > 64) fail("validation");
    const normalised = parsed.data === null ? null : (normalizeThreadSize(parsed.data) ?? parsed.data.toUpperCase().replace("×", "x"));
    const ctx = await context(partId);
    await applyAndStore(ctx, confirmThreadEdit(ctx.annotations, loopId, normalised));
    await afterChange(ctx.quote.id, partId);
    return null;
  });
}

/** Confirms (size), rejects (none) or resets to automatic (auto) the thread on several hole loops at once. */
export async function confirmThreadGroup(
  partId: string,
  loopIds: string[],
  choice: { mode: "auto" } | { mode: "none" } | { mode: "size"; size: string }
): Promise<ActionResult<null>> {
  return run(async () => {
    if (!Array.isArray(loopIds) || loopIds.length === 0 || loopIds.length > 500 || loopIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 64)) {
      fail("validation");
    }
    let size: string | null = null;
    if (choice.mode === "size") {
      const parsed = threadSizeSchema.safeParse(choice.size);
      if (!parsed.success || parsed.data === null) fail("validation");
      size = normalizeThreadSize(parsed.data) ?? parsed.data.toUpperCase().replace("×", "x");
    }
    const ctx = await context(partId);
    let next = ctx.annotations;
    for (const loopId of loopIds) {
      next = choice.mode === "auto" ? clearThread(next, loopId) : confirmThreadEdit(next, loopId, size);
    }
    await applyAndStore(ctx, next);
    await afterChange(ctx.quote.id, partId);
    return null;
  });
}

export async function setBendParams(partId: string, bendId: string, params: BendParams): Promise<ActionResult<null>> {
  return run(async () => {
    const parsed = bendParamsSchema.safeParse(params);
    if (!parsed.success || typeof bendId !== "string" || bendId.length === 0 || bendId.length > 64) fail("validation");
    const ctx = await context(partId);
    const next = setBendParamsEdit(ctx.annotations, ctx.geometry, bendId, parsed.data, thicknessOf(ctx.part));
    if (!next) fail("bend_not_found");
    await applyAndStore(ctx, next);
    await afterChange(ctx.quote.id, partId);
    return null;
  });
}

/* ─── Material / name / qty ───────────────────────────────── */

async function storeMaterial(ctx: Ctx, materialCode: string | null, thicknessMm: number | null): Promise<void> {
  const before = rowJson(ctx.part);
  const { error } = await ctx.supabase.from("parts").update({ material_code: materialCode, thickness_mm: thicknessMm }).eq("id", ctx.part.id);
  if (error) throw new Error(`parts update (material): ${error.message}`);
  const updated: PartRow = { ...ctx.part, material_code: materialCode, thickness_mm: thicknessMm };
  await logAudit({ actor: ctx.session.user.id, action: "part.material", entity: "parts", entityId: ctx.part.id, before, after: rowJson(updated) });
  if (ctx.geometry) {
    await applyAndStore({ ...ctx, part: updated }, ctx.annotations, {
      partOverrides: { thicknessMm, densityKgM3: densityFor(ctx.rates, materialCode) },
    });
  }
}

export async function setPartMaterial(partId: string, input: { materialCode: string | null; thicknessMm: number | null }): Promise<ActionResult<null>> {
  return run(async () => {
    const parsed = materialSchema.safeParse(input);
    if (!parsed.success) fail("validation");
    const ctx = await context(partId);
    const code = parsed.data.materialCode;
    const known = code ? (ctx.rates.materials.find((m) => m.code.toLowerCase() === code.toLowerCase())?.code ?? code) : null;
    await storeMaterial(ctx, known, parsed.data.thicknessMm);
    await afterChange(ctx.quote.id, partId);
    return null;
  });
}

export async function renamePart(partId: string, name: string): Promise<ActionResult<null>> {
  return run(async () => {
    const parsed = partNameSchema.safeParse(name);
    if (!parsed.success) fail("validation");
    const ctx = await context(partId);
    const { error } = await ctx.supabase.from("parts").update({ name: parsed.data }).eq("id", partId);
    if (error) throw new Error(`parts update (name): ${error.message}`);
    // The name feeds the forming hint of triage — re-evaluate when there is geometry.
    if (ctx.geometry) await applyAndStore({ ...ctx, part: { ...ctx.part, name: parsed.data } }, ctx.annotations);
    await afterChange(ctx.quote.id, partId);
    return null;
  });
}

export async function setItemQty(partId: string, qty: number): Promise<ActionResult<null>> {
  return run(async () => {
    const parsed = qtySchema.safeParse(qty);
    if (!parsed.success) fail("validation");
    const ctx = await context(partId);
    if (!ctx.item) fail("no_item");
    const { error } = await ctx.supabase.from("quote_items").update({ qty: parsed.data }).eq("id", ctx.item.id);
    if (error) throw new Error(`quote_items update (qty): ${error.message}`);
    await afterChange(ctx.quote.id, partId);
    return null;
  });
}

/* ─── Delete ──────────────────────────────────────────────── */

/** Deletes the part (its quote item cascades). `redirectAfter` sends the user to the quote's upload page. */
export async function deletePart(partId: string, redirectAfter = false): Promise<ActionResult<{ quoteId: string }>> {
  const result = await run(async () => {
    const ctx = await context(partId);
    const { error } = await ctx.supabase.from("parts").delete().eq("id", partId);
    if (error) throw new Error(`parts delete: ${error.message}`);
    await logAudit({ actor: ctx.session.user.id, action: "part.delete", entity: "parts", entityId: partId, before: rowJson(ctx.part) });
    await afterChange(ctx.quote.id);
    return { quoteId: ctx.quote.id };
  });
  if (redirectAfter && result.ok) redirect(routes.quoteUpload(result.data.quoteId));
  return result;
}

/* ─── Quick part ──────────────────────────────────────────── */

export async function createQuickPart(
  quoteId: string,
  form: QuickPartForm,
  replacePartId: string | null = null
): Promise<ActionResult<{ partId: string }>> {
  return run(async () => {
    const parsed = quickPartFormSchema.safeParse(form);
    if (!parsed.success) fail("validation");
    if (replacePartId !== null && !isUuid(replacePartId)) fail("validation");
    const writer = await requireQuoteWriter(quoteId);
    const rates = await loadRatesInfo(writer.supabase, writer.quote.rate_version_id);
    const code = parsed.data.materialCode;
    const material = code ? (rates.materials.find((m) => m.code.toLowerCase() === code.toLowerCase()) ?? null) : null;
    // Replace: source manual, file_id kept, file_hash NULLED so the synthetic
    // annotations never restore onto a later upload of the same DXF.
    const { columns } = buildQuickPartColumns(parsed.data, material, rates.blankMarginMm, replacePartId ? "replace" : "create");

    let partId: string;
    if (replacePartId) {
      const { data: existing, error } = await writer.supabase.from("parts").select("id, quote_id").eq("id", replacePartId).maybeSingle();
      if (error) throw new Error(`parts select: ${error.message}`);
      if (!existing || existing.quote_id !== quoteId) fail("not_found");
      const { error: updateError } = await writer.supabase.from("parts").update(columns).eq("id", replacePartId);
      if (updateError) throw new Error(`parts update (quick): ${updateError.message}`);
      partId = replacePartId;
      const { data: item } = await writer.supabase.from("quote_items").select("id").eq("part_id", partId).maybeSingle();
      if (!item) {
        const position = await nextPosition(writer.supabase, quoteId);
        const { error: itemError } = await writer.supabase.from("quote_items").insert({ quote_id: quoteId, part_id: partId, position, qty: 1 });
        if (itemError) throw new Error(`quote_items insert: ${itemError.message}`);
      }
    } else {
      const { data, error } = await writer.supabase
        .from("parts")
        .insert({ quote_id: quoteId, ...columns })
        .select("id")
        .single();
      if (error || !data) throw new Error(`parts insert (quick): ${error?.message ?? "no row"}`);
      partId = data.id;
      const position = await nextPosition(writer.supabase, quoteId);
      const { error: itemError } = await writer.supabase.from("quote_items").insert({ quote_id: quoteId, part_id: partId, position, qty: 1 });
      if (itemError) throw new Error(`quote_items insert: ${itemError.message}`);
    }
    await logAudit({
      actor: writer.session.user.id,
      action: replacePartId ? "part.replace_manual" : "part.create",
      entity: "parts",
      entityId: partId,
      after: toJson({ name: parsed.data.name, source: "manual", material_code: columns.material_code, thickness_mm: parsed.data.thicknessMm }),
    });
    await afterChange(quoteId, partId);
    return { partId };
  });
}

async function nextPosition(supabase: ServerSupabase, quoteId: string): Promise<number> {
  const { data, error } = await supabase.from("quote_items").select("position").eq("quote_id", quoteId).order("position", { ascending: false }).limit(1);
  if (error) throw new Error(`quote_items position: ${error.message}`);
  return (data && data.length > 0 ? Number(data[0].position) : 0) + 1;
}

/* ─── Re-analyse ──────────────────────────────────────────── */

export async function reanalysePart(partId: string, toleranceMm: number): Promise<ActionResult<{ triage: Triage; fromCache: boolean }>> {
  return run(async () => {
    const parsed = toleranceSchema.safeParse(toleranceMm);
    if (!parsed.success) fail("validation");
    const ctx = await context(partId);
    if (ctx.part.source !== "dxf" || !ctx.file) fail("no_geometry");
    const { geometry, fromCache } = await applyAndStore(ctx, ctx.annotations, { toleranceMm: parsed.data });
    await afterChange(ctx.quote.id, partId);
    return { triage: geometry.triage, fromCache };
  });
}

/* ─── PDF / AI ────────────────────────────────────────────── */

export async function acceptSuggestion(partId: string, field: string): Promise<ActionResult<{ applied: string }>> {
  return run(async () => {
    const parsedField = suggestionFieldSchema.safeParse(field);
    if (!parsedField.success) fail("validation");
    const ctx = await context(partId);
    const suggestions = parseStoredSuggestions(ctx.part.ai_suggestions);
    if (!suggestions) fail("no_pdf");
    const f = parsedField.data;

    switch (f) {
      case "material": {
        if (!suggestions.material) fail("nothing_to_apply");
        const match = ctx.rates.materials.find((m) => m.code.toLowerCase() === suggestions.material!.replace(/\s+/g, "").toLowerCase());
        await storeMaterial(ctx, match?.code ?? suggestions.material, thicknessOf(ctx.part));
        break;
      }
      case "thicknessMm": {
        if (suggestions.thicknessMm === null) fail("nothing_to_apply");
        await storeMaterial(ctx, ctx.part.material_code, suggestions.thicknessMm);
        break;
      }
      case "qty": {
        if (suggestions.quantity === null || !ctx.item) fail(ctx.item ? "nothing_to_apply" : "no_item");
        const { error } = await ctx.supabase.from("quote_items").update({ qty: suggestions.quantity }).eq("id", ctx.item.id);
        if (error) throw new Error(`quote_items update (qty): ${error.message}`);
        break;
      }
      case "threads": {
        if (!ctx.geometry || suggestions.threads.length === 0) fail("nothing_to_apply");
        const { annotations, confirmed } = acceptThreadSuggestions(ctx.annotations, ctx.geometry.measures.holes, suggestions.threads);
        if (confirmed === 0) fail("nothing_to_apply");
        await applyAndStore(ctx, annotations);
        break;
      }
      case "bends": {
        if (!suggestions.bends) fail("nothing_to_apply");
        const next = acceptBendSuggestion(ctx.annotations, ctx.geometry, suggestions.bends, thicknessOf(ctx.part));
        if (!next) fail("no_bends");
        await applyAndStore(ctx, next);
        break;
      }
      case "finish": {
        if (!suggestions.finish || !ctx.item) fail(ctx.item ? "nothing_to_apply" : "no_item");
        const { extras, added } = acceptFinishSuggestion(parseStoredExtras(ctx.item.extras), suggestions.finish);
        if (!added) fail("nothing_to_apply");
        const { error } = await ctx.supabase.from("quote_items").update({ extras: toJson(extras) }).eq("id", ctx.item.id);
        if (error) throw new Error(`quote_items update (extras): ${error.message}`);
        break;
      }
    }
    await logAudit({
      actor: ctx.session.user.id,
      action: "part.accept_suggestion",
      entity: "parts",
      entityId: partId,
      after: toJson({ field: f, source: suggestions.source }),
    });
    await afterChange(ctx.quote.id, partId);
    return { applied: f };
  });
}

/** Attaches an already uploaded PDF of the same quote to the part (text + suggestions). */
export async function attachPdf(partId: string, fileId: string): Promise<ActionResult<{ source: "ai" | "heuristic" }>> {
  return run(async () => {
    if (!isUuid(fileId)) fail("validation");
    const ctx = await context(partId);
    const pdf = await fileRowOf(ctx.supabase, fileId);
    if (!pdf || pdf.kind !== "pdf") fail("no_pdf");
    const parsedPath = parseStoragePath(pdf.storage_path);
    if (!parsedPath || parsedPath.quoteId !== ctx.quote.id.toLowerCase()) fail("forbidden");
    // Same rule as the intake companion lookup: the uploader must be allowed to edit this quote.
    if (!(await uploaderMayEditQuote(ctx, pdf))) fail("forbidden");
    const { error } = await ctx.supabase.from("parts").update({ pdf_file_id: pdf.id, pdf_text: null }).eq("id", partId);
    if (error) throw new Error(`parts update (pdf): ${error.message}`);
    const outcome = await prefillPartSuggestions(ctx.supabase, { ...ctx.part, pdf_file_id: pdf.id, pdf_text: null }, pdf, ctx.session.profile.locale);
    if (ctx.geometry) {
      await applyAndStore({ ...ctx, part: { ...ctx.part, pdf_text: outcome.text } }, ctx.annotations);
    }
    await afterChange(ctx.quote.id, partId);
    return { source: outcome.suggestions.source };
  });
}

/** Re-runs the PDF pre-fill (AI when a key exists, else heuristics) and stores the result. */
export async function runPrefill(partId: string): Promise<ActionResult<{ source: "ai" | "heuristic" }>> {
  return run(async () => {
    const ctx = await context(partId);
    const pdf = await fileRowOf(ctx.supabase, ctx.part.pdf_file_id);
    if (!pdf) fail("no_pdf");
    const outcome = await prefillPartSuggestions(ctx.supabase, ctx.part, pdf, ctx.session.profile.locale);
    revalidate(ctx.quote.id, partId);
    return { source: outcome.suggestions.source };
  });
}

/** Text of the companion PDF, extracted on demand when the row has none. */
export async function extractPartPdfText(partId: string): Promise<ActionResult<{ text: string }>> {
  return run(async () => {
    const ctx = await context(partId);
    const pdf = await fileRowOf(ctx.supabase, ctx.part.pdf_file_id);
    if (!pdf) fail("no_pdf");
    const bytes = await downloadFile(pdf.storage_path);
    const { text } = await extractPdfText(bytes);
    const { error } = await ctx.supabase.from("parts").update({ pdf_text: text }).eq("id", partId);
    if (error) throw new Error(`parts update (pdf_text): ${error.message}`);
    revalidate(ctx.quote.id, partId);
    return { text };
  });
}
