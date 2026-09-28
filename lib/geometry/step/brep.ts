/**
 * Geometry engine — evaluation of a parsed STEP file into a boundary
 * representation: bodies → faces → bounds → oriented edges → 3D curves.
 * File path: /lib/geometry/step/brep.ts
 *
 * Only what the sheet-metal analysis needs (analyse.ts) is evaluated:
 * points, directions, placements, the curve types exporters write for
 * sheet parts (LINE, CIRCLE, ELLIPSE, B_SPLINE_CURVE_WITH_KNOTS with or
 * without RATIONAL weights, POLYLINE) and the surface types that decide
 * whether a part is a flat sheet (PLANE, CYLINDRICAL/CONICAL/TOROIDAL/
 * SPHERICAL_SURFACE; everything else is "other"). SURFACE_CURVE /
 * SEAM_CURVE / TRIMMED_CURVE wrappers are unwrapped to their 3D basis
 * curve; edges are trimmed by their vertices, never by parameters.
 *
 * Decisions:
 *   - Coordinates are scaled to millimetres from the file's LENGTH_UNIT
 *     (SI_UNIT prefix or a CONVERSION_BASED_UNIT such as INCH); a file
 *     without a length unit is taken as millimetres, reported in warnings.
 *   - Assembly placements (MAPPED_ITEM / ITEM_DEFINED_TRANSFORMATION) are
 *     ignored: every body is evaluated in its own coordinates, which is
 *     all thickness, size and outline extraction need. Multi-body files
 *     are reported as such by analyse.ts and never merged.
 *   - Bodies come from MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS (outer shell
 *     only), FACETED_BREP, SHELL_BASED_SURFACE_MODEL and, when none of
 *     those exist, all faces found in the file as one open shell.
 *   - A damaged reference (missing instance, wrong type) drops the edge
 *     or face and adds a warning; nothing throws below parseStep.
 *   - Circle and ellipse edges keep their analytic definition so the flat
 *     outline can become exact arcs; sampleEdge() flattens any edge to a
 *     3D polyline with the requested chord error (B-splines by de Boor).
 */

import {
  asBool,
  asNumber,
  asNumbers,
  asRef,
  asRefs,
  isEnum,
  isList,
  isRef,
  part,
  type StepFile,
  type StepInstance,
  type StepValue,
} from "./part21";

/* ─── 3D vectors ────────────────────────────────────────────── */

export type Vec3 = { x: number; y: number; z: number };

export const V0: Vec3 = { x: 0, y: 0, z: 0 };
export const VZ: Vec3 = { x: 0, y: 0, z: 1 };
export const VX: Vec3 = { x: 1, y: 0, z: 0 };

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}
export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale3(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}
export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function len3(a: Vec3): number {
  return Math.sqrt(dot3(a, a));
}
export function dist3(a: Vec3, b: Vec3): number {
  return len3(sub3(a, b));
}
export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l < 1e-12 ? { ...a } : scale3(a, 1 / l);
}
/** Distance from p to the segment ab. */
export function distPointToSegment3(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub3(b, a);
  const l2 = dot3(ab, ab);
  if (l2 < 1e-18) return dist3(p, a);
  const t = Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / l2));
  return dist3(p, add3(a, scale3(ab, t)));
}

/* ─── Model types ───────────────────────────────────────────── */

/** AXIS2_PLACEMENT_3D: origin, z axis, x (ref) and the derived y. All unit vectors. */
export type Placement = { origin: Vec3; axis: Vec3; ref: Vec3; y: Vec3 };

export type Curve3 =
  | { kind: "line"; point: Vec3; dir: Vec3 }
  | { kind: "circle"; placement: Placement; radius: number }
  | { kind: "ellipse"; placement: Placement; semi1: number; semi2: number }
  | { kind: "bspline"; degree: number; controlPoints: Vec3[]; knots: number[]; weights: number[] | null }
  | { kind: "polyline"; points: Vec3[] }
  | { kind: "other"; type: string };

export type Surface3 =
  | { kind: "plane"; placement: Placement }
  | { kind: "cylinder"; placement: Placement; radius: number }
  | { kind: "cone"; placement: Placement; radius: number; semiAngleDeg: number }
  | { kind: "torus"; placement: Placement; majorRadius: number; minorRadius: number }
  | { kind: "sphere"; placement: Placement; radius: number }
  | { kind: "other"; type: string };

