/**
 * SST France fixtures — the three formed 2 mm enclosure parts of the
 * 28 Sep 2026 diagnosis through the STEP sheet-metal path, against the
 * values measured by hand (OCP + ezdxf) and the reference flat DXFs.
 * File path: /test/geometry/sst-fixtures.test.ts
 *
 * The files carry an SST confidentiality notice and are NOT committed:
 * drop them into test/fixtures/sst/ (3 × STEP, 3 × PDF, expected/*.dxf)
 * and the suite runs; without them every case is skipped and reported as
 * such. Tolerances: ±0.2 mm on lengths, ±0.5 % on cut length, ±0.005 kg
 * on mass (7.85 g/cm³), exact on counts. All parts DC01, t = 2, r = 1,
 * 90° bends, DIN seed allowance 2.355 mm per bend.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDxfSync } from "@/lib/geometry";
import { analyseStepSync, splitModelSync } from "@/lib/geometry/step/analyse";
import { decodeStepBytes } from "@/lib/geometry/step/part21";
import { evaluateDfmFlags } from "@/lib/pricing/dfm";
import { hardwareExtras } from "@/lib/parts/intake";
import type { PressBrakeTool } from "@/lib/pricing/types";
import type { PartGeometry } from "@/lib/geometry/types";

const DIR = path.join(process.cwd(), "test/fixtures/sst");
const DENSITY = 7850;

const FILES = {
  M040120: "M040120_G - Carrosserie de face avant L1 GM.stp",
  M040400: "M040400_F - Carrosserie d_embase L1.stp",
  M040320: "M040320_E - Carrosserie de capot L1 GM.stp",
} as const;

const PLACEHOLDER_TOOLS: PressBrakeTool[] = [
  { kind: "punch", code: "punch-straight-120", name: "", heightMm: 120, type: "straight", tipRadiusMm: 1, throatDepthMm: null, placeholder: true },
  { kind: "punch", code: "punch-straight-200", name: "", heightMm: 200, type: "straight", tipRadiusMm: 1, throatDepthMm: null, placeholder: true },
  { kind: "punch", code: "punch-gooseneck-120", name: "", heightMm: 120, type: "gooseneck", tipRadiusMm: 1, throatDepthMm: 60, placeholder: true },
  { kind: "die", code: "die-v12", name: "", vMm: 12, minFlangeMm: 9, placeholder: true },
  { kind: "die", code: "die-v16", name: "", vMm: 16, minFlangeMm: 12, placeholder: true },
];

const HARDWARE_NAMES = [
  { pattern: "ACAO470ZP", kind: "insert" as const, size: "M4", featureCode: "insert_m4" },
  { pattern: "ACAO610ZP", kind: "insert" as const, size: "M6", featureCode: "insert_m6" },
];

function present(name: string): boolean {
  return fs.existsSync(path.join(DIR, name));
}

function readText(name: string): string {
  return decodeStepBytes(new Uint8Array(fs.readFileSync(path.join(DIR, name))));
}

function drawingText(base: string): string | null {
  const txt = path.join(DIR, `${base}.pdf.txt`);
  return fs.existsSync(txt) ? fs.readFileSync(txt, "utf8") : null;
}

function analyse(key: keyof typeof FILES): PartGeometry {
  const name = FILES[key];
  const base = name.replace(/\.stp$/i, "");
  return splitModelSync(readText(name), { name: base, hardwareNames: HARDWARE_NAMES, drawingText: drawingText(base), densityKgM3: DENSITY }).parts[0].geometry;
}

function massKg(g: PartGeometry): number {
  return (g.measures.netAreaMm2 * (g.sheet?.thicknessMm ?? 2) * DENSITY) / 1e9;
}

function flagsOf(g: PartGeometry) {
  return evaluateDfmFlags({ partId: "p", itemId: "i", geometry: g, sheet: g.sheet!, thicknessMm: g.sheet!.thicknessMm, kerfMm: null, tools: PLACEHOLDER_TOOLS });
}

function dims(g: PartGeometry): [number, number] {
  return [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => b - a) as [number, number];
}

/** Loop-by-loop comparison with the hand-made reference flat: same count, centroids within 0.2 mm, areas within 0.5 %. */
function compareToReference(g: PartGeometry, referenceDxf: string): void {
  const ref = analyzeDxfSync(fs.readFileSync(path.join(DIR, "expected", referenceDxf), "utf8"), { thicknessMm: 2 });
  const closed = (x: PartGeometry) =>
    x.loops
      .filter((l) => l.closed && (l.kind === "outer" || l.kind === "hole"))
      .map((l) => ({ area: l.areaMm2, cx: (l.bbox.minX + l.bbox.maxX) / 2 - x.measures.bbox.minX, cy: (l.bbox.minY + l.bbox.maxY) / 2 - x.measures.bbox.minY }))
      .sort((a, b) => b.area - a.area || a.cx - b.cx || a.cy - b.cy);
  const ours = closed(g);
  const theirs = closed(ref);
  expect(ours).toHaveLength(theirs.length);
  // The reference may be mirrored / rotated: match on area and try the four orientations of the centroid.
  const W = g.measures.bbox.width;
  const H = g.measures.bbox.height;
  const orientations = [
    (p: { cx: number; cy: number }) => p,
    (p: { cx: number; cy: number }) => ({ cx: W - p.cx, cy: p.cy }),
    (p: { cx: number; cy: number }) => ({ cx: p.cx, cy: H - p.cy }),
    (p: { cx: number; cy: number }) => ({ cx: W - p.cx, cy: H - p.cy }),
    (p: { cx: number; cy: number }) => ({ cx: p.cy, cy: p.cx }),
    (p: { cx: number; cy: number }) => ({ cx: H - p.cy, cy: p.cx }),
    (p: { cx: number; cy: number }) => ({ cx: p.cy, cy: W - p.cx }),
    (p: { cx: number; cy: number }) => ({ cx: H - p.cy, cy: W - p.cx }),
  ];
  const fits = orientations.some((o) =>
    theirs.every((t) => ours.some((u) => Math.abs(u.area - t.area) <= Math.max(t.area, 1) * 0.005 && Math.hypot(o(u).cx - t.cx, o(u).cy - t.cy) <= 0.2))
  );
  expect(fits).toBe(true);
}

