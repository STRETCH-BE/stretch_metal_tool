/**
 * Geometry engine — ISO metric thread suggestion from a hole diameter.
 * File path: /lib/geometry/threads.ts
 *
 * Inventor models a tapped hole at the ISO minor diameter
 * D1 = d − 1.0825·P; customers who model drilled holes use the tap-drill
 * size. A hole matches when its diameter is within ±0.05 mm of either
 * value (build prompt Step 6.8); the closer match wins, minor diameter
 * on a tie. Values are geometry facts, not rates — the pricing engine
 * decides what a thread costs.
 */

import type { ThreadSuggestion } from "./types";

export type ThreadTableEntry = {
  size: string;
  pitchMm: number;
  minorDiameterMm: number;
  tapDrillMm: number;
};

export const THREAD_MATCH_TOLERANCE_MM = 0.05;

export const THREAD_TABLE: ThreadTableEntry[] = [
  { size: "M3", pitchMm: 0.5, minorDiameterMm: 2.459, tapDrillMm: 2.5 },
  { size: "M4", pitchMm: 0.7, minorDiameterMm: 3.242, tapDrillMm: 3.3 },
  { size: "M5", pitchMm: 0.8, minorDiameterMm: 4.134, tapDrillMm: 4.2 },
  { size: "M6", pitchMm: 1.0, minorDiameterMm: 4.917, tapDrillMm: 5.0 },
  { size: "M8", pitchMm: 1.25, minorDiameterMm: 6.647, tapDrillMm: 6.8 },
  { size: "M10", pitchMm: 1.5, minorDiameterMm: 8.376, tapDrillMm: 8.5 },
  { size: "M10x1", pitchMm: 1.0, minorDiameterMm: 8.917, tapDrillMm: 9.0 },
  { size: "M12", pitchMm: 1.75, minorDiameterMm: 10.106, tapDrillMm: 10.2 },
  { size: "M12x1.5", pitchMm: 1.5, minorDiameterMm: 10.376, tapDrillMm: 10.5 },
  { size: "M16", pitchMm: 2.0, minorDiameterMm: 13.835, tapDrillMm: 14.0 },
  { size: "M20", pitchMm: 2.5, minorDiameterMm: 17.294, tapDrillMm: 17.5 },
];

export function threadBySize(size: string): ThreadTableEntry | null {
  const key = size.trim().toUpperCase().replace("×", "X").replace(/\s+/g, "");
  return THREAD_TABLE.find((t) => t.size.toUpperCase() === key) ?? null;
}

/** Best thread match for a hole diameter, or null when nothing is within tolerance. */
export function suggestThread(
  diameterMm: number,
  tolerance = THREAD_MATCH_TOLERANCE_MM
): ThreadSuggestion | null {
  let best: ThreadSuggestion | null = null;
  for (const t of THREAD_TABLE) {
    const candidates: { by: ThreadSuggestion["matchedBy"]; dev: number }[] = [
      { by: "minor_diameter", dev: Math.abs(diameterMm - t.minorDiameterMm) },
      { by: "tap_drill", dev: Math.abs(diameterMm - t.tapDrillMm) },
    ];
    for (const c of candidates) {
      if (c.dev > tolerance + 1e-9) continue;
      if (
        best === null ||
        c.dev < best.deviationMm - 1e-12 ||
        (Math.abs(c.dev - best.deviationMm) <= 1e-12 && c.by === "minor_diameter" && best.matchedBy === "tap_drill")
      ) {
        best = {
          size: t.size,
          pitchMm: t.pitchMm,
          minorDiameterMm: t.minorDiameterMm,
          tapDrillMm: t.tapDrillMm,
          matchedBy: c.by,
          deviationMm: c.dev,
        };
      }
    }
  }
  return best;
}

/** Suggestion for a user-confirmed size (deviation measured against D1). */
export function threadForSize(size: string, diameterMm: number): ThreadSuggestion | null {
  const t = threadBySize(size);
  if (!t) return null;
  const devMinor = Math.abs(diameterMm - t.minorDiameterMm);
  const devTap = Math.abs(diameterMm - t.tapDrillMm);
  const byTap = devTap < devMinor;
  return {
    size: t.size,
    pitchMm: t.pitchMm,
    minorDiameterMm: t.minorDiameterMm,
    tapDrillMm: t.tapDrillMm,
    matchedBy: byTap ? "tap_drill" : "minor_diameter",
    deviationMm: byTap ? devTap : devMinor,
  };
}
