/**
 * AI pre-fill contract — the suggestion object read from a PDF companion.
 * File path: /lib/ai/types.ts
 *
 * `Suggestions` is what the intake UI renders as amber chips; nothing in it
 * is ever applied automatically (see /lib/ai/apply.ts). It is produced by
 * /lib/ai/heuristics.ts (regexes over the extracted text, source
 * "heuristic") and, when ANTHROPIC_API_KEY is set, by /lib/ai/prefill.ts
 * (Claude reading the PDF + text, source "ai").
 *
 * No visible copy lives here or in the producers (CLAUDE.md: every
 * visible string comes from content/). Everything that needs a label is a
 * CODE the UI maps through `content/upload.ts` → `aiSuggestions`:
 * - notes are `{ code, params }` objects rendered with
 *   `interpolate(content.aiSuggestions.notes[code], params)`; the model's
 *   free-text hints (written in the request locale) use code "text";
 * - finish is `{ code, ral, text }` with `code` from FINISH_CODES
 *   (`content.aiSuggestions.finishCodes`) and `ral` the 4-digit RAL number;
 * - `materialFamily` uses the DB material family enum
 *   (`content.aiSuggestions.materialFamilies`); `material` stays the grade
 *   exactly as written on the drawing (S355, DC01, 1.4301 — data, not copy).
 *
 * `suggestionsSchema` validates the model's JSON (the tool input). The
 * model never sends `source` / `model`, so those default to "ai" / null
 * and the caller overwrites them; the same schema also accepts a complete
 * Suggestions object (e.g. read back from parts.ai_suggestions). Parsing is
 * lenient on shape (missing → null / []) but strict on type: a wrong type
 * fails the parse and the caller falls back to the heuristics. Value
 * RANGES are not enforced here — /lib/ai/bounds.ts nulls out-of-range
 * values field by field (with an "ai_value_dropped" note) so one bad
 * number does not discard the whole answer.
 *
 * `dimensionsMm` is an optional extra beyond the build prompt's field list:
 * the title block "PLECH 15x500x220" carries the blank size, which the
 * intake can compare with the DXF bounding box.
 */

import { z } from "zod";
import type { MaterialFamilyDb } from "@/lib/db/types";

export type SuggestionSource = "ai" | "heuristic";
export type Confidence = "low" | "medium" | "high";
export type BendDirection = "up" | "down";

/** Same vocabulary as the `material_family` DB enum (lib/db/types.ts). */
export const MATERIAL_FAMILIES = [
  "mild_steel",
  "stainless",
  "aluminium",
  "brass",
  "copper",
] as const satisfies readonly MaterialFamilyDb[];
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

/**
 * Finish vocabulary. Rate codes in `rate_finish` (powder, zinc, deburr, …)
 * are admin data; the UI maps a code to a rate when a chip is accepted.
 */
export const FINISH_CODES = [
  "powder_coating",
  "galvanised",
  "anodised",
  "blasted",
  "brushed",
  "pickled_passivated",
  "painted",
  "deburred",
  "none",
] as const;
export type FinishCode = (typeof FINISH_CODES)[number];

export type FinishSuggestion = {
  code: FinishCode | null;
  /** 4-digit RAL number ("7016"), when a colour is stated. */
  ral: string | null;
  /** The finish as written on the drawing (AI only; heuristics leave null). */
  text: string | null;
};

/**
 * Note codes. `params` per code (all strings/numbers, language-neutral):
 * - text:              { text }            free text from the model
 * - hole:              { callout }         "Ø13 (6×)"
 * - hole_fit:          { callout }         "Ø35 H7 (2×)" — a fit → machining
 * - chamfer:           { a, b }            "2×45°"
 * - radii:             { list }            "R5, R10"
 * - angles_no_context: { list }            "45°, 13°" seen, no bend word
 * - other_materials:   { list }            further grade tokens in the text
 * - thread_repeated:   { size, seen }      same callout in several views
 * - ai_unavailable:    –                   key set but the call failed
 * - pdf_too_large:     –                   document block skipped (> 20 MB)
 * - ai_value_dropped:  { field, value }    out-of-range AI value nulled;
 *                                          `field` is a key of content
 *                                          `aiSuggestions.fields`
 */
export const SUGGESTION_NOTE_CODES = [
  "text",
  "hole",
  "hole_fit",
  "chamfer",
  "radii",
  "angles_no_context",
  "other_materials",
  "thread_repeated",
  "ai_unavailable",
  "pdf_too_large",
  "ai_value_dropped",
] as const;
export type SuggestionNoteCode = (typeof SUGGESTION_NOTE_CODES)[number];

export type SuggestionNote = {
  code: SuggestionNoteCode;
  params?: Record<string, string | number>;
};

export type ThreadSuggestion = {
  /** Metric size, fine pitch kept ("M10x1"), coarse pitch dropped ("M8"). */
  size: string;
  count: number | null;
};

export type BendSuggestion = {
  count: number | null;
  /** Bend angles in degrees, as marked on the drawing (never chamfers). */
  angles: number[];
  /** Only when the drawing marks the direction. */
  directions?: BendDirection[];
};

