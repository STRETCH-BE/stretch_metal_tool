"use client";

/**
 * PartViewer — the SVG drawing viewer/editor (build prompt Step 8).
 * File path: /components/viewer/part-viewer.tsx
 *
 * Props are the agreed contract the part page codes against. `geometry`
 * is the STORED (base) snapshot from analysis; the viewer applies
 * `annotations` itself with applyAnnotationsSync (useMemo) and renders
 * the result — roles, deletions, scale and mirror show immediately, and
 * the measures strip reads the same object. Every edit runs a pure
 * reducer from lib/viewer/tools and emits a complete new PartAnnotations
 * through onAnnotationsChange; nothing is persisted here. Healing
 * ("join within tolerance") and multi-part splitting are server work,
 * requested through the optional onRequestReanalyse callback.
 *
 * Rendering: one <svg> in screen px; grid and markers in px, geometry
 * and annotation overlays inside a single <g transform> (pan/zoom only
 * changes that attribute). The base geometry layer is memoised so a
 * 2000-entity file re-renders paths only when the annotated geometry
 * or the layer visibility changes; hover/selection are a separate thin
 * layer. Hit-testing is mathematical (lib/viewer/hit-test, 6 px, bbox
 * prefilter), never DOM-based. Server render works: the initial view
 * fits a 960 px assumed width, a ResizeObserver refits on mount.
 *
 * Interaction: left-click selects (Shift adds), left-drag lassos in the
 * selecting tools and pans in the point-pick tools, middle-drag or
 * Space+drag always pans, wheel zooms about the cursor (non-passive
 * listener), keyboard shortcuts per lib/viewer/keyboard on the wrapper
 * (ignored while typing in a field or while the rolling dialog is open).
 *
 * Keyboard-only path (Step 14.7): with the <svg> focused, `[` / `]` move
 * a focus cursor through the visible entities (the view pans to reveal
 * it, never zooms), Enter selects it (Shift+Enter toggles), Ctrl/Cmd+A
 * selects all; in the point tools Enter picks both ends of the focused
 * entity and the panels offer typed X/Y entry. These keys are resolved
 * only when the canvas itself is the target so Enter on a panel button
 * still clicks it and Tab still leaves the canvas.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Kbd } from "@/components/ui/kbd";
import type { ViewerLayerKey } from "@/content/viewer";
import { formatMm, formatNumber, interpolate } from "@/lib/format";
import { applyAnnotationsSync } from "@/lib/geometry/annotate";
import { bboxUnionAll } from "@/lib/geometry/math";
import type { EntityRole, PartAnnotations, PartGeometry, Point, RollAnnotation } from "@/lib/geometry/types";
import { entitiesInRect, nearestEntity, selectionLengthMm } from "@/lib/viewer/hit-test";
import {
  CANVAS_SHORTCUT_LABELS,
  EDITING_ACTIONS,
  SHORTCUT_LABELS,
  cycleId,
  isTextInputTag,
  resolveCanvasShortcut,
  resolveShortcut,
  selectWith,
  type CanvasAction,
  type ViewerAction,
} from "@/lib/viewer/keyboard";
import { entityPickPoints, snapPoint, type SnapResult } from "@/lib/viewer/snap";
import {
  addDrawnBend,
  addWeldFromEntities,
  addWeldFromPoints,
  clearRoll,
  clearScale,
  deleteSelection,
  ignoreSelection,
  joinWithinTolerance,
  keepLargestContour,
  mirror,
  polylineLength,
  removeAnnotation,
  restoreDeleted,
  setRoll,
  setScale,
  splitIntoParts,
  tagEntities,
  untagEntities,
  type BendForm,
  type WeldForm,
} from "@/lib/viewer/tools";
import {
  ZOOM_STEP,
  fitToBbox,
  gridLines,
  normalizeRect,
  panBy,
  panToReveal,
  screenToWorld,
  svgGroupTransform,
  wheelZoomFactor,
  zoomAbout,
  zoomCenter,
  zoomPercent,
  type ViewTransform,
  type Viewport,
} from "@/lib/viewer/view-transform";
import { GeometryLayer, HighlightLayer } from "./geometry-layer";
import { GridLayer } from "./grid-layer";
import { MeasuresStrip } from "./measures-strip";
import { AnnotationOverlay, MarkerOverlay } from "./overlays";
import { BendPanel, CalibratePanel, CleanupPanel, RollDialog, TagPanel, WeldPanel } from "./viewer-panels";
import { ViewerToolbar } from "./viewer-toolbar";
import { DEFAULT_LAYERS, isVisible, type LayerState, type Tool } from "./viewer-types";

/** Server-side work the viewer cannot do itself (see lib/viewer/tools). */
export type ReanalyseRequest = {
  /** "Join within tolerance": re-run healing with this endpoint tolerance (0.01–0.5 mm). */
  toleranceMm?: number;
  /** "Split into parts": make every closed outer contour its own part. */
  splitParts?: boolean;
};

