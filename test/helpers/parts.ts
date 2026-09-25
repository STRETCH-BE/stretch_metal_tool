/**
 * Test fixture — synthetic parts shaped like the two customer DXFs
 * (200005: 500 × 220 × 15 S355 with 25 holes; 200164: 554.3 × 60 × 2 DC01
 * with 32 holes and 4 bends), built with makeRectPartGeometry so the
 * pricing/UI tests do not need the DXF pipeline. Hole positions are
 * synthetic (a grid); counts, diameters, bend positions and directions
 * follow build prompt Step 6.
 * File path: /test/helpers/parts.ts
 */

import type { PartGeometry, ThreadSuggestion } from "@/lib/geometry/types";
import { makeRectPartGeometry, type RectHole } from "./geometry";

export const THREAD_M8: ThreadSuggestion = {
  size: "M8",
  pitchMm: 1.25,
  minorDiameterMm: 6.647,
  tapDrillMm: 6.8,
  matchedBy: "minor_diameter",
  deviationMm: 0,
};

export const THREAD_M10X1: ThreadSuggestion = {
  size: "M10x1",
  pitchMm: 1,
  minorDiameterMm: 8.917,
  tapDrillMm: 9.0,
  matchedBy: "minor_diameter",
  deviationMm: 0,
};

/** 200164-like: 554.3 × 60, t 2, 30 × Ø5.5 + 2 × Ø8.5, bends 1 up + 3 down at the Inventor x positions. */
export function make200164Like(overrides: { thicknessMm?: number | null } = {}): PartGeometry {
  const holes: RectHole[] = [];
  for (let i = 0; i < 30; i += 1) holes.push({ x: -330 + i * 10, y: -30, diameterMm: 5.5 });
  holes.push({ x: 190, y: -30, diameterMm: 8.5 }, { x: 205, y: -30, diameterMm: 8.5 });
  return makeRectPartGeometry({
    name: "200164",
    lengthMm: 554.3,
    widthMm: 60,
    thicknessMm: overrides.thicknessMm === undefined ? 2 : overrides.thicknessMm,
    densityKgM3: 7850,
    originX: -338.907,
    originY: -60,
    holes,
    bendLines: [
      { id: "bend-up-1", x1: 156.926, y1: -60, x2: 156.926, y2: 0, direction: "up" },
      { id: "bend-down-1", x1: -1.131, y1: -60, x2: -1.131, y2: 0, direction: "down" },
      { id: "bend-down-2", x1: 39.355, y1: -60, x2: 39.355, y2: 0, direction: "down" },
      { id: "bend-down-3", x1: 98.356, y1: -60, x2: 98.356, y2: 0, direction: "down" },
    ],
  });
}

/** 200005-like: 500 × 220, t 15, 8 × Ø6.647 (M8) + 6 × Ø8.917 (M10x1) + 4 × Ø10 + 6 × Ø13 + 1 × Ø32, no bends. */
export function make200005Like(overrides: { thicknessMm?: number | null } = {}): PartGeometry {
  const diameters = [
    ...Array<number>(8).fill(6.647),
    ...Array<number>(6).fill(8.917),
    ...Array<number>(4).fill(10),
    ...Array<number>(6).fill(13),
    32,
  ];
  const holes: RectHole[] = diameters.map((d, i) => ({
    x: -42 + 50 + (i % 5) * 100,
    y: 30 + Math.floor(i / 5) * 40,
    diameterMm: d,
    thread: d === 6.647 ? THREAD_M8 : d === 8.917 ? THREAD_M10X1 : null,
  }));
  return makeRectPartGeometry({
    name: "200005",
    lengthMm: 500,
    widthMm: 220,
    thicknessMm: overrides.thicknessMm === undefined ? 15 : overrides.thicknessMm,
    densityKgM3: 7850,
    originX: -42,
    originY: 0,
    holes,
  });
}
