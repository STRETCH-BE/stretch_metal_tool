/**
 * Geometry engine — STEP AP214 writers: extruded profiles and faceted meshes.
 * File path: /lib/geometry/step/write-step.ts
 *
 * Two uses: (1) IFC elements are turned into STEP text so every model the
 * tool stores per part is a STEP file the reader understands — extruded
 * profiles (IfcExtrudedAreaSolid) exactly, with planar caps holding the
 * holes as FACE_BOUNDs, one planar side face per straight segment and one
 * CYLINDRICAL_SURFACE per arc; tessellated solids (IfcFacetedBrep,
 * IfcTriangulatedFaceSet) as a FACETED_BREP of POLY_LOOP faces; (2) the
 * test suite builds its synthetic fixtures with the same writer.
 *
 * Conventions match what CAD exporters write so the reader is exercised
 * on the real thing: shared VERTEX_POINTs, ORIENTED_EDGEs with the bottom
 * cap traversed the other way round, a representation context with SI or
 * inch units, FACE_OUTER_BOUND on caps (FACE_BOUND everywhere when asked).
 * Numbers are written with a decimal point (REAL attributes); the mesh
 * writer merges vertices by position.
 */

import type { Point } from "../types";
import { cross3, dot3, norm3, scale3, sub3, type Vec3 } from "./brep";

export type ProfileSegment = { kind: "line"; to: Point } | { kind: "arc"; to: Point; center: Point; ccw: boolean };

/** Closed profile: the last segment ends at `start`. */
export type Profile = { start: Point; segments: ProfileSegment[] };

/** Where the profile plane sits: origin, extrusion axis (w) and the u direction. */
export type ExtrusionFrame = { origin: Vec3; axis: Vec3; ref: Vec3 };

export type ExtrusionSpec = {
  name?: string;
  outer: Profile;
  holes?: Profile[];
  /** Extrusion length along the frame axis. */
  height: number;
  frame?: ExtrusionFrame;
};

export type WriteOptions = {
  unit?: "mm" | "inch" | "m";
  originatingSystem?: string;
  fileName?: string;
  /** Write every cap bound as FACE_BOUND (no FACE_OUTER_BOUND), as some exporters do. */
  noOuterBound?: boolean;
  /**
   * Product structure, one entry per solid: each solid gets its own
   * PRODUCT / PRODUCT_DEFINITION / SHAPE_DEFINITION_REPRESENTATION and is
   * placed `occurrences` times in an assembly product (NEXT_ASSEMBLY_USAGE_OCCURRENCE).
   */
  products?: { name: string; occurrences?: number }[];
};

const XY: ExtrusionFrame = { origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } };

export function fmt(n: number): string {
  if (Number.isInteger(n)) return `${n}.`;
  const s = String(Math.round(n * 1e9) / 1e9);
  return s.includes(".") || s.includes("e") ? s.replace("e", "E") : `${s}.`;
}

function escape(s: string): string {
  return s.replace(/'/g, "''").replace(/[^\x20-\x7E]/g, (ch) => `\\X2\\${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}\\X0\\`);
}

type V3 = [number, number, number];

class Writer {
  private next = 1;
  readonly lines: string[] = [];
  private readonly points = new Map<string, number>();
  private readonly vertices = new Map<string, number>();
  private readonly dirs = new Map<string, number>();

  add(text: string): number {
    const id = this.next++;
    this.lines.push(`#${id} = ${text};`);
    return id;
  }

  private key(p: V3): string {
    return p.map((c) => Math.round(c * 1e6)).join(",");
  }

  point(p: V3): number {
    const key = this.key(p);
    const cached = this.points.get(key);
    if (cached) return cached;
    const id = this.add(`CARTESIAN_POINT('',(${p.map(fmt).join(",")}))`);
    this.points.set(key, id);
    return id;
  }

  vertex(p: V3): number {
    const key = this.key(p);
    const cached = this.vertices.get(key);
    if (cached) return cached;
    const id = this.add(`VERTEX_POINT('',#${this.point(p)})`);
    this.vertices.set(key, id);
    return id;
  }

  direction(d: V3): number {
    const key = this.key(d);
    const cached = this.dirs.get(key);
    if (cached) return cached;
    const id = this.add(`DIRECTION('',(${d.map(fmt).join(",")}))`);
    this.dirs.set(key, id);
    return id;
  }

  placement(origin: V3, axis: V3, ref: V3): number {
    return this.add(`AXIS2_PLACEMENT_3D('',#${this.point(origin)},#${this.direction(axis)},#${this.direction(ref)})`);
  }

  units(unit: WriteOptions["unit"]): { context: number } {
    let lengthUnit: number;
    if (unit === "inch") {
      const mm = this.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
      const measure = this.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#${mm})`);
      const exponents = this.add(`DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)`);
      lengthUnit = this.add(`( CONVERSION_BASED_UNIT('INCH',#${measure}) LENGTH_UNIT() NAMED_UNIT(#${exponents}) )`);
    } else if (unit === "m") {
      lengthUnit = this.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) )`);
    } else {
      lengthUnit = this.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
    }
    const angle = this.add(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
    const solidAngle = this.add(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
    const uncertainty = this.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${lengthUnit},'distance_accuracy_value','')`);
    const context = this.add(
      `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angle},#${solidAngle})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`
    );
    return { context };
  }
}

