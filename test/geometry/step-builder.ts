/**
 * Test helper — writes ISO 10303-21 (STEP AP214) text for prisms.
 * File path: /test/geometry/step-builder.ts
 *
 * A closed 2D profile (lines and arcs, with optional hole profiles) is
 * extruded along a third axis into a MANIFOLD_SOLID_BREP the way CAD
 * exporters write it: planar caps with FACE_OUTER_BOUND / FACE_BOUND
 * loops, one planar side face per line segment, one CYLINDRICAL_SURFACE
 * face per arc, shared VERTEX_POINTs, ORIENTED_EDGEs with the bottom cap
 * traversed the other way round, a representation context with SI or
 * inch units. Enough to exercise the reader on flat plates with holes
 * (two half-circle edges, or one seam-edge full circle), bent brackets
 * (coaxial inner/outer bend cylinders) and multi-body files.
 */

export type P = { x: number; y: number };

export type ProfileSegment =
  | { kind: "line"; to: P }
  | { kind: "arc"; to: P; center: P; ccw: boolean };

/** Closed profile: the last segment ends at `start`. */
export type Profile = { start: P; segments: ProfileSegment[] };

export type Frame = "xy" | "xz";

export type PrismSpec = {
  name?: string;
  outer: Profile;
  holes?: Profile[];
  /** Extrusion length along the frame's third axis. */
  height: number;
  /** "xy": profile (u,v) → (x,y), extruded along z. "xz": (u,v) → (x,z), extruded along y. */
  frame?: Frame;
};

export type BuildOptions = {
  unit?: "mm" | "inch" | "m";
  originatingSystem?: string;
  /** Write every cap bound as FACE_BOUND (no FACE_OUTER_BOUND), as some exporters do. */
  noOuterBound?: boolean;
};

/* ─── Profile helpers ───────────────────────────────────────── */

