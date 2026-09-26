/**
 * Pure annotation reducers (lib/parts/annotation-edits.ts): triage
 * answers, thread confirmation, bend parameters (materialising every
 * bend line), accepting PDF thread / bend / finish suggestions, and the
 * candidate answer keeping annotations.bends in step with what
 * lib/pricing resolveBends prices.
 * File path: /test/intake/annotation-edits.test.ts
 */
import { describe, expect, it } from "vitest";
import { EMPTY_ANNOTATIONS, type GeometryEntity, type PartAnnotations, type PartGeometry } from "@/lib/geometry/types";
import { resolveBends } from "@/lib/pricing";
import type { ExtraOperation, PricingPart } from "@/lib/pricing/types";
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

/** 200164-like geometry plus three unnamed interior lines the triage would list as candidates. */
function withCandidates(): { geometry: PartGeometry; ids: string[] } {
  const geometry = make200164Like();
  const ids = ["cand-1", "cand-2", "cand-3"];
  const xs = [-300, -250, -200];
  const entities: GeometryEntity[] = ids.map((id, i) => ({
    id,
    layer: "0",
    originalType: "LINE",
    segments: [{ kind: "line", start: { x: xs[i], y: -60 }, end: { x: xs[i], y: 0 } }],
    closed: false,
    lengthMm: 60,
    bbox: { minX: xs[i], minY: -60, maxX: xs[i], maxY: 0, width: 0, height: 60 },
    roleFromLayer: null,
    role: "unknown",
    loopId: null,
  }));
  return { geometry: { ...geometry, entities: [...geometry.entities, ...entities] }, ids };
}

function pricingPart(geometry: PartGeometry, annotations: PartAnnotations): PricingPart {
  return { id: "p", name: "200164", source: "dxf", materialCode: "DC01", thicknessMm: 2, geometry, annotations };
}

describe("candidate answers vs annotations.bends (pricing reads bends exclusively once non-empty)", () => {
  const { geometry, ids } = withCandidates();
  const triage = { candidateEntityIds: ids };
  const materialised = setBendParams(base, geometry, "bend-down-2", { angleDeg: 120, radiusMm: 3, direction: "down" }, 2)!;

  it("appends a bend annotation per tagged candidate when bend annotations already exist", () => {
    expect(materialised.bends).toHaveLength(4);
    const tagged = applyTriageAnswer(materialised, triage, { kind: "candidates", role: "bend_up" }, geometry, 2);
    expect(tagged.entities).toEqual({ "cand-1": { role: "bend_up" }, "cand-2": { role: "bend_up" }, "cand-3": { role: "bend_up" } });
    expect(tagged.bends).toHaveLength(7);
    const fresh = tagged.bends.filter((b) => ids.includes(b.entityId ?? ""));
    expect(fresh.map((b) => b.id)).toEqual(["bend-1", "bend-2", "bend-3"]);
    for (const b of fresh) {
      expect(b).toMatchObject({ angleDeg: 90, radiusMm: 2, direction: "up", dieVMm: null, lengthMm: 60 });
      expect(b.start).toEqual({ x: expect.any(Number), y: -60 });
      expect(b.end).toEqual({ x: b.start.x, y: 0 });
    }
    // The four materialised bends are untouched (including the edited one).
    expect(tagged.bends.find((b) => b.id === "bend-down-2")).toMatchObject({ angleDeg: 120, radiusMm: 3 });
    // And the pricing engine sees all seven.
    const priced = resolveBends(pricingPart(geometry, tagged), 2, null);
    expect(priced).toHaveLength(7);
    expect(priced.filter((b) => b.direction === "up")).toHaveLength(4);
    expect(priced.every((b) => b.origin === "annotation")).toBe(true);
    // Input untouched.
    expect(materialised.bends).toHaveLength(4);
  });

  it("uses the role's direction and replaces an earlier answer instead of duplicating", () => {
    const up = applyTriageAnswer(materialised, triage, { kind: "candidates", role: "bend_up" }, geometry, 2);
    const down = applyTriageAnswer(up, triage, { kind: "candidates", role: "bend_down" }, geometry, 2);
    expect(down.bends).toHaveLength(7);
    expect(down.bends.filter((b) => ids.includes(b.entityId ?? "")).every((b) => b.direction === "down")).toBe(true);
    expect(resolveBends(pricingPart(geometry, down), 2, null)).toHaveLength(7);
  });

  it("removes the tagged bends again on ignore / cut", () => {
    const up = applyTriageAnswer(materialised, triage, { kind: "candidates", role: "bend_up" }, geometry, 2);
    const ignored = applyTriageAnswer(up, triage, { kind: "candidates", role: "ignore" }, geometry, 2);
    expect(ignored.bends).toHaveLength(4);
    expect(ignored.entities["cand-1"]).toEqual({ role: "ignore" });
    expect(resolveBends(pricingPart(geometry, ignored), 2, null)).toHaveLength(4);
    const cut = tagCandidates(up, ids, "cut", geometry, 2);
    expect(cut.bends).toHaveLength(4);
  });

  it("writes only role overrides while no bend annotation exists (the engine's bend lines are priced)", () => {
    const tagged = applyTriageAnswer(base, triage, { kind: "candidates", role: "bend_down" }, geometry, 2);
    expect(tagged.bends).toEqual([]);
    expect(Object.keys(tagged.entities)).toEqual(ids);
    // Geometry path: the four layer bend lines are priced from measures.
    expect(resolveBends(pricingPart(geometry, tagged), 2, null)).toHaveLength(4);
  });

  it("skips ids without an entity and works without geometry", () => {
    const tagged = tagCandidates(materialised, ["nope", "cand-1"], "bend_up", geometry, 2);
    expect(tagged.bends).toHaveLength(5);
    expect(tagged.entities.nope).toEqual({ role: "bend_up" });
    const blind = tagCandidates(materialised, ids, "bend_up");
    expect(blind.bends).toHaveLength(4);
    expect(blind.entities["cand-2"]).toEqual({ role: "bend_up" });
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
