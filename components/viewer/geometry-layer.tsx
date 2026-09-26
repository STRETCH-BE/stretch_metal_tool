"use client";

/**
 * Viewer — the geometry paths (one <path> per visible entity) and the
 * hover / selection highlight layer.
 * File path: /components/viewer/geometry-layer.tsx
 *
 * Performance: path strings are cached per entity in a WeakMap keyed by
 * the entity's `segments` array (applyAnnotationsSync keeps the array
 * reference when it only changes roles), and both layers are memoised so
 * panning / zooming — which only changes the parent <g transform> — never
 * re-renders 2000 paths. The base layer has pointer-events none: hits
 * are computed mathematically in lib/viewer/hit-test.
 * The keyboard focus cursor (`focusId`) is a dashed 2 px path: in the
 * select colour when the entity is not selected, black on top of the
 * solid 3 px selection stroke when it is, so the cursor stays visible in
 * both states without a new CSS class.
 */

import { memo } from "react";
import type { GeometryEntity, Segment } from "@/lib/geometry/types";
import { entityPath } from "@/lib/geometry/svg";
import { STROKE_BASE, STROKE_HOVER, STROKE_SELECTED } from "./viewer-types";

const PATH_CACHE = new WeakMap<Segment[], string>();

/** SVG "d" for the entity, memoised on its segments. */
export function pathFor(entity: GeometryEntity): string {
  let d = PATH_CACHE.get(entity.segments);
  if (d === undefined) {
    d = entityPath(entity);
    PATH_CACHE.set(entity.segments, d);
  }
  return d;
}

export const GeometryLayer = memo(function GeometryLayer({ entities }: { entities: readonly GeometryEntity[] }) {
  return (
    <g className="viewer-geometry" pointerEvents="none">
      {entities.map((e) => (
        <path
          key={e.id}
          d={pathFor(e)}
          className={`geo-${e.role}`}
          data-entity-id={e.id}
          fill="none"
          strokeWidth={STROKE_BASE}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});

export const HighlightLayer = memo(function HighlightLayer({
  byId,
  selectedIds,
  hoverId,
  focusId = null,
}: {
  byId: ReadonlyMap<string, GeometryEntity>;
  selectedIds: readonly string[];
  hoverId: string | null;
  /** Keyboard focus cursor (lib/viewer/keyboard cycleId). */
  focusId?: string | null;
}) {
  const hover = hoverId && !selectedIds.includes(hoverId) ? byId.get(hoverId) : undefined;
  const focus = focusId ? byId.get(focusId) : undefined;
  const focusSelected = focusId !== null && selectedIds.includes(focusId);
  return (
    <g className="viewer-highlight" pointerEvents="none">
      {selectedIds.map((id) => {
        const e = byId.get(id);
        if (!e) return null;
        return (
          <path
            key={id}
            d={pathFor(e)}
            className={`geo-${e.role} geo-selected`}
            fill="none"
            strokeWidth={STROKE_SELECTED}
            vectorEffect="non-scaling-stroke"
            data-selected="true"
          />
        );
      })}
      {hover && (
        <path
          d={pathFor(hover)}
          className={`geo-${hover.role}`}
          fill="none"
          strokeWidth={STROKE_HOVER}
          vectorEffect="non-scaling-stroke"
          data-hover="true"
        />
      )}
      {focus && (
        <path
          d={pathFor(focus)}
          className={focusSelected ? undefined : "geo-selected"}
          style={focusSelected ? { stroke: "var(--color-black)" } : undefined}
          fill="none"
          strokeWidth={STROKE_HOVER}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
          data-focus="true"
        />
      )}
    </g>
  );
});
