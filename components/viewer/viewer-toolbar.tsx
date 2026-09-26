"use client";

/**
 * Viewer — toolbar (tools + view actions with their key glyphs) and the
 * layer toggle strip.
 * File path: /components/viewer/viewer-toolbar.tsx
 *
 * Tool buttons are .tool-btn with aria-pressed for the active tool; the
 * key glyph next to each label is .tool-key (from lib/viewer/keyboard,
 * not copy). Editing tools disappear in read-only mode; view actions,
 * export and the layer toggles stay. Layer toggles are real checkboxes
 * (keyboard operable, no red "pressed" state for always-on layers) with
 * a token-coloured swatch matching the .geo-* stroke.
 */

import { useId } from "react";
import { useContent } from "@/components/providers/locale";
import type { ViewerLayerKey } from "@/content/viewer";
import { EDITING_ACTIONS, SHORTCUT_LABELS, type ViewerAction } from "@/lib/viewer/keyboard";
import { LAYER_ORDER, LAYER_SWATCH, type LayerState, type Tool } from "./viewer-types";

export type ViewerToolbarProps = {
  tool: Tool;
  readOnly: boolean;
  canExport: boolean;
  hasSelection: boolean;
  onAction: (action: ViewerAction) => void;
  layers: LayerState;
  onToggleLayer: (key: ViewerLayerKey) => void;
};

const TOOLS: readonly Tool[] = ["select", "tag", "bend", "weld", "roll", "calibrate", "cleanup"];
const VIEW_ACTIONS: readonly ViewerAction[] = ["fit", "zoomIn", "zoomOut", "reset"];

export function ViewerToolbar({ tool, readOnly, canExport, hasSelection, onAction, layers, onToggleLayer }: ViewerToolbarProps) {
  const c = useContent().viewer;
  const layersId = useId();
  const tools = readOnly ? TOOLS.filter((t) => !EDITING_ACTIONS.includes(t)) : TOOLS;

  const button = (action: ViewerAction, pressed?: boolean, disabled?: boolean) => (
    <button
      key={action}
      type="button"
      className="tool-btn"
      aria-pressed={pressed}
      title={c.tooltips[action]}
      disabled={disabled}
      onClick={() => onAction(action)}
      data-action={action}
    >
      {c.tools[action]}
      <span className="tool-key" aria-hidden="true">
        {SHORTCUT_LABELS[action]}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-px">
      <div className="toolbar" role="toolbar" aria-label={c.toolbarLabel}>
        {tools.map((t) => button(t, tool === t))}
        <span className="mx-1 h-6 w-px bg-line-dark" aria-hidden="true" />
        {VIEW_ACTIONS.map((a) => button(a))}
        {!readOnly && button("delete", undefined, !hasSelection)}
        {canExport && <span className="ml-auto" aria-hidden="true" />}
        {canExport && button("export")}
      </div>
      <div
        role="group"
        aria-labelledby={layersId}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-line-dark bg-black px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-on-dark-soft"
      >
        <span id={layersId} className="text-on-dark-muted">
          {c.layersLabel}
        </span>
        {LAYER_ORDER.map((key) => (
          <label key={key} className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={layers[key]}
              onChange={() => onToggleLayer(key)}
              data-layer={key}
            />
            {LAYER_SWATCH[key] && (
              <span aria-hidden="true" className="inline-block h-[11px] w-[8px]" style={{ background: LAYER_SWATCH[key] }} />
            )}
            {c.layers[key]}
          </label>
        ))}
      </div>
    </div>
  );
}
