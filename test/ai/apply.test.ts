/**
 * suggestionDiff / acceptSuggestion — pure, nothing auto-applied.
 * File path: /test/ai/apply.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  acceptSuggestion,
  pendingSuggestions,
  suggestionDiff,
  type CurrentPartValues,
} from "@/lib/ai/apply";
import { emptySuggestions, type Suggestions } from "@/lib/ai/types";

const suggestions: Suggestions = {
  ...emptySuggestions("ai"),
  model: "claude-opus-5",
  material: "S355",
  thicknessMm: 15,
  quantity: null,
  threads: [{ size: "M8x1.25", count: 8 }],
};

const current: CurrentPartValues = {
  material: "s 355",
  thicknessMm: 15.001,
  qty: 10,
  threads: [],
};

describe("suggestionDiff", () => {
  it("returns one entry per field with differs computed leniently", () => {
    const diff = suggestionDiff(suggestions, current);
    expect(diff.map((d) => d.field)).toEqual(["material", "thicknessMm", "qty", "threads"]);
    expect(diff[0]).toEqual({ field: "material", suggested: "S355", current: "s 355", differs: false });
    expect(diff[1]).toEqual({ field: "thicknessMm", suggested: 15, current: 15.001, differs: false });
    expect(diff[2]).toEqual({ field: "qty", suggested: null, current: 10, differs: false });
    expect(diff[3]).toEqual({
      field: "threads",
      suggested: [{ size: "M8x1.25", count: 8 }],
      current: null,
      differs: true,
    });
  });

  it("flags real differences and empty current values", () => {
    const diff = suggestionDiff(
      { ...suggestions, material: "DC01", thicknessMm: 2, quantity: 50 },
      { material: null, thicknessMm: 3, qty: null, threads: [{ size: "M8", count: 8 }] }
    );
    expect(diff.find((d) => d.field === "material")?.differs).toBe(true);
    expect(diff.find((d) => d.field === "thicknessMm")?.differs).toBe(true);
    expect(diff.find((d) => d.field === "qty")?.differs).toBe(true);
    // M8x1.25 normalises to M8 → same set, nothing to offer.
    expect(diff.find((d) => d.field === "threads")?.differs).toBe(false);
  });

  it("pendingSuggestions keeps only the differing entries", () => {
    const pending = pendingSuggestions(suggestionDiff(suggestions, current));
    expect(pending.map((p) => p.field)).toEqual(["threads"]);
  });
});

describe("acceptSuggestion", () => {
  it("replaces one field in a copy and leaves the input untouched", () => {
    const [material, , , threads] = suggestionDiff(
      { ...suggestions, material: "DC01" },
      current
    );
    const next = acceptSuggestion(current, material);
    expect(next).not.toBe(current);
    expect(next.material).toBe("DC01");
    expect(next.qty).toBe(10);
    expect(current.material).toBe("s 355");

    const withThreads = acceptSuggestion(next, threads);
    expect(withThreads.threads).toEqual([{ size: "M8x1.25", count: 8 }]);
    expect(withThreads.threads).not.toBe(suggestions.threads);
  });

  it("is a no-op for a null suggestion", () => {
    const [, , qty] = suggestionDiff(suggestions, current);
    expect(acceptSuggestion(current, qty)).toBe(current);
  });
});