export type PartViewerProps = {
  /** Stored geometry snapshot (as analysed) — the viewer applies `annotations` itself. */
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
  /**
   * Parent re-analyses on the server: healing with a new tolerance
   * ("join within tolerance") or splitting a multi-part file.
   */
  onRequestReanalyse?: (request: ReanalyseRequest) => void;
  /** Height of the canvas in px; the width fills the container. */
  height?: number;
  className?: string;
};

const SSR_VIEWPORT_WIDTH = 960;
const CLICK_SLOP_PX = 4;
const ARROW_PAN_PX = 40;

type Drag = {
  kind: "pan" | "lasso" | "maybe-lasso" | "maybe-pan";
  start: Point;
  current: Point;
  startView: ViewTransform;
  shift: boolean;
};

function resetView(bbox: PartGeometry["measures"]["bbox"], viewport: Viewport): ViewTransform {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return { scale: 1, tx: viewport.width / 2 - cx, ty: viewport.height / 2 + cy };
}

function safeApply(geometry: PartGeometry, annotations: PartAnnotations, thicknessMm: number | null): PartGeometry {
  try {
    return applyAnnotationsSync(geometry, annotations, thicknessMm !== null ? { thicknessMm } : {});
  } catch {
    return geometry;
  }
}

export function PartViewer({
  geometry,
  annotations,
  onAnnotationsChange,
  thicknessMm,
  readOnly = false,
  onExportDxf,
  onRequestReanalyse,
  height = 520,
  className = "",
}: PartViewerProps) {
  const content = useContent();
  const c = content.viewer;
  const locale = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const spaceRef = useRef(false);

  /* ─── Derived geometry ─────────────────────────────────── */
  const effective = useMemo(() => safeApply(geometry, annotations, thicknessMm), [geometry, annotations, thicknessMm]);
  const entities = effective.entities;
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const contentBbox = useMemo(
    () => (entities.length > 0 ? bboxUnionAll(entities.map((e) => e.bbox)) : effective.measures.bbox),
    [entities, effective.measures.bbox]
  );

  /* ─── State ────────────────────────────────────────────── */
  const [viewport, setViewport] = useState<Viewport>({ width: SSR_VIEWPORT_WIDTH, height });
  const [measured, setMeasured] = useState(false);
  const [view, setView] = useState<ViewTransform>(() => fitToBbox(contentBbox, { width: SSR_VIEWPORT_WIDTH, height }));
  const [tool, setToolState] = useState<Tool>("select");
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Keyboard focus cursor (entity id) — see lib/viewer/keyboard. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picked, setPicked] = useState<Point[]>([]);
  const [weldMode, setWeldMode] = useState<"entities" | "points">("entities");
  const [rollOpen, setRollOpen] = useState(false);

  const activeTool: Tool = readOnly ? "select" : tool;
  const pickMode = activeTool === "bend" || activeTool === "calibrate" || (activeTool === "weld" && weldMode === "points");
  const visibleEntities = useMemo(() => entities.filter((e) => isVisible(layers, e)), [entities, layers]);
  const selectedIds = useMemo(() => selected.filter((id) => byId.has(id)), [selected, byId]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionLength = useMemo(() => selectionLengthMm(entities, selectedSet), [entities, selectedSet]);
  const focusEntity = useMemo(() => {
    const e = focusId ? byId.get(focusId) : undefined;
    return e && isVisible(layers, e) ? e : null;
  }, [focusId, byId, layers]);
  const grid = useMemo(() => (layers.grid ? gridLines(view, viewport) : null), [layers.grid, view, viewport]);
  const cursorWorld = cursor ? screenToWorld(view, cursor) : null;
  const snap: SnapResult | null = useMemo(() => {
    if (!cursor || !pickMode || !layers.snap || drag) return null;
    return snapPoint(visibleEntities, cursor, view, { from: picked[picked.length - 1] ?? null });
  }, [cursor, pickMode, layers.snap, drag, visibleEntities, view, picked]);

  /* ─── Viewport measurement + fit ───────────────────────── */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      setViewport((v) => (v.width === r.width && v.height === r.height ? v : { width: r.width, height: r.height }));
      setMeasured(true);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const bboxKey = `${contentBbox.minX}|${contentBbox.minY}|${contentBbox.maxX}|${contentBbox.maxY}`;
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!measured || fittedKey.current === bboxKey) return;
    fittedKey.current = bboxKey;
    setView(fitToBbox(contentBbox, viewport));
  }, [measured, bboxKey, contentBbox, viewport]);

  /* ─── Wheel zoom (non-passive so the page never scrolls) ─ */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      setView((v) => zoomAbout(v, p, wheelZoomFactor(ev.deltaY, ev.deltaMode)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ─── Emit ─────────────────────────────────────────────── */
  const emit = (next: PartAnnotations) => {
    if (next !== annotations) onAnnotationsChange?.(next);
  };

  const selectTool = (next: Tool) => {
    setToolState(next);
    setPicked([]);
    setHoverId(null);
    if (next !== "roll") setRollOpen(false);
  };

  const runAction = (action: ViewerAction) => {
    if (readOnly && EDITING_ACTIONS.includes(action)) return;
    switch (action) {
      case "select":
      case "tag":
      case "bend":
      case "weld":
      case "calibrate":
      case "cleanup":
        selectTool(action);
        break;
      case "roll":
        selectTool("roll");
        setRollOpen(true);
        break;
      case "export":
        onExportDxf?.();
        break;
      case "fit":
        setView(fitToBbox(contentBbox, viewport));
        break;
      case "zoomIn":
        setView((v) => zoomCenter(v, viewport, ZOOM_STEP));
        break;
      case "zoomOut":
        setView((v) => zoomCenter(v, viewport, 1 / ZOOM_STEP));
        break;
      case "reset":
        setView(resetView(contentBbox, viewport));
        break;
      case "cancel":
        if (picked.length > 0) setPicked([]);
        else if (rollOpen) setRollOpen(false);
        else if (tool !== "select") selectTool("select");
        else {
          setSelected([]);
          setFocusId(null);
        }
        break;
      case "delete":
        if (selectedIds.length > 0) {
          emit(deleteSelection(annotations, selectedIds));
          setSelected([]);
        }
        break;
    }
  };

  /** Canvas-only keys: entity focus cursor, Enter, Ctrl+A. */
  const runCanvasAction = (action: CanvasAction, additive: boolean) => {
    switch (action) {
      case "prevEntity":
      case "nextEntity": {
        const next = cycleId(
          visibleEntities.map((e) => e.id),
          focusEntity?.id ?? null,
          action === "nextEntity" ? 1 : -1
        );
        setFocusId(next);
        const entity = next ? byId.get(next) : undefined;
        if (entity) setView((v) => panToReveal(v, entity.bbox, viewport));
        break;
      }
      case "activate": {
        if (!focusEntity) return;
        if (pickMode) {
          const pts = entityPickPoints(focusEntity);
          if (pts) setPicked(pts);
        } else {
          setSelected((prev) => selectWith(prev, focusEntity.id, additive));
        }
        break;
      }
      case "selectAll":
        if (!pickMode) setSelected(visibleEntities.map((e) => e.id));
        break;
    }
  };

  /* ─── Pointer ──────────────────────────────────────────── */
  const localPoint = (e: PointerEvent<SVGSVGElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Pick rule shared by clicks and typed points: a third point starts a new pair. */
  const pushPicked = (p: Point) => setPicked((prev) => (prev.length >= 2 ? [p] : [...prev, p]));

  const pickPoint = (p: Point) => {
    const s = layers.snap
      ? snapPoint(visibleEntities, p, view, { from: picked[picked.length - 1] ?? null })
      : { point: screenToWorld(view, p), kind: null, entityId: null };
    pushPicked(s.point);
  };

  const handleClick = (p: Point, shift: boolean) => {
    if (pickMode) {
      pickPoint(p);
      return;
    }
    const hit = nearestEntity(visibleEntities, p, view);
    if (!hit) {
      if (!shift) setSelected([]);
      return;
    }
    const id = hit.entity.id;
    setSelected((prev) => (shift ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = localPoint(e);
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const pan = e.button === 1 || spaceRef.current;
    if (pan) e.preventDefault();
    setDrag({ kind: pan ? "pan" : pickMode ? "maybe-pan" : "maybe-lasso", start: p, current: p, startView: view, shift: e.shiftKey });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = localPoint(e);
    setCursor(p);
    if (drag) {
      let kind = drag.kind;
      if ((kind === "maybe-pan" || kind === "maybe-lasso") && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > CLICK_SLOP_PX) {
        kind = kind === "maybe-pan" ? "pan" : "lasso";
      }
      if (kind === "pan") setView(panBy(drag.startView, p.x - drag.start.x, p.y - drag.start.y));
      setDrag({ ...drag, kind, current: p });
      return;
    }
    if (!pickMode) {
      const id = nearestEntity(visibleEntities, p, view)?.entity.id ?? null;
      if (id !== hoverId) setHoverId(id);
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const p = localPoint(e);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "lasso") {
      const ids = entitiesInRect(visibleEntities, normalizeRect(d.start, p), view);
      setSelected((prev) => (d.shift ? Array.from(new Set([...prev, ...ids])) : ids));
      return;
    }
    if (d.kind === "maybe-lasso" || d.kind === "maybe-pan") handleClick(p, d.shift);
  };

  const onPointerLeave = () => {
    if (drag) return;
    setCursor(null);
    setHoverId(null);
  };

  /* ─── Keyboard ─────────────────────────────────────────── */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (isTextInputTag(target.tagName, target instanceof HTMLElement && target.isContentEditable)) return;
    if (e.key === " ") {
      spaceRef.current = true;
      if (target === svgRef.current) e.preventDefault();
      return;
    }
    if (rollOpen) return; // the Modal owns Escape / focus while open
    if (target === svgRef.current && e.key.startsWith("Arrow")) {
      const step = e.shiftKey ? ARROW_PAN_PX * 5 : ARROW_PAN_PX;
      const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        setView((v) => panBy(v, dx, dy));
      }
      return;
    }
    if (target === svgRef.current) {
      const canvasAction = resolveCanvasShortcut(e);
      if (canvasAction) {
        e.preventDefault();
        runCanvasAction(canvasAction, e.shiftKey);
        return;
      }
    }
    const action = resolveShortcut(e);
    if (!action) return;
    e.preventDefault();
    runAction(action);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") spaceRef.current = false;
  };

  /* ─── Panel callbacks ──────────────────────────────────── */
  const toggleLayer = (key: ViewerLayerKey) => setLayers((l) => ({ ...l, [key]: !l[key] }));
  const onTag = (role: EntityRole, form?: BendForm) => emit(tagEntities(annotations, selectedIds, role, form, entities));
  const onAddBend = (form: BendForm) => {
    if (picked.length !== 2) return;
    emit(addDrawnBend(annotations, picked[0], picked[1], form));
    setPicked([]);
  };
  const weldLength = weldMode === "entities" ? selectionLength : picked.length === 2 ? polylineLength(picked) : 0;
  const weldReady = weldMode === "entities" ? selectedIds.length > 0 : picked.length === 2;
  const onAddWeld = (form: WeldForm) => {
    if (weldMode === "entities") emit(addWeldFromEntities(annotations, entities, selectedIds, form));
    else if (picked.length === 2) emit(addWeldFromPoints(annotations, picked, form));
    setPicked([]);
  };
  const onCalibrate = (realMm: number) => {
    if (picked.length !== 2) return;
    emit(setScale(annotations, picked[0], picked[1], realMm));
    setPicked([]);
  };
  const onSaveRoll = (roll: RollAnnotation) => {
    emit(setRoll(annotations, roll));
    setRollOpen(false);
    selectTool("select");
  };
  const closeRoll = () => {
    setRollOpen(false);
    selectTool("select");
  };

  /* ─── Render helpers ───────────────────────────────────── */
  const hint = readOnly
    ? c.hints.select
    : activeTool === "tag"
      ? c.hints.tag
      : activeTool === "bend"
        ? picked.length === 0
          ? c.hints.bendFirst
          : c.hints.bendSecond
        : activeTool === "weld"
          ? weldMode === "entities"
            ? c.hints.weldEntities
            : c.hints.weldPoints
          : activeTool === "calibrate"
            ? picked.length === 0
              ? c.hints.calibrateFirst
              : c.hints.calibrateSecond
            : activeTool === "cleanup"
              ? c.hints.cleanup
              : c.hints.select;
  const cursorStyle = drag?.kind === "pan" ? "grabbing" : pickMode ? "crosshair" : "default";
  const showPanel = !readOnly && (activeTool === "tag" || activeTool === "bend" || activeTool === "weld" || activeTool === "calibrate" || activeTool === "cleanup");

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()} onKeyDown={onKeyDown} onKeyUp={onKeyUp} data-part-viewer="true">
      <MeasuresStrip geometry={effective} />
      <ViewerToolbar
        tool={activeTool}
        readOnly={readOnly}
        canExport={Boolean(onExportDxf)}
        hasSelection={selectedIds.length > 0}
        onAction={runAction}
        layers={layers}
        onToggleLayer={toggleLayer}
      />
      <div className="flex items-stretch gap-2">
        <div className="viewer min-w-0 flex-1" style={{ height }}>
          <svg
            ref={svgRef}
            role="application"
            aria-label={c.canvasLabel}
            tabIndex={0}
            width="100%"
            height={height}
            style={{ touchAction: "none", cursor: cursorStyle }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onContextMenu={(e) => e.preventDefault()}
            data-tool={activeTool}
            data-focus-id={focusEntity?.id}
          >
            {grid && <GridLayer grid={grid} viewport={viewport} locale={locale} />}
            <g transform={svgGroupTransform(view)} data-view="true">
              <GeometryLayer entities={visibleEntities} />
              <AnnotationOverlay annotations={annotations} byId={byId} bbox={effective.measures.bbox} />
              <HighlightLayer byId={byId} selectedIds={selectedIds} hoverId={hoverId} focusId={focusEntity?.id ?? null} />
            </g>
            <MarkerOverlay
              view={view}
              picked={picked}
              cursorWorld={pickMode ? cursorWorld : null}
              snap={snap}
              lasso={drag?.kind === "lasso" ? normalizeRect(drag.start, drag.current) : null}
              snapLabel={snap?.kind ? c.snapKinds[snap.kind] : null}
            />
          </svg>
          <div className="viewer-readout" aria-live="off" data-readout="cursor">
            {cursorWorld ? (
              <>
                {c.readout.x} {formatMm(cursorWorld.x, locale)} {c.readout.y} {formatMm(cursorWorld.y, locale)} {c.units.mm}
              </>
            ) : (
              c.readout.outside
            )}
            {" · "}
            {c.readout.zoom} {formatNumber(zoomPercent(view), locale, { maximumFractionDigits: 0 })} {c.units.percent}
            {grid && (
              <>
                {" · "}
                {interpolate(c.readout.gridStep, { step: formatNumber(grid.stepMm, locale) })}
              </>
            )}
            {focusEntity && (
              <span data-readout="focus">
                {" · "}
                {interpolate(c.readout.focused, {
                  index: visibleEntities.indexOf(focusEntity) + 1,
                  count: visibleEntities.length,
                  role: c.roles[focusEntity.role],
                })}
              </span>
            )}
          </div>
          <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap items-center gap-2">
            {readOnly && <span className="chip chip-dark">{c.readOnly}</span>}
            <span className="chip chip-dark" data-selection-summary="true" aria-live="polite">
              {selectedIds.length > 0
                ? interpolate(c.readout.selection, { count: selectedIds.length, length: formatMm(selectionLength, locale) })
                : c.readout.noSelection}
            </span>
            <span className="chip chip-dark chip-plain">{interpolate(c.readout.entities, { count: visibleEntities.length })}</span>
          </div>
        </div>
        {showPanel && (
          <div className="w-[300px] shrink-0">
            {activeTool === "tag" && (
              <TagPanel key="tag" selectedIds={selectedIds} thicknessMm={thicknessMm} onTag={onTag} onClearTag={() => emit(untagEntities(annotations, selectedIds))} />
            )}
            {activeTool === "bend" && (
              <BendPanel
                key="bend"
                picked={picked}
                thicknessMm={thicknessMm}
                bends={annotations.bends}
                onAdd={onAddBend}
                onRemove={(id) => emit(removeAnnotation(annotations, id))}
                onPickPoint={pushPicked}
                onClearPicked={() => setPicked([])}
              />
            )}
            {activeTool === "weld" && (
              <WeldPanel
                key="weld"
                mode={weldMode}
                onModeChange={(m) => {
                  setWeldMode(m);
                  setPicked([]);
                }}
                lengthMm={weldLength}
                ready={weldReady}
                picked={picked}
                thicknessMm={thicknessMm}
                welds={annotations.welds}
                onAdd={onAddWeld}
                onRemove={(id) => emit(removeAnnotation(annotations, id))}
                onPickPoint={pushPicked}
                onClearPicked={() => setPicked([])}
              />
            )}
            {activeTool === "calibrate" && (
              <CalibratePanel
                key="calibrate"
                picked={picked}
                annotations={annotations}
                bbox={effective.measures.bbox}
                onApply={onCalibrate}
                onReset={() => emit(clearScale(annotations))}
                onPickPoint={pushPicked}
                onClearPicked={() => setPicked([])}
              />
            )}
            {activeTool === "cleanup" && (
              <CleanupPanel
                key="cleanup"
                hasSelection={selectedIds.length > 0}
                annotations={annotations}
                onKeepLargest={() => emit(keepLargestContour(effective, annotations))}
                onDeleteSelection={() => {
                  emit(deleteSelection(annotations, selectedIds));
                  setSelected([]);
                }}
                onIgnoreSelection={() => emit(ignoreSelection(annotations, selectedIds))}
                onJoin={(tol) => onRequestReanalyse?.({ toleranceMm: joinWithinTolerance(annotations, tol).requestedToleranceMm })}
                onMirror={() => emit(mirror(annotations))}
                onSplit={() => onRequestReanalyse?.({ splitParts: splitIntoParts(annotations).splitParts })}
                onRestoreDeleted={() => emit(restoreDeleted(annotations))}
              />
            )}
          </div>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-muted" data-hint="true">
        <span>{hint}</span>
        <span>
          <Kbd>{SHORTCUT_LABELS.cancel}</Kbd> {c.tools.cancel}
        </span>
        {!readOnly && (
          <span>
            <Kbd>{SHORTCUT_LABELS.delete}</Kbd> {c.tools.delete}
          </span>
        )}
        <span>
          <Kbd>{c.legend.shiftClick}</Kbd> {c.hints.shiftClick}
        </span>
        <span>
          <Kbd>{c.legend.spaceDrag}</Kbd> {c.hints.pan}
        </span>
        <span>
          <Kbd>{c.legend.wheel}</Kbd> {c.hints.zoom}
        </span>
        <span>
          <Kbd>{c.legend.arrows}</Kbd> {c.hints.arrows}
        </span>
        <span>
          <Kbd>{`${CANVAS_SHORTCUT_LABELS.prevEntity} ${CANVAS_SHORTCUT_LABELS.nextEntity}`}</Kbd> {c.hints.cycle}
        </span>
        <span>
          <Kbd>{CANVAS_SHORTCUT_LABELS.activate}</Kbd> {pickMode ? c.hints.enterPick : c.hints.enterSelect}
        </span>
        {!pickMode && (
          <span>
            <Kbd>{CANVAS_SHORTCUT_LABELS.selectAll}</Kbd> {c.hints.selectAll}
          </span>
        )}
      </p>
      {!readOnly && rollOpen && (
        <RollDialog key="roll" open={rollOpen} geometry={effective} annotations={annotations} onSave={onSaveRoll} onClear={() => { emit(clearRoll(annotations)); closeRoll(); }} onClose={closeRoll} />
      )}
    </div>
  );
}
