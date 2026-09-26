/**
 * PDF companion → suggestions for one part — SERVER ONLY, shared by the
 * /api/ai/prefill route and the attachPdf action.
 * File path: /lib/parts/prefill.ts
 *
 * Reads the part's PDF (bytes from Storage + stored pdf_text, extracted
 * again when missing), runs prefillFromPdf (Claude; null without
 * ANTHROPIC_API_KEY) and falls back to heuristicSuggestions. The result
 * is STORED on parts.ai_suggestions and returned — never applied to the
 * part (spec 5.4: suggests, never decides).
 */

import { env } from "@/lib/env";
import type { FileRow, PartRow } from "@/lib/db/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import { extractPdfText } from "@/lib/pdf-text";
import { prefillFromPdf } from "@/lib/ai/prefill";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import type { Suggestions } from "@/lib/ai/types";
import { downloadFile } from "@/lib/files/storage";
import { toJson } from "./intake-db";

export type PrefillOutcome = { suggestions: Suggestions; text: string; aiAvailable: boolean };

export async function prefillPartSuggestions(
  supabase: ServerSupabase,
  part: PartRow,
  pdfFile: FileRow,
  locale: "pl" | "en"
): Promise<PrefillOutcome> {
  const bytes = await downloadFile(pdfFile.storage_path);
  let text = part.pdf_text ?? "";
  if (text.trim().length === 0) {
    try {
      text = (await extractPdfText(bytes)).text;
    } catch (error) {
      console.error("[prefill] pdf text extraction failed", part.id, error);
      text = "";
    }
  }
  const aiAvailable = env.hasAi();
  let suggestions: Suggestions | null = null;
  if (aiAvailable) {
    suggestions = await prefillFromPdf({ pdfBytes: new Uint8Array(bytes), text, partName: part.name, locale });
  }
  if (!suggestions) suggestions = heuristicSuggestions(text, part.name);

  const { error } = await supabase
    .from("parts")
    .update({ ai_suggestions: toJson(suggestions), pdf_text: text })
    .eq("id", part.id);
  if (error) throw new Error(`parts update (ai_suggestions): ${error.message}`);
  return { suggestions, text, aiAvailable };
}
