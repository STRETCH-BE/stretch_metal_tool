/**
 * Pure annotation reducers (lib/parts/annotation-edits.ts): triage
 * answers, thread confirmation, bend parameters (materialising every
 * bend line), accepting PDF thread / bend / finish suggestions.
 * File path: /test/intake/annotation-edits.test.ts
 */
import { describe, expect, it } from "vitest";
import { EMPTY_ANNOTATIONS, type PartAnnotations } from "@/lib/geometry/types";
import type { ExtraOperation } from "@/lib/pricing/types";
import { make200005Like, make200164Like } from "../helpers/parts";
import {
  acceptBendSuggestion,
  acceptFinishSuggestion,
  acceptThreadSuggestions,
  applyTriageAnswer,
  clearThread,
  confirmThread,
  finishRateCodeFor,
  materialiseBends,
  setBendParams,
  tagCandidates,
} from "@/lib/parts/annotation-edits";

const base: PartAnnotations = { ...EMPTY_ANNOTATIONS };

describe("applyTriageAnswer", () => {
  it("tags every candidate at once, confirms units, stores the forming answer", () => {
    const triage = { candidateEntityIds: ["e1", "e2", "e3"] };
    const tagged = applyTriageAnswer(base, triage, { kind: "candidates", role: "bend_down" });
    expect(tagged.entities).toEqual({ e1: { role: "bend_down" }, e2: { role: "bend_down" }, e3: { role: "bend_down" } });
    expect(base.entities).toEqual({});
    expect(applyTriageAnswer(base, null, { kind: "units", confirmed: true }).unitsConfirmed).toBe(true);
    expect(applyTriageAnswer(base, null, { kind: "forming", value: "rolled" }).forming).toBe("rolled");
    expect(tagCandidates({ ...base, entities: { x: { role: "weld" } } }, ["e1"], "cut").entities).toEqual({ x: { role: "weld" }, e1: { role: "cut" } });
  });
});

describe("threads", () => {
  it("confirms, rejects and clears per loop id without mutating the input", () => {
    const confirmed = confirmThread(base, "loop-1", "M8");
    expect(confirmed.threads).toEqual({ "loop-1": "M8" });
    const rejected = confirmThread(confirmed, "loop-2", null);
    expect(rejected.threads).toEqual({ "loop-1": "M8", "loop-2": null });
    expect(clearThread(rejected, "loop-1").threads).toEqual({ "loop-2": null });
    expect(base.threads).toEqual({});
  });

  it("accepts a PDF thread list by matching hole diameters (M8 ×8, M10x1 ×6 on 200005)", () => {
    const holes = make200005Like().measures.holes;
    const { annotations, confirmed } = acceptThreadSuggestions(base, holes, [
      { size: "M8x1.25", count: 8 },
      { size: "M10x1", count: 6 },
      { size: "M20", count: 2 },
    ]);
    expect(confirmed).toBe(14);
    const sizes = Object.values(annotations.threads);
    expect(sizes.filter((s) => s === "M8")).toHaveLength(8);
    expect(sizes.filter((s) => s === "M10x1")).toHaveLength(6);
    // Already confirmed holes are left alone.
    const again = acceptThreadSuggestions(annotations, holes, [{ size: "M8", count: 8 }]);
    expect(again.confirmed).toBe(0);
  });
});

describe("bends", () => {
  const geometry = make200164Like();

  it("materialises every layer bend line with defaults when the first one is edited", () => {
    const next = setBendParams(base, geometry, "bend-down-2", { angleDeg: 120, radiusMm: 3, direction: "down" }, 2);
    expect(next).not.toBeNull();
    expect(next!.bends).toHaveLength(4);
    const edited = next!.bends.find((b) => b.id === "bend-down-2")!;
    expect(edited).toMatchObject({ angleDeg: 120, radiusMm: 3, direction: "down", entityId: expect.any(String) });
    const untouched = next!.bends.find((b) => b.id === "bend-up-1")!;
    expect(untouched).toMatchObject({ angleDeg: 90, radiusMm: 2, direction: "up" });
    expect(untouched.lengthMm).toBeCloseTo(60, 3);
    // A second edit updates in place.
    const third = setBendParams(next!, geometry, "bend-up-1", { angleDeg: 45, radiusMm: null, direction: "up" }, 2);
    expect(third!.bends).toHaveLength(4);
    expect(third!.bends.find((b) => b.id === "bend-up-1")).toMatchObject({ angleDeg: 45, radiusMm: null });
    expect(setBendParams(base, geometry, "nope", { angleDeg: 90, radiusMm: null, direction: "up" }, 2)).toBeNull();
  });

  it("skips candidate and deleted lines and returns [] without geometry", () => {
    expect(materialiseBends(base, null, 2)).toEqual([]);
    const deleted = { ...base, deletedEntityIds: ["bend-down-1"] };
    expect(materialiseBends(deleted, geometry, 2)).toHaveLength(3);
  });

  it("applies suggested angles: one angle → all, N angles → in order, otherwise null", () => {
    const one = acceptBendSuggestion(base, geometry, { count: 4, angles: [135] }, 2);
    expect(one!.bends.map((b) => b.angleDeg)).toEqual([135, 135, 135, 135]);
    const four = acceptBendSuggestion(base, geometry, { count: 4, angles: [90, 45, 60, 120], directions: ["down", "down", "up", "up"] }, 2);
    expect(four!.bends.map((b) => b.angleDeg)).toEqual([90, 45, 60, 120]);
    expect(four!.bends.map((b) => b.direction)).toEqual(["down", "down", "up", "up"]);
    expect(acceptBendSuggestion(base, geometry, { count: 4, angles: [90, 45] }, 2)).toBeNull();
    expect(acceptBendSuggestion(base, geometry, { count: 4, angles: [] }, 2)).toBeNull();
    expect(acceptBendSuggestion(base, null, { count: 1, angles: [90] }, 2)).toBeNull();
  });
});

describe("finish", () => {
  it("maps AI finish codes to rate codes and adds one finish extra", () => {
    expect(finishRateCodeFor("powder_coating")).toBe("powder");
    expect(finishRateCodeFor("galvanised")).toBe("zinc");
    expect(finishRateCodeFor("deburred")).toBe("deburr");
    expect(finishRateCodeFor("none")).toBeNull();
    expect(finishRateCodeFor("anodised")).toBe("anodised");
    const first = acceptFinishSuggestion([], { code: "powder_coating", ral: "7016", text: "RAL 7016 powder" });
    expect(first.added).toBe(true);
    expect(first.extras).toEqual<ExtraOperation[]>([{ type: "finish", code: "powder", maskingMinutes: 0, note: "RAL 7016 — RAL 7016 powder" }]);
    const again = acceptFinishSuggestion(first.extras, { code: "painted", ral: null, text: null });
    expect(again.added).toBe(false);
    expect(acceptFinishSuggestion([], { code: "none", ral: null, text: null }).added).toBe(false);
  });
});
