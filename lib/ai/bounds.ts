/**
 * Plausibility bounds for suggestion values + the sanitiser applied to the
 * model's answer before it is merged over the heuristics.
 * File path: /lib/ai/bounds.ts
 *
 * The zod schema (/lib/ai/types.ts) checks TYPES only. A model answering
 * `quantity: 0` for "not stated", a negative thickness or a 720° bend
 * angle would otherwise pass, override a correct heuristic value in
 * `mergeSuggestions` and be offered as an amber chip. `sanitiseSuggestions`
 * nulls every out-of-range value field by field and records an
 * "ai_value_dropped" note per drop, so the rest of the answer survives
 * and the person sees what was thrown away.
 *
 * These are SANITY bounds (a 0.3–150 mm sheet, a 1–99 bend count), not
 * machine limits — the laser / press-brake limits come from the
 * `machines` table via MachinePark (CLAUDE.md), never from constants.
 * The heuristics use the same thickness bounds so both producers agree.
 */

import { normalizeThreadSize } from "@/lib/ai/threads";
import type {
  BendSuggestion,
  DimensionsSuggestion,
  FinishSuggestion,
  SuggestionNote,
  Suggestions,
  ThreadSuggestion,
} from "@/lib/ai/types";

export const SUGGESTION_BOUNDS = {
  /** Sheet thickness, mm (inclusive). */
  thicknessMm: { min: 0.3, max: 150 },
  /** Ordered quantity, integer (inclusive). */
  quantity: { min: 1, max: 100_000 },
  /** Part weight, kg (exclusive min, inclusive max). */
  weightKg: { min: 0, max: 50_000 },
  /** Number of bends, integer (inclusive). */
  bendCount: { min: 1, max: 99 },
  /** Bend angle, degrees (exclusive both ends: 0 and 180 are not bends). */
  bendAngleDeg: { min: 0, max: 180 },
  /** Blank side, mm (inclusive). */
  dimensionMm: { min: 1, max: 20_000 },
  /** Threads of one size, integer (inclusive). */
  threadCount: { min: 1, max: 999 },
} as const;

function inRange(value: number, bounds: { min: number; max: number }, exclusiveMin = false): boolean {
  if (!Number.isFinite(value)) return false;
  if (exclusiveMin ? value <= bounds.min : value < bounds.min) return false;
  return value <= bounds.max;
}

function isInt(value: number): boolean {
  return Number.isInteger(value);
}

export function isValidThickness(value: number): boolean {
  return inRange(value, SUGGESTION_BOUNDS.thicknessMm);
}

export function isValidQuantity(value: number): boolean {
  return isInt(value) && inRange(value, SUGGESTION_BOUNDS.quantity);
}

export function isValidWeight(value: number): boolean {
  return inRange(value, SUGGESTION_BOUNDS.weightKg, true);
}

export function isValidBendCount(value: number): boolean {
  return isInt(value) && inRange(value, SUGGESTION_BOUNDS.bendCount);
}

export function isValidBendAngle(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value > SUGGESTION_BOUNDS.bendAngleDeg.min &&
    value < SUGGESTION_BOUNDS.bendAngleDeg.max
  );
}

export function isValidDimension(value: number): boolean {
  return inRange(value, SUGGESTION_BOUNDS.dimensionMm);
}

export function isValidThreadCount(value: number): boolean {
  return isInt(value) && inRange(value, SUGGESTION_BOUNDS.threadCount);
}

