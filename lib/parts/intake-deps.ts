/**
 * Production IntakeDeps — the real engines, Storage, AI and pricing wired
 * into the ports of lib/parts/intake.ts, shared by the complete route
 * (first run of an upload) and the resume route (finishing a run that
 * timed out).
 * File path: /lib/parts/intake-deps.ts
 *
 * Everything runs as the user (RLS client from requireQuoteWriter):
 * derived STEP files are uploaded to Storage with the admin client
 * (uploadBytes) but their files rows are inserted as the user, so the
 * files_insert policy checks the quote. Re-pricing is the server-side
 * repriceQuote (prices never come from the client).
 */

import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { geometryEngine, geometryToSvg } from "@/lib/geometry";
import { extractPdfText } from "@/lib/pdf-text";
import { prefillFromPdf } from "@/lib/ai/prefill";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import { repriceQuote } from "@/lib/quotes/reprice";
import type { requireQuoteWriter } from "@/lib/parts/access";
import { mimeForKind, safeFileName } from "@/lib/files/sniff";
import { downloadFile, insertFileRow, sha256, storagePath, uploadBytes } from "@/lib/files/storage";
import { THUMBNAIL_SIZE, type IntakeDeps } from "@/lib/parts/intake";
import { createIntakeDb } from "@/lib/parts/intake-db";
import { loadRatesInfo } from "@/lib/parts/queries";

export type IntakeWriter = Awaited<ReturnType<typeof requireQuoteWriter>>;

export async function createIntakeDeps(writer: IntakeWriter): Promise<IntakeDeps> {
  const { supabase, session, quote } = writer;
  const rates = await loadRatesInfo(supabase, quote.rate_version_id);
  return {
    analyse: (text, options) => geometryEngine.analyzeDxf(text, options),
    analyseStep: (text, options) => geometryEngine.analyzeStep(text, options),
    splitModel: (text, options) => geometryEngine.splitModel(text, options),
    saveDerivedFile: async ({ quoteId: forQuote, name, bytes, kind }) => {
      const id = randomUUID();
      const objectPath = storagePath(forQuote, id, safeFileName(name));
      const mime = mimeForKind(kind);
      await uploadBytes(objectPath, bytes, mime);
      const row = await insertFileRow(supabase, {
        id,
        storagePath: objectPath,
        originalName: name,
        mime,
        size: bytes.byteLength,
        sha256: sha256(bytes),
        kind,
        uploadedBy: session.user.id,
        quoteId: forQuote,
      });
      return { id: row.id, originalName: row.original_name, storagePath: row.storage_path, sha256: row.sha256 };
    },
    applyAnnotations: (geometry, annotations, options) => geometryEngine.applyAnnotations(geometry, annotations, options),
    toSvg: (geometry, annotations) => geometryToSvg(geometry, annotations, { ...THUMBNAIL_SIZE, theme: "light" }),
    extractPdfText: async (bytes) => (await extractPdfText(bytes)).text,
    prefill: (input) => (env.hasAi() ? prefillFromPdf(input) : Promise.resolve(null)),
    heuristics: heuristicSuggestions,
    download: async (path) => new Uint8Array(await downloadFile(path)),
    densityFor: (code) =>
      code ? (rates.materials.find((m) => m.code.toLowerCase() === code.toLowerCase())?.densityKgM3 ?? null) : null,
    db: createIntakeDb(supabase),
    reprice: async (id) => {
      await repriceQuote(id);
    },
    blankMarginMm: rates.blankMarginMm,
    locale: session.profile.locale,
  };
}