export type Edge3 = {
  id: number;
  start: Vec3;
  end: Vec3;
  curve: Curve3;
  /** EDGE_CURVE same_sense: the edge runs along the curve's parametrisation. */
  sameSense: boolean;
};

export type OrientedEdge3 = { edge: Edge3; orientation: boolean };

export type Loop3 = { id: number; edges: OrientedEdge3[] };

export type Face3 = {
  id: number;
  surface: Surface3;
  /** ADVANCED_FACE same_sense: the face normal is the surface normal (else flipped). */
  sameSense: boolean;
  outer: Loop3 | null;
  inner: Loop3[];
};

export type Body3 = { id: number; kind: "solid" | "shell"; faces: Face3[] };

export type BrepModel = {
  /** Factor already applied to every coordinate (25.4 for inch files, 1 for mm). */
  unitScale: number;
  unitName: "mm" | "inch" | "unknown";
  bodies: Body3[];
  warnings: string[];
};

/* ─── Evaluation ────────────────────────────────────────────── */

const MAX_WARNINGS = 20;

class Evaluator {
  readonly warnings: string[] = [];
  private warned = 0;
  private readonly points = new Map<number, Vec3>();
  private readonly dirs = new Map<number, Vec3>();
  private readonly placements = new Map<number, Placement>();
  private readonly curves = new Map<number, Curve3>();
  private readonly surfaces = new Map<number, Surface3>();
  private readonly edges = new Map<number, Edge3 | null>();
  private readonly loops = new Map<number, Loop3 | null>();
  private readonly faces = new Map<number, Face3 | null>();
  unitScale = 1;
  unitName: BrepModel["unitName"] = "unknown";

  constructor(readonly file: StepFile) {}

  warn(message: string): void {
    this.warned++;
    if (this.warned <= MAX_WARNINGS) this.warnings.push(message);
    else if (this.warned === MAX_WARNINGS + 1) this.warnings.push("further warnings suppressed");
  }

  inst(id: number | null): StepInstance | null {
    if (id === null) return null;
    return this.file.instances.get(id) ?? null;
  }

  /* Units */

  resolveUnits(): void {
    // The unit the geometry is expressed in is the LENGTH_UNIT assigned to
    // the representation context; a conversion unit (INCH) is defined in
    // terms of a base unit that also carries LENGTH_UNIT, so scanning all
    // LENGTH_UNITs in file order would pick the base first.
    const candidates: number[] = [];
    for (const ctxId of this.file.byType.get("GLOBAL_UNIT_ASSIGNED_CONTEXT") ?? []) {
      const ctx = this.inst(ctxId);
      const p = ctx ? part(ctx, "GLOBAL_UNIT_ASSIGNED_CONTEXT") : null;
      if (p) for (const ref of asRefs(p.args[0])) candidates.push(ref);
    }
    for (const id of this.file.byType.get("LENGTH_UNIT") ?? []) candidates.push(id);
    for (const id of candidates) {
      const inst = this.inst(id);
      if (!inst || !part(inst, "LENGTH_UNIT")) continue;
      const factor = this.lengthUnitFactor(inst, 0);
      if (factor !== null) {
        this.unitScale = factor;
        this.unitName = Math.abs(factor - 25.4) < 1e-6 ? "inch" : "mm";
        return;
      }
    }
    this.warn("no LENGTH_UNIT found; coordinates taken as millimetres");
  }

  /** Millimetres per unit of `inst`, or null when the unit is not a length unit we know. */
  private lengthUnitFactor(inst: StepInstance, depth: number): number | null {
    if (depth > 4) return null;
    const si = part(inst, "SI_UNIT");
    if (si) {
      const prefix = si.args[0];
      const name = si.args[1];
      if (!isEnum(name) || name.enum !== "METRE") return null;
      const p = isEnum(prefix) ? prefix.enum : "";
      switch (p) {
        case "MILLI":
          return 1;
        case "CENTI":
          return 10;
        case "DECI":
          return 100;
        case "":
          return 1000;
        case "MICRO":
          return 0.001;
        default:
          return null;
      }
    }
    const conv = part(inst, "CONVERSION_BASED_UNIT");
    if (conv) {
      const measure = this.inst(asRef(conv.args[1]));
      if (!measure) return null;
      const mwu = part(measure, "LENGTH_MEASURE_WITH_UNIT") ?? part(measure, "MEASURE_WITH_UNIT");
      if (!mwu) return null;
      const value = asNumber(mwu.args[0]);
      const base = this.inst(asRef(mwu.args[1]));
      if (value === null || !base) return null;
      const baseFactor = this.lengthUnitFactor(base, depth + 1);
      return baseFactor === null ? null : value * baseFactor;
    }
    return null;
  }

