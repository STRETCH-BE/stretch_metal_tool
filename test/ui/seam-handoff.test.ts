/**
 * Weld → assembly seam hand-off state (components/quote/seam-handoff.ts):
 * the SeamInput built from a viewer weld, the per-weld button state
 * (idle / pending / added / paired / already — the double-click guard)
 * and the outcome of addSeamFromPart.
 * File path: /test/ui/seam-handoff.test.ts
 */
import { describe, expect, it } from "vitest";
import { handoffOutcome, seamForWeld, seamStateForWeld, weldToSeamInput } from "@/components/quote/seam-handoff";
import type { WeldAnnotation } from "@/lib/geometry/types";
import { makeSeamRow, PART_ID, PART_ID_2 } from "@/test/quotes/fixtures";

function weld(over: Partial<WeldAnnotation> = {}): WeldAnnotation {
  return {
    id: "w1",
    entityIds: ["e1", "e2"],
    points: null,
    lengthMm: 1250,
    process: "mig_mag",
    beadMm: 4,
    pattern: "full",
    stitch: null,
    sides: 1,
    effectiveLengthMm: 1250,
    ...over,
  };
}

describe("weldToSeamInput", () => {
  it("maps a full weld to a continuous seam of the part at its thickness", () => {
    expect(weldToSeamInput(weld(), PART_ID, 3)).toEqual({
      label: null,
      partId: PART_ID,
      entityIds: ["e1", "e2"],
      points: null,
      lengthMm: 1250,
      process: "mig_mag",
      thicknessMm: 3,
      seamType: "continuous",
      stitchBeadMm: null,
      stitchPitchMm: null,
      tackCount: null,
      sides: 1,
    });
  });

  it("maps a stitch weld with its bead / pitch, sides and drawn points", () => {
    const input = weldToSeamInput(weld({ pattern: "stitch", stitch: { beadLengthMm: 25, pitchMm: 75 }, sides: 2, entityIds: [], points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }), PART_ID, null);
    expect(input).toMatchObject({ seamType: "stitch", stitchBeadMm: 25, stitchPitchMm: 75, sides: 2, thicknessMm: null, entityIds: [], points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  });
});

describe("seamStateForWeld", () => {
  const stored = [makeSeamRow({ part_id: PART_ID, entity_ids: ["e2", "e1"] })];

  it("is 'already' when the assembly holds a seam made from the same edge (entity order irrelevant)", () => {
    expect(seamStateForWeld(weld(), PART_ID, stored, null, {})).toBe("already");
    expect(seamForWeld(weld(), PART_ID, stored)?.id).toBe(stored[0].id);
  });

  it("does not match the same entity ids on another part, nor a hand-typed seam", () => {
    expect(seamStateForWeld(weld(), PART_ID_2, stored, null, {})).toBe("idle");
    expect(seamStateForWeld(weld({ entityIds: [] }), PART_ID, [makeSeamRow({ part_id: null, entity_ids: [] })], null, {})).toBe("idle");
  });

  it("matches a drawn weld by its points", () => {
    const points = [{ x: 0, y: 0 }, { x: 250, y: 0 }];
    const drawn = weld({ entityIds: [], points });
    expect(seamStateForWeld(drawn, PART_ID, [makeSeamRow({ entity_ids: [], points })], null, {})).toBe("already");
    expect(seamStateForWeld(drawn, PART_ID, [makeSeamRow({ entity_ids: [], points: [{ x: 0, y: 0 }, { x: 251, y: 0 }] })], null, {})).toBe("idle");
  });

  it("is 'pending' while its own action runs and keeps the session outcome afterwards", () => {
    expect(seamStateForWeld(weld(), PART_ID, [], "w1", {})).toBe("pending");
    expect(seamStateForWeld(weld(), PART_ID, [], "other", {})).toBe("idle");
    expect(seamStateForWeld(weld(), PART_ID, [], null, { w1: "added" })).toBe("added");
    expect(seamStateForWeld(weld(), PART_ID, [], null, { w1: "paired" })).toBe("paired");
    // The refreshed seams arrive: the stored seam wins over a stale "idle" outcome but an explicit outcome stays.
    expect(seamStateForWeld(weld(), PART_ID, stored, null, { w1: "paired" })).toBe("paired");
  });
});

describe("handoffOutcome", () => {
  it("reads added / paired / already from the action result", () => {
    const existing = new Set(["seam-a"]);
    expect(handoffOutcome({ ok: true, seamId: "seam-b", pairedSeamId: null }, existing)).toBe("added");
    expect(handoffOutcome({ ok: true, seamId: "seam-b", pairedSeamId: "seam-a" }, existing)).toBe("paired");
    expect(handoffOutcome({ ok: true, seamId: "seam-a", pairedSeamId: null }, existing)).toBe("already");
    expect(handoffOutcome({ ok: false, error: "notFound" }, existing)).toBeNull();
  });
});
