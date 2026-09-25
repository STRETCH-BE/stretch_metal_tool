/**
 * SVG output — path generation and thumbnails.
 * File path: /test/geometry/svg.test.ts
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { analyzeDxfSync, EMPTY_ANNOTATIONS, geometryToSvg, makeArc, segmentsToPath, viewBoxFor, makeBbox } from "@/lib/geometry";
import { buildDxf, circle, line, rectLines } from "./dxf-builder";

describe("svg", () => {
  it("flips Y and writes arcs with the right sweep flags", () => {
    const d = segmentsToPath([{ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } }]);
    expect(d).toBe("M 0 0 L 10 -5");
    // CCW quarter arc 0→90 about the origin: (5,0) → (0,5); on screen (5,0) → (0,-5) is sweep 0
    const arc = makeArc({ x: 0, y: 0 }, 5, 0, 90);
    expect(segmentsToPath([arc])).toBe("M 5 0 A 5 5 0 0 0 0 -5");
    // traversed backwards (pen at the arc end) → sweep 1
    expect(segmentsToPath([{ kind: "line", start: { x: 0, y: 10 }, end: { x: 0, y: 5 } }, arc])).toBe("M 0 -10 L 0 -5 A 5 5 0 0 1 5 0");
    expect(segmentsToPath([makeArc({ x: 0, y: 0 }, 5, 0, 270)])).toContain("A 5 5 0 1 0");
    expect(segmentsToPath([{ kind: "circle", center: { x: 1, y: 2 }, radius: 3 }])).toBe("M 4 -2 A 3 3 0 1 0 -2 -2 A 3 3 0 1 0 4 -2 Z");
    expect(viewBoxFor(makeBbox(0, 0, 100, 50), 5)).toBe("-5 -55 110 60");
  });

  it("renders a thumbnail with one path per entity, coloured by role", () => {
    const text = fs.readFileSync("test/fixtures/200164.dxf").toString("latin1");
    const g = analyzeDxfSync(text);
    const svg = geometryToSvg(g, null, { width: 400, height: 120, theme: "light" });
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect((svg.match(/<path /g) ?? []).length).toBe(42);
    expect((svg.match(/class="geo-hole"/g) ?? []).length).toBe(32);
    expect((svg.match(/class="geo-cut"/g) ?? []).length).toBe(6);
    expect((svg.match(/class="geo-bend_up"/g) ?? []).length).toBe(1);
    expect((svg.match(/class="geo-bend_down"/g) ?? []).length).toBe(3);
    expect(svg).toContain('stroke="#e00000"');
    expect(svg).toContain('stroke="#ff1a1a" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="6 3"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain("data-entity-id=");
    const dark = geometryToSvg(g, null, { theme: "dark" });
    expect(dark).toContain('fill="#111111"');
    expect(dark).toContain('stroke="#ffffff"');
  });

  it("draws annotation bends/welds and ignored entities faintly", () => {
    const g = analyzeDxfSync(buildDxf({ entities: [...rectLines(0, 0, 100, 50), circle(50, 25, 5), line(20, 0, 20, 50)] }));
    const [candidate] = g.triage.candidateEntityIds;
    const svg = geometryToSvg(g, {
      ...EMPTY_ANNOTATIONS,
      bends: [{ id: "b", entityId: null, start: { x: 0, y: 30 }, end: { x: 100, y: 30 }, lengthMm: 100, angleDeg: 90, radiusMm: null, direction: "down", dieVMm: null }],
      welds: [{ id: "w", entityIds: [], points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], lengthMm: 100, process: "mig_mag", beadMm: 4, pattern: "full", stitch: null, sides: 1, effectiveLengthMm: 100 }],
    });
    expect((svg.match(/<path /g) ?? []).length).toBe(6 + 2);
    expect(svg).toContain('class="geo-unknown"');
    expect(svg).toContain('class="geo-bend_down geo-drawn"');
    expect(svg).toContain('class="geo-weld geo-drawn"');
    expect(svg).toContain('stroke="#ffd400"');
    const ignored = geometryToSvg({ ...g, entities: g.entities.map((e) => (e.id === candidate ? { ...e, role: "ignore" } : e)) });
    expect(ignored).toContain('opacity="0.25"');
  });

  it("does not crash on empty geometry", () => {
    const g = analyzeDxfSync("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n");
    const svg = geometryToSvg(g);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox=");
  });
});
