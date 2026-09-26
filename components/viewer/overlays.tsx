"use client";

/**
 * Viewer — annotation overlays and interaction markers.
 * File path: /components/viewer/overlays.tsx
 *
 * `AnnotationOverlay` lives INSIDE the view <g transform> (world mm with
 * the Y flip baked into the coordinates, like the entity paths): drawn
 * bend lines, weld seams (entity chains and point pairs), the roll axis
 * and the calibration line. `MarkerOverlay` lives in screen px on top:
 * picked points, the rubber line to the cursor, the red square snap
 * marker, and the lasso rectangle — things that must keep a fixed px
 * size at every zoom. Colours are tokens only.
 */

import { memo } from "react";
import type { GeometryEntity, PartAnnotations, Point, Bbox } from "@/lib/geometry/types";
import type { SnapResult } from "@/lib/viewer/snap";
import type { ScreenRect, ViewTransform } from "@/lib/viewer/view-transform";
import { worldToScreen } from "@/lib/viewer/view-transform";
import { toDisplayFrame } from "@/lib/viewer/tools";
import { pathFor } from "./geometry-layer";

const SNAP_SIZE = 10;
const PICK_SIZE = 8;

export const AnnotationOverlay = memo(function AnnotationOverlay({
  annotations,
  byId,
  bbox,
}: {
  annotations: PartAnnotations;
  byId: ReadonlyMap<string, GeometryEntity>;
  bbox: Bbox;
}) {
  const roll = annotations.roll;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const pad = 0.08;
  const scale = annotations.scale;
  const from = scale ? toDisplayFrame(annotations, scale.from) : null;
  const to = scale ? toDisplayFrame(annotations, scale.to) : null;
  return (
    <g className="viewer-annotations" pointerEvents="none">
      {annotations.bends
        .filter((b) => b.entityId === null)
        .map((b) => (
          <line
            key={b.id}
            x1={b.start.x}
            y1={-b.start.y}
            x2={b.end.x}
            y2={-b.end.y}
            className={b.direction === "down" ? "geo-bend_down" : "geo-bend_up"}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            data-bend-id={b.id}
          />
        ))}
      {annotations.welds.map((w) =>
        w.points && w.points.length >= 2 ? (
          <polyline
            key={w.id}
            points={w.points.map((p) => `${p.x},${-p.y}`).join(" ")}
            fill="none"
            className="geo-weld"
            strokeWidth={4}
            strokeOpacity={0.55}
            vectorEffect="non-scaling-stroke"
            data-weld-id={w.id}
          />
        ) : (
          <g key={w.id} data-weld-id={w.id}>
            {w.entityIds.map((id) => {
              const e = byId.get(id);
              return e ? (
                <path key={id} d={pathFor(e)} fill="none" className="geo-weld" strokeWidth={4} strokeOpacity={0.55} vectorEffect="non-scaling-stroke" />
              ) : null;
            })}
          </g>
        )
      )}
      {roll && (
        <line
          x1={roll.axis === "x" ? bbox.minX - bbox.width * pad : cx}
          x2={roll.axis === "x" ? bbox.maxX + bbox.width * pad : cx}
          y1={roll.axis === "x" ? -cy : -(bbox.minY - bbox.height * pad)}
          y2={roll.axis === "x" ? -cy : -(bbox.maxY + bbox.height * pad)}
          stroke="var(--color-on-dark-soft)"
          strokeWidth={1}
          strokeDasharray="10 6"
          vectorEffect="non-scaling-stroke"
          data-roll-axis={roll.axis}
        />
      )}
      {from && to && (
        <line
          x1={from.x}
          y1={-from.y}
          x2={to.x}
          y2={-to.y}
          stroke="var(--color-geo-select)"
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
          data-calibration="true"
        />
      )}
    </g>
  );
});

export function MarkerOverlay({
  view,
  picked,
  cursorWorld,
  snap,
  lasso,
  snapLabel,
}: {
  view: ViewTransform;
  picked: readonly Point[];
  cursorWorld: Point | null;
  snap: SnapResult | null;
  lasso: ScreenRect | null;
  snapLabel: string | null;
}) {
  const last = picked.length > 0 ? worldToScreen(view, picked[picked.length - 1]) : null;
  const target = snap ? worldToScreen(view, snap.point) : cursorWorld ? worldToScreen(view, cursorWorld) : null;
  return (
    <g className="viewer-markers" pointerEvents="none">
      {picked.map((p, i) => {
        const s = worldToScreen(view, p);
        return <rect key={i} x={s.x - PICK_SIZE / 2} y={s.y - PICK_SIZE / 2} width={PICK_SIZE} height={PICK_SIZE} fill="var(--color-geo-snap)" data-picked={i} />;
      })}
      {last && target && (
        <line x1={last.x} y1={last.y} x2={target.x} y2={target.y} stroke="var(--color-geo-select)" strokeWidth={1} strokeDasharray="6 4" />
      )}
      {snap && snap.kind && target && (
        <g data-snap={snap.kind}>
          <rect x={target.x - SNAP_SIZE / 2} y={target.y - SNAP_SIZE / 2} width={SNAP_SIZE} height={SNAP_SIZE} fill="none" stroke="var(--color-geo-snap)" strokeWidth={2} />
          {snapLabel && (
            <text x={target.x + SNAP_SIZE} y={target.y - SNAP_SIZE / 2} fontSize={10} fill="var(--color-geo-snap)">
              {snapLabel}
            </text>
          )}
        </g>
      )}
      {lasso && (
        <rect
          x={lasso.x}
          y={lasso.y}
          width={lasso.width}
          height={lasso.height}
          fill="var(--color-geo-select)"
          fillOpacity={0.08}
          stroke="var(--color-geo-select)"
          strokeWidth={1}
          strokeDasharray="4 3"
          data-lasso="true"
        />
      )}
    </g>
  );
}
