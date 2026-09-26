/**
 * Base geometry + re-analysis (lib/parts/reanalyse.ts): the SHA-256
 * cache short-circuits the file parse, annotations are re-applied on the
 * base, synthetic parts use the stored geometry with scale neutralised.
 * File path: /test/intake/reanalyse.test.ts
 */
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { analyzeDxfSync, applyAnnotationsSync, geometryToSvg, quickPart } from "@/lib/geometry";
import { EMPTY_ANNOTATIONS, type PartGeometry } from "@/lib/geometry/types";
import { baseGeometryFor, isBaseEquivalent, reanalysePart, type ReanalyseDeps, type ReanalysePart } from "@/lib/parts/reanalyse";

const DXF = new Uint8Array(fs.readFileSync("test/fixtures/200164.dxf"));

function deps(cached: PartGeometry | null): ReanalyseDeps & { download: ReturnType<typeof vi.fn>; findCachedGeometry: ReturnType<typeof vi.fn> } {
  return {
    analyse: async (text, options) => analyzeDxfSync(text, options),
    applyAnnotations: async (geometry, annotations, options) => applyAnnotationsSync(geometry, annotations, options),
    toSvg: (geometry, annotations, size) => geometryToSvg(geometry, annotations, { ...size, theme: "light" }),
    download: vi.fn(async () => DXF),
    findCachedGeometry: vi.fn(async () => cached),
  };
}

const dxfPart: ReanalysePart = {
  id: "p1",
  source: "dxf",
  name: "200164",
  storagePath: "quotes/q/f/200164.dxf",
  fileHash: "hash",
  geometry: null,
  annotations: EMPTY_ANNOTATIONS,
  pdfText: null,
  thicknessMm: 2,
  densityKgM3: 7850,
};

describe("isBaseEquivalent", () => {
  it("is true without scale / mirror / deletions", () => {
    expect(isBaseEquivalent(EMPTY_ANNOTATIONS)).toBe(true);
    expect(isBaseEquivalent({ ...EMPTY_ANNOTATIONS, threads: { a: "M8" }, bends: [] })).toBe(true);
    expect(isBaseEquivalent({ ...EMPTY_ANNOTATIONS, mirrored: true })).toBe(false);
    expect(isBaseEquivalent({ ...EMPTY_ANNOTATIONS, deletedEntityIds: ["x"] })).toBe(false);
    expect(isBaseEquivalent({ ...EMPTY_ANNOTATIONS, scale: { factor: 2, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, measuredMm: 1, realMm: 2 } })).toBe(false);
  });
});

describe("baseGeometryFor / reanalysePart", () => {
  it("re-parses the stored file when nothing is cached and applies the annotations", async () => {
    const d = deps(null);
    const result = await reanalysePart(dxfPart, { ...EMPTY_ANNOTATIONS, forming: "bent" }, { toleranceMm: 0.01, blankMarginMm: 10 }, d);
    expect(d.download).toHaveBeenCalledWith("quotes/q/f/200164.dxf");
    expect(result.fromCache).toBe(false);
    expect(result.geometry.measures.bendLines).toHaveLength(4);
    expect(result.geometry.measures.massKg).toBeCloseTo(0.509, 2);
    expect(result.geometry.healing.toleranceMm).toBe(0.01);
    expect(result.thumbnailSvg).toContain("<svg");
    expect(result.annotations.forming).toBe("bent");
  });

  it("copies a cached base geometry instead of downloading", async () => {
    const cached = analyzeDxfSync(new TextDecoder().decode(DXF), { toleranceMm: 0.05 });
    const d = deps(cached);
    const base = await baseGeometryFor(dxfPart, { toleranceMm: 0.05, blankMarginMm: 10 }, d);
    expect(base.fromCache).toBe(true);
    expect(d.download).not.toHaveBeenCalled();
    expect(d.findCachedGeometry).toHaveBeenCalledWith("hash", 0.05, "p1");
    const result = await reanalysePart(dxfPart, EMPTY_ANNOTATIONS, { toleranceMm: 0.05, blankMarginMm: 10 }, d);
    expect(result.fromCache).toBe(true);
    expect(result.geometry.material.thicknessMm).toBe(2);
    expect(result.geometry.measures.massKg).not.toBeNull();
  });

  it("uses the stored geometry as base for manual parts and neutralises scale / mirror", async () => {
    const manual = quickPart({ name: "q", lengthMm: 100, widthMm: 50, thicknessMm: 2, densityKgM3: 7850, holes: [], bends: [{ lengthMm: 50, angleDeg: 90, count: 1 }], roll: null });
    const part: ReanalysePart = { ...dxfPart, id: "m1", source: "manual", storagePath: null, fileHash: null, geometry: manual.geometry, annotations: manual.annotations };
    const d = deps(null);
    const scaled = { ...manual.annotations, scale: { factor: 2, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, measuredMm: 1, realMm: 2 }, mirrored: true };
    const base = await baseGeometryFor({ ...part, annotations: scaled }, { toleranceMm: 0.01, blankMarginMm: 10 }, d);
    expect(base.geometry).toBe(manual.geometry);
    expect(base.annotations.scale).toBeNull();
    expect(base.annotations.mirrored).toBe(false);
    expect(d.download).not.toHaveBeenCalled();
    const result = await reanalysePart(part, manual.annotations, { toleranceMm: 0.01, blankMarginMm: 10 }, d);
    expect(result.geometry.measures.bbox.width).toBeCloseTo(100, 3);
    expect(result.geometry.measures.bendLines).toHaveLength(1);
  });

  it("throws for a part with neither a file nor geometry", async () => {
    await expect(baseGeometryFor({ ...dxfPart, source: "step", storagePath: null }, { toleranceMm: 0.01, blankMarginMm: 10 }, deps(null))).rejects.toThrow(/no geometry/);
  });
});
