/**
 * Geometry engine — public entry point.
 * File path: /lib/geometry/index.ts
 *
 * Re-exports every module plus a ready `geometryEngine` instance. App
 * code imports from "@/lib/geometry"; inside the engine every import is
 * relative so the folder can be lifted out as-is.
 */

export * from "./types";
export * from "./math";
export * from "./ids";
export * from "./layer-conventions";
export * from "./threads";
export * from "./parse";
export * from "./normalise";
export * from "./heal";
export * from "./loops";
export * from "./classify";
export * from "./measure";
export * from "./triage";
export * from "./annotate";
export * from "./quick-part";
export * from "./export-dxf";
export * from "./svg";
export * from "./engine";

import { TsGeometryEngine } from "./engine";

/** Ready-to-use engine instance (pure, stateless). */
export const geometryEngine = new TsGeometryEngine();
