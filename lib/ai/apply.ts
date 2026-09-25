/**
 * Pure helpers for showing PDF / AI suggestions next to a part's fields.
 * File path: /lib/ai/apply.ts
 *
 * NOTHING HERE IS EVER AUTO-APPLIED. `suggestionDiff` only computes, per
 * field, what the suggestion says, what the part currently holds and
 * whether they differ, so the intake UI can render an amber chip per
 * field with accept / dismiss buttons. `acceptSuggestion` returns a new
 * values object for ONE field and is meant to be called from the click
 * handler of that chip's accept button — never from an effect or on
 * load. The suggestion object itself is never mutated.
 *
 * Comparison rules: material is compared case- and whitespace-
 * insensitively ("s 355" == "S355"); thickness within 0.005 mm; threads
 * as an unordered set of normalised size + count. A null suggestion never
 * "differs" — there is nothing to offer.
 */

import { normalizeThreadSize } from "@/lib/ai/heuristics";
import type { Suggestions, ThreadSuggestion } from "@/lib/ai/types";

export type CurrentPartValues = {
  material: string | null;
  thicknessMm: number | null;
  qty: number | null;
  threads: ThreadSuggestion[];
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
  | DiffEntry<"threads", ThreadSuggestion[]>;

function normaliseMaterial(value: string | null): string | null {
  if (value === null) return null;
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  return compact.length > 0 ? compact : null;
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
      normaliseMaterial(suggestions.material) !== normaliseMaterial(current.material),
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
  return [material, thicknessMm, qty, threads];
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
  }
}
