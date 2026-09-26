/**
 * Viewer — keyboard shortcut map. Pure, no React.
 * File path: /lib/viewer/keyboard.ts
 *
 * Single-key shortcuts (no Ctrl/Meta/Alt so browser shortcuts keep
 * working); letters match in either case so Shift+V still selects.
 * `SHORTCUT_LABELS` are the glyphs shown in `.tool-key` next to each
 * tool — key names, not copy, so they stay out of the content files.
 *
 * Canvas shortcuts (`resolveCanvasShortcut`) only apply while the <svg>
 * itself has focus: they make selection and point picking reachable
 * without a pointer (build prompt Step 14.7, CLAUDE.md "keyboard
 * operable"). `[` / `]` (or `,` / `.`) move a keyboard focus cursor
 * through the visible entities, Enter selects it (Shift+Enter toggles
 * it into the selection) or, in a point tool, picks both of its ends;
 * Ctrl/Cmd+A selects every visible entity. Tab is deliberately not
 * captured so focus can still leave the canvas.
 */

export type ViewerAction =
  | "select"
  | "tag"
  | "bend"
  | "weld"
  | "roll"
  | "calibrate"
  | "cleanup"
  | "export"
  | "fit"
  | "zoomIn"
  | "zoomOut"
  | "reset"
  | "cancel"
  | "delete";

export type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export const SHORTCUTS: Record<ViewerAction, readonly string[]> = {
  select: ["v"],
  tag: ["t"],
  bend: ["b"],
  weld: ["w"],
  roll: ["r"],
  calibrate: ["c"],
  cleanup: ["x"],
  export: ["e"],
  fit: ["f"],
  zoomIn: ["+", "="],
  zoomOut: ["-", "_"],
  reset: ["0"],
  cancel: ["Escape"],
  delete: ["Delete", "Backspace"],
};

export const SHORTCUT_LABELS: Record<ViewerAction, string> = {
  select: "V",
  tag: "T",
  bend: "B",
  weld: "W",
  roll: "R",
  calibrate: "C",
  cleanup: "X",
  export: "E",
  fit: "F",
  zoomIn: "+",
  zoomOut: "−",
  reset: "0",
  cancel: "Esc",
  delete: "Del",
};

export const MODIFIER_LABELS = { shift: "Shift", space: "Space" } as const;

/** Actions that change annotations — hidden in read-only mode. */
export const EDITING_ACTIONS: readonly ViewerAction[] = ["tag", "bend", "weld", "roll", "calibrate", "cleanup", "delete"];

/** Tools (modes) as opposed to one-shot actions. */
export const TOOL_ACTIONS: readonly ViewerAction[] = ["select", "tag", "bend", "weld", "roll", "calibrate", "cleanup"];

export function resolveShortcut(event: KeyLike): ViewerAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  for (const action of Object.keys(SHORTCUTS) as ViewerAction[]) {
    for (const k of SHORTCUTS[action]) {
      if (k === key || k === lower) return action;
    }
  }
  return null;
}

/* ─── Canvas-only shortcuts (keyboard selection / picking) ── */

export type CanvasAction = "prevEntity" | "nextEntity" | "activate" | "selectAll";

export const CANVAS_SHORTCUTS: Record<CanvasAction, readonly string[]> = {
  prevEntity: ["[", ","],
  nextEntity: ["]", "."],
  activate: ["Enter"],
  /** With Ctrl or Cmd. */
  selectAll: ["a"],
};

export const CANVAS_SHORTCUT_LABELS: Record<CanvasAction, string> = {
  prevEntity: "[",
  nextEntity: "]",
  activate: "Enter",
  selectAll: "Ctrl + A",
};

/** Resolve a key pressed on the focused canvas; null for anything else (including Tab). */
export function resolveCanvasShortcut(event: KeyLike): CanvasAction | null {
  if (event.altKey) return null;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (event.ctrlKey || event.metaKey) return lower === "a" ? "selectAll" : null;
  for (const action of Object.keys(CANVAS_SHORTCUTS) as CanvasAction[]) {
    if (action === "selectAll") continue;
    for (const k of CANVAS_SHORTCUTS[action]) if (k === key || k === lower) return action;
  }
  return null;
}

/**
 * Next id when stepping through `ids` from `currentId` (wraps around);
 * from nothing, `+1` starts at the first and `−1` at the last entity.
 */
export function cycleId(ids: readonly string[], currentId: string | null, step: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = currentId === null ? -1 : ids.indexOf(currentId);
  if (i === -1) return step === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(i + step + ids.length) % ids.length];
}

/** Selection after activating `id`: replace, or toggle it when `additive` (Shift). */
export function selectWith(selected: readonly string[], id: string, additive: boolean): string[] {
  if (!additive) return [id];
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** True when a key event comes from a text control and must not trigger shortcuts. */
export function isTextInputTag(tagName: string | null | undefined, contentEditable?: boolean): boolean {
  if (contentEditable) return true;
  const t = (tagName ?? "").toUpperCase();
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
}
