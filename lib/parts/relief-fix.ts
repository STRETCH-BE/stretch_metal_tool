/**
 * Applying the approved RELIEF_TOO_NARROW fix to a part — SERVER ONLY.
 * File path: /lib/parts/relief-fix.ts
 *
 * The DFM check proposes "widen the relief to t, deepen to the bend
 * tangent + t" (lib/pricing/dfm.ts). It is never applied by itself: the
 * salesperson requests an override on the flag, an admin approves it
 * (lib/admin/overrides.ts decideOverride), and that approval calls
 * applyApprovedReliefFix: annotations.reliefFix = true, the part is
 * re-analysed with the fix (lib/geometry/annotate.ts applies it before
 * chaining), the stored geometry / triage / thumbnail are refreshed, the
 * production DXF is rewritten (parts.flat_file_id) and the quote is
 * re-priced. Runs with the admin client; every failure is logged and
 * returned, never thrown into the approval flow.
 */

import { randomUUID } from "node:crypto";
import { geometryToSvg, writeProductionDxf } from "@/lib/geometry";
import type { PartAnnotations } from "@/lib/geometry/types";
import { insertFileRow, sha256, storagePath, uploadBytes } from "@/lib/files/storage";
import { safeFileName } from "@/lib/files/sniff";
import { loadBendTable, loadHardwareNames } from "@/lib/rates/load";
import { repriceQuote } from "@/lib/quotes/reprice";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { parseStoredGeometry, toJson } from "./intake-db";
import { parseStoredAnnotations } from "./schema";
import { reanalysePart, THUMBNAIL_SIZE } from "./reanalyse";
import { makeReanalyseDeps } from "./server-deps";
import { DEFAULT_SHEET_FAMILY } from "./intake-deps";

export type ReliefFixResult = { ok: true; partId: string } | { ok: false; reason: string };

export async function applyApprovedReliefFix(partId: string, actorId: string, admin: AdminSupabase): Promise<ReliefFixResult> {
  const { data: part, error } = await admin.from("parts").select("*").eq("id", partId).maybeSingle();
  if (error) return { ok: false, reason: `parts select: ${error.message}` };
  if (!part) return { ok: false, reason: "part not found" };
  const geometry = parseStoredGeometry(part.geometry);
  if (!geometry?.sheet?.isSheetMetal || part.source !== "step" || !part.file_id) return { ok: false, reason: "not a STEP sheet part" };
  const { data: file } = await admin.from("files").select("*").eq("id", part.file_id).maybeSingle();
  const { data: quote } = await admin.from("quotes").select("id, bend_table_version_id, rate_version_id").eq("id", part.quote_id).maybeSingle();
  if (!file || !quote) return { ok: false, reason: "file or quote missing" };

  const annotations: PartAnnotations = { ...parseStoredAnnotations(part.annotations), reliefFix: true };
  const [bendTable, hardwareNames, materialRow] = await Promise.all([
    loadBendTable(admin, quote.bend_table_version_id).catch(() => ({ versionId: null, rows: [] })),
    loadHardwareNames(admin).catch(() => []),
    part.material_code ? admin.from("materials").select("family, density_kg_m3").eq("rate_version_id", quote.rate_version_id ?? "").ilike("code", part.material_code).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const family = materialRow.data?.family ?? DEFAULT_SHEET_FAMILY;
  try {
    const result = await reanalysePart(
      {
        id: part.id,
        source: "step",
        name: part.name,
        storagePath: file.storage_path,
        fileHash: part.file_hash,
        geometry,
        annotations,
        pdfText: part.pdf_text,
        thicknessMm: part.thickness_mm === null ? null : Number(part.thickness_mm),
        densityKgM3: materialRow.data?.density_kg_m3 === undefined || materialRow.data?.density_kg_m3 === null ? null : Number(materialRow.data.density_kg_m3),
      },
      annotations,
      { toleranceMm: geometry.healing.toleranceMm, blankMarginMm: geometry.measures.blank.marginMm, sheet: { bendTable: { materialFamily: family, rows: bendTable.rows }, hardwareNames } },
      makeReanalyseDeps(admin)
    );
    // Production DXF with the fix, as a new derived file.
    const text = writeProductionDxf(result.geometry, result.annotations, { title: `${part.name} — relief fix approved` });
    const bytes = new TextEncoder().encode(text);
    const id = randomUUID();
    const objectPath = storagePath(part.quote_id, id, safeFileName(`${part.name}_flat.dxf`));
    await uploadBytes(objectPath, bytes, "application/dxf");
    const row = await insertFileRow(admin, {
      id,
      storagePath: objectPath,
      originalName: `${part.name}_flat.dxf`,
      mime: "application/dxf",
      size: bytes.byteLength,
      sha256: sha256(bytes),
      kind: "export_dxf",
      uploadedBy: actorId,
      quoteId: part.quote_id,
    });
    const { error: updateError } = await admin
      .from("parts")
      .update({
        geometry: toJson(result.geometry),
        annotations: toJson(result.annotations),
        triage: toJson(result.geometry.triage),
        thumbnail_svg: geometryToSvg(result.geometry, result.annotations, { ...THUMBNAIL_SIZE, theme: "light" }),
        flat_file_id: row.id,
      })
      .eq("id", part.id);
    if (updateError) return { ok: false, reason: `parts update: ${updateError.message}` };
    await repriceQuote(part.quote_id, { admin: true }).catch((e: unknown) => console.error("[relief-fix] reprice failed", e));
    return { ok: true, partId: part.id };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
