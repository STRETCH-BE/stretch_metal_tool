/**
 * Quick part — manual entry builds a full PartGeometry.
 * File path: /test/geometry/quick-part.test.ts
 */
import { describe, expect, it } from "vitest";
import { geometryEngine, quickPart } from "@/lib/geometry";

describe("quickPart", () => {
  const input = {
    name: "bracket",
    lengthMm: 200,
    widthMm: 100,
    thicknessMm: 3,
    densityKgM3: 7850,
    holes: [{ diameterMm: 6.647, count: 4 }, { diameterMm: 10, count: 1 }],
    bends: [{ lengthMm: 200, angleDeg: 90, count: 2 }],
    roll: null,
  };

  it("builds outline, holes, bends and measures", async () => {
    const { geometry: g, annotations } = quickPart(input);
    expect(g.source).toBe("manual");
    expect(g.version).toBe(1);
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toEqual(["no_interior_open_lines"]);
    expect(g.partCount).toBe(1);
    expect(g.measures.bbox).toMatchObject({ minX: 0, minY: 0, maxX: 200, maxY: 100, width: 200, height: 100 });
    expect(g.measures.pierces).toBe(6);
    expect(g.measures.cutLengthMm).toBeCloseTo(600 + 4 * Math.PI * 6.647 + Math.PI * 10, 6);
    const holeArea = 4 * Math.PI * 3.3235 ** 2 + Math.PI * 25;
    expect(g.measures.netAreaMm2).toBeCloseTo(20000 - holeArea, 6);
    expect(g.measures.massKg).toBeCloseTo(((20000 - holeArea) * 3 * 7850) / 1e9, 9);
    expect(g.measures.holes.filter((h) => h.thread?.size === "M8")).toHaveLength(4);
    expect(g.measures.holes.every((h) => h.circular)).toBe(true);
    // holes never cross the edge
    for (const h of g.measures.holes) {
      expect(h.center.x - h.diameterMm / 2).toBeGreaterThan(0);
      expect(h.center.x + h.diameterMm / 2).toBeLessThan(200);
      expect(h.center.y - h.diameterMm / 2).toBeGreaterThan(0);
      expect(h.center.y + h.diameterMm / 2).toBeLessThan(100);
    }
    expect(g.measures.bendLines).toHaveLength(2);
    expect(g.measures.bendLines.every((b) => b.direction === "up" && b.source === "drawn" && Math.abs(b.lengthMm - 200) < 1e-9)).toBe(true);
    expect(annotations.bends).toHaveLength(2);
    expect(annotations.bends.every((b) => b.angleDeg === 90 && b.direction === "up")).toBe(true);
    expect(annotations.forming).toBe("bent");
    expect(annotations.roll).toBeNull();
    expect(g.header.units.detected).toBe("mm");
    expect(g.entities.filter((e) => e.originalType === "MANUAL")).toHaveLength(9);
    const viaEngine = await geometryEngine.quickPart(input);
    expect(viaEngine.measures.cutLengthMm).toBeCloseTo(g.measures.cutLengthMm, 9);
  });

  it("handles no holes, no density, and a roll", () => {
    const { geometry: g, annotations } = quickPart({
      name: "tube segment",
      lengthMm: 300,
      widthMm: 157.08,
      thicknessMm: 2,
      densityKgM3: null,
      holes: [],
      bends: [],
      roll: { radiusMm: 50, axisLengthMm: 300 },
    });
    expect(g.measures.pierces).toBe(1);
    expect(g.measures.massKg).toBeNull();
    expect(g.measures.bendLines).toHaveLength(0);
    expect(annotations.roll).toMatchObject({ radiusMm: 50, axis: "x", axisLengthMm: 300, developedWidthMm: 157.08 });
    expect(annotations.roll?.arcAngleDeg).toBeCloseTo(180, 1);
    expect(annotations.forming).toBe("rolled");
    expect(g.triage.state).toBe("green");
  });

  it("lays out many holes without collapsing duplicates", () => {
    const { geometry: g } = quickPart({ name: "grid", lengthMm: 100, widthMm: 100, thicknessMm: 1, densityKgM3: 2700, holes: [{ diameterMm: 4, count: 20 }], bends: [], roll: null });
    expect(g.measures.pierces).toBe(21);
    expect(g.healing.duplicatesRemoved).toBe(0);
  });
});
