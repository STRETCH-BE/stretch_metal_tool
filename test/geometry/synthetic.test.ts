/**
 * Synthetic DXFs — healing, units, parts, sheets, candidates, curves, blocks.
 * File path: /test/geometry/synthetic.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyzeDxfSync, DxfFormatError, parseDxf } from "@/lib/geometry";
import { buildDxf, circle, line, rectLines, roundedRect, type EntitySpec } from "./dxf-builder";

const analyze = (entities: EntitySpec[], extra: Partial<Parameters<typeof buildDxf>[0]> = {}, opts = {}) =>
  analyzeDxfSync(buildDxf({ entities, ...extra }), opts);

describe("healing", () => {
  it("joins a 0.005 mm gap in a rectangle and reports it", () => {
    const g = analyze(rectLines(0, 0, 100, 50, "0", 0.005));
    expect(g.healing.gapsJoined).toBe(1);
    expect(g.healing.duplicatesRemoved).toBe(0);
    expect(g.triage.state).toBe("green");
    expect(g.loops.filter((l) => l.kind === "outer")).toHaveLength(1);
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 2);
    expect(g.measures.outerAreaMm2).toBeCloseTo(5000, 1);
    expect(g.entities.some((e) => e.healed)).toBe(true);
  });

  it("does not join a gap wider than the tolerance, but does with a wider tolerance", () => {
    const g = analyze(rectLines(0, 0, 100, 50, "0", 0.3));
    expect(g.triage.state).toBe("red_no_closed_contour");
    expect(g.healing.gapsJoined).toBe(0);
    const g2 = analyze(rectLines(0, 0, 100, 50, "0", 0.3), {}, { toleranceMm: 0.5 });
    expect(g2.triage.state).toBe("green");
    expect(g2.healing.gapsJoined).toBe(1);
    expect(g2.healing.toleranceMm).toBe(0.5);
    // the tolerance is capped at 0.5
    expect(analyze(rectLines(0, 0, 100, 50), {}, { toleranceMm: 5 }).healing.toleranceMm).toBe(0.5);
  });

  it("removes a duplicated line (either direction) exactly once", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(100, 0, 0, 0)]);
    expect(g.healing.duplicatesRemoved).toBe(1);
    expect(g.entities).toHaveLength(4);
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g.triage.state).toBe("green");
  });

  it("removes a collinear line fully inside an edge, never a distinct parallel line", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(20, 0, 60, 0)]);
    expect(g.healing.overlapsRemoved).toBe(1);
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    const g2 = analyze([...rectLines(0, 0, 100, 50), line(20, 0.5, 60, 0.5)]);
    expect(g2.healing.overlapsRemoved).toBe(0);
    expect(g2.entities).toHaveLength(5);
  });

  it("drops zero-length entities and reports them", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(10, 10, 10, 10)]);
    expect(g.healing.zeroLengthRemoved).toBe(1);
    expect(g.dropped).toContainEqual({ type: "LINE", layer: "0", count: 1, reason: "zero_length" });
    expect(g.triage.state).toBe("green");
  });

  it("closes an unflagged polyline that returns to its start", () => {
    const g = analyze([
      { type: "LWPOLYLINE", vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 0.004 }] },
    ]);
    expect(g.healing.loopsClosed).toBe(1);
    expect(g.triage.state).toBe("green");
    expect(g.measures.outerAreaMm2).toBeCloseTo(5000, 0);
  });
});

describe("units", () => {
  it("scales an inch file by 25.4 and flags amber_units", () => {
    const g = analyze(rectLines(0, 0, 4, 2), { insunits: 1, extmax: { x: 4, y: 2 } });
    expect(g.header.units).toEqual({ insunits: 1, detected: "inch", scaleApplied: 25.4 });
    expect(g.measures.bbox.width).toBeCloseTo(101.6, 6);
    expect(g.measures.bbox.height).toBeCloseTo(50.8, 6);
    expect(g.header.extmax).toEqual({ x: expect.closeTo(101.6, 6), y: expect.closeTo(50.8, 6) });
    expect(g.triage.state).toBe("amber_units");
    expect(g.triage.reasons).toEqual(["units_inch"]);
  });

  it("flags missing $INSUNITS", () => {
    const g = analyze(rectLines(0, 0, 100, 50), { insunits: null });
    expect(g.header.units).toEqual({ insunits: null, detected: "unknown", scaleApplied: 1 });
    expect(g.triage.state).toBe("amber_units");
    expect(g.triage.reasons).toEqual(["units_missing"]);
    expect(analyze(rectLines(0, 0, 100, 50), { insunits: 0 }).triage.state).toBe("amber_units");
  });
});

describe("parts and sheets", () => {
  it("splits two separate parts into part groups", () => {
    const g = analyze([
      ...rectLines(0, 0, 100, 50),
      circle(50, 25, 5),
      ...rectLines(200, 0, 60, 40),
      circle(230, 20, 4),
    ]);
    expect(g.partCount).toBe(2);
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toContain("multi_part");
    expect(g.loops.filter((l) => l.kind === "outer")).toHaveLength(1);
    expect(g.loops.filter((l) => l.kind === "other_part")).toHaveLength(1);
    const other = g.loops.find((l) => l.kind === "other_part")!;
    expect(other.partIndex).toBe(1);
    expect(g.loops.filter((l) => l.kind === "hole" && l.partIndex === 1)).toHaveLength(1);
    // measures for part 0 by default, part 1 on request
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.cutLengthMm).toBeCloseTo(300 + 2 * Math.PI * 5, 6);
    const g1 = analyze([...rectLines(0, 0, 100, 50), circle(50, 25, 5), ...rectLines(200, 0, 60, 40), circle(230, 20, 4)], {}, { partIndex: 1 });
    expect(g1.measures.cutLengthMm).toBeCloseTo(200 + 2 * Math.PI * 4, 6);
    expect(g1.measures.bbox.width).toBeCloseTo(60, 6);
  });

  it("flags a dimension/text-heavy sheet with three views as red_drawing_sheet", () => {
    const ents: EntitySpec[] = [
      ...rectLines(0, 0, 100, 50),
      circle(50, 25, 5),
      ...rectLines(200, 0, 100, 50),
      ...rectLines(400, 0, 50, 50),
    ];
    for (let i = 0; i < 6; i++) ents.push({ type: "DIMENSION", layer: "DIMENSIONS" });
    for (let i = 0; i < 3; i++) ents.push({ type: "TEXT", layer: "TITLE", position: { x: i, y: -20 }, text: `T${i}` });
    ents.push({ type: "MTEXT", layer: "0", position: { x: 0, y: -30 }, text: "note" });
    ents.push({ type: "HATCH", layer: "0" });
    const g = analyze(ents);
    expect(g.triage.state).toBe("red_drawing_sheet");
    expect(g.triage.reasons).toContain("dimension_text_heavy");
    expect(g.triage.reasons).toContain("multiple_view_clusters");
    expect(g.triage.details.dimensionTextCount).toBe(10);
    expect(g.triage.details.clusterCount).toBe(3);
    expect(g.dropped).toContainEqual({ type: "DIMENSION", layer: "DIMENSIONS", count: 6, reason: "not_geometry" });
    expect(g.dropped).toContainEqual({ type: "HATCH", layer: "0", count: 1, reason: "not_geometry" });
  });

  it("flags header extents that are grossly inconsistent with the geometry", () => {
    const red = analyze(rectLines(0, 0, 100, 50), { extmin: { x: 0, y: 0 }, extmax: { x: 1000, y: 500 } });
    expect(red.triage.state).toBe("red_drawing_sheet");
    expect(red.triage.reasons).toEqual(["extents_mismatch"]);
    // an offset only (Inventor style) is fine
    const ok = analyze(rectLines(-40, 0, 100, 50), { extmin: { x: 0, y: 0 }, extmax: { x: 102, y: 50 } });
    expect(ok.triage.state).toBe("green");
    // missing extents are fine too
    expect(analyze(rectLines(0, 0, 100, 50), { extmin: null, extmax: null }).triage.state).toBe("green");
  });

  it("ignores a rectangular frame drawn around a part with holes", () => {
    const g = analyze([
      ...rectLines(-50, -50, 400, 300, "BORDER"),
      ...rectLines(0, 0, 100, 50),
      circle(50, 25, 5),
    ]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(1);
    expect(g.partCount).toBe(1);
    expect(g.measures.bbox.width).toBeCloseTo(100, 6);
    expect(g.measures.pierces).toBe(2);
    expect(g.entities.filter((e) => e.layer === "BORDER").every((e) => e.role === "ignore")).toBe(true);
  });
});

describe("bend candidates and layer conventions", () => {
  it("flags unnamed interior lines on layer 0 with their entity ids", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(50, 0, 50, 50), line(20, 0, 20, 50, "0", "DASHED")]);
    expect(g.triage.state).toBe("amber_bend_candidates");
    expect(g.triage.reasons).toEqual(["interior_open_lines"]);
    expect(g.triage.details.count).toBe(2);
    const cands = g.entities.filter((e) => e.role === "unknown");
    expect(cands).toHaveLength(2);
    expect(new Set(g.triage.candidateEntityIds)).toEqual(new Set(cands.map((e) => e.id)));
    expect(cands.find((e) => e.linetype === "DASHED")).toBeTruthy();
    // candidates are not priced and not bend lines
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g.measures.bendLines).toHaveLength(0);
    expect(g.loops.filter((l) => l.kind === "open_chain")).toHaveLength(2);
  });

  it("reads bend/weld/engrave layers before geometry", () => {
    const g = analyze([
      ...rectLines(0, 0, 100, 50, "CUT"),
      line(50, 0, 50, 50, "BEND LINES"),
      line(70, 0, 70, 50, "Bend-Down"),
      line(10, 25, 30, 25, "ENGRAVE"),
      circle(85, 25, 3, "WELD"),
      line(0, 10, 0, 40, "weld_seam"),
    ]);
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toEqual(["bend_layers_found"]);
    expect(g.measures.bendLines.map((b) => b.direction).sort()).toEqual(["down", "up"]);
    expect(g.measures.engraveLengthMm).toBeCloseTo(20, 6);
    // the closed loop on the WELD layer is a weld, not a hole
    expect(g.measures.pierces).toBe(1);
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g.entities.filter((e) => e.role === "weld")).toHaveLength(2);
  });

  it("goes amber_forming_unknown only when a name/PDF hints at forming and nothing else does", () => {
    const flat = rectLines(0, 0, 100, 50);
    expect(analyze(flat, {}, { name: "bracket_bent_v2.dxf" }).triage.state).toBe("amber_forming_unknown");
    expect(analyze(flat, {}, { name: "part.dxf", pdfText: "Blacha gięta 2 mm" }).triage.state).toBe("amber_forming_unknown");
    expect(analyze(flat, {}, { name: "part.dxf", pdfText: "PLECH 2x554,3x60" }).triage.state).toBe("green");
    expect(analyze(flat, {}, { name: "Ohýbaný diel" }).triage.reasons).toEqual(["forming_hint_in_name"]);
    expect(analyze(flat, {}, { pdfText: "Abkanten nach Zeichnung" }).triage.reasons).toEqual(["forming_hint_in_pdf"]);
    // a bend layer answers the question
    expect(analyze([...flat, line(50, 0, 50, 50, "BEND")], {}, { name: "bent" }).triage.state).toBe("green");
  });

  it("puts open chains outside every outline into noise", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(150, 0, 150, 50)]);
    expect(g.triage.state).toBe("green");
    expect(g.loops.find((l) => l.kind === "noise")).toBeTruthy();
    expect(g.entities.find((e) => e.bbox.minX === 150)?.role).toBe("ignore");
  });
});

describe("curves and blocks", () => {
  it("reads LWPOLYLINE bulges as exact arcs (matches a CIRCLE of the same size)", () => {
    const withPoly = analyze([
      ...rectLines(0, 0, 100, 50),
      { type: "LWPOLYLINE", vertices: [{ x: 45, y: 25, bulge: 1 }, { x: 55, y: 25, bulge: 1 }], closed: true },
    ]);
    const withCircle = analyze([...rectLines(0, 0, 100, 50), circle(50, 25, 5)]);
    expect(withPoly.measures.holesLengthMm).toBeCloseTo(withCircle.measures.holesLengthMm, 6);
    expect(withPoly.measures.holesAreaMm2).toBeCloseTo(withCircle.measures.holesAreaMm2, 6);
    expect(withPoly.measures.holes[0].circular).toBe(true);
    expect(withPoly.measures.holes[0].diameterMm).toBeCloseTo(10, 3);
    expect(withPoly.measures.holes[0].center).toEqual({ x: expect.closeTo(50, 6), y: expect.closeTo(25, 6) });
  });

  it("handles negative bulges and closed POLYLINE with VERTEX records", () => {
    // Rounded slot 30 × 10 built with two negative-bulge semicircles (clockwise).
    const g = analyze([
      ...rectLines(0, 0, 100, 50),
      {
        type: "POLYLINE",
        vertices: [{ x: 35, y: 30 }, { x: 65, y: 30, bulge: -1 }, { x: 65, y: 20 }, { x: 35, y: 20, bulge: -1 }],
        closed: true,
      },
    ]);
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holesLengthMm).toBeCloseTo(60 + Math.PI * 10, 6);
    expect(g.measures.holesAreaMm2).toBeCloseTo(300 + Math.PI * 25, 6);
    expect(g.measures.holes[0].circular).toBe(false);
    // the two CW semicircles bulge outward: the slot spans x = 30 … 70
    expect(g.measures.holes[0].maxSideMm).toBeCloseTo(40, 6);
  });

  it("flattens a circle-like SPLINE to within 0.1 % of its true perimeter", () => {
    // Uniform cubic B-spline with control points on a circle, wrapped 3 times → closed periodic curve.
    const n = 24;
    const rc = 20;
    const ctrl = Array.from({ length: n + 3 }, (_, i) => ({
      x: 50 + rc * Math.cos((2 * Math.PI * (i % n)) / n),
      y: 25 + rc * Math.sin((2 * Math.PI * (i % n)) / n),
    }));
    const knots = Array.from({ length: n + 7 }, (_, i) => i);
    const g = analyze([...rectLines(0, 0, 100, 50), { type: "SPLINE", degree: 3, controlPoints: ctrl, knots }]);
    expect(g.healing.splinesFlattened).toBe(1);
    expect(g.measures.pierces).toBe(2);
    const hole = g.measures.holes[0];
    expect(hole.circular).toBe(true);
    // Reference: dense independent evaluation of the same B-spline (de Boor).
    const deBoor = (u: number) => {
      const k = Math.min(Math.floor(u), n + 2);
      const d = [0, 1, 2, 3].map((j) => ({ ...ctrl[j + k - 3] }));
      for (let r = 1; r <= 3; r++) {
        for (let j = 3; j >= r; j--) {
          const i = j + k - 3;
          const a = (u - knots[i]) / (knots[i + 3 - r + 1] - knots[i]);
          d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
        }
      }
      return d[3];
    };
    let ref = 0;
    let prev = deBoor(3);
    const steps = 20000;
    for (let s = 1; s <= steps; s++) {
      const u = 3 + ((n) * s) / steps;
      const p = deBoor(Math.min(u, n + 3 - 1e-9));
      ref += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    expect(Math.abs(g.measures.holesLengthMm - ref) / ref).toBeLessThan(0.001);
    expect(Math.abs(hole.diameterMm - 2 * rc * ((2 + Math.cos((2 * Math.PI) / n)) / 3)) / (2 * rc)).toBeLessThan(0.002);
  });

  it("flattens an ELLIPSE with the right perimeter", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), { type: "ELLIPSE", center: { x: 50, y: 25 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5 }]);
    expect(g.healing.ellipsesFlattened).toBe(1);
    expect(g.measures.pierces).toBe(2);
    // Ramanujan approximation for a = 10, b = 5.
    const a = 10;
    const b = 5;
    const h = ((a - b) / (a + b)) ** 2;
    const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(Math.abs(g.measures.holesLengthMm - perimeter) / perimeter).toBeLessThan(0.001);
    expect(g.measures.holesAreaMm2).toBeCloseTo(Math.PI * a * b, 0);
  });

  it("explodes INSERTs with translation, scale and rotation", () => {
    const text = buildDxf({
      blocks: [
        {
          name: "HOLE",
          entities: [circle(0, 0, 2.5, "0"), line(0, 0, 10, 0, "MARK")],
        },
      ],
      entities: [
        ...rectLines(0, 0, 200, 100),
        { type: "INSERT", name: "HOLE", position: { x: 50, y: 50 }, xScale: 2, yScale: 2, rotation: 90 },
        { type: "INSERT", name: "HOLE", position: { x: 150, y: 50 }, layer: "HOLES" },
      ],
    });
    const parsed = parseDxf(text);
    expect(parsed.blocksExploded).toBe(2);
    const circles = parsed.entities.filter((e) => e.originalType === "CIRCLE");
    expect(circles).toHaveLength(2);
    const big = circles.find((c) => c.segments[0].kind === "circle" && c.segments[0].radius === 5)!;
    expect(big.segments[0]).toMatchObject({ center: { x: expect.closeTo(50, 9), y: expect.closeTo(50, 9) }, radius: 5 });
    const rotated = parsed.entities.find((e) => e.layer === "MARK" && e.segments[0].kind === "line" && e.segments[0].end.y > 60)!;
    expect(rotated.segments[0]).toMatchObject({ start: { x: expect.closeTo(50, 9), y: expect.closeTo(50, 9) }, end: { x: expect.closeTo(50, 9), y: expect.closeTo(70, 9) } });
    // Children on layer "0" inherit the INSERT's layer.
    const inherited = circles.find((c) => c.layer === "HOLES");
    expect(inherited).toBeTruthy();
    const g = analyzeDxfSync(text);
    expect(g.healing.blocksExploded).toBe(2);
    expect(g.measures.pierces).toBe(3);
    expect(g.measures.engraveLengthMm).toBeCloseTo(30, 6);
  });

  it("explodes an INSERT with a mirrored scale keeping arcs exact", () => {
    const text = buildDxf({
      blocks: [{ name: "Q", entities: [{ type: "ARC", center: { x: 0, y: 0 }, radius: 10, startDeg: 0, endDeg: 90 }, line(0, 10, 0, 0), line(0, 0, 10, 0)] }],
      entities: [{ type: "INSERT", name: "Q", position: { x: 0, y: 0 }, xScale: -1, yScale: 1 }],
    });
    const g = analyzeDxfSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.measures.outerAreaMm2).toBeCloseTo((Math.PI * 100) / 4, 6);
    expect(g.measures.bbox.minX).toBeCloseTo(-10, 6);
    expect(g.measures.bbox.maxX).toBeCloseTo(0, 6);
  });
});

describe("robustness", () => {
  it("throws only for non-DXF text", () => {
    expect(() => analyzeDxfSync("hello world")).toThrow(DxfFormatError);
    expect(() => analyzeDxfSync("")).toThrow(DxfFormatError);
    expect(() => analyzeDxfSync("%PDF-1.4 binary junk")).toThrow(DxfFormatError);
  });

  it("returns red_no_closed_contour with reports for garbage that looks like DXF", () => {
    const garbage = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\nabc\n20\n0\n11\n";
    const g = analyzeDxfSync(garbage);
    expect(g.triage.state).toBe("red_no_closed_contour");
    expect(g.triage.reasons).toContain("no_closed_contour");
    expect(g.entities).toHaveLength(0);
    expect(g.partCount).toBe(0);
    expect(g.measures.pierces).toBe(0);
    expect(typeof g.triage.details.parseError).toBe("string");
    // truncated file without EOF
    const truncated = buildDxf({ entities: rectLines(0, 0, 100, 50) }).replace(/\s*0\r\nEOF\r\n$/, "");
    const g2 = analyzeDxfSync(truncated);
    expect(["green", "red_no_closed_contour"]).toContain(g2.triage.state);
    expect(g2.dropped).toBeDefined();
    expect(g2.healing).toBeDefined();
  });

  it("goes red_no_closed_contour for an open outline", () => {
    const g = analyzeDxfSync(buildDxf({ entities: rectLines(0, 0, 100, 50).slice(0, 3) }));
    expect(g.triage.state).toBe("red_no_closed_contour");
    expect(g.outerLoopId).toBeNull();
    expect(g.measures.cutLengthMm).toBe(0);
    expect(g.loops.filter((l) => !l.closed)).toHaveLength(1);
  });

  it("keeps arcs exact on a rounded rectangle outline", () => {
    const g = analyze(roundedRect(0, 0, 100, 50, 5, "IV_OUTER_PROFILE"));
    expect(g.triage.state).toBe("green");
    expect(g.measures.cutLengthMm).toBeCloseTo(2 * (90 + 40) + 2 * Math.PI * 5, 6);
    expect(g.measures.outerAreaMm2).toBeCloseTo(5000 - (100 - 25 * Math.PI), 6);
    expect(g.measures.bbox).toMatchObject({ minX: expect.closeTo(0, 9), maxX: expect.closeTo(100, 9), minY: expect.closeTo(0, 9), maxY: expect.closeTo(50, 9) });
  });

  it("handles LF line endings and CRLF the same", () => {
    const crlf = buildDxf({ entities: rectLines(0, 0, 100, 50) });
    const lf = buildDxf({ entities: rectLines(0, 0, 100, 50), eol: "\n" });
    expect(analyzeDxfSync(lf).measures).toEqual(analyzeDxfSync(crlf).measures);
  });
});
