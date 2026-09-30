/**
 * Test helper — synthetic STEP fixtures through the library's own writer
 * (lib/geometry/step/write-step.ts): extruded profiles the way CAD
 * exporters write them. `frame: "xz"` extrudes along y with the profile
 * in the x–z plane (bent brackets); default "xy" extrudes along z.
 * File path: /test/geometry/step-builder.ts
 */

import { FRAME_XZ, writeExtrudedStep, type ExtrusionSpec, type WriteOptions } from "@/lib/geometry/step/write-step";

export { circle, facetProfile, lProfile, rect, uProfile, type Profile, type ProfileSegment } from "@/lib/geometry/step/write-step";

export type P = { x: number; y: number };
export type Frame = "xy" | "xz";
export type PrismSpec = Omit<ExtrusionSpec, "frame"> & { frame?: Frame };
export type BuildOptions = WriteOptions;

export function buildStep(solids: PrismSpec[], opts: BuildOptions = {}): string {
  return writeExtrudedStep(
    solids.map(({ frame, ...s }) => ({ ...s, frame: frame === "xz" ? FRAME_XZ : undefined })),
    { originatingSystem: "step-builder", ...opts }
  );
}