export type DimensionsSuggestion = {
  /** Longer blank side, mm. */
  length: number;
  /** Shorter blank side, mm. */
  width: number;
};

export type Suggestions = {
  source: SuggestionSource;
  /** Model id that produced the AI fields; null for heuristics. */
  model: string | null;
  partNumber: string | null;
  /** Grade as written on the drawing (S355, DC01, 1.4301, AlMg3). */
  material: string | null;
  materialFamily: MaterialFamily | null;
  thicknessMm: number | null;
  quantity: number | null;
  weightKg: number | null;
  bends: BendSuggestion | null;
  threads: ThreadSuggestion[];
  finish: FinishSuggestion | null;
  tolerances: string | null;
  /** Coded hints (hole callouts, chamfers, "ai_unavailable", …). */
  notes: SuggestionNote[];
  confidence: Confidence;
  dimensionsMm?: DimensionsSuggestion | null;
};

/** Note code added when the API key is set but the call failed. */
export const AI_UNAVAILABLE_NOTE: SuggestionNoteCode = "ai_unavailable";
/** Note code added when the PDF was too large to send as a document block. */
export const PDF_TOO_LARGE_NOTE: SuggestionNoteCode = "pdf_too_large";

/** A free-text note (the model's hints, in the request locale). */
export function textNote(text: string): SuggestionNote {
  return { code: "text", params: { text } };
}

export function hasNote(suggestions: Pick<Suggestions, "notes">, code: SuggestionNoteCode): boolean {
  return suggestions.notes.some((n) => n.code === code);
}

/** Stable identity of a note for de-duplication (code + sorted params). */
export function noteKey(note: SuggestionNote): string {
  const params = note.params ?? {};
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  return `${note.code}?${sorted}`;
}

export function uniqueNotes(notes: SuggestionNote[]): SuggestionNote[] {
  const seen = new Set<string>();
  const out: SuggestionNote[] = [];
  for (const note of notes) {
    const key = noteKey(note);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

const nullableString = z
  .string()
  .nullish()
  .transform((v) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : null;
  });

export const threadSuggestionSchema = z.object({
  size: z.string().trim().min(1),
  count: nullableInt,
});

export const bendSuggestionSchema = z.object({
  count: nullableInt,
  angles: z
    .array(z.number())
    .nullish()
    .transform((v) => v ?? []),
  directions: z
    .array(z.enum(["up", "down"]))
    .nullish()
    .transform((v) => v ?? undefined),
});

export const dimensionsSuggestionSchema = z.object({
  length: z.number(),
  width: z.number(),
});

export const finishSuggestionSchema = z.object({
  code: z
    .enum(FINISH_CODES)
    .nullish()
    .transform((v) => v ?? null),
  ral: nullableString,
  text: nullableString,
});

export const suggestionNoteSchema = z.object({
  code: z.enum(SUGGESTION_NOTE_CODES),
  params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullish()
    .transform((v) => v ?? undefined),
});

/** A note is either the model's free text or an already-coded note object. */
const noteInputSchema = z.union([z.string(), suggestionNoteSchema]).transform(
  (v): SuggestionNote | null => {
    if (typeof v === "string") {
      const trimmed = v.trim();
      return trimmed ? textNote(trimmed) : null;
    }
    return v;
  }
);

export const suggestionsSchema = z.object({
  source: z.enum(["ai", "heuristic"]).default("ai"),
  model: nullableString,
  partNumber: nullableString,
  material: nullableString,
  materialFamily: z
    .enum(MATERIAL_FAMILIES)
    .nullish()
    .transform((v) => v ?? null),
  thicknessMm: nullableNumber,
  quantity: nullableInt,
  weightKg: nullableNumber,
  bends: bendSuggestionSchema.nullish().transform((v) => v ?? null),
  threads: z
    .array(threadSuggestionSchema)
    .nullish()
    .transform((v) => v ?? []),
  finish: finishSuggestionSchema.nullish().transform((v) => v ?? null),
  tolerances: nullableString,
  notes: z
    .array(noteInputSchema)
    .nullish()
    .transform((v) => (v ?? []).filter((n): n is SuggestionNote => n !== null)),
  confidence: z.enum(["low", "medium", "high"]).default("low"),
  dimensionsMm: dimensionsSuggestionSchema
    .nullish()
    .transform((v) => v ?? null),
});

/** Parse unknown JSON into Suggestions; throws a ZodError on a type mismatch. */
export function parseSuggestions(input: unknown): Suggestions {
  return suggestionsSchema.parse(input);
}

/** An empty heuristic result — the shape every producer starts from. */
export function emptySuggestions(
  source: SuggestionSource = "heuristic"
): Suggestions {
  return {
    source,
    model: null,
    partNumber: null,
    material: null,
    materialFamily: null,
    thicknessMm: null,
    quantity: null,
    weightKg: null,
    bends: null,
    threads: [],
    finish: null,
    tolerances: null,
    notes: [],
    confidence: "low",
    dimensionsMm: null,
  };
}
