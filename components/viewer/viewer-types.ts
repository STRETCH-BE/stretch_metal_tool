/**
 * Viewer — shared client-side types and constants (tools, layers, the
 * role → layer mapping and the token colour of each layer swatch).
 * File path: /components/viewer/viewer-types.ts
 *
 * Colours are CSS variable references (design tokens from globals.css),
 * never hex, so the swatches follow the theme like the .geo-* classes.
 */

import type { EntityRole, GeometryEntity } from "@/lib/geometry/types";
import type { ViewerLayerKey } from "@/content/viewer";

export type Tool = "select" | "tag" | "bend" | "weld" | "roll" | "calibrate" | "cleanup";

/** Tools that pick points with snapping instead of selecting entities. */
export const POINT_TOOLS: readonly Tool[] = ["bend", "calibrate"];

export type LayerState = Record<ViewerLayerKey, boolean>;

export const LAYER_ORDER: readonly ViewerLayerKey[] = [
  "cut",
  "holes",
  "bendUp",
  "bendDown",
  "weld",
  "engrave",
  "ignored",
  "candidates",
  "grid",
  "snap",
];

export const DEFAULT_LAYERS: LayerState = {
  cut: true,
  holes: true,
  bendUp: true,
  bendDown: true,
  weld: true,
  engrave: true,
  ignored: true,
  candidates: true,
  grid: true,
  snap: true,
};

export const ROLE_LAYER: Record<EntityRole, ViewerLayerKey> = {
  cut: "cut",
  hole: "holes",
  bend_up: "bendUp",
  bend_down: "bendDown",
  weld: "weld",
  engrave: "engrave",
  ignore: "ignored",
  unknown: "candidates",
};

export const LAYER_SWATCH: Partial<Record<ViewerLayerKey, string>> = {
  cut: "var(--color-geo-cut)",
  holes: "var(--color-geo-hole)",
  bendUp: "var(--color-geo-bend-up)",
  bendDown: "var(--color-geo-bend-down)",
  weld: "var(--color-geo-weld)",
  engrave: "var(--color-geo-engrave)",
  ignored: "var(--color-on-dark-muted)",
  candidates: "var(--color-geo-candidate)",
};

export function isVisible(layers: LayerState, entity: GeometryEntity): boolean {
  return layers[ROLE_LAYER[entity.role]];
}

/** Stroke widths (px, non-scaling): base, hover, selected — build prompt Step 4. */
export const STROKE_BASE = 1;
export const STROKE_HOVER = 2;
export const STROKE_SELECTED = 3;
