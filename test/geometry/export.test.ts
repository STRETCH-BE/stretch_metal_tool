/**
 * Annotated DXF export — round trip through the parser.
 * File path: /test/geometry/export.test.ts
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { analyzeDxfSync, EMPTY_ANNOTATIONS, exportAnnotatedDxf, geometryEngine, parseDxf } from "@/lib/geometry";
import { buildDxf, circle, line, rectLines } from "./dxf-builder";

describe("exportAnnotatedDxf", () => {
  it("round-trips 200164 (cut length, holes, bends)", async () => {
    const text = fs.readFileSync("test/fixtures/200164.dxf").toString("latin1");
    const g = analyzeDxfSync(text, { thicknessMm: 2, densityKgM3: 7850 });
    const dxf = await geometryEngine.exportAnnotatedDxf(g, EMPTY_ANNOTATIONS);
    expect(dxf.startsWith("  0\r\nSECTION\r\n  2\r\nHEADER")).toBe(true);
    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toContain("$EXTMIN");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    for (const l of ["CUT", "HOLES", "BEND_UP", "BEND_DOWN", "WELD", "ENGRAVE", "IGNORE"]) expect(dxf).toContain(`\r\n${l}\r\n`);
    const back = analyzeDxfSync(dxf, { thicknessMm: 2, densityKgM3: 7850 });
    expect(back.header.units.detected).toBe("mm");
    expect(back.header.layers).toEqual(expect.arrayContaining(["CUT", "HOLES", "BEND_UP", "BEND_DOWN"]));
    expect(Math.abs(back.measures.cutLengthMm - g.measures.cutLengthMm)).toBeLessThan(0.2);
    expect(back.measures.holes).toHaveLength(32);
    expect(back.measures.bendLines).toHaveLength(4);
    expect(back.measures.bendLines.filter((b) => b.direction === "down")).toHaveLength(3);
    expect(back.triage.state).toBe("green");
    expect(back.measures.massKg).toBeCloseTo(g.measures.massKg ?? 0, 3);
    expect(back.entities.filter((e) => e.layer === "HOLES")).toHaveLength(32);
    expect(back.entities.filter((e) => e.layer === "CUT")).toHaveLength(6);
  });

  it("writes annotations: tagged roles, drawn bends, point welds, deletions", () => {
    const g = analyzeDxfSync(buildDxf({ entities: [...rectLines(0, 0, 100, 50), circle(20, 25, 5), circle(80, 25, 5), line(50, 0, 50, 50), line(10, 10, 10, 40, "ENGRAVE")] }));
    const [candidate] = g.triage.candidateEntityIds;
    const hole = g.measures.holes[0];
    const dxf = exportAnnotatedDxf(g, {
      ...EMPTY_ANNOTATIONS,
      entities: { [candidate]: { role: "bend_up" } },
      deletedEntityIds: [hole.loopId],
      bends: [{ id: "b1", entityId: null, start: { x: 0, y: 40 }, end: { x: 100, y: 40 }, lengthMm: 100, angleDeg: 90, radiusMm: null, direction: "down", dieVMm: null }],
      welds: [{ id: "w1", entityIds: [], points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMm: 100, process: "tig", beadMm: 3, pattern: "full", stitch: null, sides: 1, effectiveLengthMm: 100 }],
    });
    const parsed = parseDxf(dxf);
    const byLayer = (l: string) => parsed.entities.filter((e) => e.layer === l);
    expect(byLayer("CUT")).toHaveLength(4);
    expect(byLayer("HOLES")).toHaveLength(1);
    expect(byLayer("BEND_UP")).toHaveLength(1);
    expect(byLayer("BEND_DOWN")).toHaveLength(1);
    expect(byLayer("WELD")).toHaveLength(1);
    expect(byLayer("ENGRAVE")).toHaveLength(1);
    const back = analyzeDxfSync(dxf);
    expect(back.triage.state).toBe("green");
    expect(back.measures.pierces).toBe(2);
    expect(back.measures.bendLines).toHaveLength(2);
    expect(back.measures.engraveLengthMm).toBeCloseTo(30, 6);
  });

  it("writes arcs and circles as ARC/CIRCLE with degree angles", () => {
    const g = analyzeDxfSync(buildDxf({ entities: [{ type: "LWPOLYLINE", vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 1 }], closed: true }, ...rectLines(-20, -20, 50, 50)] }));
    const dxf = exportAnnotatedDxf(g, EMPTY_ANNOTATIONS);
    expect((dxf.match(/\r\nARC\r\n/g) ?? []).length).toBe(2);
    const back = analyzeDxfSync(dxf);
    expect(back.measures.holesLengthMm).toBeCloseTo(Math.PI * 10, 4);
    expect(back.measures.holes[0].circular).toBe(true);
  });
});
