/**
 * Seam matching and totals (lib/quotes/seams.ts): the double-click guard
 * (same part + same entity ids → the existing seam, no second row), the
 * neighbour's edge (different part, same process, |Δlength| within
 * max(1 mm, 0.5 %) → paired, not counted), a different process or a
 * hand-typed seam → new; seamTotals excludes paired seams and applies the
 * stitch ratio and sides.
 * File path: /test/quotes/seams.test.ts
 */
import { describe, expect, it } from "vitest";
import { matchSeam, seamEffectiveLengthMm, seamInputToColumns, seamLengthTolerance, seamRowToInput, seamRowToPricingSeam, seamTotals } from "@/lib/quotes/seams";
import { seamInputSchema } from "@/lib/quotes/schema";
import { PART_ID, PART_ID_2, SEAM_ID, makeSeamRow } from "./fixtures";

const OTHER_SEAM = "5ea30000-0000-4000-8000-000000000002";
const THIRD_SEAM = "5ea30000-0000-4000-8000-000000000003";
const PART_ID_3 = "44444444-4444-4444-8444-444444444444";

describe("matchSeam", () => {
  const first = makeSeamRow();

  it("the same part with the same entity ids (any order) is a duplicate → the existing row", () => {
    expect(matchSeam([first], { partId: PART_ID, entityIds: ["e2", "e1"], lengthMm: 1250, process: "mig_mag" })).toEqual({ kind: "duplicate", seam: first });
    // even with a slightly different measured length (the edge is the same)
    expect(matchSeam([first], { partId: PART_ID, entityIds: ["e1", "e2"], lengthMm: 1200, process: "tig" })).toEqual({ kind: "duplicate", seam: first });
  });

  it("the neighbour's edge (different part, same process, length within tolerance) is paired to the first seam", () => {
    const paired = matchSeam([first], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 1250.9, process: "mig_mag" });
    expect(paired).toEqual({ kind: "paired", seam: first });
    // 0.5 % of 1250 = 6.25 mm
    expect(matchSeam([first], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 1256, process: "mig_mag" }).kind).toBe("paired");
    expect(matchSeam([first], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 1257, process: "mig_mag" }).kind).toBe("new");
    // 1 mm floor for short seams
    const short = makeSeamRow({ id: OTHER_SEAM, length_mm: 100 });
    expect(matchSeam([short], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 100.9, process: "mig_mag" }).kind).toBe("paired");
    expect(matchSeam([short], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 101.2, process: "mig_mag" }).kind).toBe("new");
  });

  it("a different process, the same part on another edge, or a hand-typed seam is new", () => {
    expect(matchSeam([first], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 1250, process: "tig" })).toEqual({ kind: "new" });
    expect(matchSeam([first], { partId: PART_ID, entityIds: ["e3"], lengthMm: 1250, process: "mig_mag" })).toEqual({ kind: "new" });
    expect(matchSeam([first], { partId: null, entityIds: [], lengthMm: 1250, process: "mig_mag" })).toEqual({ kind: "new" });
    expect(matchSeam([], { partId: PART_ID, entityIds: ["e1"], lengthMm: 1250, process: "mig_mag" })).toEqual({ kind: "new" });
  });

  it("a joint has two edges: a seam that already has a partner, or is itself paired, is no candidate", () => {
    const partner = makeSeamRow({ id: OTHER_SEAM, part_id: PART_ID_2, entity_ids: ["n1"], paired_seam_id: SEAM_ID });
    // third part, same length: a different joint → new (would otherwise be wrongly paired)
    expect(matchSeam([first, partner], { partId: PART_ID_3, entityIds: ["t1"], lengthMm: 1250, process: "mig_mag" })).toEqual({ kind: "new" });
  });

  it("picks the closest length among several candidates", () => {
    const a = makeSeamRow({ id: OTHER_SEAM, length_mm: 1245 });
    const b = makeSeamRow({ id: THIRD_SEAM, length_mm: 1252, entity_ids: ["e9"] });
    expect(matchSeam([a, b], { partId: PART_ID_2, entityIds: ["n1"], lengthMm: 1251, process: "mig_mag" })).toEqual({ kind: "paired", seam: b });
  });

  it("tolerance = max(1 mm, 0.5 % of the longer edge)", () => {
    expect(seamLengthTolerance(100, 100)).toBe(1);
    expect(seamLengthTolerance(1250, 1256)).toBeCloseTo(6.28, 9);
  });
});

