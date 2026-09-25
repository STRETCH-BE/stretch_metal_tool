/**
 * Pure helpers for showing PDF / AI suggestions next to a part's fields.
 * File path: /lib/ai/apply.ts
 *
 * NOTHING HERE IS EVER AUTO-APPLIED. `suggestionDiff` only computes, per
 * field, what the suggestion says, what the part currently holds and
 * whether they differ, so the intake UI can render an amber chip per
 * field with accept / dismiss buttons (Step 7: thickness, material, bends
 * and angles, threads, finish, quantity). `acceptSuggestion` returns a new
 * values object for ONE field and is meant to be called from the click
 * handler of that chip's accept button — never from an effect or on load
 * ("accept all" is that handler in a loop). The suggestion object itself
 * is never mutated.
 *
 * Comparison rules: material is compared case- and whitespace-
 * insensitively ("s 355" == "S355"); thickness within 0.005 mm; threads
 * as an unordered set of normalised size + count; bends by count, angles
 * as a sorted set (0.1° tolerance) and directions only when the
 * suggestion carries them; finish by code + RAL number, falling back to
 * the free text (case/space-insensitive) when no code is known. A null or
 * empty suggestion never "differs" — there is nothing to offer.
 */

import { normalizeThreadSize } from "@/lib/ai/threads";
import type {
  BendSuggestion,
  FinishSuggestion,
  Suggestions,
  ThreadSuggestion,
} from "@/lib/ai/types";

export type CurrentPartValues = {
  material: string | null;
  thicknessMm: number | null;
  qty: number | null;
  threads: ThreadSuggestion[];
  bends: BendSuggestion | null;
  finish: FinishSuggestion | null;
};

export type SuggestionField = keyof CurrentPartValues;

type DiffEntry<F extends SuggestionField, V> = {
  field: F;
  suggested: V | null;
  current: V | null;
  /** True only when a suggestion exists and is not already the current value. */
  differs: boolean;
};

export type SuggestionDiffEntry =
  | DiffEntry<"material", string>
  | DiffEntry<"thicknessMm", number>
  | DiffEntry<"qty", number>
  | DiffEntry<"threads", ThreadSuggestion[]>
  | DiffEntry<"bends", BendSuggestion>
  | DiffEntry<"finish", FinishSuggestion>;

function compact(value: string | null): string | null {
  if (value === null) return null;
  const c = value.trim().toUpperCase().replace(/\s+/g, "");
  return c.length > 0 ? c : null;
}

function threadKey(list: ThreadSuggestion[]): string {
  return list
    .map((t) => ({
      size: normalizeThreadSize(t.size) ?? t.size.trim().toUpperCase().replace(/\s+/g, ""),
      count: t.count,
    }))
    .sort((a, b) => a.size.localeCompare(b.size))
    .map((t) => `${t.size}:${t.count ?? "?"}`)
    .join("|");
}

function angleKey(angles: number[]): string {
  return Array.from(new Set(angles.map((a) => Math.round(a * 10) / 10)))
    .sort((a, b) => a - b)
    .join(",");
}

/** An empty bend object ({count: null, angles: []}) offers nothing. */
function bendsOrNull(bends: BendSuggestion | null): BendSuggestion | null {
  if (bends === null) return null;
  const hasDirections = (bends.directions?.length ?? 0) > 0;
  return bends.count !== null || bends.angles.length > 0 || hasDirections ? bends : null;
}

function bendsDiffer(suggested: BendSuggestion, current: BendSuggestion | null): boolean {
  if (current === null) return true;
  if (suggested.count !== null && suggested.count !== current.count) return true;
  if (suggested.angles.length > 0 && angleKey(suggested.angles) !== angleKey(current.angles)) {
    return true;
  }
  if (suggested.directions && suggested.directions.length > 0) {
    const cur = current.directions ?? [];
    if (suggested.directions.join(",") !== cur.join(",")) return true;
  }
  return false;
}

