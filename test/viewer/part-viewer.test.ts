/**
 * PartViewer — server-render smoke test (react-dom/server, no DOM).
 * File path: /test/viewer/part-viewer.test.ts
 *
 * The viewer must render on the server without touching window/DOM and
 * emit one <path> per visible entity (37 on the 200164-like part: outer
 * + 32 holes + 4 bend lines), the accessible canvas, the toolbar with its
 * key glyphs, the layer toggles and the measures strip. The panels are
 * rendered on their own for the keyboard route (typed X/Y point entry,
 * clear points) and the stitch-pitch guard, which need a tool active.
 */
import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { getContent } from "@/content";
import { LocaleProvider } from "@/components/providers/locale";
import { PartViewer, type PartViewerProps } from "@/components/viewer";
import { BendPanel, CalibratePanel, WeldFormFields, WeldPanel } from "@/components/viewer/viewer-panels";
import { EMPTY_ANNOTATIONS, type PartAnnotations, type PartGeometry } from "@/lib/geometry/types";
import { make200164Like } from "@/test/helpers/parts";
import { addDrawnBend, addWeldFromPoints, bendDefaults, weldDefaults, type WeldForm } from "@/lib/viewer/tools";

// vitest compiles the .tsx components with the classic JSX runtime
// (tsconfig jsx: preserve), which expects a global React at render time.
(globalThis as { React?: typeof React }).React = React;

function renderViewer(props: Partial<PartViewerProps>, locale: "pl" | "en" = "en", geometry: PartGeometry = make200164Like()): string {
  const viewerProps: PartViewerProps = { geometry, annotations: EMPTY_ANNOTATIONS, thicknessMm: 2, ...props };
  const providerProps = { content: getContent(locale) } as React.ComponentProps<typeof LocaleProvider>;
  return renderToString(React.createElement(LocaleProvider, providerProps, React.createElement(PartViewer, viewerProps)));
}

const render = (props: Partial<PartViewerProps> = {}, locale: "pl" | "en" = "en") => renderViewer(props, locale);

function renderPanel(element: React.ReactElement, locale: "pl" | "en" = "en"): string {
  const providerProps = { content: getContent(locale) } as React.ComponentProps<typeof LocaleProvider>;
  return renderToString(React.createElement(LocaleProvider, providerProps, element));
}

