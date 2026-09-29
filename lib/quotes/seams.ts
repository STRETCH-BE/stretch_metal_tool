/**
 * Assembly seams — pure helpers shared by the seam actions, the builder
 * and the tests: the double-click / neighbour-edge matcher, the counted
 * seam totals and the input → row conversion.
 * File path: /lib/quotes/seams.ts
 *
 * No Next, no Supabase, no rates (docs/assembly-mode-design.md §2).
 *
 * matchSeam — a seam marked on a part edge arrives twice in two ways:
 *   - the SAME part, the same tagged entities (a double click or a second
 *     "add seam" on the same edge) → `duplicate`: the existing row is
 *     returned and nothing is inserted;
 *   - the NEIGHBOUR part's edge of the same joint (a different part of the
 *     assembly, the same process, |Δlength| ≤ max(1 mm, 0.5 %)) → `paired`:
 *     the new row is stored with paired_seam_id = the first seam and is
 *     NOT counted.
 *   A joint has two edges, so only counted seams (paired_seam_id null)
 *   that have no partner yet are pairing candidates, and the closest
 *   length wins. This is a heuristic (a box has many edges of one length):
 *   the builder shows paired seams as such and `unpairSeam` puts a wrongly
 *   paired seam back into the count. Seams typed by hand (partId null)
 *   never match: two hand-typed 1 250 mm seams are two seams.
 *
 * seamTotals — counted length per process (paired seams excluded), the
 * effective arc length (length × bead ÷ pitch for stitch seams × sides),
 * and the tack count, for the assembly panel. The thickness at the joint
 * is the seam's own or the assembly's (null when neither is known).
 */

import type { AssemblySeamRow, WeldProcessDb } from "@/lib/db/types";
import type { AssemblySeam } from "@/lib/pricing/types";
import type { SeamInputValues } from "./schema";

export type SeamCandidate = {
  partId: string | null;
  entityIds: string[];
  lengthMm: number;
  process: WeldProcessDb;
};

export type SeamMatch =
  | { kind: "duplicate"; seam: AssemblySeamRow }
  | { kind: "paired"; seam: AssemblySeamRow }
  | { kind: "new" };

/** Length tolerance of the neighbour-edge rule: max(1 mm, 0.5 % of the longer edge). */
export function seamLengthTolerance(a: number, b: number): number {
  return Math.max(1, 0.005 * Math.max(Math.abs(a), Math.abs(b)));
}

function sameEntitySet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return new Set(b).size === set.size && b.every((id) => set.has(id));
  return b.every((id) => set.has(id));
}

