/**
 * Weld → assembly seam hand-off — the pure part of the part workspace's
 * "Add as assembly seam" button (components/parts/welds-table.tsx):
 * mapping a viewer weld annotation to the server's SeamInput, telling
 * whether a weld was already added to the assembly (by its entity ids,
 * or by its points when it was drawn between two clicks) and reading the
 * outcome of addSeamFromPart. Unit tested in test/ui/seam-handoff.test.ts.
 * File path: /components/quote/seam-handoff.ts
 *
 * Pattern mapping: the viewer knows "full" / "stitch"; a seam of the
 * assembly is continuous / stitch / tack — a weld annotation never
 * produces a tack seam (tacks are typed in the assembly editor). The
 * thickness at the joint is the part's own thickness (the assembly
 * thickness is the server's fallback when null).
 */

import type { AssemblySeamRow } from "@/lib/db/types";
import type { Point, WeldAnnotation } from "@/lib/geometry/types";
import type { SeamInput } from "@/lib/quotes/schema";

export type SeamHandoffState = "idle" | "pending" | "added" | "paired" | "already";

/** The result shape of addSeamFromPart (lib/quotes/actions.ts SeamActionResult), structurally. */
export type SeamHandoffResult = { ok: true; seamId: string; pairedSeamId: string | null } | { ok: false; error: string; message?: string };

export function weldToSeamInput(weld: WeldAnnotation, partId: string, thicknessMm: number | null): SeamInput {
  const stitch = weld.pattern === "stitch" ? (weld.stitch ?? { beadLengthMm: 30, pitchMm: 60 }) : null; // [CONFIRM] default stitch 30/60 mirrors the viewer's default
  return {
    label: null,
    partId,
    entityIds: weld.entityIds,
    points: weld.points,
    lengthMm: weld.lengthMm,
    process: weld.process,
    thicknessMm,
    seamType: weld.pattern === "stitch" ? "stitch" : "continuous",
    stitchBeadMm: stitch?.beadLengthMm ?? null,
    stitchPitchMm: stitch?.pitchMm ?? null,
    tackCount: null,
    sides: weld.sides,
  };
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function samePoints(a: ReadonlyArray<Point> | null, b: unknown): boolean {
  if (!a || a.length === 0 || !Array.isArray(b) || b.length !== a.length) return false;
  return a.every((p, i) => {
    const q = b[i] as { x?: unknown; y?: unknown } | null;
    return Boolean(q) && typeof q!.x === "number" && typeof q!.y === "number" && Math.abs(q!.x - p.x) < 1e-6 && Math.abs(q!.y - p.y) < 1e-6;
  });
}

/** The stored seam of this part that was made from this weld (same entity ids, or the same drawn points), or null. */
export function seamForWeld(weld: Pick<WeldAnnotation, "entityIds" | "points">, partId: string, seams: ReadonlyArray<AssemblySeamRow>): AssemblySeamRow | null {
  for (const seam of seams) {
    if (seam.part_id !== partId) continue;
    if (sameSet(weld.entityIds, seam.entity_ids ?? [])) return seam;
    if (samePoints(weld.points, seam.points)) return seam;
  }
  return null;
}

/**
 * Button state for one weld: pending while its action runs, "already"
 * when the assembly holds a seam made from it (paired or not — the
 * double-click guard), else the last outcome for this weld, else idle.
 */
export function seamStateForWeld(
  weld: Pick<WeldAnnotation, "id" | "entityIds" | "points">,
  partId: string,
  seams: ReadonlyArray<AssemblySeamRow>,
  pendingWeldId: string | null,
  outcomes: Readonly<Record<string, SeamHandoffState>>
): SeamHandoffState {
  if (pendingWeldId === weld.id) return "pending";
  const outcome = outcomes[weld.id];
  if (outcome === "added" || outcome === "paired") return outcome;
  if (seamForWeld(weld, partId, seams)) return "already";
  return outcome ?? "idle";
}

/** Outcome of addSeamFromPart → the state shown next to the button. */
export function handoffOutcome(result: SeamHandoffResult, existingSeamIds: ReadonlySet<string>): SeamHandoffState | null {
  if (!result.ok) return null;
  if (existingSeamIds.has(result.seamId)) return "already";
  return result.pairedSeamId ? "paired" : "added";
}
