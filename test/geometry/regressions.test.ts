/**
 * Review regressions — one describe per confirmed finding on the geometry
 * engine (frames, chain overshoot, per-part measures, forming triage,
 * tagged outline edges, open cuts, 360° arcs, rational splines).
 * File path: /test/geometry/regressions.test.ts
 *
 * Every block first states the failure the reviewer reproduced, then the
 * behaviour the spec (build prompt Step 6) requires. Numbers are exact
 * geometry: lengths ±1e-6 unless a flattened curve is involved.
 */
import { describe, expect, it } from "vitest";
import {
  analyzeDxfSync,
  applyAnnotationsSync,
  exportAnnotatedDxf,
  EMPTY_ANNOTATIONS,
  parseDxf,
  type PartAnnotations,
} from "@/lib/geometry";
import { buildDxf, circle, line, rectLines, roundedRect, type EntitySpec } from "./dxf-builder";

const analyze = (entities: EntitySpec[], extra: Partial<Parameters<typeof buildDxf>[0]> = {}, opts = {}) =>
  analyzeDxfSync(buildDxf({ entities, ...extra }), opts);
const ann = (patch: Partial<PartAnnotations>): PartAnnotations => ({ ...EMPTY_ANNOTATIONS, ...patch });

/* ─── Finding 1: frame rule swallowed the real outer contour ──── */

