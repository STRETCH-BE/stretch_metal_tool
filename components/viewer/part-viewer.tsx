"use client";

/**
 * PartViewer — the SVG drawing viewer/editor. CONTRACT STUB: the viewer
 * build step (wave 2) replaces this file's body; the props below are the
 * agreed interface that the part page codes against, so keep them stable.
 * File path: /components/viewer/part-viewer.tsx
 *
 * Responsibilities of the real implementation (build prompt Step 8):
 * pan/zoom/fit, mm grid + coordinate readout, layer toggles, hit-testing
 * (6 px), selection (click / shift-click / lasso), tag tool, draw bend
 * line with snapping, weld seam tool, rolling dialog, clean-up tools,
 * calibrate units, export annotated DXF. It emits a new PartAnnotations
 * object on every edit and never persists anything itself.
 */

import type { PartAnnotations, PartGeometry } from "@/lib/geometry/types";

export type PartViewerProps = {
  geometry: PartGeometry;
  annotations: PartAnnotations;
  /** Called with the next annotations object after every user edit. */
  onAnnotationsChange?: (next: PartAnnotations) => void;
  /** Part thickness for bend defaults (radius = t) — null when unknown. */
  thicknessMm: number | null;
  /** Viewer-only mode (viewers, sent quotes). */
  readOnly?: boolean;
  /** Parent triggers the annotated-DXF download (route in lib/routes). */
  onExportDxf?: () => void;
  /** Height of the canvas in px; the width fills the container. */
  height?: number;
  className?: string;
};

export function PartViewer({ height = 520, className = "" }: PartViewerProps) {
  return (
    <div
      className={`viewer ${className}`.trim()}
      style={{ height }}
      data-viewer-stub="true"
    />
  );
}