function finishOrNull(finish: FinishSuggestion | null): FinishSuggestion | null {
  if (finish === null) return null;
  return finish.code !== null || finish.ral !== null || compact(finish.text) !== null
    ? finish
    : null;
}

function finishKey(finish: FinishSuggestion | null): string {
  if (finish === null) return "";
  const what = finish.code ?? compact(finish.text) ?? "";
  return `${what}|${finish.ral ?? ""}`;
}

/** Per-field comparison of a suggestion with the part's current values. */
export function suggestionDiff(
  suggestions: Suggestions,
  current: CurrentPartValues
): SuggestionDiffEntry[] {
  const material: DiffEntry<"material", string> = {
    field: "material",
    suggested: suggestions.material,
    current: current.material,
    differs:
      suggestions.material !== null &&
      compact(suggestions.material) !== compact(current.material),
  };
  const thicknessMm: DiffEntry<"thicknessMm", number> = {
    field: "thicknessMm",
    suggested: suggestions.thicknessMm,
    current: current.thicknessMm,
    differs:
      suggestions.thicknessMm !== null &&
      (current.thicknessMm === null ||
        Math.abs(suggestions.thicknessMm - current.thicknessMm) >= 0.005),
  };
  const qty: DiffEntry<"qty", number> = {
    field: "qty",
    suggested: suggestions.quantity,
    current: current.qty,
    differs: suggestions.quantity !== null && suggestions.quantity !== current.qty,
  };
  const suggestedThreads = suggestions.threads.length > 0 ? suggestions.threads : null;
  const threads: DiffEntry<"threads", ThreadSuggestion[]> = {
    field: "threads",
    suggested: suggestedThreads,
    current: current.threads.length > 0 ? current.threads : null,
    differs:
      suggestedThreads !== null && threadKey(suggestedThreads) !== threadKey(current.threads),
  };
  const suggestedBends = bendsOrNull(suggestions.bends);
  const currentBends = bendsOrNull(current.bends);
  const bends: DiffEntry<"bends", BendSuggestion> = {
    field: "bends",
    suggested: suggestedBends,
    current: currentBends,
    differs: suggestedBends !== null && bendsDiffer(suggestedBends, currentBends),
  };
  const suggestedFinish = finishOrNull(suggestions.finish);
  const currentFinish = finishOrNull(current.finish);
  const finish: DiffEntry<"finish", FinishSuggestion> = {
    field: "finish",
    suggested: suggestedFinish,
    current: currentFinish,
    differs: suggestedFinish !== null && finishKey(suggestedFinish) !== finishKey(currentFinish),
  };
  return [material, thicknessMm, qty, threads, bends, finish];
}

/** Only the entries worth an amber chip. */
export function pendingSuggestions(diff: SuggestionDiffEntry[]): SuggestionDiffEntry[] {
  return diff.filter((entry) => entry.differs);
}

/**
 * New values with ONE field replaced by its suggestion. Call from the
 * accept button's click handler only. A null suggestion returns the
 * input unchanged (same reference), so callers can detect a no-op.
 */
export function acceptSuggestion(
  current: CurrentPartValues,
  entry: SuggestionDiffEntry
): CurrentPartValues {
  if (entry.suggested === null) return current;
  switch (entry.field) {
    case "material":
      return { ...current, material: entry.suggested };
    case "thicknessMm":
      return { ...current, thicknessMm: entry.suggested };
    case "qty":
      return { ...current, qty: entry.suggested };
    case "threads":
      return { ...current, threads: entry.suggested.map((t) => ({ ...t })) };
    case "bends":
      return {
        ...current,
        bends: {
          count: entry.suggested.count,
          angles: [...entry.suggested.angles],
          ...(entry.suggested.directions ? { directions: [...entry.suggested.directions] } : {}),
        },
      };
    case "finish":
      return { ...current, finish: { ...entry.suggested } };
  }
}