function frameMap(frame: ExtrusionFrame): { map(u: number, v: number, w: number): V3; axis: V3; ref: V3; rightHanded: boolean } {
  const axis = norm3(frame.axis);
  const ref = norm3(sub3(frame.ref, scale3(axis, dot3(frame.ref, axis))));
  const y = cross3(axis, ref);
  // Profile v runs along the frame's y (axis × ref): right-handed by construction.
  return {
    map: (u, v, w) => [
      frame.origin.x + ref.x * u + y.x * v + axis.x * w,
      frame.origin.y + ref.y * u + y.y * v + axis.y * w,
      frame.origin.z + ref.z * u + y.z * v + axis.z * w,
    ],
    axis: [axis.x, axis.y, axis.z],
    ref: [ref.x, ref.y, ref.z],
    rightHanded: true,
  };
}

type FrameMap = ReturnType<typeof frameMap>;

type EdgeSet = { bottom: number[]; top: number[]; vertical: number[]; verts: Point[] };

function profilePoints(profile: Profile): Point[] {
  const pts = [profile.start];
  for (const s of profile.segments) pts.push(s.to);
  pts.pop();
  return pts;
}

function norm2(a: Point): Point {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

function profileEdges(w: Writer, f: FrameMap, profile: Profile, h: number): EdgeSet {
  const verts = profilePoints(profile);
  const n = verts.length;
  const bottom: number[] = [];
  const top: number[] = [];
  const vertical: number[] = [];
  const edgeAt = (seg: ProfileSegment, from: Point, to: Point, z: number): number => {
    const v1 = w.vertex(f.map(from.x, from.y, z));
    const v2 = w.vertex(f.map(to.x, to.y, z));
    if (seg.kind === "line") {
      const d = norm2({ x: to.x - from.x, y: to.y - from.y });
      const dir3 = sub3({ x: f.map(d.x, d.y, 0)[0], y: f.map(d.x, d.y, 0)[1], z: f.map(d.x, d.y, 0)[2] }, { x: f.map(0, 0, 0)[0], y: f.map(0, 0, 0)[1], z: f.map(0, 0, 0)[2] });
      const dir: V3 = [dir3.x, dir3.y, dir3.z];
      const line = w.add(`LINE('',#${w.point(f.map(from.x, from.y, z))},#${w.add(`VECTOR('',#${w.direction(dir)},1.)`)})`);
      return w.add(`EDGE_CURVE('',#${v1},#${v2},#${line},.T.)`);
    }
    const r = Math.hypot(from.x - seg.center.x, from.y - seg.center.y);
    const placement = w.placement(f.map(seg.center.x, seg.center.y, z), f.axis, f.ref);
    const circ = w.add(`CIRCLE('',#${placement},${fmt(r)})`);
    const ccwAboutAxis = seg.ccw === f.rightHanded;
    return w.add(`EDGE_CURVE('',#${v1},#${v2},#${circ},${ccwAboutAxis ? ".T." : ".F."})`);
  };
  for (let i = 0; i < n; i++) {
    const seg = profile.segments[i];
    const from = verts[i];
    const to = verts[(i + 1) % n];
    bottom.push(edgeAt(seg, from, to, 0));
    top.push(edgeAt(seg, from, to, h));
  }
  for (let i = 0; i < n; i++) {
    const p = verts[i];
    const v1 = w.vertex(f.map(p.x, p.y, 0));
    const v2 = w.vertex(f.map(p.x, p.y, h));
    const line = w.add(`LINE('',#${w.point(f.map(p.x, p.y, 0))},#${w.add(`VECTOR('',#${w.direction(f.axis)},1.)`)})`);
    vertical.push(w.add(`EDGE_CURVE('',#${v1},#${v2},#${line},.T.)`));
  }
  return { bottom, top, vertical, verts };
}

function orientedLoop(w: Writer, edges: number[], forward: boolean): number {
  const oes = (forward ? edges : [...edges].reverse()).map((e) => w.add(`ORIENTED_EDGE('',*,*,#${e},${forward ? ".T." : ".F."})`));
  return w.add(`EDGE_LOOP('',(${oes.map((id) => `#${id}`).join(",")}))`);
}

function prism(w: Writer, spec: ExtrusionSpec, opts: WriteOptions): number {
  const f = frameMap(spec.frame ?? XY);
  const h = spec.height;
  const outer = profileEdges(w, f, spec.outer, h);
  const holes = (spec.holes ?? []).map((p) => profileEdges(w, f, p, h));
  const faces: number[] = [];
  const outerBoundType = opts.noOuterBound ? "FACE_BOUND" : "FACE_OUTER_BOUND";
  for (const [z, forward, sense] of [
    [0, false, ".F."],
    [h, true, ".T."],
  ] as const) {
    const plane = w.add(`PLANE('',#${w.placement(f.map(0, 0, z), f.axis, f.ref)})`);
    const bounds: number[] = [];
    bounds.push(w.add(`${outerBoundType}('',#${orientedLoop(w, z === 0 ? outer.bottom : outer.top, forward)},.T.)`));
    for (const hole of holes) bounds.push(w.add(`FACE_BOUND('',#${orientedLoop(w, z === 0 ? hole.bottom : hole.top, !forward)},.T.)`));
    faces.push(w.add(`ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(",")}),#${plane},${sense})`));
  }
  const sides = (profile: Profile, edges: EdgeSet, hole: boolean) => {
    const n = edges.verts.length;
    for (let i = 0; i < n; i++) {
      const seg = profile.segments[i];
      const from = edges.verts[i];
      const loopEdges = [
        w.add(`ORIENTED_EDGE('',*,*,#${edges.bottom[i]},.T.)`),
        w.add(`ORIENTED_EDGE('',*,*,#${edges.vertical[(i + 1) % n]},.T.)`),
        w.add(`ORIENTED_EDGE('',*,*,#${edges.top[i]},.F.)`),
        w.add(`ORIENTED_EDGE('',*,*,#${edges.vertical[i]},.F.)`),
      ];
      const loop = w.add(`EDGE_LOOP('',(${loopEdges.map((id) => `#${id}`).join(",")}))`);
      const bound = w.add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      let surface: number;
      let sense = ".T.";
      if (seg.kind === "line") {
        const d = norm2({ x: seg.to.x - from.x, y: seg.to.y - from.y });
        const nx = hole ? -d.y : d.y;
        const ny = hole ? d.x : -d.x;
        const o = f.map(0, 0, 0);
        const nn = f.map(nx, ny, 0);
        const rr = f.map(d.x, d.y, 0);
        const normal: V3 = [nn[0] - o[0], nn[1] - o[1], nn[2] - o[2]];
        const ref: V3 = [rr[0] - o[0], rr[1] - o[1], rr[2] - o[2]];
        surface = w.add(`PLANE('',#${w.placement(f.map(from.x, from.y, 0), normal, ref)})`);
      } else {
        const r = Math.hypot(from.x - seg.center.x, from.y - seg.center.y);
        surface = w.add(`CYLINDRICAL_SURFACE('',#${w.placement(f.map(seg.center.x, seg.center.y, 0), f.axis, f.ref)},${fmt(r)})`);
        const concave = hole ? seg.ccw : !seg.ccw;
        sense = concave ? ".F." : ".T.";
      }
      faces.push(w.add(`ADVANCED_FACE('',(#${bound}),#${surface},${sense})`));
    }
  };
  sides(spec.outer, outer, false);
  spec.holes?.forEach((p, i) => sides(p, holes[i], true));
  const shell = w.add(`CLOSED_SHELL('',(${faces.map((id) => `#${id}`).join(",")}))`);
  return w.add(`MANIFOLD_SOLID_BREP('${escape(spec.name ?? "body")}',#${shell})`);
}

function header(opts: WriteOptions, description: string): string[] {
  const system = opts.originatingSystem ?? "stretchmetal-tool";
  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('${escape(description)}'),'2;1');`,
    `FILE_NAME('${escape(opts.fileName ?? "part.step")}','2026-01-01T00:00:00',(''),(''),'${escape(system)}','${escape(system)}','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
  ];
}

/** Extruded profiles as an AP214 file (one MANIFOLD_SOLID_BREP per spec). */
export function writeExtrudedStep(solids: ExtrusionSpec[], opts: WriteOptions = {}): string {
  const w = new Writer();
  const { context } = w.units(opts.unit ?? "mm");
  const origin = w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const bodies = solids.map((s) => prism(w, s, opts));
  if (opts.products && opts.products.length === solids.length) {
    const app = w.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
    const productContext = w.add(`PRODUCT_CONTEXT('',#${app},'mechanical')`);
    const definitionContext = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`);
    const definitionOf = (name: string): number => {
      const product = w.add(`PRODUCT('${escape(name)}','${escape(name)}','',(#${productContext}))`);
      const formation = w.add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
      return w.add(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`);
    };
    const assembly = definitionOf("assembly");
    opts.products.forEach((p, i) => {
      const definition = definitionOf(p.name);
      const shape = w.add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
      const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${origin},#${bodies[i]}),#${context})`);
      w.add(`SHAPE_DEFINITION_REPRESENTATION(#${shape},#${rep})`);
      for (let k = 0; k < (p.occurrences ?? 1); k++) {
        w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i + 1}.${k + 1}','','',#${assembly},#${definition},$)`);
      }
    });
  } else {
    w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${origin},${bodies.map((id) => `#${id}`).join(",")}),#${context})`);
  }
  return [...header(opts, "Extruded sheet part"), ...w.lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}

/** A tessellated solid as an AP214 FACETED_BREP of POLY_LOOP faces (millimetres). */
export function writeFacetedStep(name: string, polygons: Vec3[][], opts: WriteOptions = {}): string {
  const w = new Writer();
  const { context } = w.units("mm");
  const faces: number[] = [];
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    const pts = poly.map((p) => `#${w.point([p.x, p.y, p.z])}`);
    const loop = w.add(`POLY_LOOP('',(${pts.join(",")}))`);
    const bound = w.add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    faces.push(w.add(`FACE('',(#${bound}))`));
  }
  const shell = w.add(`CLOSED_SHELL('',(${faces.map((id) => `#${id}`).join(",")}))`);
  const solid = w.add(`FACETED_BREP('${escape(name)}',#${shell})`);
  const origin = w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  w.add(`FACETED_BREP_SHAPE_REPRESENTATION('${escape(name)}',(#${origin},#${solid}),#${context})`);
  return [...header({ ...opts, fileName: opts.fileName ?? `${name}.step` }, "Tessellated sheet part"), ...w.lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}

/* ─── Profile helpers (tests and IFC profiles) ──────────────── */

export function rect(w: number, h: number, at: Point = { x: 0, y: 0 }): Profile {
  const { x, y } = at;
  return {
    start: { x, y },
    segments: [
      { kind: "line", to: { x: x + w, y } },
      { kind: "line", to: { x: x + w, y: y + h } },
      { kind: "line", to: { x, y: y + h } },
      { kind: "line", to: { x, y } },
    ],
  };
}

/** Circle as two half arcs (SolidWorks style) or one full-circle seam edge. */
export function circle(center: Point, r: number, edges: 1 | 2 = 2): Profile {
  const start = { x: center.x + r, y: center.y };
  if (edges === 1) return { start, segments: [{ kind: "arc", to: start, center, ccw: true }] };
  return {
    start,
    segments: [
      { kind: "arc", to: { x: center.x - r, y: center.y }, center, ccw: true },
      { kind: "arc", to: start, center, ccw: true },
    ],
  };
}

/** L profile: leg `a` along +u, leg `b` along +v, thickness `t`, inner bend radius `r`. Counter-clockwise. */
export function lProfile(a: number, b: number, t: number, r: number): Profile {
  return {
    start: { x: r + t, y: 0 },
    segments: [
      { kind: "line", to: { x: a, y: 0 } },
      { kind: "line", to: { x: a, y: t } },
      { kind: "line", to: { x: t + r, y: t } },
      { kind: "arc", to: { x: t, y: t + r }, center: { x: t + r, y: t + r }, ccw: false },
      { kind: "line", to: { x: t, y: b } },
      { kind: "line", to: { x: 0, y: b } },
      { kind: "line", to: { x: 0, y: r + t } },
      { kind: "arc", to: { x: r + t, y: 0 }, center: { x: r + t, y: r + t }, ccw: true },
    ],
  };
}

/** Frame for the tests' "xz" layout: profile (u, v) → (x, z), extruded along y. */
export const FRAME_XZ: ExtrusionFrame = { origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, ref: { x: 1, y: 0, z: 0 } };
