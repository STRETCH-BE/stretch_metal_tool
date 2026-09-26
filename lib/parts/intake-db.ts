/**
 * Production IntakeDb — the Supabase implementation of the DB port used
 * by lib/parts/intake.ts (tests use an in-memory one).
 * File path: /lib/parts/intake-db.ts
 *
 * Works with the RLS client as the user (parts_write / quote_items_write
 * policies gate on can_edit_quote) or the admin client. `files` rows carry
 * no quote_id, so "PDFs of this quote" is a prefix match on storage_path
 * (quotes/<quoteId>/…, see lib/files/storage.ts) — and because any
 * can_write user may insert a files row under any folder (files_insert
 * only checks uploaded_by = auth.uid()), a companion is only accepted when
 * its uploader may edit the quote (lib/parts/quote-editor.ts mirrors SQL
 * can_edit_quote: admin, or the quote's sales owner). Base-name matching
 * is done in TypeScript with the same helper the intake uses
 * (lib/files/sniff.ts baseNamesMatch) — the sets are tiny (one quote).
 * Annotation restore by hash only reads source = dxf rows: a red part
 * converted to a quick part keeps its file_id for the download link but
 * its synthetic annotations must never re-attach to the real drawing
 * (actions.createQuickPart also nulls file_hash on replace).
 */

import type { Json, PartRow } from "@/lib/db/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { PartGeometry } from "@/lib/geometry/types";
import { baseNamesMatch } from "@/lib/files/sniff";
import { parseStoredAnnotations } from "./schema";
import { canEditQuoteAs } from "./quote-editor";
import type { ExistingPart, IntakeDb, IntakeFile, PartInsert, PartPatch } from "./intake";

export type IntakeClient = ServerSupabase | AdminSupabase;

/** Stored JSON columns are our own serialisable objects; the cast avoids a JSON round trip. */
export function toJson(value: unknown): Json {
  return (value ?? null) as Json;
}

/** Light guard: a stored geometry with the expected top-level shape. */
export function parseStoredGeometry(value: unknown): PartGeometry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const g = value as Partial<PartGeometry>;
  if (g.version !== 1 || !Array.isArray(g.entities) || !Array.isArray(g.loops) || !g.measures || !g.triage || !g.healing) {
    return null;
  }
  return g as PartGeometry;
}

function partPatchToRow(patch: PartPatch): Partial<PartRow> {
  const row: Partial<PartRow> = {};
  if ("geometry" in patch) row.geometry = toJson(patch.geometry);
  if ("annotations" in patch) row.annotations = toJson(patch.annotations);
  if ("triage" in patch) row.triage = toJson(patch.triage);
  if ("thumbnailSvg" in patch) row.thumbnail_svg = patch.thumbnailSvg ?? null;
  if ("pdfFileId" in patch) row.pdf_file_id = patch.pdfFileId ?? null;
  if ("pdfText" in patch) row.pdf_text = patch.pdfText ?? null;
  if ("aiSuggestions" in patch) row.ai_suggestions = toJson(patch.aiSuggestions);
  return row;
}