  /* Points and directions */

  point(id: number | null): Vec3 | null {
    if (id === null) return null;
    const cached = this.points.get(id);
    if (cached) return cached;
    const inst = this.inst(id);
    const p = inst ? part(inst, "CARTESIAN_POINT") : null;
    if (!p) return null;
    const c = asNumbers(p.args[1]);
    if (c.length < 2) return null;
    const s = this.unitScale;
    const v = v3(c[0] * s, c[1] * s, (c[2] ?? 0) * s);
    this.points.set(id, v);
    return v;
  }

  direction(id: number | null): Vec3 | null {
    if (id === null) return null;
    const cached = this.dirs.get(id);
    if (cached) return cached;
    const inst = this.inst(id);
    const d = inst ? part(inst, "DIRECTION") : null;
    if (!d) return null;
    const c = asNumbers(d.args[1]);
    if (c.length < 2) return null;
    const v = norm3(v3(c[0], c[1], c[2] ?? 0));
    this.dirs.set(id, v);
    return v;
  }

  placement(id: number | null): Placement | null {
    if (id === null) return null;
    const cached = this.placements.get(id);
    if (cached) return cached;
    const inst = this.inst(id);
    const a = inst ? part(inst, "AXIS2_PLACEMENT_3D") : null;
    if (!a) return null;
    const origin = this.point(asRef(a.args[1])) ?? V0;
    const axis = this.direction(asRef(a.args[2])) ?? VZ;
    let ref = this.direction(asRef(a.args[3]));
    if (!ref || Math.abs(dot3(ref, axis)) > 0.999) {
      // Any direction not parallel to the axis.
      const seed = Math.abs(axis.x) < 0.9 ? VX : v3(0, 1, 0);
      ref = seed;
    }
    // Orthogonalise ref against the axis.
    ref = norm3(sub3(ref, scale3(axis, dot3(ref, axis))));
    const y = cross3(axis, ref);
    const p: Placement = { origin, axis, ref, y };
    this.placements.set(id, p);
    return p;
  }

  /* Curves */

  curve(id: number | null, depth = 0): Curve3 | null {
    if (id === null) return null;
    const cached = this.curves.get(id);
    if (cached) return cached;
    const inst = this.inst(id);
    if (!inst) return null;
    const c = this.evalCurve(inst, depth);
    if (c) this.curves.set(id, c);
    return c;
  }

  private evalCurve(inst: StepInstance, depth: number): Curve3 | null {
    if (depth > 4) return null;
    const line = part(inst, "LINE");
    if (line) {
      const point = this.point(asRef(line.args[1]));
      const vec = this.inst(asRef(line.args[2]));
      const vp = vec ? part(vec, "VECTOR") : null;
      const dir = vp ? this.direction(asRef(vp.args[1])) : null;
      if (!point || !dir) return null;
      return { kind: "line", point, dir };
    }
    const circle = part(inst, "CIRCLE");
    if (circle) {
      const placement = this.placement(asRef(circle.args[1]));
      const radius = asNumber(circle.args[2]);
      if (!placement || radius === null) return null;
      return { kind: "circle", placement, radius: radius * this.unitScale };
    }
    const ellipse = part(inst, "ELLIPSE");
    if (ellipse) {
      const placement = this.placement(asRef(ellipse.args[1]));
      const semi1 = asNumber(ellipse.args[2]);
      const semi2 = asNumber(ellipse.args[3]);
      if (!placement || semi1 === null || semi2 === null) return null;
      return { kind: "ellipse", placement, semi1: semi1 * this.unitScale, semi2: semi2 * this.unitScale };
    }
    const bspline = this.evalBspline(inst);
    if (bspline) return bspline;
    const poly = part(inst, "POLYLINE");
    if (poly) {
      const points: Vec3[] = [];
      for (const ref of asRefs(poly.args[1])) {
        const p = this.point(ref);
        if (p) points.push(p);
      }
      return points.length >= 2 ? { kind: "polyline", points } : null;
    }
    // Wrappers around a 3D basis curve.
    const wrapper = part(inst, "SURFACE_CURVE") ?? part(inst, "SEAM_CURVE") ?? part(inst, "TRIMMED_CURVE") ?? part(inst, "BOUNDED_SURFACE_CURVE");
    if (wrapper) {
      const basis = this.curve(asRef(wrapper.args[1]), depth + 1);
      if (basis) return basis;
    }
    const composite = part(inst, "COMPOSITE_CURVE");
    if (composite) {
      // Flatten the segments' curves to one polyline (rare on sheet parts).
      const points: Vec3[] = [];
      for (const segRef of asRefs(composite.args[1])) {
        const seg = this.inst(segRef);
        const cs = seg ? part(seg, "COMPOSITE_CURVE_SEGMENT") : null;
        const sub = cs ? this.curve(asRef(cs.args[2]), depth + 1) : null;
        if (!sub) continue;
        const pts = sampleCurveFull(sub, 0.05);
        for (const p of pts) points.push(p);
      }
      return points.length >= 2 ? { kind: "polyline", points } : null;
    }
    return { kind: "other", type: inst.type || inst.complex.map((p) => p.type).join("+") };
  }

