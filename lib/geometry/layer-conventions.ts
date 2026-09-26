/**
 * Geometry engine — layer-name conventions.
 * File path: /lib/geometry/layer-conventions.ts
 *
 * Maps a DXF layer name to an entity role BEFORE any geometry heuristic
 * runs (build prompt Step 6.6). Matching is case-insensitive and
 * whitespace-trimmed; entries ending in "*" are prefix patterns (DIM*,
 * TEXT*, TITLE*). Layer "0" counts as cut — it is the AutoCAD default and
 * most hand-made files put everything there. The admin will edit this
 * list in a later phase, so callers pass their own `LayerConventions`
 * and everything here stays data-driven.
 *
 * Inventor flat-pattern layers: IV_MARK* (the sheet-metal Mark feature —
 * surface marking/engraving, e.g. IV_MARK_SURFACE) is engrave, never a
 * bend candidate; IV_TOOL_CENTER(_DOWN) (punch tool centres), IV_ALTREP_*
 * (alternate bend representations) and IV_ROLL_TANGENT (tangent lines of
 * rolled features) are drawing aids and are ignored like IV_TANGENT.
 */

import type { EntityRole, LayerConventions } from "./types";

export const DEFAULT_LAYER_CONVENTIONS: LayerConventions = {
  bendUp: ["IV_BEND", "BEND", "BEND_UP", "BEND LINES", "BENDLINES", "BEND-UP", "BENDUP"],
  bendDown: ["IV_BEND_DOWN", "BEND_DOWN", "BEND-DOWN", "BENDDOWN"],
  ignore: [
    "IV_TANGENT",
    "IV_ARC_CENTERS",
    "IV_FEATURE_PROFILES",
    "IV_FEATURE_PROFILES_DOWN",
    "IV_UNCONSUMED_SKETCHES",
    "IV_TOOL_CENTER",
    "IV_TOOL_CENTER_DOWN",
    "IV_ALTREP_FRONT",
    "IV_ALTREP_BACK",
    "IV_ROLL_TANGENT",
    "DEFPOINTS",
    "DIM*",
    "TEXT*",
    "FRAME",
    "TITLE*",
  ],
  engrave: ["ENGRAVE", "MARK", "ETCH", "IV_ENGRAVE", "IV_MARK*"],
  weld: ["WELD", "WELD_SEAM"],
  cut: ["IV_OUTER_PROFILE", "IV_INTERIOR_PROFILES", "CUT", "0"],
};

function matches(layer: string, pattern: string): boolean {
  const l = layer.trim().toUpperCase();
  const p = pattern.trim().toUpperCase();
  if (p.endsWith("*")) return l.startsWith(p.slice(0, -1));
  return l === p;
}

/**
 * Role implied by the layer, or null when the layer is not in the
 * convention list. Order of precedence when a name matches several
 * lists: bend down before bend up (so "BEND_DOWN" never reads as a
 * "BEND" prefix), then ignore, engrave, weld, cut.
 */
export function roleForLayer(
  layer: string,
  conventions: LayerConventions = DEFAULT_LAYER_CONVENTIONS
): EntityRole | null {
  const has = (list: string[]) => list.some((p) => matches(layer, p));
  if (has(conventions.bendDown)) return "bend_down";
  if (has(conventions.bendUp)) return "bend_up";
  if (has(conventions.ignore)) return "ignore";
  if (has(conventions.engrave)) return "engrave";
  if (has(conventions.weld)) return "weld";
  if (has(conventions.cut)) return "cut";
  return null;
}

export function isIgnoredLayer(
  layer: string,
  conventions: LayerConventions = DEFAULT_LAYER_CONVENTIONS
): boolean {
  return roleForLayer(layer, conventions) === "ignore";
}

/** Layer name the annotated DXF export uses for each role. */
export const EXPORT_LAYER_FOR_ROLE: Record<EntityRole, string> = {
  cut: "CUT",
  hole: "HOLES",
  bend_up: "BEND_UP",
  bend_down: "BEND_DOWN",
  weld: "WELD",
  engrave: "ENGRAVE",
  ignore: "IGNORE",
  unknown: "IGNORE",
};
