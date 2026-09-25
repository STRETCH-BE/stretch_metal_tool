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
 * `suggestionsSchema` validates the model's JSON (the tool input). The
 * model never sends `source` / `model`, so those default to "ai" / null
 * and the caller overwrites them; the same schema also accepts a complete
 * Suggestions object. Parsing is lenient on shape (missing → null / [])
 * but strict on type: a wrong type fails the parse and the caller falls
 * back to the heuristics.
 *
 * `dimensionsMm` is an optional extra beyond the build prompt's field list:
 * the title block "PLECH 15x500x220" carries the blank size, which the
 * intake can compare with the DXF bounding box.
 */

import { z } from "zod";

export type SuggestionSource = "ai" | "heuristic";
export type Confidence = "low" | "medium" | "high";
export type BendDirection = "up" | "down";

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
  material: string | null;
  thicknessMm: number | null;
  quantity: number | null;
  weightKg: number | null;
  bends: BendSuggestion | null;
  threads: ThreadSuggestion[];
  finish: string | null;
  tolerances: string | null;
  /** Free-text hints (hole callouts, chamfers, "ai_unavailable", …). */
  notes: string[];
  confidence: Confidence;
  dimensionsMm?: DimensionsSuggestion | null;
};

/** Marker note added when the API key is set but the call failed. */
export const AI_UNAVAILABLE_NOTE = "ai_unavailable";

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

export const suggestionsSchema = z.object({
  source: z.enum(["ai", "heuristic"]).default("ai"),
  model: nullableString,
  partNumber: nullableString,
  material: nullableString,
  thicknessMm: nullableNumber,
  quantity: nullableInt,
  weightKg: nullableNumber,
  bends: bendSuggestionSchema.nullish().transform((v) => v ?? null),
  threads: z
    .array(threadSuggestionSchema)
    .nullish()
    .transform((v) => v ?? []),
  finish: nullableString,
  tolerances: nullableString,
  notes: z
    .array(z.string())
    .nullish()
    .transform((v) => (v ?? []).map((n) => n.trim()).filter(Boolean)),
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