  private evalBspline(inst: StepInstance): Curve3 | null {
    const withKnots = part(inst, "B_SPLINE_CURVE_WITH_KNOTS");
    const base = part(inst, "B_SPLINE_CURVE");
    if (!withKnots && !base) return null;
    let degree: number | null;
    let pointRefs: number[];
    let mults: number[];
    let knots: number[];
    if (inst.type === "B_SPLINE_CURVE_WITH_KNOTS" && withKnots) {
      // Simple form: ('', degree, (points), form, closed, selfint, (mults), (knots), spec)
      degree = asNumber(withKnots.args[1]);
      pointRefs = asRefs(withKnots.args[2]);
      mults = asNumbers(withKnots.args[6]);
      knots = asNumbers(withKnots.args[7]);
    } else if (base && withKnots) {
      // Complex form: B_SPLINE_CURVE(degree, (points), form, closed, selfint) + B_SPLINE_CURVE_WITH_KNOTS((mults), (knots), spec)
      degree = asNumber(base.args[0]);
      pointRefs = asRefs(base.args[1]);
      mults = asNumbers(withKnots.args[0]);
      knots = asNumbers(withKnots.args[1]);
    } else {
      return null;
    }
    if (degree === null || degree < 1 || pointRefs.length < degree + 1 || mults.length !== knots.length) return null;
    const controlPoints: Vec3[] = [];
    for (const ref of pointRefs) {
      const p = this.point(ref);
      if (!p) return null;
      controlPoints.push(p);
    }
    const expanded: number[] = [];
    for (let i = 0; i < knots.length; i++) for (let k = 0; k < mults[i]; k++) expanded.push(knots[i]);
    if (expanded.length !== controlPoints.length + degree + 1) return null;
    const rational = part(inst, "RATIONAL_B_SPLINE_CURVE");
    let weights: number[] | null = null;
    if (rational) {
      const w = asNumbers(rational.args[0]);
      if (w.length === controlPoints.length) weights = w;
    }
    return { kind: "bspline", degree, controlPoints, knots: expanded, weights };
  }

  /* Surfaces */

  surface(id: number | null): Surface3 | null {
    if (id === null) return null;
    const cached = this.surfaces.get(id);
    if (cached) return cached;
    const inst = this.inst(id);
    if (!inst) return null;
    const s = this.evalSurface(inst);
    if (s) this.surfaces.set(id, s);
    return s;
  }