/** Rows stored as strings by PostgREST (numeric columns) → number. */
function num(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function matchSeam(existing: ReadonlyArray<AssemblySeamRow>, candidate: SeamCandidate): SeamMatch {
  if (!candidate.partId) return { kind: "new" };
  const duplicate = existing.find((s) => s.part_id === candidate.partId && sameEntitySet(candidate.entityIds, s.entity_ids ?? []));
  if (duplicate) return { kind: "duplicate", seam: duplicate };

  const taken = new Set(existing.map((s) => s.paired_seam_id).filter((id): id is string => Boolean(id)));
  let best: { seam: AssemblySeamRow; delta: number } | null = null;
  for (const seam of existing) {
    if (!seam.part_id || seam.part_id === candidate.partId) continue;
    if (seam.process !== candidate.process) continue;
    if (seam.paired_seam_id || taken.has(seam.id)) continue;
    const delta = Math.abs(num(seam.length_mm) - candidate.lengthMm);
    if (delta > seamLengthTolerance(num(seam.length_mm), candidate.lengthMm)) continue;
    if (!best || delta < best.delta) best = { seam, delta };
  }
  return best ? { kind: "paired", seam: best.seam } : { kind: "new" };
}

/** length × (bead ÷ pitch for stitch) × sides; a tack seam has no arc length. */
export function seamEffectiveLengthMm(seam: Pick<AssemblySeamRow, "length_mm" | "seam_type" | "stitch_bead_mm" | "stitch_pitch_mm" | "sides">): number {
  const length = num(seam.length_mm);
  const sides = num(seam.sides) === 2 ? 2 : 1;
  if (seam.seam_type === "tack") return 0;
  if (seam.seam_type === "stitch") {
    const bead = num(seam.stitch_bead_mm);
    const pitch = num(seam.stitch_pitch_mm);
    const ratio = pitch > 0 ? Math.min(1, bead / pitch) : 1;
    return length * ratio * sides;
  }
  return length * sides;
}

export type SeamProcessTotal = {
  process: WeldProcessDb;
  /** Thickness at the joint (the seam's own, else the assembly's), null when unknown. */
  thicknessMm: number | null;
  seams: number;
  lengthMm: number;
  effectiveLengthMm: number;
};

export type SeamTotals = {
  /** Counted seams (paired ones excluded). */
  counted: number;
  paired: number;
  tackCount: number;
  lengthMm: number;
  effectiveLengthMm: number;
  byProcess: SeamProcessTotal[];
};

/** Totals of an assembly's seams for the builder: paired seams are not counted, tacks are summed. */
export function seamTotals(seams: ReadonlyArray<AssemblySeamRow>, assemblyThicknessMm: number | null = null): SeamTotals {
  const groups = new Map<string, SeamProcessTotal>();
  let counted = 0;
  let paired = 0;
  let tackCount = 0;
  let lengthMm = 0;
  let effectiveLengthMm = 0;
  for (const seam of seams) {
    if (seam.paired_seam_id) {
      paired += 1;
      continue;
    }
    counted += 1;
    if (seam.seam_type === "tack") {
      tackCount += num(seam.tack_count);
      continue;
    }
    const thickness = seam.thickness_mm === null || seam.thickness_mm === undefined ? assemblyThicknessMm : num(seam.thickness_mm);
    const key = `${seam.process}|${thickness ?? ""}`;
    const group = groups.get(key) ?? { process: seam.process, thicknessMm: thickness, seams: 0, lengthMm: 0, effectiveLengthMm: 0 };
    const length = num(seam.length_mm);
    const effective = seamEffectiveLengthMm(seam);
    group.seams += 1;
    group.lengthMm += length;
    group.effectiveLengthMm += effective;
    groups.set(key, group);
    lengthMm += length;
    effectiveLengthMm += effective;
  }
  return { counted, paired, tackCount, lengthMm, effectiveLengthMm, byProcess: [...groups.values()] };
}

/** Columns of an assembly_seams insert / update built from a validated SeamInput. */
export type SeamColumns = {
  label: string | null;
  part_id: string | null;
  entity_ids: string[];
  points: { x: number; y: number }[] | null;
  length_mm: number;
  process: WeldProcessDb;
  thickness_mm: number | null;
  seam_type: AssemblySeamRow["seam_type"];
  stitch_bead_mm: number | null;
  stitch_pitch_mm: number | null;
  tack_count: number | null;
  sides: 1 | 2;
};

export function seamInputToColumns(input: SeamInputValues): SeamColumns {
  return {
    label: input.label,
    part_id: input.partId,
    entity_ids: input.entityIds,
    points: input.points,
    length_mm: input.lengthMm,
    process: input.process,
    thickness_mm: input.thicknessMm,
    seam_type: input.seamType,
    stitch_bead_mm: input.seamType === "stitch" ? input.stitchBeadMm : null,
    stitch_pitch_mm: input.seamType === "stitch" ? input.stitchPitchMm : null,
    tack_count: input.seamType === "tack" ? input.tackCount : null,
    sides: input.sides,
  };
}

/** The stored row as the seam-input shape (so an updateSeam patch can be merged over it and re-validated). */
export function seamRowToInput(row: AssemblySeamRow): SeamInputValues {
  return {
    label: row.label,
    partId: row.part_id,
    entityIds: row.entity_ids ?? [],
    points: Array.isArray(row.points) ? (row.points as { x: number; y: number }[]) : null,
    lengthMm: num(row.length_mm),
    process: row.process,
    thicknessMm: row.thickness_mm === null || row.thickness_mm === undefined ? null : num(row.thickness_mm),
    seamType: row.seam_type,
    stitchBeadMm: row.stitch_bead_mm === null || row.stitch_bead_mm === undefined ? null : num(row.stitch_bead_mm),
    stitchPitchMm: row.stitch_pitch_mm === null || row.stitch_pitch_mm === undefined ? null : num(row.stitch_pitch_mm),
    tackCount: row.tack_count === null || row.tack_count === undefined ? null : num(row.tack_count),
    sides: num(row.sides) === 2 ? 2 : 1,
  };
}

/** assembly_seams row → the engine's AssemblySeam (numeric columns coerced). */
export function seamRowToPricingSeam(row: AssemblySeamRow): AssemblySeam {
  const stitch =
    row.seam_type === "stitch" && row.stitch_bead_mm !== null && row.stitch_pitch_mm !== null
      ? { beadLengthMm: num(row.stitch_bead_mm), pitchMm: num(row.stitch_pitch_mm) }
      : null;
  return {
    id: row.id,
    label: row.label,
    partId: row.part_id,
    lengthMm: num(row.length_mm),
    process: row.process,
    thicknessMm: row.thickness_mm === null || row.thickness_mm === undefined ? null : num(row.thickness_mm),
    type: row.seam_type,
    stitch,
    tackCount: row.seam_type === "tack" ? num(row.tack_count) : row.tack_count === null || row.tack_count === undefined ? null : num(row.tack_count),
    sides: num(row.sides) === 2 ? 2 : 1,
    pairedSeamId: row.paired_seam_id,
  };
}
