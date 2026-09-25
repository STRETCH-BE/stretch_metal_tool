/**
 * Customer fixtures — the numbers from the build prompt (Step 6).
 * File path: /test/geometry/fixtures.test.ts
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzeDxfSync, geometryEngine, decodeDxfBytes } from "@/lib/geometry";

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), "test/fixtures", name));
const LEN = 0.2;
const MASS = 0.005;

describe("200005.dxf (15 mm S355 plate)", () => {
  const text = fixture("200005.dxf").toString("latin1");
  const pdfText = fixture("200005.pdf.txt").toString("utf8");
  const g = analyzeDxfSync(text, { thicknessMm: 15, densityKgM3: 7850, name: "200005", pdfText });
  const m = g.measures;

  it("reads the header", () => {
    expect(g.header.version).toBe("AC1018");
    expect(g.header.units).toEqual({ insunits: 4, detected: "mm", scaleApplied: 1 });
    expect(g.header.extmin).toEqual({ x: 0, y: 0 });
    expect(g.header.extmax?.x).toBeCloseTo(502.071, 2);
    expect(g.header.extmax?.y).toBeCloseTo(220, 6);
    expect(g.header.layers).toEqual(
      expect.arrayContaining(["IV_OUTER_PROFILE", "IV_INTERIOR_PROFILES", "IV_FEATURE_PROFILES_DOWN", "IV_ARC_CENTERS"])
    );
  });

  it("keeps only the cut layers and drops the rest with reasons", () => {
    expect(g.entities).toHaveLength(49);
    expect(g.entities.filter((e) => e.layer === "IV_OUTER_PROFILE")).toHaveLength(24);
    expect(g.entities.filter((e) => e.originalType === "ARC")).toHaveLength(8);
    expect(g.entities.filter((e) => e.originalType === "CIRCLE")).toHaveLength(25);
    const dropped = Object.fromEntries(g.dropped.map((d) => [`${d.type}/${d.layer}/${d.reason}`, d.count]));
    expect(dropped).toEqual({
      "POINT/IV_ARC_CENTERS/not_geometry": 47,
      "LINE/IV_FEATURE_PROFILES_DOWN/ignored_layer": 12,
      "ARC/IV_FEATURE_PROFILES_DOWN/ignored_layer": 12,
      "CIRCLE/IV_FEATURE_PROFILES_DOWN/ignored_layer": 2,
    });
  });

  it("finds one outer loop and 25 holes", () => {
    expect(g.partCount).toBe(1);
    expect(g.loops.filter((l) => l.kind === "outer")).toHaveLength(1);
    expect(g.loops.filter((l) => l.kind === "hole")).toHaveLength(25);
    expect(g.loops.filter((l) => l.kind === "open_chain")).toHaveLength(0);
    expect(g.outerLoopId).toBe(g.loops.find((l) => l.kind === "outer")?.id);
    const outer = g.loops.find((l) => l.id === g.outerLoopId)!;
    expect(outer.entityIds).toHaveLength(24);
    expect(outer.closed).toBe(true);
  });

  it("measures the part", () => {
    expect(m.bbox.minX).toBeCloseTo(-42, 2);
    expect(m.bbox.maxX).toBeCloseTo(458, 2);
    expect(m.bbox.minY).toBeCloseTo(0, 2);
    expect(m.bbox.maxY).toBeCloseTo(220, 2);
    expect(Math.abs(m.bbox.width - 500)).toBeLessThan(LEN);
    expect(Math.abs(m.bbox.height - 220)).toBeLessThan(LEN);
    expect(Math.abs(m.outerLengthMm - 1418.1)).toBeLessThan(LEN);
    expect(Math.abs(m.holesLengthMm - 806.4)).toBeLessThan(LEN);
    expect(Math.abs(m.cutLengthMm - 2224.5)).toBeLessThan(LEN);
    expect(m.pierces).toBe(26);
    expect(Math.abs(m.netAreaMm2 - 101824.9)).toBeLessThan(1);
    expect(Math.abs((m.massKg ?? 0) - 11.99)).toBeLessThan(MASS);
    expect(m.blank).toEqual({ lengthMm: expect.closeTo(520, 2), widthMm: expect.closeTo(240, 2), marginMm: 10 });
    expect(m.bendLines).toHaveLength(0);
    expect(m.engraveLengthMm).toBe(0);
  });

  it("lists the holes with diameters and thread suggestions", () => {
    const byDiameter = new Map<number, number>();
    for (const h of m.holes) {
      const d = Math.round(h.diameterMm * 1000) / 1000;
      byDiameter.set(d, (byDiameter.get(d) ?? 0) + 1);
      expect(h.circular).toBe(true);
    }
    expect(byDiameter.get(6.647)).toBe(8);
    expect(byDiameter.get(8.917)).toBe(6);
    expect(byDiameter.get(10)).toBe(4);
    expect(byDiameter.get(13)).toBe(6);
    expect(byDiameter.get(32)).toBe(1);
    const threads = m.holes.map((h) => h.thread?.size ?? null);
    expect(threads.filter((t) => t === "M8")).toHaveLength(8);
    expect(threads.filter((t) => t === "M10x1")).toHaveLength(6);
    expect(threads.filter((t) => t === null)).toHaveLength(11);
    expect(m.holes.find((h) => h.thread?.size === "M8")?.thread?.matchedBy).toBe("minor_diameter");
    expect(m.smallestContourMm).toBeCloseTo(6.647, 2);
    // 15 mm plate: everything under 150 mm is a slow contour.
    expect(m.slowContours).toHaveLength(25);
  });

  it("is green with no healing needed and tolerates the origin-based extents", () => {
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toEqual(["no_interior_open_lines"]);
    expect(g.triage.candidateEntityIds).toEqual([]);
    expect(g.healing).toEqual({
      toleranceMm: 0.01,
      gapsJoined: 0,
      duplicatesRemoved: 0,
      overlapsRemoved: 0,
      zeroLengthRemoved: 0,
      splinesFlattened: 0,
      ellipsesFlattened: 0,
      blocksExploded: 0,
      loopsClosed: 0,
    });
  });

  it("is deterministic and re-attachable by id", () => {
    const again = analyzeDxfSync(text, { thicknessMm: 15, densityKgM3: 7850 });
    expect(again.entities.map((e) => e.id)).toEqual(g.entities.map((e) => e.id));
    expect(again.loops.map((l) => l.id)).toEqual(g.loops.map((l) => l.id));
    expect(new Set(g.entities.map((e) => e.id)).size).toBe(g.entities.length);
    expect(JSON.stringify(again)).toBe(JSON.stringify(g));
  });

  it("does not choke on the cp1250 byte when decoded as utf-8 either", async () => {
    const utf = decodeDxfBytes(new Uint8Array(fixture("200005.dxf")));
    const g2 = await geometryEngine.analyzeDxf(utf, { thicknessMm: 15, densityKgM3: 7850 });
    expect(g2.measures.cutLengthMm).toBeCloseTo(m.cutLengthMm, 6);
    expect(g2.triage.state).toBe("green");
  });
});

describe("200164.dxf (2 mm DC01 bracket)", () => {
  const text = fixture("200164.dxf").toString("latin1");
  const pdfText = fixture("200164.pdf.txt").toString("utf8");
  const g = analyzeDxfSync(text, { thicknessMm: 2, densityKgM3: 7850, name: "200164", pdfText });
  const m = g.measures;

  it("keeps the bend layers and drops tangents and points", () => {
    expect(g.entities).toHaveLength(42);
    const dropped = Object.fromEntries(g.dropped.map((d) => [`${d.type}/${d.layer}/${d.reason}`, d.count]));
    expect(dropped).toEqual({
      "POINT/IV_ARC_CENTERS/not_geometry": 34,
      "LINE/IV_TANGENT/ignored_layer": 8,
    });
  });

  it("measures the part", () => {
    expect(m.bbox.minX).toBeCloseTo(-338.907, 2);
    expect(m.bbox.maxX).toBeCloseTo(215.397, 2);
    expect(m.bbox.minY).toBeCloseTo(-60, 2);
    expect(m.bbox.maxY).toBeCloseTo(0, 2);
    expect(Math.abs(m.bbox.width - 554.3)).toBeLessThan(LEN);
    expect(Math.abs(m.bbox.height - 60)).toBeLessThan(LEN);
    expect(Math.abs(m.outerLengthMm - 1224.3)).toBeLessThan(LEN);
    expect(Math.abs(m.holesLengthMm - 571.8)).toBeLessThan(LEN);
    expect(Math.abs(m.cutLengthMm - 1796.1)).toBeLessThan(LEN);
    expect(m.pierces).toBe(33);
    expect(Math.abs(m.netAreaMm2 - 32421.3)).toBeLessThan(1);
    expect(Math.abs((m.massKg ?? 0) - 0.509)).toBeLessThan(MASS);
    expect(m.holes).toHaveLength(32);
    expect(m.holes.filter((h) => Math.abs(h.diameterMm - 5.5) < 0.01)).toHaveLength(30);
    expect(m.holes.filter((h) => Math.abs(h.diameterMm - 8.5) < 0.01)).toHaveLength(2);
  });

  it("finds 4 bend lines of 60 mm with the right directions and positions", () => {
    expect(m.bendLines).toHaveLength(4);
    for (const b of m.bendLines) {
      expect(Math.abs(b.lengthMm - 60)).toBeLessThan(LEN);
      expect(b.source).toBe("layer");
      expect(b.entityId).not.toBeNull();
    }
    const up = m.bendLines.filter((b) => b.direction === "up");
    const down = m.bendLines.filter((b) => b.direction === "down");
    expect(up).toHaveLength(1);
    expect(down).toHaveLength(3);
    expect(up[0].layer).toBe("IV_BEND");
    expect(up[0].start.x).toBeCloseTo(156.926, 2);
    const xs = down.map((b) => Math.round(b.start.x * 1000) / 1000).sort((a, b) => a - b);
    expect(xs).toEqual([-1.131, 39.355, 98.356]);
    expect(down.every((b) => b.layer === "IV_BEND_DOWN")).toBe(true);
    // Bend entities carry their role and sit in open chains inside the part.
    const bendLoops = g.loops.filter((l) => l.kind === "open_chain");
    expect(bendLoops).toHaveLength(4);
    expect(bendLoops.every((l) => l.partIndex === 0)).toBe(true);
    expect(g.entities.filter((e) => e.role === "bend_up")).toHaveLength(1);
    expect(g.entities.filter((e) => e.role === "bend_down")).toHaveLength(3);
  });

  it("is green because of the named bend layers", () => {
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toEqual(["bend_layers_found"]);
    expect(g.triage.details.bendLines).toBe(4);
    expect(g.healing.gapsJoined).toBe(0);
    expect(g.healing.duplicatesRemoved).toBe(0);
  });
});