describe("frame rule never demotes a plate on a cut layer (finding 1)", () => {
  it("keeps a rectangular plate with a window that holds an island", () => {
    // 200 × 100 plate, 50 × 30 window, Ø10 island inside the window.
    const g = analyze(
      [
        ...rectLines(0, 0, 200, 100, "IV_OUTER_PROFILE"),
        ...rectLines(75, 35, 50, 30, "IV_INTERIOR_PROFILES"),
        circle(100, 50, 5, "IV_INTERIOR_PROFILES"),
      ],
      {},
      { thicknessMm: 2, densityKgM3: 7850 }
    );
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(0);
    expect(g.loops.find((l) => l.kind === "outer")?.areaMm2).toBeCloseTo(20000, 6);
    expect(g.measures.bbox.width).toBeCloseTo(200, 6);
    expect(g.measures.bbox.height).toBeCloseTo(100, 6);
    expect(g.measures.cutLengthMm).toBeCloseTo(600 + 160 + 10 * Math.PI, 6);
    expect(g.measures.pierces).toBe(3);
    // island parity: the Ø10 disc adds material back
    expect(g.measures.netAreaMm2).toBeCloseTo(20000 - 1500 + 25 * Math.PI, 6);
    expect(g.measures.massKg).toBeCloseTo(((20000 - 1500 + 25 * Math.PI) * 2 * 7850) / 1e9, 6);
    expect(g.triage.state).toBe("green");
    expect(g.entities.filter((e) => e.layer === "IV_OUTER_PROFILE").every((e) => e.role === "cut")).toBe(true);
  });

  it("keeps a plain rectangle on layer 0 with concentric Ø60 / Ø40 / Ø10 loops", () => {
    const g = analyze([...rectLines(0, 0, 200, 100), circle(100, 50, 30), circle(100, 50, 20), circle(100, 50, 5)]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(0);
    expect(g.loops.find((l) => l.kind === "outer")?.areaMm2).toBeCloseTo(20000, 6);
    expect(g.measures.pierces).toBe(4);
    expect(g.measures.cutLengthMm).toBeCloseTo(600 + 110 * Math.PI, 6);
    expect(g.measures.netAreaMm2).toBeCloseTo(20000 - 525 * Math.PI, 6);
    expect(g.triage.state).toBe("green");
  });

  it("keeps a square ring with a nested washer as one part", () => {
    const g = analyze([...rectLines(0, 0, 200, 200), circle(100, 100, 50), circle(100, 100, 30), circle(100, 100, 10)]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(0);
    expect(g.partCount).toBe(1);
    expect(g.measures.outerLengthMm).toBeCloseTo(800, 6);
    expect(g.measures.cutLengthMm).toBeCloseTo(800 + 180 * Math.PI, 6);
    expect(g.measures.pierces).toBe(4);
  });

  it("never treats a rounded (R5) plate as a frame", () => {
    const g = analyze([
      ...roundedRect(0, 0, 200, 100, 5, "IV_OUTER_PROFILE"),
      ...rectLines(75, 35, 50, 30, "IV_INTERIOR_PROFILES"),
      circle(100, 50, 5, "IV_INTERIOR_PROFILES"),
    ]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(0);
    expect(g.measures.bbox.width).toBeCloseTo(200, 6);
    expect(g.measures.pierces).toBe(3);
  });

  it("still ignores a border on its own layer around a part with holes", () => {
    const g = analyze([...rectLines(-50, -50, 400, 300, "BORDER"), ...rectLines(0, 0, 100, 50), circle(50, 25, 5)]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(1);
    expect(g.partCount).toBe(1);
    expect(g.measures.bbox.width).toBeCloseTo(100, 6);
    expect(g.measures.pierces).toBe(2);
  });

  it("ignores a same-layer border that encloses two parts with holes (a nest inside a sheet border)", () => {
    const g = analyze([
      ...rectLines(-50, -50, 500, 300),
      ...rectLines(0, 0, 100, 50),
      circle(50, 25, 5),
      ...rectLines(200, 0, 60, 40),
      circle(230, 20, 4),
    ]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(1);
    expect(g.partCount).toBe(2);
    expect(g.measures.bbox.width).toBeCloseTo(100, 6);
    expect(g.measures.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI, 6);
    expect(g.triage.reasons).toContain("multi_part");
  });

  it("ignores a same-layer border with a title block in its corner", () => {
    const g = analyze([
      ...rectLines(-50, -50, 400, 300),
      // closed title block sharing the border's bottom-right corner
      {
        type: "LWPOLYLINE",
        vertices: [{ x: 200, y: -50 }, { x: 350, y: -50 }, { x: 350, y: 0 }, { x: 200, y: 0 }],
        closed: true,
      },
      ...rectLines(0, 50, 100, 50),
      circle(50, 75, 5),
    ]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(2);
    expect(g.partCount).toBe(1);
    expect(g.measures.bbox.width).toBeCloseTo(100, 6);
    expect(g.measures.pierces).toBe(2);
  });

  it("does not demote a same-layer rectangle around a hole-less part (it stays the outer contour)", () => {
    const g = analyze([...rectLines(-50, -50, 400, 300), ...rectLines(0, 0, 100, 50)]);
    expect(g.loops.filter((l) => l.kind === "frame")).toHaveLength(0);
    expect(g.measures.bbox.width).toBeCloseTo(400, 6);
  });
});

/* ─── Finding 2: chain walk took the overshoot and never closed ─ */

describe("chaining survives a stray line continuing past a corner (finding 2)", () => {
  it("closes the outline when a line overshoots a corner", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(100, 0, 120, 0)]);
    expect(g.triage.state).toBe("green");
    const outer = g.loops.find((l) => l.kind === "outer")!;
    expect(outer.entityIds).toHaveLength(4);
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g.measures.outerAreaMm2).toBeCloseTo(5000, 6);
    const stray = g.entities.find((e) => e.bbox.maxX === 120)!;
    expect(stray.role).toBe("ignore");
    expect(g.loops.find((l) => l.entityIds.includes(stray.id))?.kind).toBe("noise");
  });

  it("does not price the hole as the part when an overshoot is present", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), circle(50, 25, 5), line(100, 0, 120, 0)]);
    expect(g.triage.state).toBe("green");
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI, 6);
    expect(g.measures.bbox.width).toBeCloseTo(100, 6);
  });

  it("handles an overshoot on a non-convention layer and a two-piece overshoot", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(100, 0, 120, 0, "STRAY")]);
    expect(g.triage.state).toBe("green");
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    const g2 = analyze([...rectLines(0, 0, 100, 50), line(100, 0, 120, 0), line(120, 0, 140, 0)]);
    expect(g2.triage.state).toBe("green");
    expect(g2.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g2.loops.filter((l) => l.kind === "noise")).toHaveLength(1);
  });

  it("keeps an overshoot inside the part as a bend candidate", () => {
    // Line starts at the corner and runs into the plate: still an open interior chain.
    const g = analyze([...rectLines(0, 0, 100, 50), line(0, 0, 40, 20)]);
    expect(g.triage.state).toBe("amber_bend_candidates");
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g.measures.outerAreaMm2).toBeCloseTo(5000, 6);
  });

  it("stays exact and fast on a 2000-line outline with an overshoot next to a lattice of crossing lines", () => {
    // Outline: regular 2000-gon of radius 500 built from LINEs, one overshoot at vertex 0.
    const n = 2000;
    const r = 500;
    const ents: EntitySpec[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n;
      const a1 = (2 * Math.PI * (i + 1)) / n;
      ents.push(line(r * Math.cos(a0), r * Math.sin(a0), r * Math.cos(a1), r * Math.sin(a1)));
    }
    ents.push(line(r, 0, r + 30, 0));
    // A separate 12 × 12 lattice (many branches, many cycles) far to the right.
    const cells = 12;
    const pitch = 10;
    const ox = 1200;
    for (let i = 0; i <= cells; i++) {
      for (let j = 0; j < cells; j++) {
        ents.push(line(ox + i * pitch, j * pitch, ox + i * pitch, (j + 1) * pitch));
        ents.push(line(ox + j * pitch, i * pitch, ox + (j + 1) * pitch, i * pitch));
      }
    }
    const t0 = Date.now();
    const g = analyze(ents);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(5000);
    const outer = g.loops.find((l) => l.kind === "outer")!;
    expect(outer.entityIds).toHaveLength(n);
    expect(outer.areaMm2).toBeCloseTo(0.5 * n * r * r * Math.sin((2 * Math.PI) / n), 3);
    // every lattice line ends up in some chain, none is lost
    expect(g.entities.filter((e) => e.loopId === null)).toHaveLength(0);
    expect(g.loops.filter((l) => l.closed).length).toBeGreaterThan(1);
  });

  it("backtracks over a bridge line joining two parts", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(100, 0, 150, 0), ...rectLines(150, 0, 60, 40)]);
    expect(g.partCount).toBe(2);
    expect(g.loops.filter((l) => l.closed)).toHaveLength(2);
    expect(g.measures.cutLengthMm).toBeCloseTo(300, 6);
    expect(g.measures.pierces).toBe(1);
    expect(g.loops.find((l) => l.kind === "other_part")?.perimeterMm).toBeCloseTo(200, 6);
  });
});