export function rect(w: number, h: number, at: P = { x: 0, y: 0 }): Profile {
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
export function circle(center: P, r: number, edges: 1 | 2 = 2): Profile {
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

/**
 * L profile: leg `a` along +u, leg `b` along +v, thickness `t`, inner bend
 * radius `r` (outer r + t). Counter-clockwise.
 */
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

/* ─── Writer ────────────────────────────────────────────────── */

type V3 = [number, number, number];

function fmt(n: number): string {
  if (Number.isInteger(n)) return `${n}.`;
  const s = String(Math.round(n * 1e9) / 1e9);
  return s.includes(".") || s.includes("e") ? s.replace("e", "E") : `${s}.`;
}

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

  point(p: V3): number {
    const key = p.map((c) => Math.round(c * 1e6)).join(",");
    const cached = this.points.get(key);
    if (cached) return cached;
    const id = this.add(`CARTESIAN_POINT('',(${p.map(fmt).join(",")}))`);
    this.points.set(key, id);
    return id;
  }

  vertex(p: V3): number {
    const key = p.map((c) => Math.round(c * 1e6)).join(",");
    const cached = this.vertices.get(key);
    if (cached) return cached;
    const id = this.add(`VERTEX_POINT('',#${this.point(p)})`);
    this.vertices.set(key, id);
    return id;
  }

  direction(d: V3): number {
    const key = d.map((c) => Math.round(c * 1e6)).join(",");
    const cached = this.dirs.get(key);
    if (cached) return cached;
    const id = this.add(`DIRECTION('',(${d.map(fmt).join(",")}))`);
    this.dirs.set(key, id);
    return id;
  }

  placement(origin: V3, axis: V3, ref: V3): number {
    return this.add(`AXIS2_PLACEMENT_3D('',#${this.point(origin)},#${this.direction(axis)},#${this.direction(ref)})`);
  }
}

type FrameMap = { map(u: number, v: number, w: number): V3; axis: V3; ref: V3; rightHanded: boolean };

function frameOf(frame: Frame): FrameMap {
  if (frame === "xz") {
    // u → x, v → z, w → y. (x, z, y) is left-handed: profile CCW is CW about +y.
    return { map: (u, v, w) => [u, w, v], axis: [0, 1, 0], ref: [1, 0, 0], rightHanded: false };
  }
  return { map: (u, v, w) => [u, v, w], axis: [0, 0, 1], ref: [1, 0, 0], rightHanded: true };
}

type EdgeSet = { bottom: number[]; top: number[]; vertical: number[]; verts: P[] };

function profilePoints(profile: Profile): P[] {
  const pts = [profile.start];
  for (const s of profile.segments) pts.push(s.to);
  pts.pop(); // last "to" is the start again
  return pts;
}

function sub(a: P, b: P): P {
  return { x: a.x - b.x, y: a.y - b.y };
}
function norm(a: P): P {
  const l = Math.hypot(a.x, a.y);
  return { x: a.x / l, y: a.y / l };
}

/** Edges of a profile at heights 0 and h plus the vertical edges at each vertex. */
function profileEdges(w: Writer, f: FrameMap, profile: Profile, h: number): EdgeSet {
  const verts = profilePoints(profile);
  const n = verts.length;
  const bottom: number[] = [];
  const top: number[] = [];
  const vertical: number[] = [];
  const edgeAt = (seg: ProfileSegment, from: P, to: P, z: number): number => {
    const v1 = w.vertex(f.map(from.x, from.y, z));
    const v2 = w.vertex(f.map(to.x, to.y, z));
    if (seg.kind === "line") {
      const d = norm(sub(to, from));
      const dir = f.map(d.x, d.y, 0);
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

function prism(w: Writer, spec: PrismSpec, opts: BuildOptions): number {
  const f = frameOf(spec.frame ?? "xy");
  const h = spec.height;
  const outer = profileEdges(w, f, spec.outer, h);
  const holes = (spec.holes ?? []).map((p) => profileEdges(w, f, p, h));
  const faces: number[] = [];

  const outerBoundType = opts.noOuterBound ? "FACE_BOUND" : "FACE_OUTER_BOUND";
  // Caps.
  for (const [z, forward, sense] of [
    [0, false, ".F."],
    [h, true, ".T."],
  ] as const) {
    const plane = w.add(`PLANE('',#${w.placement(f.map(0, 0, z), f.axis, f.ref)})`);
    const bounds: number[] = [];
    bounds.push(w.add(`${outerBoundType}('',#${orientedLoop(w, z === 0 ? outer.bottom : outer.top, forward)},.T.)`));
    for (const hole of holes) {
      bounds.push(w.add(`FACE_BOUND('',#${orientedLoop(w, z === 0 ? hole.bottom : hole.top, !forward)},.T.)`));
    }
    faces.push(w.add(`ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(",")}),#${plane},${sense})`));
  }

  // Side faces, one per segment of every profile.
  const sides = (profile: Profile, edges: EdgeSet, hole: boolean) => {
    const n = edges.verts.length;
    for (let i = 0; i < n; i++) {
      const seg = profile.segments[i];
      const from = edges.verts[i];
      const eb = edges.bottom[i];
      const et = edges.top[i];
      const vs = edges.vertical[i];
      const ve = edges.vertical[(i + 1) % n];
      const loopEdges = [
        w.add(`ORIENTED_EDGE('',*,*,#${eb},.T.)`),
        w.add(`ORIENTED_EDGE('',*,*,#${ve},.T.)`),
        w.add(`ORIENTED_EDGE('',*,*,#${et},.F.)`),
        w.add(`ORIENTED_EDGE('',*,*,#${vs},.F.)`),
      ];
      const loop = w.add(`EDGE_LOOP('',(${loopEdges.map((id) => `#${id}`).join(",")}))`);
      const bound = w.add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      let surface: number;
      let sense = ".T.";
      if (seg.kind === "line") {
        const d = norm(sub(seg.to, from));
        // Outward normal of a CCW outer profile is (dy, -dx); a hole's is the opposite.
        const nx = hole ? -d.y : d.y;
        const ny = hole ? d.x : -d.x;
        const normal = f.map(nx, ny, 0);
        const ref = f.map(d.x, d.y, 0);
        surface = w.add(`PLANE('',#${w.placement(f.map(from.x, from.y, 0), normal, ref)})`);
      } else {
        const r = Math.hypot(from.x - seg.center.x, from.y - seg.center.y);
        surface = w.add(`CYLINDRICAL_SURFACE('',#${w.placement(f.map(seg.center.x, seg.center.y, 0), f.axis, f.ref)},${fmt(r)})`);
        // Concave arcs (a hole, or the inner bend radius) face inwards.
        const concave = hole ? seg.ccw : !seg.ccw;
        sense = concave ? ".F." : ".T.";
      }
      faces.push(w.add(`ADVANCED_FACE('',(#${bound}),#${surface},${sense})`));
    }
  };
  sides(spec.outer, outer, false);
  spec.holes?.forEach((p, i) => sides(p, holes[i], true));

  const shell = w.add(`CLOSED_SHELL('',(${faces.map((id) => `#${id}`).join(",")}))`);
  return w.add(`MANIFOLD_SOLID_BREP('${spec.name ?? "body"}',#${shell})`);
}

export function buildStep(solids: PrismSpec[], opts: BuildOptions = {}): string {
  const w = new Writer();
  const unit = opts.unit ?? "mm";
  let lengthUnit: number;
  if (unit === "inch") {
    const mm = w.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
    const measure = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#${mm})`);
    const exponents = w.add(`DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)`);
    lengthUnit = w.add(`( CONVERSION_BASED_UNIT('INCH',#${measure}) LENGTH_UNIT() NAMED_UNIT(#${exponents}) )`);
  } else if (unit === "m") {
    lengthUnit = w.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) )`);
  } else {
    lengthUnit = w.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  }
  const angle = w.add(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const solidAngle = w.add(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  const uncertainty = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${lengthUnit},'distance_accuracy_value','')`);
  const context = w.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angle},#${solidAngle})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`
  );
  const origin = w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const bodies = solids.map((s) => prism(w, s, opts));
  w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${origin},${bodies.map((id) => `#${id}`).join(",")}),#${context})`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Synthetic test part'),'2;1');",
    `FILE_NAME('part.step','2026-09-27T00:00:00',('tests'),(''),'${opts.originatingSystem ?? "step-builder"}','${opts.originatingSystem ?? "step-builder"}','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
  ];
  return [...header, ...w.lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
