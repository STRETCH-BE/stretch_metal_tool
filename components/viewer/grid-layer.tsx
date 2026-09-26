"use client";

/**
 * Viewer — mm grid in screen space with tick labels along the bottom
 * (X) and left (Y) edges.
 * File path: /components/viewer/grid-layer.tsx
 *
 * Lines are drawn in px (outside the view transform) from the list that
 * lib/viewer/view-transform gridLines() computes, so a 1 px hairline
 * stays 1 px at every zoom. Labels appear on every line when lines are
 * ≥ 56 px apart, otherwise on major lines only. Colours are tokens.
 */

import { memo } from "react";
import type { Grid, Viewport } from "@/lib/viewer/view-transform";
import { formatNumber, type Locale } from "@/lib/format";

const LABEL_EVERY_PX = 56;
const TICK = 6;

export const GridLayer = memo(function GridLayer({ grid, viewport, locale }: { grid: Grid; viewport: Viewport; locale: Locale }) {
  const spacing = grid.vertical.length > 1 ? grid.vertical[1].screenPx - grid.vertical[0].screenPx : Infinity;
  const labelAll = spacing >= LABEL_EVERY_PX;
  const fmt = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });
  return (
    <g className="viewer-grid" pointerEvents="none" aria-hidden="true">
      {grid.vertical.map((l) => (
        <line
          key={`v${l.worldMm}`}
          x1={l.screenPx}
          x2={l.screenPx}
          y1={0}
          y2={viewport.height}
          stroke={l.major ? "var(--color-canvas-grid-major)" : "var(--color-canvas-grid)"}
          strokeWidth={1}
        />
      ))}
      {grid.horizontal.map((l) => (
        <line
          key={`h${l.worldMm}`}
          x1={0}
          x2={viewport.width}
          y1={l.screenPx}
          y2={l.screenPx}
          stroke={l.major ? "var(--color-canvas-grid-major)" : "var(--color-canvas-grid)"}
          strokeWidth={1}
        />
      ))}
      {grid.vertical.map((l) =>
        labelAll || l.major ? (
          <g key={`vl${l.worldMm}`}>
            <line x1={l.screenPx} x2={l.screenPx} y1={viewport.height - TICK} y2={viewport.height} stroke="var(--color-on-dark-muted)" strokeWidth={1} />
            <text x={l.screenPx + 3} y={viewport.height - 4} fontSize={10} fill="var(--color-on-dark-muted)" className="mono">
              {fmt(l.worldMm)}
            </text>
          </g>
        ) : null
      )}
      {grid.horizontal.map((l) =>
        labelAll || l.major ? (
          <g key={`hl${l.worldMm}`}>
            <line x1={0} x2={TICK} y1={l.screenPx} y2={l.screenPx} stroke="var(--color-on-dark-muted)" strokeWidth={1} />
            <text x={TICK + 2} y={l.screenPx - 3} fontSize={10} fill="var(--color-on-dark-muted)" className="mono">
              {fmt(l.worldMm)}
            </text>
          </g>
        ) : null
      )}
    </g>
  );
});