/* ─── Finding 3: bend lines / engrave leaked across part groups ─ */

describe("bend lines and engrave length are per part (finding 3)", () => {
  const ents: EntitySpec[] = [
    ...rectLines(0, 0, 100, 50),
    line(50, 0, 50, 50, "IV_BEND"),
    line(10, 25, 30, 25, "ENGRAVE"),
    ...rectLines(200, 0, 60, 40),
    line(230, 0, 230, 40, "IV_BEND_DOWN"),
    line(205, 20, 245, 20, "ENGRAVE"),
  ];

  it("part 0 gets its own bend and 20 mm of engraving", () => {
    const g = analyze(ents);
    expect(g.partCount).toBe(2);
    expect(g.measures.bendLines).toHaveLength(1);
    expect(g.measures.bendLines[0]).toMatchObject({ direction: "up", lengthMm: 50 });
    expect(g.measures.engraveLengthMm).toBeCloseTo(20, 6);
  });

  it("part 1 gets its own bend and 40 mm of engraving", () => {
    const g = analyze(ents, {}, { partIndex: 1 });
    expect(g.measures.bendLines).toHaveLength(1);
    expect(g.measures.bendLines[0]).toMatchObject({ direction: "down", lengthMm: 40 });
    expect(g.measures.engraveLengthMm).toBeCloseTo(40, 6);
    expect(g.measures.cutLengthMm).toBeCloseTo(200, 6);
  });

  it("single-part files still count a bend line touching the outline", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(0, 25, 100, 25, "BEND")]);
    expect(g.measures.bendLines).toHaveLength(1);
    expect(g.triage.state).toBe("green");
  });
});

