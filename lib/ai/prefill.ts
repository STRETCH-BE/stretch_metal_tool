/**
 * AI pre-fill — Claude reads the PDF companion and proposes a Suggestions
 * object (server only).
 * File path: /lib/ai/prefill.ts
 *
 *   prefillFromPdf({ pdfBytes?, text, partName, locale })
 *     → null                      when ANTHROPIC_API_KEY is unset (no-op)
 *     → Suggestions (source "ai") when Claude answered
 *     → heuristic Suggestions + note "ai_unavailable" on any failure
 *       (timeout, API error, refusal, malformed JSON) — never throws
 *
 * The key is OPTIONAL. Without it the intake shows the extracted text and
 * the heuristics (/lib/ai/heuristics.ts); with it the AI fields override
 * the heuristic ones field by field, only where the model gave a
 * non-null value (`mergeSuggestions`).
 *
 * Model: DEFAULT_AI_MODEL = "claude-opus-5" (the capable default per the
 * Claude API reference), overridable with ANTHROPIC_MODEL. Structured
 * answer: ONE tool (`report_drawing_suggestions`, strict JSON schema of
 * the Suggestions fields) that the request forces with
 * `tool_choice: { type: "tool" }`; models that reject forced tool use
 * (Claude Fable 5.1, Mythos, Opus 5.5) get `tool_choice: auto` plus the
 * instruction in the prompt, and a missing tool call counts as a failure.
 * Thinking is adaptive (on by default on Opus 5) at effort "medium";
 * `output_config.format` is not used because the tool already carries
 * the schema. The answer is validated with zod (`suggestionsSchema`).
 *
 * Cost / latency expectation (Opus 5 list price $5 / $25 per MTok): a
 * 1–2 page drawing as a document block plus its text is ~3–8 k input
 * tokens and ~0.3–1 k output tokens → roughly $0.02–0.07 per part and
 * 5–20 s wall-clock. Hard timeout 30 s (AI_TIMEOUT_MS), no SDK retries,
 * so a slow call costs the user at most 30 s before the heuristic
 * fallback shows. The document block is skipped above 20 MB (the API
 * request limit is 32 MB after base64) — text only, with a note.
 *
 * The PDF companion is matched to its DXF by base name
 * (200005.pdf ↔ 200005.dxf) in the intake route, not here. Nothing the
 * model returns is applied automatically; the UI renders amber chips
 * (/lib/ai/apply.ts) that a person accepts or dismisses.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import {
  AI_UNAVAILABLE_NOTE,
  parseSuggestions,
  type Suggestions,
} from "@/lib/ai/types";

/** The one place the model id lives; `ANTHROPIC_MODEL` overrides it at runtime. */
export const DEFAULT_AI_MODEL = "claude-opus-5";
export const AI_TIMEOUT_MS = 30_000;
export const SUGGESTION_TOOL_NAME = "report_drawing_suggestions";
/** Above this the base64 document would exceed the 32 MB request limit. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Model families that return 400 on `tool_choice: tool | any` (Claude API reference). */
const FORCED_TOOL_CHOICE_UNSUPPORTED = /^claude-(?:fable-5-1|mythos|opus-5-5)/;

export function resolveAiModel(): string {
  const override = process.env.ANTHROPIC_MODEL?.trim();
  return override ? override : DEFAULT_AI_MODEL;
}

export function supportsForcedToolChoice(model: string): boolean {
  return !FORCED_TOOL_CHOICE_UNSUPPORTED.test(model);
}

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }],
});

/**
 * JSON schema of the tool input = the Suggestions fields the model fills
 * (no `source` / `model`). Every property is required and nullable so the
 * strict schema forces an explicit null for anything not on the drawing.
 * /test/ai/prefill.test.ts checks these keys stay in sync with
 * `suggestionsSchema`.
 */
