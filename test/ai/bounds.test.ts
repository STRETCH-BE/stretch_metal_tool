/**
 * Range validation of AI values (review finding: types were checked,
 * ranges were not — quantity 0 / thickness −5 hid correct heuristic
 * values and produced a zero-quantity chip). The reviewer's probe is the
 * end-to-end case at the bottom.
 * File path: /test/ai/bounds.test.ts
 */
import { describe, expect, it } from "vitest";
import { normaliseRal, sanitiseSuggestions, SUGGESTION_BOUNDS } from "@/lib/ai/bounds";
import { acceptSuggestion, suggestionDiff } from "@/lib/ai/apply";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import { mergeSuggestions } from "@/lib/ai/prefill";
import { emptySuggestions, parseSuggestions, type Suggestions } from "@/lib/ai/types";

const BAD: Suggestions = {
  ...emptySuggestions("ai"),
  thicknessMm: -5,
  quantity: 0,
  weightKg: -1,
  bends: { count: -3, angles: [720, 90], directions: ["up", "down"] },
  threads: [
    { size: "banana", count: 2 },
    { size: "M8x1.25", count: 0 },
    { size: "M10x1", count: 6 },
  ],
  finish: { code: "powder_coating", ral: "seven", text: null },
  dimensionsMm: { length: 0, width: 220 },
};

describe("sanitiseSuggestions", () => {
  const { suggestions: s, dropped } = sanitiseSuggestions(BAD);

  it("nulls every out-of-range value without touching the input", () => {
    expect(s.thicknessMm).toBeNull();
    expect(s.quantity).toBeNull();
    expect(s.weightKg).toBeNull();
    expect(s.bends).toEqual({ count: null, angles: [90], directions: ["down"] });
    expect(s.threads).toEqual([
      { size: "M8", count: null },
      { size: "M10x1", count: 6 },
    ]);
    expect(s.finish).toEqual({ code: "powder_coating", ral: null, text: null });
    expect(s.dimensionsMm).toBeNull();
    expect(BAD.thicknessMm).toBe(-5);
    expect(BAD.threads).toHaveLength(3);
  });

  it("reports one ai_value_dropped note per drop, keyed by the content field", () => {
    const fields = dropped.map((n) => `${n.params?.field}=${n.params?.value}`);
    expect(dropped.every((n) => n.code === "ai_value_dropped")).toBe(true);
    expect(fields).toEqual([
      "thicknessMm=-5",
      "quantity=0",
      "weightKg=-1",
      "bendCount=-3",
      "bendAngles=720",
      "threads=banana",
      "threads=M8 × 0",
      "finish=seven",
      "dimensionsMm=0 × 220",
    ]);
  });

  it("keeps in-range values untouched and reports nothing", () => {
    const good: Suggestions = {
      ...emptySuggestions("ai"),
      thicknessMm: SUGGESTION_BOUNDS.thicknessMm.min,
      quantity: 1,
      weightKg: 0.001,
      bends: { count: 1, angles: [0.5, 179.5] },
      threads: [{ size: "M6", count: 4 }],
      finish: { code: null, ral: "RAL 7016", text: "RAL 7016" },
      dimensionsMm: { length: 220, width: 500 },
    };
    const { suggestions, dropped: none } = sanitiseSuggestions(good);
    expect(none).toEqual([]);
    expect(suggestions).toEqual({ ...good, finish: { code: null, ral: "7016", text: "RAL 7016" }, dimensionsMm: { length: 500, width: 220 } });
  });

  it("drops a bend object that has nothing left and a finish with nothing left", () => {
    const { suggestions } = sanitiseSuggestions({
      ...emptySuggestions("ai"),
      bends: { count: 0, angles: [180] },
      finish: { code: null, ral: "x", text: null },
    });
    expect(suggestions.bends).toBeNull();
    expect(suggestions.finish).toBeNull();
  });

  it("drops directions that no longer line up with the angles", () => {
    const { suggestions, dropped: d } = sanitiseSuggestions({
      ...emptySuggestions("ai"),
      bends: { count: 2, angles: [90, 45], directions: ["up"] },
    });
    expect(suggestions.bends).toEqual({ count: 2, angles: [90, 45] });
    expect(d).toContainEqual({ code: "ai_value_dropped", params: { field: "bendDirections", value: "up" } });
  });

  it("normaliseRal extracts the 4-digit number", () => {
    expect(normaliseRal("RAL 7016")).toBe("7016");
    expect(normaliseRal("7016")).toBe("7016");
    expect(normaliseRal("RAL7016")).toBeNull();
    expect(normaliseRal("black")).toBeNull();
  });
});

describe("reviewer probe: a model answering quantity 0 / thickness -5", () => {
  it("no longer hides the heuristic values or offers a zero-quantity chip", () => {
    const ai = sanitiseSuggestions(
      parseSuggestions({ ...BAD, source: undefined, model: undefined })
    );
    const heuristic = heuristicSuggestions("PLECH 15x500x220 QTY: 10 S355");
    const merged = mergeSuggestions(heuristic, ai.suggestions, "claude-opus-5");
    expect(merged.thicknessMm).toBe(15);
    expect(merged.quantity).toBe(10);

    const current = { material: null, thicknessMm: 15, qty: 10, threads: [], bends: null, finish: null };
    const diff = suggestionDiff(merged, current);
    expect(diff.find((d) => d.field === "thicknessMm")?.differs).toBe(false);
    expect(diff.find((d) => d.field === "qty")?.differs).toBe(false);
    const qty = diff.find((d) => d.field === "qty")!;
    expect(acceptSuggestion(current, qty).qty).toBe(10);
  });
});
