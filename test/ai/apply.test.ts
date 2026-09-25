/**
 * suggestionDiff / acceptSuggestion — pure, nothing auto-applied; covers
 * all six Step 7 chip fields (material, thickness, qty, threads, bends
 * and angles, finish).
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
  bends: null,
  finish: null,
};

describe("suggestionDiff", () => {
  it("returns one entry per field with differs computed leniently", () => {
    const diff = suggestionDiff(suggestions, current);
    expect(diff.map((d) => d.field)).toEqual([
      "material",
      "thicknessMm",
      "qty",
      "threads",
      "bends",
      "finish",
    ]);
    expect(diff[0]).toEqual({ field: "material", suggested: "S355", current: "s 355", differs: false });
    expect(diff[1]).toEqual({ field: "thicknessMm", suggested: 15, current: 15.001, differs: false });
    expect(diff[2]).toEqual({ field: "qty", suggested: null, current: 10, differs: false });
    expect(diff[3]).toEqual({
      field: "threads",
      suggested: [{ size: "M8x1.25", count: 8 }],
      current: null,
      differs: true,
    });
    expect(diff[4]).toEqual({ field: "bends", suggested: null, current: null, differs: false });
    expect(diff[5]).toEqual({ field: "finish", suggested: null, current: null, differs: false });
  });

  it("flags real differences and empty current values", () => {
    const diff = suggestionDiff(
      { ...suggestions, material: "DC01", thicknessMm: 2, quantity: 50 },
      { ...current, material: null, thicknessMm: 3, qty: null, threads: [{ size: "M8", count: 8 }] }
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

describe("bends and angles chip", () => {
  const bent: Suggestions = {
    ...suggestions,
    bends: { count: 2, angles: [90, 45], directions: ["up", "down"] },
  };

  it("differs when the part has no bends yet", () => {
    const entry = suggestionDiff(bent, current).find((d) => d.field === "bends");
    expect(entry).toEqual({
      field: "bends",
      suggested: bent.bends,
      current: null,
      differs: true,
    });
  });

  it("compares angles as a set, tolerant to order and 0.05°", () => {
    const same = suggestionDiff(bent, {
      ...current,
      bends: { count: 2, angles: [45.02, 90], directions: ["up", "down"] },
    });
    expect(same.find((d) => d.field === "bends")?.differs).toBe(false);

    const otherAngle = suggestionDiff(bent, { ...current, bends: { count: 2, angles: [90, 30] } });
    expect(otherAngle.find((d) => d.field === "bends")?.differs).toBe(true);

    const otherCount = suggestionDiff(bent, { ...current, bends: { count: 3, angles: [90, 45] } });
    expect(otherCount.find((d) => d.field === "bends")?.differs).toBe(true);
  });

  it("ignores directions the suggestion does not carry and a count it does not know", () => {
    const partial: Suggestions = { ...suggestions, bends: { count: null, angles: [90] } };
    const diff = suggestionDiff(partial, {
      ...current,
      bends: { count: 4, angles: [90], directions: ["up"] },
    });
    expect(diff.find((d) => d.field === "bends")?.differs).toBe(false);
  });

  it("treats an empty bend object as nothing to offer", () => {
    const empty: Suggestions = { ...suggestions, bends: { count: null, angles: [] } };
    const entry = suggestionDiff(empty, current).find((d) => d.field === "bends");
    expect(entry?.suggested).toBeNull();
    expect(entry?.differs).toBe(false);
  });

  it("accept copies the bend object without sharing arrays", () => {
    const entry = suggestionDiff(bent, current).find((d) => d.field === "bends")!;
    const next = acceptSuggestion(current, entry);
    expect(next.bends).toEqual({ count: 2, angles: [90, 45], directions: ["up", "down"] });
    expect(next.bends?.angles).not.toBe(bent.bends?.angles);
    expect(next.bends?.directions).not.toBe(bent.bends?.directions);
    expect(current.bends).toBeNull();
  });
});

describe("finish chip", () => {
  const powder: Suggestions = {
    ...suggestions,
    finish: { code: "powder_coating", ral: "7016", text: "malowanie proszkowe RAL 7016" },
  };

  it("differs when the part has no finish, matches by code + RAL regardless of wording", () => {
    expect(suggestionDiff(powder, current).find((d) => d.field === "finish")?.differs).toBe(true);
    const same = suggestionDiff(powder, {
      ...current,
      finish: { code: "powder_coating", ral: "7016", text: null },
    });
    expect(same.find((d) => d.field === "finish")?.differs).toBe(false);
    const otherRal = suggestionDiff(powder, {
      ...current,
      finish: { code: "powder_coating", ral: "9005", text: null },
    });
    expect(otherRal.find((d) => d.field === "finish")?.differs).toBe(true);
  });

  it("falls back to the free text, case- and space-insensitively, when no code is known", () => {
    const textOnly: Suggestions = {
      ...suggestions,
      finish: { code: null, ral: null, text: "Cynk lamelowy" },
    };
    const same = suggestionDiff(textOnly, {
      ...current,
      finish: { code: null, ral: null, text: "cynk  LAMELOWY" },
    });
    expect(same.find((d) => d.field === "finish")?.differs).toBe(false);
    const empty: Suggestions = { ...suggestions, finish: { code: null, ral: null, text: "  " } };
    expect(suggestionDiff(empty, current).find((d) => d.field === "finish")?.suggested).toBeNull();
  });

  it("accept copies the finish object", () => {
    const entry = suggestionDiff(powder, current).find((d) => d.field === "finish")!;
    const next = acceptSuggestion(current, entry);
    expect(next.finish).toEqual(powder.finish);
    expect(next.finish).not.toBe(powder.finish);
    expect(current.finish).toBeNull();
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

  it("'accept all' is the accept handler over every pending entry — never automatic", () => {
    const all: Suggestions = {
      ...suggestions,
      material: "DC01",
      quantity: 25,
      bends: { count: 1, angles: [90] },
      finish: { code: "galvanised", ral: null, text: null },
    };
    let values = current;
    for (const entry of pendingSuggestions(suggestionDiff(all, current))) {
      values = acceptSuggestion(values, entry);
    }
    expect(values).toEqual({
      material: "DC01",
      thicknessMm: 15.001,
      qty: 25,
      threads: [{ size: "M8x1.25", count: 8 }],
      bends: { count: 1, angles: [90] },
      finish: { code: "galvanised", ral: null, text: null },
    });
  });
});