export const suggestionTool: Anthropic.Tool = {
  name: SUGGESTION_TOOL_NAME,
  description:
    "Report what the sheet-metal drawing states, for a person to confirm. Use null for anything the drawing does not state explicitly.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      partNumber: nullable({
        type: "string",
        description: "Drawing / part number from the title block or file name.",
      }),
      material: nullable({
        type: "string",
        description: "Material grade exactly as written (S355, DC01, 1.4301, AlMg3).",
      }),
      thicknessMm: nullable({
        type: "number",
        description: "Sheet thickness in millimetres.",
      }),
      quantity: nullable({
        type: "integer",
        description: "Ordered quantity ONLY when the drawing or order states it (QTY, pcs, szt., ks). Never derived from dimensions or hole counts.",
      }),
      weightKg: nullable({
        type: "number",
        description: "Part weight in kilograms from the title block.",
      }),
      bends: nullable({
        type: "object",
        description: "Bend information; null when the part is flat or the drawing does not show bends.",
        properties: {
          count: nullable({ type: "integer" }),
          angles: {
            type: "array",
            items: { type: "number" },
            description: "Bend angles in degrees as marked on bend views. Chamfers like 2x45° are not bend angles.",
          },
          directions: nullable({
            type: "array",
            items: { type: "string", enum: ["up", "down"] },
            description: "Only when the drawing marks up/down per bend, in the same order as angles.",
          }),
        },
        required: ["count", "angles", "directions"],
        additionalProperties: false,
      }),
      threads: {
        type: "array",
        description: "Tapped holes. size is the metric size with fine pitch kept (M10x1) and coarse pitch dropped (M8).",
        items: {
          type: "object",
          properties: {
            size: { type: "string" },
            count: nullable({ type: "integer" }),
          },
          required: ["size", "count"],
          additionalProperties: false,
        },
      },
      finish: nullable({
        type: "string",
        description: "Surface finish as written (powder coating RAL 7016, galvanised, none).",
      }),
      tolerances: nullable({
        type: "string",
        description: "General tolerance standard (ISO 2768-mK, ISO 13920-B).",
      }),
      notes: {
        type: "array",
        items: { type: "string" },
        description: "Short hints useful for quoting: holes with fits, countersinks, welding symbols, roughness, edge treatment, anything ambiguous.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How legible and complete the title block and callouts are.",
      },
      dimensionsMm: nullable({
        type: "object",
        description: "Blank / overall size from the title block (PLECH 15x500x220 → 500 × 220).",
        properties: {
          length: { type: "number" },
          width: { type: "number" },
        },
        required: ["length", "width"],
        additionalProperties: false,
      }),
    },
    required: [
      "partNumber",
      "material",
      "thicknessMm",
      "quantity",
      "weightKg",
      "bends",
      "threads",
      "finish",
      "tolerances",
      "notes",
      "confidence",
      "dimensionsMm",
    ],
    additionalProperties: false,
  },
};

export type PrefillInput = {
  /** Raw PDF bytes; sent as a document block when present and ≤ 20 MB. */
  pdfBytes?: Uint8Array;
  /** Text from /lib/pdf-text.ts (also sent, it is what the heuristics saw). */
  text: string;
  /** File / part name, e.g. "200005.pdf". */
  partName: string;
  locale: "pl" | "en";
};

export function buildSystemPrompt(locale: PrefillInput["locale"]): string {
  const notesLanguage = locale === "pl" ? "Polish" : "English";
  return [
    "You read manufacturing drawings of sheet-metal parts (PDF title blocks, dimension callouts, bend views) for the quoting tool of a laser-cutting, bending and welding job shop.",
    "Report only what the drawing states; a person confirms every value, so prefer null over a guess.",
    "Thickness in mm, weight in kg. Decimal commas (11,69) are decimals.",
    "Threads: metric size, keep a fine pitch (M10x1), drop the coarse pitch (M8x1.25 → M8); '(8x)' after a callout is its count. A lone 'n' before a number is the Ø symbol of a plain hole, not a thread.",
    "Bend angles are the angles marked on bend views or bend lines; chamfers such as 2x45° are never bend angles. Give up/down directions only when the drawing marks them.",
    "Quantity only from an explicit order quantity (QTY, pcs, szt., ks, Stück) — never from dimensions, hole counts or sheet numbers.",
    `Notes in ${notesLanguage}, short, one hint each.`,
    `Answer by calling the ${SUGGESTION_TOOL_NAME} tool exactly once.`,
  ].join("\n");
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function buildUserContent(
  input: PrefillInput
): { content: Anthropic.ContentBlockParam[]; documentSkipped: boolean } {
  const content: Anthropic.ContentBlockParam[] = [];
  let documentSkipped = false;
  if (input.pdfBytes && input.pdfBytes.byteLength > 0) {
    if (input.pdfBytes.byteLength <= MAX_DOCUMENT_BYTES) {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: toBase64(input.pdfBytes),
        },
        title: input.partName,
      });
    } else {
      documentSkipped = true;
    }
  }
  const text = input.text.trim();
  content.push({
    type: "text",
    text: [
      `File name: ${input.partName}`,
      "",
      "Text extracted from the PDF (pdf.js, whitespace collapsed):",
      text.length > 0 ? text : "(no text layer — scanned or vector-only drawing)",
    ].join("\n"),
  });
  return { content, documentSkipped };
}