const noop = () => undefined;

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("PartViewer (server render)", () => {
  it("renders one <path> per visible entity on the 200164-like part", () => {
    const html = render();
    expect(count(html, /<path /g)).toBe(37);
    expect(count(html, /class="geo-hole"/g)).toBe(32);
    expect(count(html, /class="geo-cut"/g)).toBe(1);
    expect(count(html, /class="geo-bend_up"/g)).toBe(1);
    expect(count(html, /class="geo-bend_down"/g)).toBe(3);
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toContain('role="application"');
    expect(html).toContain('aria-label="Part drawing — editor canvas"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("translate(");
  });

  it("shows the toolbar with shortcuts, the layer toggles, the readout and the measures", () => {
    const html = render({ onExportDxf: () => undefined });
    expect(html).toContain('role="toolbar"');
    for (const key of ["V", "T", "B", "W", "R", "C", "X", "E", "F", "0"]) expect(html).toContain(`<span class="tool-key" aria-hidden="true">${key}</span>`);
    expect(html).toContain('<kbd class="kbd">Esc</kbd>');
    expect(html).toContain('<kbd class="kbd">Del</kbd>');
    expect(html).toContain('<kbd class="kbd">Shift + click</kbd>');
    expect(html).toContain('<kbd class="kbd">Space + drag</kbd>');
    expect(html).toContain('aria-pressed="true"');
    expect(count(html, /data-layer="/g)).toBe(10);
    expect(html).toContain('class="viewer-readout"');
    expect(html).toContain("Zoom");
    expect(html).toContain('data-measure="cut"');
    expect(html).toContain("1,800.4 mm"); // cut length 1 224.3 + 571.8 (synthetic rectangle: 2·(554.3+60) + Σπd)
    expect(html).toContain('data-measure="pierces"');
    expect(html).toContain(">33<");
    expect(html).toContain("0.509 kg");
    expect(html).toContain("554.3 × 60.0 mm");
    expect(html).toContain("Nothing selected");
  });

  it("renders the Polish dictionary", () => {
    const html = render({}, "pl");
    expect(html).toContain("Zaznacz");
    expect(html).toContain("Długość cięcia");
    expect(html).toContain("Brak zaznaczenia");
  });

  it("hides editing tools in read-only mode but keeps view actions, layers and export", () => {
    const html = render({ readOnly: true, onExportDxf: () => undefined });
    expect(html).toContain('data-action="select"');
    expect(html).toContain('data-action="fit"');
    expect(html).toContain('data-action="export"');
    expect(html).not.toContain('data-action="tag"');
    expect(html).not.toContain('data-action="bend"');
    expect(html).not.toContain('data-action="delete"');
    expect(html).not.toContain('data-tool-panel');
    expect(html).toContain("View only");
    expect(count(html, /<path /g)).toBe(37);
  });

  it("draws annotation overlays without adding entity paths", () => {
    let annotations: PartAnnotations = addDrawnBend(EMPTY_ANNOTATIONS, { x: 0, y: -60 }, { x: 0, y: 0 }, bendDefaults(2, "down"));
    annotations = addWeldFromPoints(annotations, [{ x: -338.907, y: -60 }, { x: 215.393, y: -60 }], weldDefaults(2));
    annotations = { ...annotations, roll: { radiusMm: 100, axis: "x", arcAngleDeg: 360, axisLengthMm: 554.3, developedWidthMm: 60, cone: null } };
    const html = render({ annotations });
    expect(count(html, /<path /g)).toBe(37);
    expect(html).toContain('data-bend-id="bend-1"');
    expect(html).toContain('data-weld-id="weld-1"');
    expect(html).toContain('data-roll-axis="x"');
    expect(html).toContain("554.3 mm"); // effective weld length in the measures strip
  });

  it("documents the keyboard selection path next to the pointer hints", () => {
    const html = render();
    expect(html).toContain('<kbd class="kbd">[ ]</kbd>');
    expect(html).toContain('<kbd class="kbd">Enter</kbd>');
    expect(html).toContain('<kbd class="kbd">Ctrl + A</kbd>');
    expect(html).toContain("selects the focused entity");
    expect(html).toContain('aria-live="polite"'); // selection summary is announced
    expect(html).not.toContain('data-focus="true"'); // no focus cursor until the keyboard moves it
    expect(render({}, "pl")).toContain("przechodzi po elementach");
  });

  it("point-pick panels offer typed X/Y entry and clear-points as the keyboard route", () => {
    const picked = [{ x: 0, y: 0 }];
    const bend = renderPanel(
      React.createElement(BendPanel, { picked, thicknessMm: 2, bends: [], onAdd: noop, onRemove: noop, onPickPoint: noop, onClearPicked: noop })
    );
    expect(bend).toContain('data-point-entry="true"');
    expect(bend).toContain("Add point");
    expect(bend).toContain('data-clear-picked="true"');
    expect(count(bend, /inputmode="decimal"/gi)).toBeGreaterThanOrEqual(2); // X, Y (+ the bend form)
    const geometry = make200164Like();
    const calibrate = renderPanel(
      React.createElement(CalibratePanel, {
        picked: [],
        annotations: EMPTY_ANNOTATIONS,
        bbox: geometry.measures.bbox,
        onApply: noop,
        onReset: noop,
        onPickPoint: noop,
        onClearPicked: noop,
      })
    );
    expect(calibrate).toContain('data-point-entry="true"');
    expect(calibrate).not.toContain('data-clear-picked="true"'); // nothing picked yet
    const weldProps = { onModeChange: noop, lengthMm: 0, ready: false, picked: [], thicknessMm: 2, welds: [], onAdd: noop, onRemove: noop, onPickPoint: noop, onClearPicked: noop };
    expect(renderPanel(React.createElement(WeldPanel, { ...weldProps, mode: "points" }))).toContain('data-point-entry="true"');
    expect(renderPanel(React.createElement(WeldPanel, { ...weldProps, mode: "entities" }))).not.toContain('data-point-entry="true"');
    expect(renderPanel(React.createElement(BendPanel, { picked, thicknessMm: 2, bends: [], onAdd: noop, onRemove: noop, onPickPoint: noop, onClearPicked: noop }), "pl")).toContain("Dodaj punkt");
  });

  it("flags a stitch pitch of 0 in the weld form (the server schema requires pitch > 0)", () => {
    const zeroPitch: WeldForm = { ...weldDefaults(2), pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 0 } };
    const bad = renderPanel(React.createElement(WeldFormFields, { value: zeroPitch, onChange: noop, idPrefix: "w" }));
    expect(bad).toContain('role="alert"');
    expect(bad).toContain("Pitch must be greater than zero.");
    expect(bad).toContain('aria-invalid="true"');
    expect(bad).toContain('aria-describedby="w-pitch-error"');
    const ok = renderPanel(React.createElement(WeldFormFields, { value: { ...zeroPitch, stitch: { beadLengthMm: 30, pitchMm: 60 } }, onChange: noop, idPrefix: "w" }));
    expect(ok).not.toContain('role="alert"');
    expect(ok).not.toContain('aria-invalid="true"');
    // a valid pick shows the previewed effective length; the Add button is present and enabled
    const panel = renderPanel(
      React.createElement(WeldPanel, {
        mode: "points",
        onModeChange: noop,
        lengthMm: 500,
        ready: true,
        picked: [
          { x: 0, y: 0 },
          { x: 500, y: 0 },
        ],
        thicknessMm: 2,
        welds: [],
        onAdd: noop,
        onRemove: noop,
        onPickPoint: noop,
        onClearPicked: noop,
      })
    );
    expect(panel).toContain('data-readout="weld-effective">500.0 mm');
    expect(panel).toMatch(/<button[^>]*data-add-weld="true"[^>]*>/);
    expect(panel).not.toMatch(/<button[^>]*disabled[^>]*data-add-weld="true"/);
  });

  it("copes with a geometry without entities", () => {
    const geometry: PartGeometry = { ...make200164Like(), entities: [], loops: [], outerLoopId: null };
    const html = renderViewer({ thicknessMm: null }, "en", geometry);
    expect(count(html, /<path /g)).toBe(0);
    expect(html).toContain('role="application"');
  });
});