describe("seamTotals / seamEffectiveLengthMm", () => {
  it("counts every unpaired seam once, applies the stitch ratio and sides, sums tacks", () => {
    const seams = [
      makeSeamRow({ id: "s1", length_mm: 1250 }),
      makeSeamRow({ id: "s2", length_mm: 1250, part_id: PART_ID_2, paired_seam_id: "s1" }),
      makeSeamRow({ id: "s3", length_mm: 1260, sides: 2 }),
      makeSeamRow({ id: "s4", length_mm: 600, seam_type: "stitch", stitch_bead_mm: 30, stitch_pitch_mm: 60, process: "tig", thickness_mm: 2 }),
      makeSeamRow({ id: "s5", length_mm: 0, seam_type: "tack", tack_count: 11 }),
    ];
    const totals = seamTotals(seams, 3);
    expect(totals.counted).toBe(4);
    expect(totals.paired).toBe(1);
    expect(totals.tackCount).toBe(11);
    expect(totals.lengthMm).toBe(1250 + 1260 + 600);
    expect(totals.effectiveLengthMm).toBe(1250 + 2520 + 300);
    expect(totals.byProcess).toEqual([
      { process: "mig_mag", thicknessMm: 3, seams: 2, lengthMm: 2510, effectiveLengthMm: 3770 },
      { process: "tig", thicknessMm: 2, seams: 1, lengthMm: 600, effectiveLengthMm: 300 },
    ]);
    expect(seamEffectiveLengthMm(makeSeamRow({ seam_type: "stitch", stitch_bead_mm: 80, stitch_pitch_mm: 60, length_mm: 100 }))).toBe(100);
    expect(seamTotals([]).byProcess).toEqual([]);
  });
});

describe("row ↔ input ↔ engine conversions", () => {
  it("seamInputToColumns keeps only the pattern's fields; seamRowToInput round-trips through the schema", () => {
    const parsed = seamInputSchema.safeParse({ lengthMm: 600, process: "tig", seamType: "stitch", stitchBeadMm: 30, stitchPitchMm: 60, tackCount: 5, sides: 2 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(seamInputToColumns(parsed.data)).toMatchObject({ length_mm: 600, process: "tig", seam_type: "stitch", stitch_bead_mm: 30, stitch_pitch_mm: 60, tack_count: null, sides: 2, part_id: null, entity_ids: [] });
    const row = makeSeamRow({ length_mm: "1250.00" as unknown as number, sides: "2" as unknown as number, thickness_mm: "3.000" as unknown as number });
    const again = seamInputSchema.safeParse(seamRowToInput(row));
    expect(again.success).toBe(true);
    if (again.success) expect(again.data).toMatchObject({ lengthMm: 1250, sides: 2, thicknessMm: 3, partId: PART_ID, entityIds: ["e1", "e2"] });
  });

  it("seamRowToPricingSeam maps the engine shape (stitch only for stitch seams, tack count for tack seams)", () => {
    expect(seamRowToPricingSeam(makeSeamRow())).toEqual({
      id: SEAM_ID,
      label: null,
      partId: PART_ID,
      lengthMm: 1250,
      process: "mig_mag",
      thicknessMm: null,
      type: "continuous",
      stitch: null,
      tackCount: null,
      sides: 1,
      pairedSeamId: null,
    });
    expect(seamRowToPricingSeam(makeSeamRow({ seam_type: "stitch", stitch_bead_mm: 30, stitch_pitch_mm: 60 })).stitch).toEqual({ beadLengthMm: 30, pitchMm: 60 });
    expect(seamRowToPricingSeam(makeSeamRow({ seam_type: "tack", tack_count: null })).tackCount).toBe(0);
    expect(seamRowToPricingSeam(makeSeamRow({ seam_type: "tack", tack_count: 11 })).tackCount).toBe(11);
  });
});