export function createIntakeDb(client: IntakeClient): IntakeDb {
  return {
    async findAnnotationsByHash(fileHash) {
      const { data, error } = await client
        .from("parts")
        .select("annotations, updated_at")
        .eq("file_hash", fileHash)
        .eq("source", "dxf")
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(`parts by hash: ${error.message}`);
      for (const row of data ?? []) {
        const annotations = parseStoredAnnotations(row.annotations);
        if (JSON.stringify(annotations) !== JSON.stringify(parseStoredAnnotations({}))) return annotations;
      }
      return null;
    },

    async findPartByBaseName(quoteId, base): Promise<ExistingPart | null> {
      const { data, error } = await client
        .from("parts")
        .select("id, name, geometry, annotations, thickness_mm, material_code, file_id, file_hash, created_at")
        .eq("quote_id", quoteId)
        .eq("source", "dxf")
        .order("created_at", { ascending: false });
      if (error) throw new Error(`parts by name: ${error.message}`);
      const row = (data ?? []).find((p) => baseNamesMatch(p.name, base));
      if (!row) return null;
      let storagePath: string | null = null;
      if (row.file_id) {
        const { data: file, error: fileError } = await client.from("files").select("storage_path").eq("id", row.file_id).maybeSingle();
        if (fileError) throw new Error(`files by id: ${fileError.message}`);
        storagePath = file?.storage_path ?? null;
      }
      return {
        id: row.id,
        name: row.name,
        geometry: parseStoredGeometry(row.geometry),
        annotations: parseStoredAnnotations(row.annotations),
        thicknessMm: row.thickness_mm === null ? null : Number(row.thickness_mm),
        materialCode: row.material_code,
        storagePath,
        fileHash: row.file_hash,
      };
    },

    async findPdfByBaseName(quoteId, base): Promise<IntakeFile | null> {
      const { data, error } = await client
        .from("files")
        .select("id, original_name, storage_path, sha256, uploaded_by, created_at")
        .eq("kind", "pdf")
        .like("storage_path", `quotes/${quoteId}/%`)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`files by name: ${error.message}`);
      const matching = (data ?? []).filter((f) => baseNamesMatch(f.original_name, base) && f.uploaded_by !== null);
      if (matching.length === 0) return null;
      // Only a file whose uploader may edit this quote counts as its companion.
      const { data: quote, error: quoteError } = await client.from("quotes").select("created_by").eq("id", quoteId).maybeSingle();
      if (quoteError) throw new Error(`quotes by id: ${quoteError.message}`);
      if (!quote) return null;
      const uploaderIds = Array.from(new Set(matching.map((f) => f.uploaded_by as string)));
      const { data: profiles, error: profileError } = await client.from("profiles").select("id, role").in("id", uploaderIds);
      if (profileError) throw new Error(`profiles by id: ${profileError.message}`);
      const byId = new Map((profiles ?? []).map((p) => [p.id, p] as const));
      const row = matching.find((f) => canEditQuoteAs(quote, byId.get(f.uploaded_by as string)));
      return row ? { id: row.id, originalName: row.original_name, storagePath: row.storage_path, sha256: row.sha256 } : null;
    },

    async insertPart(row: PartInsert) {
      const { data, error } = await client
        .from("parts")
        .insert({
          quote_id: row.quoteId,
          name: row.name,
          source: row.source,
          file_id: row.fileId,
          file_hash: row.fileHash,
          geometry: toJson(row.geometry),
          annotations: toJson(row.annotations),
          triage: toJson(row.triage),
          thumbnail_svg: row.thumbnailSvg,
          pdf_file_id: row.pdfFileId,
          pdf_text: row.pdfText,
          ai_suggestions: toJson(row.aiSuggestions),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`parts insert: ${error?.message ?? "no row"}`);
      return { id: data.id };
    },

    async updatePart(id, patch) {
      const { error } = await client.from("parts").update(partPatchToRow(patch)).eq("id", id);
      if (error) throw new Error(`parts update: ${error.message}`);
    },

    async nextItemPosition(quoteId) {
      const { data, error } = await client
        .from("quote_items")
        .select("position")
        .eq("quote_id", quoteId)
        .order("position", { ascending: false })
        .limit(1);
      if (error) throw new Error(`quote_items position: ${error.message}`);
      const last = data && data.length > 0 ? Number(data[0].position) : 0;
      return last + 1;
    },

    async insertItem(row) {
      const { data, error } = await client
        .from("quote_items")
        .insert({ quote_id: row.quoteId, part_id: row.partId, position: row.position, qty: row.qty })
        .select("id")
        .single();
      if (error || !data) throw new Error(`quote_items insert: ${error?.message ?? "no row"}`);
      return { id: data.id };
    },
  };
}