  private evalSurface(inst: StepInstance): Surface3 | null {
    const plane = part(inst, "PLANE");
    if (plane) {
      const placement = this.placement(asRef(plane.args[1]));
      return placement ? { kind: "plane", placement } : null;
    }
    const cyl = part(inst, "CYLINDRICAL_SURFACE");
    if (cyl) {
      const placement = this.placement(asRef(cyl.args[1]));
      const radius = asNumber(cyl.args[2]);
      return placement && radius !== null ? { kind: "cylinder", placement, radius: radius * this.unitScale } : null;
    }
    const cone = part(inst, "CONICAL_SURFACE");
    if (cone) {
      const placement = this.placement(asRef(cone.args[1]));
      const radius = asNumber(cone.args[2]);
      const angle = asNumber(cone.args[3]);
      return placement && radius !== null && angle !== null
        ? { kind: "cone", placement, radius: radius * this.unitScale, semiAngleDeg: (angle * 180) / Math.PI }
        : null;
    }
    const torus = part(inst, "TOROIDAL_SURFACE");
    if (torus) {
      const placement = this.placement(asRef(torus.args[1]));
      const major = asNumber(torus.args[2]);
      const minor = asNumber(torus.args[3]);
      return placement && major !== null && minor !== null
        ? { kind: "torus", placement, majorRadius: major * this.unitScale, minorRadius: minor * this.unitScale }
        : null;
    }
    const sphere = part(inst, "SPHERICAL_SURFACE");
    if (sphere) {
      const placement = this.placement(asRef(sphere.args[1]));
      const radius = asNumber(sphere.args[2]);
      return placement && radius !== null ? { kind: "sphere", placement, radius: radius * this.unitScale } : null;
    }
    return { kind: "other", type: inst.type || inst.complex.map((p) => p.type).join("+") };
  }

  /* Topology */

  vertex(id: number | null): Vec3 | null {
    const inst = this.inst(id);
    const vp = inst ? part(inst, "VERTEX_POINT") : null;
    return vp ? this.point(asRef(vp.args[1])) : null;
  }

  edge(id: number): Edge3 | null {
    const cached = this.edges.get(id);
    if (cached !== undefined) return cached;
    const inst = this.inst(id);
    const ec = inst ? part(inst, "EDGE_CURVE") : null;
    let result: Edge3 | null = null;
    if (ec) {
      const start = this.vertex(asRef(ec.args[1]));
      const end = this.vertex(asRef(ec.args[2]));
      const curve = this.curve(asRef(ec.args[3]));
      const sameSense = asBool(ec.args[4]) ?? true;
      if (start && end && curve) result = { id, start, end, curve, sameSense };
      else this.warn(`edge #${id}: missing vertex or curve`);
    } else {
      this.warn(`#${id} is not an EDGE_CURVE`);
    }
    this.edges.set(id, result);
    return result;
  }

  loop(id: number): Loop3 | null {
    const cached = this.loops.get(id);
    if (cached !== undefined) return cached;
    const inst = this.inst(id);
    let result: Loop3 | null = null;
    const edgeLoop = inst ? part(inst, "EDGE_LOOP") : null;
    const polyLoop = inst ? part(inst, "POLY_LOOP") : null;
    if (edgeLoop) {
      const edges: OrientedEdge3[] = [];
      for (const oeRef of asRefs(edgeLoop.args[1])) {
        const oeInst = this.inst(oeRef);
        const oe = oeInst ? part(oeInst, "ORIENTED_EDGE") : null;
        if (!oe) {
          // Some writers reference EDGE_CURVEs directly.
          const direct = this.edge(oeRef);
          if (direct) edges.push({ edge: direct, orientation: true });
          continue;
        }
        const edgeRef = asRef(oe.args[3]);
        const edge = edgeRef === null ? null : this.edge(edgeRef);
        if (edge) edges.push({ edge, orientation: asBool(oe.args[4]) ?? true });
      }
      result = { id, edges };
    } else if (polyLoop) {
      const pts: Vec3[] = [];
      for (const ref of asRefs(polyLoop.args[1])) {
        const p = this.point(ref);
        if (p) pts.push(p);
      }
      const edges: OrientedEdge3[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        edges.push({ edge: { id: -1, start: a, end: b, curve: { kind: "line", point: a, dir: norm3(sub3(b, a)) }, sameSense: true }, orientation: true });
      }
      result = { id, edges };
    } else if (inst && part(inst, "VERTEX_LOOP")) {
      result = { id, edges: [] };
    } else {
      this.warn(`#${id} is not an EDGE_LOOP`);
    }
    this.loops.set(id, result);
    return result;
  }

