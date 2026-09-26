/**
 * Viewer — keyboard shortcut resolution.
 * File path: /test/viewer/keyboard.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_SHORTCUTS,
  CANVAS_SHORTCUT_LABELS,
  EDITING_ACTIONS,
  SHORTCUTS,
  SHORTCUT_LABELS,
  TOOL_ACTIONS,
  cycleId,
  isTextInputTag,
  resolveCanvasShortcut,
  resolveShortcut,
  selectWith,
  type CanvasAction,
} from "@/lib/viewer/keyboard";

describe("keyboard", () => {
  it("resolves every documented shortcut", () => {
    expect(resolveShortcut({ key: "v" })).toBe("select");
    expect(resolveShortcut({ key: "V", shiftKey: true })).toBe("select");
    expect(resolveShortcut({ key: "t" })).toBe("tag");
    expect(resolveShortcut({ key: "b" })).toBe("bend");
    expect(resolveShortcut({ key: "w" })).toBe("weld");
    expect(resolveShortcut({ key: "r" })).toBe("roll");
    expect(resolveShortcut({ key: "c" })).toBe("calibrate");
    expect(resolveShortcut({ key: "x" })).toBe("cleanup");
    expect(resolveShortcut({ key: "e" })).toBe("export");
    expect(resolveShortcut({ key: "f" })).toBe("fit");
    expect(resolveShortcut({ key: "+" })).toBe("zoomIn");
    expect(resolveShortcut({ key: "=" })).toBe("zoomIn");
    expect(resolveShortcut({ key: "-" })).toBe("zoomOut");
    expect(resolveShortcut({ key: "0" })).toBe("reset");
    expect(resolveShortcut({ key: "Escape" })).toBe("cancel");
    expect(resolveShortcut({ key: "Delete" })).toBe("delete");
    expect(resolveShortcut({ key: "Backspace" })).toBe("delete");
  });

  it("ignores modifier chords and unknown keys", () => {
    expect(resolveShortcut({ key: "v", ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: "c", metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: "f", altKey: true })).toBeNull();
    expect(resolveShortcut({ key: "q" })).toBeNull();
    expect(resolveShortcut({ key: "ArrowLeft" })).toBeNull();
  });

  it("has a label for every action and consistent action groups", () => {
    for (const action of Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]) {
      expect(SHORTCUT_LABELS[action].length).toBeGreaterThan(0);
    }
    expect(SHORTCUT_LABELS.cancel).toBe("Esc");
    expect(TOOL_ACTIONS).toContain("select");
    expect(EDITING_ACTIONS).not.toContain("select");
    expect(EDITING_ACTIONS).not.toContain("fit");
  });

  it("detects text controls", () => {
    expect(isTextInputTag("input")).toBe(true);
    expect(isTextInputTag("TEXTAREA")).toBe(true);
    expect(isTextInputTag("select")).toBe(true);
    expect(isTextInputTag("svg")).toBe(false);
    expect(isTextInputTag(undefined)).toBe(false);
    expect(isTextInputTag("div", true)).toBe(true);
  });
});

describe("canvas shortcuts (keyboard selection and picking)", () => {
  it("resolves the canvas-only keys and leaves Tab, letters and other chords alone", () => {
    expect(resolveCanvasShortcut({ key: "]" })).toBe("nextEntity");
    expect(resolveCanvasShortcut({ key: "." })).toBe("nextEntity");
    expect(resolveCanvasShortcut({ key: "[" })).toBe("prevEntity");
    expect(resolveCanvasShortcut({ key: "," })).toBe("prevEntity");
    expect(resolveCanvasShortcut({ key: "Enter" })).toBe("activate");
    expect(resolveCanvasShortcut({ key: "Enter", shiftKey: true })).toBe("activate");
    expect(resolveCanvasShortcut({ key: "a", ctrlKey: true })).toBe("selectAll");
    expect(resolveCanvasShortcut({ key: "A", metaKey: true })).toBe("selectAll");
    expect(resolveCanvasShortcut({ key: "a" })).toBeNull();
    expect(resolveCanvasShortcut({ key: "Tab" })).toBeNull();
    expect(resolveCanvasShortcut({ key: "v" })).toBeNull();
    expect(resolveCanvasShortcut({ key: " " })).toBeNull();
    expect(resolveCanvasShortcut({ key: "]", altKey: true })).toBeNull();
    expect(resolveCanvasShortcut({ key: "]", ctrlKey: true })).toBeNull();
    for (const action of Object.keys(CANVAS_SHORTCUTS) as CanvasAction[]) {
      expect(CANVAS_SHORTCUT_LABELS[action].length).toBeGreaterThan(0);
    }
    // no overlap with the tool shortcuts
    for (const keys of Object.values(SHORTCUTS)) for (const k of keys) expect(resolveCanvasShortcut({ key: k })).toBeNull();
  });

  it("cycles the focus cursor through the visible ids with wrap-around", () => {
    const ids = ["a", "b", "c"];
    expect(cycleId(ids, null, 1)).toBe("a");
    expect(cycleId(ids, null, -1)).toBe("c");
    expect(cycleId(ids, "a", 1)).toBe("b");
    expect(cycleId(ids, "c", 1)).toBe("a");
    expect(cycleId(ids, "a", -1)).toBe("c");
    expect(cycleId(ids, "gone", 1)).toBe("a"); // hidden or deleted entity → restart
    expect(cycleId([], "a", 1)).toBeNull();
  });

  it("Enter replaces the selection, Shift+Enter toggles the entity in it", () => {
    expect(selectWith(["a", "b"], "c", false)).toEqual(["c"]);
    expect(selectWith(["a", "b"], "c", true)).toEqual(["a", "b", "c"]);
    expect(selectWith(["a", "b"], "a", true)).toEqual(["b"]);
    expect(selectWith([], "a", true)).toEqual(["a"]);
  });
});