/**
 * AI fields override heuristic ones only when non-null / non-empty; notes
 * are the union (AI first). Source becomes "ai".
 */
export function mergeSuggestions(
  heuristic: Suggestions,
  ai: Suggestions,
  model: string
): Suggestions {
  const pick = <T>(aiValue: T | null, base: T | null): T | null =>
    aiValue !== null && aiValue !== undefined ? aiValue : base;
  return {
    source: "ai",
    model,
    partNumber: pick(ai.partNumber, heuristic.partNumber),
    material: pick(ai.material, heuristic.material),
    thicknessMm: pick(ai.thicknessMm, heuristic.thicknessMm),
    quantity: pick(ai.quantity, heuristic.quantity),
    weightKg: pick(ai.weightKg, heuristic.weightKg),
    bends: pick(ai.bends, heuristic.bends),
    threads: ai.threads.length > 0 ? ai.threads : heuristic.threads,
    finish: pick(ai.finish, heuristic.finish),
    tolerances: pick(ai.tolerances, heuristic.tolerances),
    notes: Array.from(new Set([...ai.notes, ...heuristic.notes])),
    confidence: ai.confidence,
    dimensionsMm: pick(ai.dimensionsMm ?? null, heuristic.dimensionsMm ?? null),
  };
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `${error.name} ${error.status ?? ""} ${error.message}`.trim();
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function withUnavailableNote(heuristic: Suggestions): Suggestions {
  return {
    ...heuristic,
    notes: heuristic.notes.includes(AI_UNAVAILABLE_NOTE)
      ? heuristic.notes
      : [...heuristic.notes, AI_UNAVAILABLE_NOTE],
  };
}

export async function prefillFromPdf(input: PrefillInput): Promise<Suggestions | null> {
  if (!env.hasAi()) return null;

  const heuristic = heuristicSuggestions(input.text, input.partName);
  const model = resolveAiModel();

  try {
    const client = new Anthropic({
      apiKey: env.anthropicApiKey() ?? undefined,
      timeout: AI_TIMEOUT_MS,
      maxRetries: 0,
    });
    const { content, documentSkipped } = buildUserContent(input);

    const response = await client.messages.create(
      {
        model,
        max_tokens: 8192,
        system: buildSystemPrompt(input.locale),
        messages: [{ role: "user", content }],
        tools: [suggestionTool],
        tool_choice: supportsForcedToolChoice(model)
          ? { type: "tool", name: SUGGESTION_TOOL_NAME, disable_parallel_tool_use: true }
          : { type: "auto", disable_parallel_tool_use: true },
        output_config: { effort: "medium" },
      },
      { timeout: AI_TIMEOUT_MS }
    );

    if (response.stop_reason === "refusal") {
      throw new Error(
        `refusal${response.stop_details ? ` (${response.stop_details.category ?? "unknown"})` : ""}`
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("max_tokens reached before the tool call completed");
    }
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === SUGGESTION_TOOL_NAME
    );
    if (!toolUse) {
      throw new Error(`no ${SUGGESTION_TOOL_NAME} tool call in the response`);
    }

    const ai = parseSuggestions(toolUse.input);
    const merged = mergeSuggestions(heuristic, ai, model);
    if (documentSkipped) {
      merged.notes = [...merged.notes, "pdf_too_large_for_ai_document"];
    }
    return merged;
  } catch (error) {
    console.error(
      `[ai.prefill] falling back to heuristics for ${input.partName} (model ${model}): ${describeError(error)}`
    );
    return withUnavailableNote(heuristic);
  }
}