  private boundsOf(refs: number[]): { outer: Loop3 | null; inner: Loop3[] } {
    let outer: Loop3 | null = null;
    const inner: Loop3[] = [];
    const bounds: { loop: Loop3; outer: boolean }[] = [];
    for (const bRef of refs) {
      const bInst = this.inst(bRef);
      const fob = bInst ? part(bInst, "FACE_OUTER_BOUND") : null;
      const fb = bInst ? (fob ?? part(bInst, "FACE_BOUND")) : null;
      if (!fb) continue;
      const loopRef = asRef(fb.args[1]);
      const loop = loopRef === null ? null : this.loop(loopRef);
      if (loop) bounds.push({ loop, outer: fob !== null });
    }
    for (const b of bounds) {
      if (b.outer && !outer) outer = b.loop;
      else inner.push(b.loop);
    }
    if (!outer && inner.length > 0) {
      // No FACE_OUTER_BOUND written (some exporters): the longest loop is the outer one.
      const longest = inner.reduce((best, l) => (loopLength(l) > loopLength(best) ? l : best), inner[0]);
      outer = longest;
      inner.splice(inner.indexOf(longest), 1);
    }
    return { outer, inner };
  }

  face(id: number): Face3 | null {
    const cached = this.faces.get(id);
    if (cached !== undefined) return cached;
    const inst = this.inst(id);
    const af = inst ? (part(inst, "ADVANCED_FACE") ?? part(inst, "FACE_SURFACE")) : null;
    const plain = !af && inst ? part(inst, "FACE") : null;
    let result: Face3 | null = null;
    if (af) {
      const surface = this.surface(asRef(af.args[2]));
      if (!surface) this.warn(`face #${id}: unreadable surface`);
      else result = { id, surface, sameSense: asBool(af.args[3]) ?? true, ...this.boundsOf(asRefs(af.args[1])) };
    } else if (plain) {
      // FACE without a surface (FACETED_BREP): the plane through its polygon.
      const { outer, inner } = this.boundsOf(asRefs(plain.args[1]));
      const pts = outer ? loopPolyline(outer, 1) : [];
      const normal = newellNormal(pts);
      if (outer && normal) result = { id, surface: { kind: "plane", placement: placementFromNormal(pts[0], normal) }, sameSense: true, outer, inner };
      else this.warn(`face #${id}: degenerate polygon`);
    } else if (inst) {
      this.warn(`#${id} is not a face`);
    }
    this.faces.set(id, result);
    return result;
  }

  shellFaces(shellId: number | null): Face3[] {
    const inst = this.inst(shellId);
    const shell = inst ? (part(inst, "CLOSED_SHELL") ?? part(inst, "OPEN_SHELL")) : null;
    if (!shell) return [];
    const faces: Face3[] = [];
    for (const ref of asRefs(shell.args[1])) {
      const f = this.face(ref);
      if (f) faces.push(f);
    }
    return faces;
  }

