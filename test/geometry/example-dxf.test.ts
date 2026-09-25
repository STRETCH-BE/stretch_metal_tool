/**
 * The downloadable example DXF (public/downloads) analyses green.
 * File path: /test/geometry/example-dxf.test.ts
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { analyzeDxfSync } from "@/lib/geometry";

describe("public/downloads/stretchmetal-example.dxf", () => {
  const text = fs.readFileSync("public/downloads/stretchmetal-example.dxf", "utf8");
  const g = analyzeDxfSync(text, { thicknessMm: 3, densityKgM3: 7850, name: "stretchmetal-example" });

  it("is a green 200 × 120 bracket with 2 bends and 4 M8 threads", () => {
    expect(g.header.units).toEqual({ insunits: 4, detected: "mm", scaleApplied: 1 });
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toEqual(["bend_layers_found"]);
    expect(g.measures.bbox).toMatchObject({ width: expect.closeTo(200, 9), height: expect.closeTo(120, 9) });
    expect(g.measures.bendLines).toHaveLength(2);
    expect(g.measures.bendLines.filter((b) => b.direction === "up")).toHaveLength(1);
    expect(g.measures.bendLines.filter((b) => b.direction === "down")).toHaveLength(1);
    expect(g.measures.bendLines.every((b) => Math.abs(b.lengthMm - 120) < 1e-6)).toBe(true);
    expect(g.measures.holes).toHaveLength(4);
    expect(g.measures.holes.filter((h) => h.thread?.size === "M8")).toHaveLength(4);
    expect(g.measures.pierces).toBe(5);
    expect(g.measures.outerLengthMm).toBeCloseTo(2 * (190 + 110) + 2 * Math.PI * 5, 6);
    expect(g.measures.cutLengthMm).toBeCloseTo(2 * (190 + 110) + 2 * Math.PI * 5 + 4 * Math.PI * 6.647, 6);
    expect(g.measures.engraveLengthMm).toBeCloseTo(20, 6);
    expect(g.entities.filter((e) => e.role === "weld")).toHaveLength(1);
    expect(g.measures.massKg).toBeCloseTo(((200 * 120 - (100 - 25 * Math.PI) - 4 * Math.PI * 3.3235 ** 2) * 3 * 7850) / 1e9, 4);
    expect(g.healing.gapsJoined).toBe(0);
    expect(g.dropped).toEqual([]);
  });
});