/* ─── Finding 4: marking lines suppressed amber_forming_unknown ── */

describe("a marking line does not answer the forming question (finding 4)", () => {
  it("goes amber_forming_unknown with an ENGRAVE line and a forming hint in the name", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), line(10, 25, 30, 25, "ENGRAVE")], {}, { name: "bent bracket" });
    expect(g.triage.state).toBe("amber_forming_unknown");
    expect(g.triage.reasons).toEqual(["forming_hint_in_name"]);
  });

  it("same with a WELD line, and with a PDF hint", () => {
    expect(analyze([...rectLines(0, 0, 100, 50), line(0, 10, 0, 40, "WELD")], {}, { name: "bent bracket" }).triage.state).toBe(
      "amber_forming_unknown"
    );
    expect(analyze([...rectLines(0, 0, 100, 50), line(10, 25, 30, 25, "MARK")], {}, { pdfText: "Blacha gięta" }).triage.state).toBe(
      "amber_forming_unknown"
    );
  });

  it("stays green without a hint, with a bend layer, or once answered", () => {
    const ents = [...rectLines(0, 0, 100, 50), line(10, 25, 30, 25, "ENGRAVE")];
    expect(analyze(ents, {}, { name: "plate" }).triage.state).toBe("green");
    expect(analyze([...ents, line(50, 0, 50, 50, "BEND")], {}, { name: "bent bracket" }).triage.state).toBe("green");
    const g = analyze(ents, {}, { name: "bent bracket" });
    expect(applyAnnotationsSync(g, ann({ forming: "flat" }), { name: "bent bracket" }).triage.state).toBe("green");
  });
});

/* ─── Finding 5: a tagged outline edge vanished from the cut length ── */

describe("an outline edge tagged weld/engrave is still cut (finding 5)", () => {
  const base = () => analyzeDxfSync(buildDxf({ entities: [...rectLines(0, 0, 100, 50), circle(50, 25, 5)] }));
  const bottomEdge = (g: ReturnType<typeof base>) => g.entities.find((e) => e.bbox.maxY === 0 && e.bbox.width === 100)!;

  it("keeps the weld-tagged edge in the outer loop and in cutLengthMm", () => {
    const g = base();
    const edge = bottomEdge(g);
    const out = applyAnnotationsSync(g, ann({ entities: { [edge.id]: { role: "weld" } } }));
    expect(out.triage.state).toBe("green");
    const outer = out.loops.find((l) => l.kind === "outer")!;
    expect(outer.entityIds).toContain(edge.id);
    expect(out.entities.find((e) => e.id === edge.id)?.role).toBe("weld");
    expect(out.measures.outerLengthMm).toBeCloseTo(300, 6);
    expect(out.measures.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI, 6);
    expect(out.measures.pierces).toBe(2);
  });

  it("an engrave-tagged edge is cut and engraved", () => {
    const g = base();
    const edge = bottomEdge(g);
    const out = applyAnnotationsSync(g, ann({ entities: { [edge.id]: { role: "engrave" } } }));
    expect(out.measures.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI, 6);
    expect(out.measures.engraveLengthMm).toBeCloseTo(100, 6);
  });
});

/* ─── Finding 6: an open line answered "cut" was free ──────────── */

