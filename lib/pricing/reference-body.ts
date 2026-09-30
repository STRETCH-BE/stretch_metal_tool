/**
 * Pricing engine — reference bodies: which STEP / IFC bodies are CAD
 * helper bodies (cut tools, extrudes used for booleans, window blocks) or
 * slivers rather than parts, from the geometry engine's body hints
 * (lib/geometry/types.ts BodyHints) and the laser bed of the machine park.
 * File path: /lib/pricing/reference-body.ts
 *
 * Rule table (the engine reports facts only; this is the decision):
 *   red   geometry.reference_body  a sliver; or a body named after a CAD
 *                                  feature that is a solid block or not a
 *                                  sheet; or a block / non-sheet longer
 *                                  than the laser bed
 *   amber geometry.unnamed_body    a feature name alone — "confirm it is a
 *                                  real part" (a real plate can keep the
 *                                  feature's name: the Exsos logo plate)
 *   amber geometry.solid_block     a solid block without a feature name —
 *                                  a machined block or a helper body
 *   none  everything else, a 10 mm base plate included
 * A red reference body is left out of the quote total and blocks sending
 * like every red flag; an admin can approve it as a real part through the
 * override flow (send-guard.ts honours that one red code).
 */

import type { BodyHints } from "../geometry/types";
import type { FlagCode, FlagSeverity } from "./types";

export type ReferenceBodyVerdict = { code: Extract<FlagCode, "geometry.reference_body" | "geometry.unnamed_body" | "geometry.solid_block">; severity: FlagSeverity } | null;

/** The verdict for a body's hints; `bedLengthMm` is the flat laser's bed length, null when no laser is in the park. */
export function referenceBodyVerdict(hints: BodyHints | null | undefined, bedLengthMm: number | null): ReferenceBodyVerdict {
  if (!hints) return null;
  const named = hints.featureName !== null;
  const longest = hints.bboxMm[0];
  const oversize = bedLengthMm !== null && bedLengthMm > 0 && longest > bedLengthMm;
  if (hints.sliver) return { code: "geometry.reference_body", severity: "red" };
  if (named && (hints.solidBlock || hints.notSheet)) return { code: "geometry.reference_body", severity: "red" };
  if ((hints.notSheet || hints.solidBlock) && oversize) return { code: "geometry.reference_body", severity: "red" };
  if (named) return { code: "geometry.unnamed_body", severity: "amber" };
  if (hints.solidBlock) return { code: "geometry.solid_block", severity: "amber" };
  return null;
}

/** Message params shared by the three flags. */
export function referenceBodyParams(hints: BodyHints, name: string | null, thicknessMm: number | null): Record<string, number | string> {
  return {
    name: name ?? "",
    featureName: hints.featureName ?? "",
    size: hints.bboxMm.map((d) => Math.round(d)).join(" × "),
    thicknessMm: thicknessMm ?? 0,
    volumeMm3: hints.volumeMm3 === null ? 0 : Math.round(hints.volumeMm3),
  };
}

export function isReferenceBodyFlag(code: FlagCode): boolean {
  return code === "geometry.reference_body";
}