/** "RAL 7016" / "7016" → "7016"; anything without a 4-digit group → null. */
export function normaliseRal(value: string | null): string | null {
  if (value === null) return null;
  const m = value.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

export type SanitisedSuggestions = {
  suggestions: Suggestions;
  /** One "ai_value_dropped" note per value that was nulled. */
  dropped: SuggestionNote[];
};

function droppedNote(field: string, value: unknown): SuggestionNote {
  return {
    code: "ai_value_dropped",
    params: { field, value: typeof value === "string" ? value : JSON.stringify(value) },
  };
}

function sanitiseBends(
  bends: BendSuggestion | null,
  dropped: SuggestionNote[]
): BendSuggestion | null {
  if (bends === null) return null;
  let count = bends.count;
  if (count !== null && !isValidBendCount(count)) {
    dropped.push(droppedNote("bendCount", count));
    count = null;
  }
  const angles: number[] = [];
  const keptIndex: number[] = [];
  bends.angles.forEach((angle, i) => {
    if (isValidBendAngle(angle)) {
      angles.push(angle);
      keptIndex.push(i);
    } else {
      dropped.push(droppedNote("bendAngles", angle));
    }
  });
  let directions = bends.directions;
  if (directions !== undefined) {
    if (directions.length === bends.angles.length) {
      directions = keptIndex.map((i) => bends.directions![i]);
    } else if (directions.length !== angles.length) {
      dropped.push(droppedNote("bendDirections", directions.join(",")));
      directions = undefined;
    }
    if (directions !== undefined && directions.length === 0) directions = undefined;
  }
  if (count === null && angles.length === 0 && directions === undefined) return null;
  return { count, angles, ...(directions !== undefined ? { directions } : {}) };
}

function sanitiseThreads(
  threads: ThreadSuggestion[],
  dropped: SuggestionNote[]
): ThreadSuggestion[] {
  const out: ThreadSuggestion[] = [];
  for (const thread of threads) {
    const size = normalizeThreadSize(thread.size);
    if (size === null) {
      dropped.push(droppedNote("threads", thread.size));
      continue;
    }
    let count = thread.count;
    if (count !== null && !isValidThreadCount(count)) {
      dropped.push(droppedNote("threads", `${size} × ${count}`));
      count = null;
    }
    out.push({ size, count });
  }
  return out;
}

function sanitiseFinish(
  finish: FinishSuggestion | null,
  dropped: SuggestionNote[]
): FinishSuggestion | null {
  if (finish === null) return null;
  let ral = finish.ral;
  if (ral !== null) {
    const normalised = normaliseRal(ral);
    if (normalised === null) dropped.push(droppedNote("finish", ral));
    ral = normalised;
  }
  if (finish.code === null && ral === null && finish.text === null) return null;
  return { code: finish.code, ral, text: finish.text };
}

function sanitiseDimensions(
  dimensions: DimensionsSuggestion | null | undefined,
  dropped: SuggestionNote[]
): DimensionsSuggestion | null {
  if (!dimensions) return null;
  if (!isValidDimension(dimensions.length) || !isValidDimension(dimensions.width)) {
    dropped.push(droppedNote("dimensionsMm", `${dimensions.length} × ${dimensions.width}`));
    return null;
  }
  const [width, length] = [dimensions.length, dimensions.width].sort((a, b) => a - b);
  return { length, width };
}

/**
 * Null every out-of-range value (see SUGGESTION_BOUNDS) and report each
 * drop. Pure; the input is not mutated. Notes are left as they are — the
 * caller appends `dropped` where it wants them.
 */
export function sanitiseSuggestions(input: Suggestions): SanitisedSuggestions {
  const dropped: SuggestionNote[] = [];
  const s: Suggestions = { ...input, threads: [...input.threads], notes: [...input.notes] };

  if (s.thicknessMm !== null && !isValidThickness(s.thicknessMm)) {
    dropped.push(droppedNote("thicknessMm", s.thicknessMm));
    s.thicknessMm = null;
  }
  if (s.quantity !== null && !isValidQuantity(s.quantity)) {
    dropped.push(droppedNote("quantity", s.quantity));
    s.quantity = null;
  }
  if (s.weightKg !== null && !isValidWeight(s.weightKg)) {
    dropped.push(droppedNote("weightKg", s.weightKg));
    s.weightKg = null;
  }
  s.bends = sanitiseBends(s.bends, dropped);
  s.threads = sanitiseThreads(s.threads, dropped);
  s.finish = sanitiseFinish(s.finish, dropped);
  s.dimensionsMm = sanitiseDimensions(s.dimensionsMm, dropped);

  return { suggestions: s, dropped };
}