  bodies(): Body3[] {
    const out: Body3[] = [];
    const seenShells = new Set<number>();
    const solidTypes = ["MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "FACETED_BREP"];
    for (const type of solidTypes) {
      for (const id of this.file.byType.get(type) ?? []) {
        const inst = this.inst(id);
        const p = inst ? part(inst, type) : null;
        if (!p) continue;
        const shellRef = asRef(p.args[1]);
        if (shellRef === null || seenShells.has(shellRef)) continue;
        seenShells.add(shellRef);
        const faces = this.shellFaces(shellRef);
        if (faces.length) out.push({ id, kind: "solid", faces });
      }
    }
    for (const id of this.file.byType.get("SHELL_BASED_SURFACE_MODEL") ?? []) {
      const inst = this.inst(id);
      const p = inst ? part(inst, "SHELL_BASED_SURFACE_MODEL") : null;
      if (!p) continue;
      for (const shellRef of asRefs(p.args[1])) {
        if (seenShells.has(shellRef)) continue;
        seenShells.add(shellRef);
        const faces = this.shellFaces(shellRef);
        if (faces.length) out.push({ id, kind: "shell", faces });
      }
    }
    if (out.length === 0) {
      // No solid structure: every face in the file as one open shell.
      const faces: Face3[] = [];
      for (const type of ["ADVANCED_FACE", "FACE_SURFACE"]) {
        for (const id of this.file.byType.get(type) ?? []) {
          const f = this.face(id);
          if (f) faces.push(f);
        }
      }
      if (faces.length) out.push({ id: 0, kind: "shell", faces });
    }
    return out;
  }
}

/** Unit normal of a planar polygon by Newell's method, or null when degenerate. */
export function newellNormal(pts: Vec3[]): Vec3 | null {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  const l = Math.sqrt(x * x + y * y + z * z);
  return l < 1e-12 ? null : { x: x / l, y: y / l, z: z / l };
}

/** Placement with the given axis and any perpendicular reference direction. */
export function placementFromNormal(origin: Vec3, axis: Vec3): Placement {
  const seed = Math.abs(axis.x) < 0.9 ? VX : v3(0, 1, 0);
  const ref = norm3(sub3(seed, scale3(axis, dot3(seed, axis))));
  return { origin, axis, ref, y: cross3(axis, ref) };
}

function loopLength(loop: Loop3): number {
  let total = 0;
  for (const oe of loop.edges) total += dist3(oe.edge.start, oe.edge.end);
  return total;
}

/** Evaluate every body of a parsed STEP file. Never throws. */
export function evaluateBrep(file: StepFile): BrepModel {
  const ev = new Evaluator(file);
  ev.resolveUnits();
  const bodies = ev.bodies();
  return { unitScale: ev.unitScale, unitName: ev.unitName, bodies, warnings: [...file.warnings, ...ev.warnings] };
}

/** AXIS2_PLACEMENT_3D reader with the file's unit scale applied (assembly placements). */
export function placementReader(file: StepFile): (id: number | null) => Placement | null {
  const ev = new Evaluator(file);
  ev.resolveUnits();
  return (id) => ev.placement(id);
}

/* ─── Curve evaluation ──────────────────────────────────────── */

/** Point of a circle / ellipse at angle `rad` around its placement axis (CCW seen from +axis). */
export function pointOnPlacement(p: Placement, rx: number, ry: number, rad: number): Vec3 {
  return add3(p.origin, add3(scale3(p.ref, rx * Math.cos(rad)), scale3(p.y, ry * Math.sin(rad))));
}

/** Angle (radians, [0, 2π)) of point `pt` around the placement, measured from `ref` towards `y`. */
export function angleOnPlacement(p: Placement, pt: Vec3): number {
  const d = sub3(pt, p.origin);
  const a = Math.atan2(dot3(d, p.y), dot3(d, p.ref));
  return a < 0 ? a + 2 * Math.PI : a;
}

/** de Boor evaluation of a (rational) B-spline at parameter u. */
export function evalBspline(c: Extract<Curve3, { kind: "bspline" }>, u: number): Vec3 {
  const p = c.degree;
  const U = c.knots;
  const n = c.controlPoints.length;
  const uMin = U[p];
  const uMax = U[n];
  const t = Math.min(Math.max(u, uMin), uMax);
  let k = p;
  if (t >= uMax) {
    k = n - 1;
  } else {
    while (k < n - 1 && !(t >= U[k] && t < U[k + 1])) k++;
  }
  const w = c.weights;
  const d: { x: number; y: number; z: number; w: number }[] = [];
  for (let j = 0; j <= p; j++) {
    const idx = k - p + j;
    const cp = c.controlPoints[idx];
    const wi = w ? w[idx] : 1;
    d.push({ x: cp.x * wi, y: cp.y * wi, z: cp.z * wi, w: wi });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const lo = U[j + k - p];
      const hi = U[j + 1 + k - r];
      const alpha = hi - lo < 1e-15 ? 0 : (t - lo) / (hi - lo);
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        z: (1 - alpha) * d[j - 1].z + alpha * d[j].z,
        w: (1 - alpha) * d[j - 1].w + alpha * d[j].w,
      };
    }
  }
  const res = d[p];
  const ww = Math.abs(res.w) < 1e-15 ? 1 : res.w;
  return v3(res.x / ww, res.y / ww, res.z / ww);
}

/** Adaptive sampling of a 3D parametric curve to within `chordError`. */
export function sample3(f: (t: number) => Vec3, t0: number, t1: number, chordError: number, initialSpans = 8, maxDepth = 10): Vec3[] {
  const out: Vec3[] = [f(t0)];
  const refine = (a: number, b: number, pa: Vec3, pb: Vec3, depth: number) => {
    const m = (a + b) / 2;
    const pm = f(m);
    const err = distPointToSegment3(pm, pa, pb);
    if (depth < maxDepth && (err > chordError || depth < 1)) {
      refine(a, m, pa, pm, depth + 1);
      refine(m, b, pm, pb, depth + 1);
    } else {
      out.push(pb);
    }
  };
  let prevT = t0;
  let prevP = out[0];
  for (let i = 1; i <= initialSpans; i++) {
    const t = t0 + ((t1 - t0) * i) / initialSpans;
    const p = f(t);
    refine(prevT, t, prevP, p, 0);
    prevT = t;
    prevP = p;
  }
  return out;
}