describe("an open interior chain answered cut is priced (finding 6)", () => {
  it("adds the slit length and one pierce", () => {
    const g = analyzeDxfSync(buildDxf({ entities: [...rectLines(0, 0, 100, 50), line(50, 0, 50, 50)] }));
    expect(g.triage.state).toBe("amber_bend_candidates");
    const [candidate] = g.triage.candidateEntityIds;
    const out = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "cut" } } }));
    expect(out.triage.state).toBe("green");
    expect(out.measures.cutLengthMm).toBeCloseTo(350, 6);
    expect(out.measures.outerLengthMm).toBeCloseTo(300, 6);
    expect(out.measures.openCutsLengthMm).toBeCloseTo(50, 6);
    expect(out.measures.openCuts).toBe(1);
    expect(out.measures.pierces).toBe(2);
    expect(out.measures.netAreaMm2).toBeCloseTo(5000, 6);
  });

  it("a two-piece slit is one pierce; a cut chain outside the part is not priced", () => {
    const g = analyzeDxfSync(buildDxf({ entities: [...rectLines(0, 0, 100, 50), line(50, 0, 50, 25), line(50, 25, 50, 40), line(150, 0, 150, 30)] }));
    const ids = g.entities.filter((e) => e.role !== "cut").map((e) => e.id);
    expect(ids).toHaveLength(3);
    const overrides: Record<string, { role: "cut" }> = {};
    for (const id of ids) overrides[id] = { role: "cut" };
    const out = applyAnnotationsSync(g, ann({ entities: overrides }));
    expect(out.measures.openCuts).toBe(1);
    expect(out.measures.openCutsLengthMm).toBeCloseTo(40, 6);
    expect(out.measures.cutLengthMm).toBeCloseTo(340, 6);
    expect(out.measures.pierces).toBe(2);
  });
});

/* ─── Finding 7: ARC 0→360 became an open chain ────────────────── */

describe("a full-circle ARC is a hole (finding 7)", () => {
  it("reads ARC 0→360 as a circular hole with a thread suggestion", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), { type: "ARC", center: { x: 50, y: 25 }, radius: 3.4, startDeg: 0, endDeg: 360 }]);
    expect(g.triage.state).toBe("green");
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.cutLengthMm).toBeCloseTo(300 + 6.8 * Math.PI, 6);
    expect(g.measures.holes).toHaveLength(1);
    expect(g.measures.holes[0]).toMatchObject({ circular: true, diameterMm: expect.closeTo(6.8, 6) });
    expect(g.measures.holes[0].thread?.size).toBe("M8");
    expect(g.measures.holesAreaMm2).toBeCloseTo(Math.PI * 3.4 * 3.4, 6);
    expect(g.entities.find((e) => e.originalType === "ARC")?.role).toBe("hole");
  });

  it("same for endDeg 0 and for a near-360 arc that heals shut", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), { type: "ARC", center: { x: 50, y: 25 }, radius: 5, startDeg: 0, endDeg: 0 }]);
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holes[0].circular).toBe(true);
    // 359.99° at r = 5: the ends are 0.0009 mm apart, well within the 0.01 mm tolerance
    const g2 = analyze([...rectLines(0, 0, 100, 50), { type: "ARC", center: { x: 50, y: 25 }, radius: 5, startDeg: 0, endDeg: 359.99 }]);
    expect(g2.measures.pierces).toBe(2);
    expect(g2.measures.holesLengthMm).toBeCloseTo(10 * Math.PI, 2);
    expect(g2.healing.loopsClosed).toBe(1);
  });

  it("round-trips through the annotated export", () => {
    const g = analyze([...rectLines(0, 0, 100, 50), { type: "ARC", center: { x: 50, y: 25 }, radius: 5, startDeg: 0, endDeg: 360 }]);
    const again = analyzeDxfSync(exportAnnotatedDxf(g, EMPTY_ANNOTATIONS));
    expect(again.measures.pierces).toBe(2);
    expect(again.measures.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI, 6);
    expect(again.triage.state).toBe("green");
  });
});

/* ─── Finding 8: SPLINE weights were dropped ───────────────────── */

