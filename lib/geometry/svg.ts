/**
 * Geometry engine — SVG output for thumbnails and the viewer.
 * File path: /lib/geometry/svg.ts
 *
 * DXF is Y-up, SVG is Y-down, so every y is negated (no transform
 * attribute, so text and stroke maths in the viewer stay simple). Arcs
 * become `A` commands: a DXF CCW sweep is a screen-CCW motion after the
 * flip, which is SVG sweep-flag 0; a segment traversed against its
 * stored direction flips the flag. Direction is re-derived from the pen
 * position so polylines with reversed arcs (negative bulge) draw right.
 * Hex colours are allowed here: this is generated markup, not a
 * component (the design-system token rule applies to components).
 */

import type { Bbox, EntityRole, GeometryEntity, PartAnnotations, PartGeometry, Point, Segment } from "./types";
import { bboxUnionAll, dist, segmentBbox } from "./math";

function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

function arcCmd(seg: Extract<Segment, { kind: "arc" }>, reversed: boolean): string {
  const to = reversed ? seg.start : seg.end;
  const large = seg.sweepDeg > 180 ? 1 : 0;
  const sweep = reversed ? 1 : 0;
  if (seg.sweepDeg >= 360 - 1e-9) {
    // Full circle as two half arcs (a single A back to the start collapses).
    const mid = {
      x: seg.center.x - (seg.start.x - seg.center.x),
      y: seg.center.y - (seg.start.y - seg.center.y),
    };
    return `A ${n(seg.radius)} ${n(seg.radius)} 0 0 ${sweep} ${n(mid.x)} ${n(-mid.y)} A ${n(seg.radius)} ${n(seg.radius)} 0 0 ${sweep} ${n(to.x)} ${n(-to.y)}`;
  }
  return `A ${n(seg.radius)} ${n(seg.radius)} 0 ${large} ${sweep} ${n(to.x)} ${n(-to.y)}`;
}

/** SVG path "d" for a segment list (Y flipped). */
export function segmentsToPath(segments: Segment[]): string {
  const parts: string[] = [];
  let pen: Point | null = null;
  for (const seg of segments) {
    if (seg.kind === "circle") {
      const r = seg.radius;
      const cx = seg.center.x;
      const cy = -seg.center.y;
      parts.push(
        `M ${n(cx + r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} Z`
      );
      pen = null;
      continue;
    }
    let reversed = false;
    if (pen) {
      const dS = dist(pen, seg.start);
      const dE = dist(pen, seg.end);
      reversed = dE < dS;
      const from = reversed ? seg.end : seg.start;
      if (Math.min(dS, dE) > 1e-6) parts.push(`M ${n(from.x)} ${n(-from.y)}`);
    } else {
      parts.push(`M ${n(seg.start.x)} ${n(-seg.start.y)}`);
    }
    if (seg.kind === "line") {
      const to = reversed ? seg.start : seg.end;
      parts.push(`L ${n(to.x)} ${n(-to.y)}`);
      pen = to;
    } else {
      parts.push(arcCmd(seg, reversed));
      pen = reversed ? seg.start : seg.end;
    }
  }
  return parts.join(" ");
}

export function entityPath(entity: GeometryEntity): string {
  return segmentsToPath(entity.segments);
}

export function viewBoxFor(bbox: Bbox, padding = 0): string {
  const w = Math.max(bbox.width, 1e-6) + 2 * padding;
  const h = Math.max(bbox.height, 1e-6) + 2 * padding;
  return `${n(bbox.minX - padding)} ${n(-bbox.maxY - padding)} ${n(w)} ${n(h)}`;
}

export type SvgTheme = "light" | "dark";
export type SvgOptions = { width?: number; height?: number; padding?: number; theme?: SvgTheme };

type Style = { stroke: string; dash?: string; opacity?: number };

export function roleStyle(role: EntityRole, theme: SvgTheme): Style {
  const cut = theme === "dark" ? "#ffffff" : "#000000";
  switch (role) {
    case "cut":
      return { stroke: cut };
    case "hole":
      return { stroke: theme === "dark" ? "#9a9a9a" : "#808080" };
    case "bend_up":
      return { stroke: "#e00000" };
    case "bend_down":
      return { stroke: "#ff1a1a", dash: "6 3" };
    case "weld":
      return { stroke: "#ffd400" };
    case "engrave":
      return { stroke: "#8a8a8a" };
    case "ignore":
      return { stroke: cut, opacity: 0.25 };
    case "unknown":
      return { stroke: "#ff8c00", dash: "4 2" };
  }
}

function pathEl(d: string, style: Style, cls: string, id?: string): string {
  const attrs = [
    `class="${cls}"`,
    id ? `data-entity-id="${id}"` : "",
    `d="${d}"`,
    `fill="none"`,
    `stroke="${style.stroke}"`,
    `stroke-width="1"`,
    `vector-effect="non-scaling-stroke"`,
    style.dash ? `stroke-dasharray="${style.dash}"` : "",
    style.opacity !== undefined ? `opacity="${style.opacity}"` : "",
  ].filter(Boolean);
  return `<path ${attrs.join(" ")}/>`;
}

/** Standalone <svg> string of the geometry (plus drawn bends / point welds). */
export function geometryToSvg(geometry: PartGeometry, annotations?: PartAnnotations | null, options: SvgOptions = {}): string {
  const theme = options.theme ?? "light";
  const padding = options.padding ?? 5;
  const width = options.width ?? 400;
  const height = options.height ?? 300;
  const boxes = geometry.entities.flatMap((e) => e.segments.map(segmentBbox));
  const bbox = boxes.length > 0 ? bboxUnionAll(boxes) : geometry.measures.bbox;
  const bg = theme === "dark" ? "#111111" : "#ffffff";
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxFor(bbox, padding)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" data-theme="${theme}">`
  );
  out.push(`<rect x="${n(bbox.minX - padding)}" y="${n(-bbox.maxY - padding)}" width="${n(Math.max(bbox.width, 1e-6) + 2 * padding)}" height="${n(Math.max(bbox.height, 1e-6) + 2 * padding)}" fill="${bg}"/>`);
  out.push(`<g class="geo">`);
  for (const e of geometry.entities) {
    out.push(pathEl(entityPath(e), roleStyle(e.role, theme), `geo-${e.role}`, e.id));
  }
  if (annotations) {
    for (const b of annotations.bends) {
      if (b.entityId) continue;
      const role: EntityRole = b.direction === "down" ? "bend_down" : "bend_up";
      out.push(pathEl(segmentsToPath([{ kind: "line", start: b.start, end: b.end }]), roleStyle(role, theme), `geo-${role} geo-drawn`));
    }
    for (const w of annotations.welds) {
      if (!w.points || w.points.length < 2) continue;
      const segs: Segment[] = [];
      for (let i = 0; i + 1 < w.points.length; i++) segs.push({ kind: "line", start: w.points[i], end: w.points[i + 1] });
      out.push(pathEl(segmentsToPath(segs), roleStyle("weld", theme), "geo-weld geo-drawn"));
    }
  }
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("");
}