/** The whole curve as a polyline (its natural parameter range). Used for wrappers only. */
function sampleCurveFull(curve: Curve3, chordError: number): Vec3[] {
  switch (curve.kind) {
    case "line":
      return [curve.point, add3(curve.point, curve.dir)];
    case "circle":
      return sample3((t) => pointOnPlacement(curve.placement, curve.radius, curve.radius, t), 0, 2 * Math.PI, chordError, 16);
    case "ellipse":
      return sample3((t) => pointOnPlacement(curve.placement, curve.semi1, curve.semi2, t), 0, 2 * Math.PI, chordError, 16);
    case "bspline":
      return sample3((t) => evalBspline(curve, t), curve.knots[curve.degree], curve.knots[curve.controlPoints.length], chordError);
    case "polyline":
      return curve.points;
    case "other":
      return [];
  }
}

/**
 * Flatten an edge to points from its start vertex to its end vertex, along
 * the edge's own direction (ORIENTED_EDGE orientation is applied by the
 * caller when it walks a loop). Straight edges yield two points; a full
 * circle / ellipse (start = end) yields the closed polyline.
 */
export function sampleEdge(edge: Edge3, chordError: number): Vec3[] {
  const c = edge.curve;
  switch (c.kind) {
    case "line":
      return [edge.start, edge.end];
    case "circle":
    case "ellipse": {
      const rx = c.kind === "circle" ? c.radius : c.semi1;
      const ry = c.kind === "circle" ? c.radius : c.semi2;
      const a0 = angleOnPlacement(c.placement, edge.start);
      let a1 = angleOnPlacement(c.placement, edge.end);
      const full = dist3(edge.start, edge.end) < 1e-6;
      let sweep: number;
      if (full) sweep = 2 * Math.PI;
      else if (edge.sameSense) sweep = a1 >= a0 ? a1 - a0 : a1 - a0 + 2 * Math.PI;
      else sweep = a1 <= a0 ? a1 - a0 : a1 - a0 - 2 * Math.PI;
      if (full && !edge.sameSense) sweep = -sweep;
      a1 = a0 + sweep;
      const spans = Math.max(4, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * 16));
      const pts = sample3((t) => pointOnPlacement(c.placement, rx, ry, t), a0, a1, chordError, spans);
      // Pin the ends to the vertices (the angle round trip is not exact).
      pts[0] = edge.start;
      pts[pts.length - 1] = edge.end;
      return pts;
    }
    case "bspline": {
      const u0 = c.knots[c.degree];
      const u1 = c.knots[c.controlPoints.length];
      let pts = sample3((t) => evalBspline(c, t), u0, u1, chordError);
      if (!edge.sameSense) pts = pts.reverse();
      // Some writers store the edge against the curve's direction without clearing same_sense.
      if (dist3(pts[0], edge.start) > dist3(pts[pts.length - 1], edge.start)) pts = pts.reverse();
      pts[0] = edge.start;
      pts[pts.length - 1] = edge.end;
      return pts;
    }
    case "polyline": {
      let pts = [...c.points];
      if (!edge.sameSense) pts = pts.reverse();
      if (dist3(pts[0], edge.start) > dist3(pts[pts.length - 1], edge.start)) pts = pts.reverse();
      return pts;
    }
    case "other":
      return [edge.start, edge.end];
  }
}

/** Walk a loop as a closed 3D polyline (points in traversal order, first ≠ last). */
export function loopPolyline(loop: Loop3, chordError: number): Vec3[] {
  const out: Vec3[] = [];
  for (const oe of loop.edges) {
    let pts = sampleEdge(oe.edge, chordError);
    if (!oe.orientation) pts = [...pts].reverse();
    for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
  }
  return out;
}

export function isStepValueList(v: StepValue): v is StepValue[] {
  return isList(v);
}

export function refOf(v: StepValue): number | null {
  return isRef(v) ? v.ref : null;
}