const have = (keys: (keyof typeof FILES)[]) => keys.every((k) => present(FILES[k]));

describe("SST fixtures", () => {
  it.skipIf(!have(["M040120"]))("M040120 rev G — tray with 4 flanges, 10 inserts M4, 9 weld studs, masking, no DFM flags", () => {
    const g = analyse("M040120");
    expect(g.triage.state).toBe("green");
    const s = g.sheet!;
    expect(s.isSheetMetal).toBe(true);
    expect(s.thicknessMm).toBeCloseTo(2, 2);
    expect(s.hardwareBodies).toBe(19);
    const [a, b] = dims(g);
    expect(a).toBeCloseTo(338.71, 0);
    expect(Math.abs(a - 338.71)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(b - 258.71)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(g.measures.cutLengthMm - 4919.6) / 4919.6).toBeLessThanOrEqual(0.005);
    expect(g.measures.pierces).toBe(39);
    expect(Math.abs(g.measures.netAreaMm2 - 75295)).toBeLessThanOrEqual(75295 * 0.005);
    expect(Math.abs(massKg(g) - 1.182)).toBeLessThanOrEqual(0.005);
    expect(s.solidVolumeMm3).not.toBeNull();
    expect(Math.abs((s.solidVolumeMm3! * DENSITY) / 1e9 - 1.195)).toBeLessThanOrEqual(0.005);
    expect(s.bends).toHaveLength(4);
    expect(s.bends.every((x) => x.direction === "up" && Math.abs(x.angleDeg - 90) < 0.5)).toBe(true);
    expect(s.bends.map((x) => Math.round(x.lengthMm)).sort((x, y) => x - y)).toEqual([230, 230, 310, 310]);
    expect(g.measures.holes.filter((h) => h.circular && Math.abs(h.diameterMm - 6.1) < 0.1)).toHaveLength(10);
    expect(s.studPositions).toHaveLength(9);
    expect(s.maskingZones.length).toBeGreaterThanOrEqual(2);
    const inserts = s.hardware.filter((h) => h.kind === "insert");
    expect(inserts.reduce((n, h) => n + h.qty, 0)).toBe(10);
    expect(inserts.every((h) => h.size === "M4" && h.featureCode === "insert_m4")).toBe(true);
    const studs = s.hardware.filter((h) => h.kind === "weld_stud");
    expect(studs.reduce((n, h) => n + h.qty, 0)).toBe(9);
    expect(studs.find((h) => h.size === "M3x8")?.qty).toBe(5);
    expect(studs.find((h) => h.size === "M3x15")?.qty).toBe(4);
    expect(hardwareExtras(s).map((e) => (e.type === "feature" ? `${e.code}:${e.count}` : "")).sort()).toEqual(["insert_m4:10", "stud_m3x15:4", "stud_m3x8:5"]);
    const codes = flagsOf(g).map((f) => f.code);
    expect(codes).toContain("sheet.bend_deduction_unverified");
    expect(codes).toContain("sheet.masking_not_priced");
    expect(codes.filter((c) => c.startsWith("dfm."))).toEqual([]);
    if (s.drawing) expect(s.drawing.hardwareMismatches).toEqual([]);
    if (present("expected/M040120_G_flat_2mm.dxf")) compareToReference(g, "M040120_G_flat_2mm.dxf");
  });

  it.skipIf(!have(["M040400"]))("M040400 rev F — plate with side flanges, 8 × M6 + 2 × M4 inserts, 0.1 mm reliefs, countersinks", () => {
    const g = analyse("M040400");
    expect(g.triage.state).toBe("green");
    const s = g.sheet!;
    expect(s.hardwareBodies).toBe(10);
    const [a, b] = dims(g);
    expect(Math.abs(a - 380)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(b - 270.71)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(g.measures.cutLengthMm - 1853.2) / 1853.2).toBeLessThanOrEqual(0.005);
    expect(g.measures.pierces).toBe(28);
    expect(Math.abs(massKg(g) - 1.581)).toBeLessThanOrEqual(0.005);
    expect(Math.abs((s.solidVolumeMm3! * DENSITY) / 1e9 - 1.588)).toBeLessThanOrEqual(0.005);
    expect(s.bends).toHaveLength(2);
    expect(s.bends.every((x) => x.direction === "up" && Math.abs(x.lengthMm - 344) <= 0.2)).toBe(true);
    expect(g.measures.holes.filter((h) => h.circular && Math.abs(h.diameterMm - 9.1) < 0.1)).toHaveLength(8);
    expect(g.measures.holes.filter((h) => h.circular && Math.abs(h.diameterMm - 6.1) < 0.1)).toHaveLength(2);
    expect(s.countersinks).toHaveLength(2);
    expect(s.countersinks.every((c) => Math.abs(c.throughDiameterMm - 6.1) < 0.1 && c.topDiameterMm > 6.5)).toBe(true);
    expect(s.reliefs).toHaveLength(4);
    expect(s.reliefs.every((r) => Math.abs(r.widthMm - 0.1) < 0.05 && Math.abs(r.depthMm - 3) <= 0.3)).toBe(true);
    expect(s.maskingZones.length).toBeGreaterThanOrEqual(5);
    expect(s.hardware.find((h) => h.size === "M6")?.qty).toBe(8);
    expect(s.hardware.find((h) => h.size === "M4")?.qty).toBe(2);
    const flags = flagsOf(g);
    const relief = flags.find((f) => f.code === "dfm.relief_too_narrow");
    expect(relief?.params.count).toBe(4);
    expect(relief?.locations).toHaveLength(4);
    expect(flags.find((f) => f.code === "dfm.laser_cannot_make")?.params).toMatchObject({ what: "countersink", count: 2 });
    expect(flags.map((f) => f.code)).toContain("sheet.bend_deduction_unverified");
    expect(flags.map((f) => f.code)).toContain("sheet.masking_not_priced");
    expect(hardwareExtras(s).map((e) => (e.type === "feature" ? `${e.code}:${e.count}` : "")).sort()).toEqual(["csk_m6:2", "insert_m4:2", "insert_m6:8"]);
    if (present("expected/M040400_F_flat_2mm.dxf")) compareToReference(g, "M040400_F_flat_2mm.dxf");
  });

  it.skipIf(!have(["M040320"]))("M040320 rev E — U-shaped hood, punch collision with the placeholder tooling", () => {
    const g = analyseStepSync(readText(FILES.M040320), { name: "M040320_E", densityKgM3: DENSITY });
    expect(g.triage.state).toBe("green");
    const s = g.sheet!;
    expect(s.hardwareBodies).toBe(0);
    const [a, b] = dims(g);
    expect(Math.abs(a - 874.21)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(b - 380)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(g.measures.cutLengthMm - 2860.3) / 2860.3).toBeLessThanOrEqual(0.005);
    expect(g.measures.pierces).toBe(23);
    expect(Math.abs(massKg(g) - 5.208)).toBeLessThanOrEqual(0.005);
    expect(Math.abs((s.solidVolumeMm3! * DENSITY) / 1e9 - 5.217)).toBeLessThanOrEqual(0.005);
    expect(s.bends).toHaveLength(2);
    expect(s.bends.every((x) => x.direction === "up" && Math.abs(x.lengthMm - 380) <= 0.2)).toBe(true);
    expect(g.measures.holes.filter((h) => h.circular && Math.abs(h.diameterMm - 5) < 0.1)).toHaveLength(18);
    expect(g.measures.holes.filter((h) => h.circular && Math.abs(h.diameterMm - 9) < 0.1)).toHaveLength(2);
    expect(g.measures.holes.filter((h) => h.circular && Math.abs(h.diameterMm - 2) < 0.1)).toHaveLength(2);
    expect(s.maskingZones).toHaveLength(2);
    expect(s.hardware).toEqual([]);
    const flags = flagsOf(g);
    const collision = flags.find((f) => f.code === "dfm.bend_collision");
    expect(collision).toBeDefined();
    expect(Math.abs(Number(collision?.params.widthMm) - 236.5)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(Number(collision?.params.punchMm) - 246.5)).toBeLessThanOrEqual(0.3);
    expect(flags.map((f) => f.code)).toContain("sheet.bend_deduction_unverified");
    expect(flags.map((f) => f.code)).toContain("sheet.masking_not_priced");
    if (present("expected/M040320_E_flat_2mm.dxf")) compareToReference(g, "M040320_E_flat_2mm.dxf");
  });

  it.skipIf(!have(["M040120"]))("M040120 with a 2.60 mm test-bend row: flat 259.20 × 339.20 and no deduction flag", () => {
    const table = { materialFamily: "mild_steel", rows: [{ materialFamily: "mild_steel", thicknessMm: 2, innerRadiusMm: 1, vDieMm: 16, angleDeg: 90, bendAllowanceMm: 2.6, source: "test_bend" as const }] };
    const name = FILES.M040120.replace(/\.stp$/i, "");
    const g = splitModelSync(readText(FILES.M040120), { name, hardwareNames: HARDWARE_NAMES, bendTable: table }).parts[0].geometry;
    const [a, b] = dims(g);
    expect(Math.abs(a - 339.2)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(b - 259.2)).toBeLessThanOrEqual(0.2);
    expect(flagsOf(g).some((f) => f.code === "sheet.bend_deduction_unverified")).toBe(false);
  });
});