describe("rational SPLINE weights are honoured (finding 8)", () => {
  const r = 20;
  const cx = 50;
  const cy = 25;
  const w = Math.SQRT1_2;
  // Standard 9-control-point quadratic NURBS circle.
  const ctrl = [
    { x: cx + r, y: cy },
    { x: cx + r, y: cy + r },
    { x: cx, y: cy + r },
    { x: cx - r, y: cy + r },
    { x: cx - r, y: cy },
    { x: cx - r, y: cy - r },
    { x: cx, y: cy - r },
    { x: cx + r, y: cy - r },
    { x: cx + r, y: cy },
  ];
  const weights = [1, w, 1, w, 1, w, 1, w, 1];
  const knots = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4];
  const spline: EntitySpec = { type: "SPLINE", degree: 2, controlPoints: ctrl, knots, weights };

  it("flattens a rational NURBS circle to its true perimeter and area", () => {
    const g = analyze([...rectLines(0, 0, 200, 100), spline]);
    expect(g.healing.splinesFlattened).toBe(1);
    expect(g.measures.pierces).toBe(2);
    expect(Math.abs(g.measures.holesLengthMm - 2 * Math.PI * r)).toBeLessThan(0.2);
    expect(Math.abs(g.measures.holesAreaMm2 - Math.PI * r * r) / (Math.PI * r * r)).toBeLessThan(0.002);
    const hole = g.measures.holes[0];
    expect(hole.circular).toBe(true);
    expect(hole.diameterMm).toBeCloseTo(2 * r, 1);
    expect(hole.center).toEqual({ x: expect.closeTo(cx, 2), y: expect.closeTo(cy, 2) });
    // the same spline without weights is visibly wrong (the non-rational curve bulges towards the corners)
    const flat = analyze([...rectLines(0, 0, 200, 100), { ...spline, weights: undefined }]);
    expect(flat.measures.holesLengthMm - 2 * Math.PI * r).toBeGreaterThan(1);
  });

  it("matches weights to the right spline inside an exploded block and with several splines", () => {
    const text = buildDxf({
      blocks: [{ name: "RH", entities: [{ ...spline, controlPoints: ctrl.map((p) => ({ x: p.x - cx, y: p.y - cy })) }] }],
      entities: [
        ...rectLines(0, 0, 300, 100),
        { type: "INSERT", name: "RH", position: { x: 50, y: 50 } },
        { ...spline, controlPoints: ctrl.map((p) => ({ x: p.x + 100, y: p.y + 25 })), weights: undefined },
        { ...spline, controlPoints: ctrl.map((p) => ({ x: p.x + 200, y: p.y + 25 })) },
      ],
    });
    const parsed = parseDxf(text);
    const splines = parsed.entities.filter((e) => e.originalType === "SPLINE");
    expect(splines).toHaveLength(3);
    const perimeter = (segs: typeof splines[number]["segments"]) =>
      segs.reduce((acc, s) => (s.kind === "line" ? acc + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) : acc), 0);
    const byX = [...splines].sort((a, b) => a.segments[0].kind === "line" && b.segments[0].kind === "line" ? a.segments[0].start.x - b.segments[0].start.x : 0);
    // the inserted block copy (x ≈ 50) and the third spline (x ≈ 250) are rational, the middle one is not
    expect(Math.abs(perimeter(byX[0].segments) - 2 * Math.PI * r)).toBeLessThan(0.2);
    expect(perimeter(byX[1].segments) - 2 * Math.PI * r).toBeGreaterThan(1);
    expect(Math.abs(perimeter(byX[2].segments) - 2 * Math.PI * r)).toBeLessThan(0.2);
  });

  it("ignores a weight list that does not match the control points (evaluated non-rationally)", () => {
    const g = analyze([...rectLines(0, 0, 200, 100), { ...spline, weights: [1, w, 1] }]);
    const flat = analyze([...rectLines(0, 0, 200, 100), { ...spline, weights: undefined }]);
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holesLengthMm).toBeCloseTo(flat.measures.holesLengthMm, 6);
  });
});
