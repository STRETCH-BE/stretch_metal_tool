/**
 * Unit tests for the press-brake vector math.
 * File path: /lib/pricing/bend-checks.test.ts
 */

import { describe, expect, it } from "vitest";
import { areParallel, flangeLengthsMm, holeEdgeToBendMm, spansOverlap } from "./bend-checks";

const vertical = { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };

describe("holeEdgeToBendMm", () => {
  it("positive distance from the hole edge on either side of the line", () => {
    expect(holeEdgeToBendMm(vertical, { x: 15, y: 50 }, 5)).toBeCloseTo(10, 12);
    expect(holeEdgeToBendMm(vertical, { x: -15, y: 50 }, 5)).toBeCloseTo(10, 12);
  });
  it("negative when the hole crosses the line, zero when tangent", () => {
    expect(holeEdgeToBendMm(vertical, { x: 3, y: 50 }, 5)).toBeCloseTo(-2, 12);
    expect(holeEdgeToBendMm(vertical, { x: 5, y: 50 }, 5)).toBeCloseTo(0, 12);
  });
  it("null when the perpendicular foot lies beyond the segment span ± radius", () => {
    expect(holeEdgeToBendMm(vertical, { x: 15, y: 150 }, 5)).toBeNull();
    expect(holeEdgeToBendMm(vertical, { x: 15, y: -6 }, 5)).toBeNull();
    expect(holeEdgeToBendMm(vertical, { x: 15, y: 103 }, 5)).toBeCloseTo(10, 12);
    expect(holeEdgeToBendMm(vertical, { x: 15, y: -4 }, 5)).toBeCloseTo(10, 12);
  });
  it("null for a zero-length bend", () => {
    expect(holeEdgeToBendMm({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }, { x: 0, y: 0 }, 1)).toBeNull();
  });
  it("works for a diagonal bend", () => {
    const diag = { start: { x: 0, y: 0 }, end: { x: 100, y: 100 } };
    // centre (0, 20): perpendicular distance to y = x is 20/√2
    expect(holeEdgeToBendMm(diag, { x: 0, y: 20 }, 2)).toBeCloseTo(20 / Math.SQRT2 - 2, 9);
  });
});

describe("areParallel / spansOverlap", () => {
  it("parallel within 1°, not for perpendicular lines", () => {
    expect(areParallel(vertical, { start: { x: 10, y: 0 }, end: { x: 10, y: 100 } })).toBe(true);
    expect(areParallel(vertical, { start: { x: 10, y: 100 }, end: { x: 10, y: 0 } })).toBe(true);
    expect(areParallel(vertical, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } })).toBe(false);
    const halfDegree = { start: { x: 0, y: 0 }, end: { x: Math.tan((0.5 * Math.PI) / 180) * 100, y: 100 } };
    expect(areParallel(vertical, halfDegree)).toBe(true);
    const twoDegrees = { start: { x: 0, y: 0 }, end: { x: Math.tan((2 * Math.PI) / 180) * 100, y: 100 } };
    expect(areParallel(vertical, twoDegrees)).toBe(false);
  });
  it("spans overlap along the bend direction", () => {
    expect(spansOverlap(vertical, { start: { x: 10, y: 50 }, end: { x: 10, y: 150 } })).toBe(true);
    expect(spansOverlap(vertical, { start: { x: 10, y: 200 }, end: { x: 10, y: 300 } })).toBe(false);
    expect(spansOverlap(vertical, { start: { x: 10, y: 100 }, end: { x: 10, y: 200 } })).toBe(false);
  });
});

describe("flangeLengthsMm", () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];
  it("outline extents on each side of the bend line", () => {
    const bend = { start: { x: 30, y: 0 }, end: { x: 30, y: 50 } };
    const f = flangeLengthsMm(bend, rect);
    expect(f?.positive).toBeCloseTo(30, 12);
    expect(f?.negative).toBeCloseTo(70, 12);
    expect(f?.smaller).toBeCloseTo(30, 12);
    expect(f?.boundedByBend).toBe(false);
  });
  it("a neighbouring parallel bend bounds the flange", () => {
    const bend = { start: { x: 30, y: 0 }, end: { x: 30, y: 50 } };
    const other = { start: { x: 40, y: 0 }, end: { x: 40, y: 50 } };
    const f = flangeLengthsMm(bend, rect, [other, bend]);
    expect(f?.negative).toBeCloseTo(10, 12);
    expect(f?.positive).toBeCloseTo(30, 12);
    expect(f?.smaller).toBeCloseTo(10, 12);
    expect(f?.boundedByBend).toBe(true);
  });
  it("a parallel bend on another tab (no span overlap) does not bound the flange", () => {
    const bend = { start: { x: 30, y: 0 }, end: { x: 30, y: 20 } };
    const other = { start: { x: 40, y: 30 }, end: { x: 40, y: 50 } };
    expect(flangeLengthsMm(bend, rect, [other])?.negative).toBeCloseTo(70, 12);
  });
  it("null without an outline or for a zero-length bend", () => {
    expect(flangeLengthsMm(vertical, [])).toBeNull();
    expect(flangeLengthsMm({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }, rect)).toBeNull();
  });
});
