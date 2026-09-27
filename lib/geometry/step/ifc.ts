/**
 * Geometry engine — IFC (Industry Foundation Classes) models → one STEP
 * part per element.
 * File path: /lib/geometry/step/ifc.ts
 *
 * An IFC file is a Part 21 exchange file with the IFC schema, so part21.ts
 * reads it. Each product with a body representation (IfcPlate, IfcMember,
 * IfcBuildingElementProxy, …) becomes an element whose geometry is
 * rewritten as a STEP AP214 text (write-step.ts): extruded profiles
 * (IfcExtrudedAreaSolid with arbitrary, rectangle or circle profiles —
 * polylines, indexed polycurves with arcs, composite curves, trimmed
 * circles) exactly; faceted and triangulated solids (IfcFacetedBrep,
 * IfcTriangulatedFaceSet, IfcPolygonalFaceSet) as FACETED_BREPs that the
 * mesh reconstruction turns back into flanges and bends. The tool then
 * stores and analyses every element like an uploaded single-part STEP.
 *
 * Decisions:
 *   - Coordinates are scaled to millimetres from the project's LENGTHUNIT
 *     (SI prefix or a conversion-based unit); no unit → millimetres with a
 *     warning. Placements (IfcLocalPlacement, mapped-item operators) are
 *     ignored: each element is analysed in its own coordinates.
 *   - Elements that share an IfcRepresentationMap (or, unmapped, a name)
 *     are the same part used several times: one element with
 *     `occurrences` = the count, so the quote item gets that quantity.
 *   - Boolean results, CSG, revolved / swept solids and IfcAdvancedBrep
 *     are not converted: the element is reported with the type in
 *     `unsupported` and no geometry (the quick part is the fallback).
 *     A faceted face with inner bounds (holes as face voids) is treated
 *     the same way rather than filling the hole.
 *   - Spatial containers, openings, grids, annotations and the assembly
 *     element itself are skipped; the assembly's parts are the elements.
 */

import type { Point } from "../types";
import { asNumber, asNumbers, asRef, asRefs, asString, isEnum, isList, isTyped, type StepFile, type StepInstance, type StepValue } from "./part21";
import { add3, dot3, norm3, scale3, type Vec3 } from "./brep";
import { writeExtrudedStep, writeFacetedStep, type ExtrusionFrame, type ExtrusionSpec, type Profile, type ProfileSegment } from "./write-step";

export type IfcElement = {
  id: number;
  type: string;
  name: string;
  occurrences: number;
  /** STEP text of the element's geometry, or null when nothing could be converted. */
  stepText: string | null;
  /** Representation item types that were not converted. */
  unsupported: string[];
};

export type IfcModel = {
  unitScale: number;
  elements: IfcElement[];
  warnings: string[];
};

export function isIfcFile(file: StepFile): boolean {
  return (file.header.schema ?? "").toUpperCase().startsWith("IFC");
}

const SKIP_TYPES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCOPENINGELEMENT",
  "IFCOPENINGSTANDARDCASE",
  "IFCELEMENTASSEMBLY",
  "IFCGRID",
  "IFCANNOTATION",
  "IFCVIRTUALELEMENT",
  "IFCZONE",
]);

const BODY_IDENTIFIERS = new Set(["BODY", "FACETATION", "SURFACE", ""]);

type Collected = { polygons: Vec3[][]; extrusions: ExtrusionSpec[]; unsupported: string[]; mapKeys: number[] };

class IfcReader {
  readonly warnings: string[] = [];
  unitScale = 1;

  constructor(readonly file: StepFile) {}

  inst(id: number | null): StepInstance | null {
    return id === null ? null : (this.file.instances.get(id) ?? null);
  }

  /* Units */

  resolveUnits(): void {
    for (const pid of this.file.byType.get("IFCPROJECT") ?? []) {
      const project = this.inst(pid);
      const assignment = project ? this.inst(asRef(project.args[8])) : null;
      if (!assignment) continue;
      for (const ref of asRefs(assignment.args[0])) {
        const unit = this.inst(ref);
        const factor = unit ? this.lengthFactor(unit, 0) : null;
        if (factor !== null) {
          this.unitScale = factor;
          return;
        }
      }
    }
    this.warnings.push("no LENGTHUNIT in the IFC project; coordinates taken as millimetres");
  }

  private lengthFactor(unit: StepInstance, depth: number): number | null {
    if (depth > 4) return null;
    if (unit.type === "IFCSIUNIT") {
      const kind = unit.args[1];
      if (!isEnum(kind) || kind.enum !== "LENGTHUNIT") return null;
      const prefix = unit.args[2];
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
        case "KILO":
          return 1e6;
        default:
          return null;
      }
    }
    if (unit.type === "IFCCONVERSIONBASEDUNIT" || unit.type === "IFCCONVERSIONBASEDUNITWITHOFFSET") {
      const kind = unit.args[1];
      if (!isEnum(kind) || kind.enum !== "LENGTHUNIT") return null;
      const measure = this.inst(asRef(unit.args[3]));
      if (!measure || measure.type !== "IFCMEASUREWITHUNIT") return null;
      const value = asNumber(measure.args[0]);
      const base = this.inst(asRef(measure.args[1]));
      if (value === null || !base) return null;
      const baseFactor = this.lengthFactor(base, depth + 1);
      return baseFactor === null ? null : value * baseFactor;
    }
    return null;
  }

  /* Points */

  point3(id: number | null): Vec3 | null {
    const p = this.inst(id);
    if (!p || p.type !== "IFCCARTESIANPOINT") return null;
    const c = asNumbers(p.args[0]);
    if (c.length < 2) return null;
    const s = this.unitScale;
    return { x: c[0] * s, y: c[1] * s, z: (c[2] ?? 0) * s };
  }

  point2(id: number | null): Point | null {
    const p = this.point3(id);
    return p ? { x: p.x, y: p.y } : null;
  }

  direction(id: number | null): Vec3 | null {
    const d = this.inst(id);
    if (!d || d.type !== "IFCDIRECTION") return null;
    const c = asNumbers(d.args[0]);
    if (c.length < 2) return null;
    return norm3({ x: c[0], y: c[1], z: c[2] ?? 0 });
  }

  /* Elements */

  elements(): IfcElement[] {
    const found: { inst: StepInstance; collected: Collected; name: string }[] = [];
    for (const inst of this.file.instances.values()) {
      if (!inst.type.startsWith("IFC") || SKIP_TYPES.has(inst.type)) continue;
      const shape = this.inst(asRef(inst.args[6]));
      if (!shape || shape.type !== "IFCPRODUCTDEFINITIONSHAPE") continue;
      const collected: Collected = { polygons: [], extrusions: [], unsupported: [], mapKeys: [] };
      for (const repRef of asRefs(shape.args[2])) {
        const rep = this.inst(repRef);
        if (!rep || rep.type !== "IFCSHAPEREPRESENTATION") continue;
        const identifier = (asString(rep.args[1]) ?? "").toUpperCase();
        if (!BODY_IDENTIFIERS.has(identifier)) continue;
        for (const itemRef of asRefs(rep.args[3])) this.collectItem(itemRef, collected, 0);
      }
      const name = this.elementName(inst);
      found.push({ inst, collected, name });
    }

    // Same representation map (or same name when unmapped) = same part, several times.
    const groups = new Map<string, { first: (typeof found)[number]; count: number }>();
    for (const f of found) {
      const key = f.collected.mapKeys.length ? `map:${f.collected.mapKeys.join(",")}` : `name:${f.name}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { first: f, count: 1 });
    }

    const out: IfcElement[] = [];
    for (const g of groups.values()) {
      const { inst, collected, name } = g.first;
      let stepText: string | null = null;
      const unsupported = [...collected.unsupported];
      if (collected.extrusions.length && collected.polygons.length) {
        unsupported.push("mixed_representation");
      } else if (collected.extrusions.length) {
        stepText = writeExtrudedStep(collected.extrusions, { fileName: `${name}.step`, originatingSystem: "stretchmetal ifc import" });
      } else if (collected.polygons.length) {
        stepText = writeFacetedStep(name, collected.polygons, { originatingSystem: "stretchmetal ifc import" });
      }
      out.push({ id: inst.id, type: inst.type, name, occurrences: g.count, stepText, unsupported: Array.from(new Set(unsupported)) });
    }
    return out;
  }

  private elementName(inst: StepInstance): string {
    const name = (asString(inst.args[2]) ?? "").trim();
    if (name) return name;
    const objectType = (asString(inst.args[4]) ?? "").trim();
    if (objectType) return objectType;
    return `${inst.type.replace(/^IFC/, "").toLowerCase()} ${inst.id}`;
  }

  private collectItem(itemRef: number, out: Collected, depth: number): void {
    const item = this.inst(itemRef);
    if (!item || depth > 8) return;
    switch (item.type) {
      case "IFCMAPPEDITEM": {
        const map = this.inst(asRef(item.args[0]));
        const op = this.inst(asRef(item.args[1]));
        const scale = op ? asNumber(op.args[3]) : null;
        if (scale !== null && Math.abs(scale - 1) > 1e-9) this.warnings.push(`mapped item #${item.id} scaled by ${scale}; ignored`);
        if (!map) return;
        out.mapKeys.push(map.id);
        const rep = this.inst(asRef(map.args[1]));
        if (rep && rep.type === "IFCSHAPEREPRESENTATION") for (const ref of asRefs(rep.args[3])) this.collectItem(ref, out, depth + 1);
        return;
      }
      case "IFCFACETEDBREP":
      case "IFCFACETEDBREPWITHVOIDS": {
        if (item.type === "IFCFACETEDBREPWITHVOIDS") out.unsupported.push("faceted_brep_voids");
        this.collectShell(asRef(item.args[0]), out);
        return;
      }
      case "IFCSHELLBASEDSURFACEMODEL":
      case "IFCFACEBASEDSURFACEMODEL": {
        for (const ref of asRefs(item.args[0])) this.collectShell(ref, out);
        return;
      }
      case "IFCTRIANGULATEDFACESET":
      case "IFCTRIANGULATEDIRREGULARNETWORK": {
        const coords = this.pointList(asRef(item.args[0]));
        const pn = asNumbers(item.args[4]);
        const indices = item.args[3];
        if (coords && isList(indices)) {
          for (const tri of indices) {
            const idx = asNumbers(tri).map((i) => (pn.length ? pn[i - 1] : i) - 1);
            const poly = idx.map((i) => coords[i]).filter((p): p is Vec3 => p !== undefined);
            if (poly.length >= 3) out.polygons.push(poly);
          }
        }
        return;
      }
      case "IFCPOLYGONALFACESET": {
        const coords = this.pointList(asRef(item.args[0]));
        const pn = asNumbers(item.args[3]);
        if (!coords) return;
        for (const faceRef of asRefs(item.args[2])) {
          const face = this.inst(faceRef);
          if (!face) continue;
          if (face.type === "IFCINDEXEDPOLYGONALFACEWITHVOIDS") out.unsupported.push("polygonal_face_voids");
          const idx = asNumbers(face.args[0]).map((i) => (pn.length ? pn[i - 1] : i) - 1);
          const poly = idx.map((i) => coords[i]).filter((p): p is Vec3 => p !== undefined);
          if (poly.length >= 3) out.polygons.push(poly);
        }
        return;
      }
      case "IFCEXTRUDEDAREASOLID":
      case "IFCEXTRUDEDAREASOLIDTAPERED": {
        const spec = this.extrusion(item, out);
        if (spec) out.extrusions.push(spec);
        return;
      }
      default:
        out.unsupported.push(item.type);
    }
  }

  private pointList(id: number | null): Vec3[] | null {
    const list = this.inst(id);
    if (!list || (list.type !== "IFCCARTESIANPOINTLIST3D" && list.type !== "IFCCARTESIANPOINTLIST2D")) return null;
    const coords = list.args[0];
    if (!isList(coords)) return null;
    const s = this.unitScale;
    return coords.map((c) => {
      const n = asNumbers(c);
      return { x: (n[0] ?? 0) * s, y: (n[1] ?? 0) * s, z: (n[2] ?? 0) * s };
    });
  }

  private collectShell(shellRef: number | null, out: Collected): void {
    const shell = this.inst(shellRef);
    if (!shell) return;
    for (const faceRef of asRefs(shell.args[0])) {
      const face = this.inst(faceRef);
      if (!face) continue;
      const bounds = asRefs(face.args[0]);
      if (bounds.length !== 1) {
        out.unsupported.push("face_voids");
        continue;
      }
      const bound = this.inst(bounds[0]);
      if (!bound) continue;
      const loop = this.inst(asRef(bound.args[0]));
      const orientation = bound.args[1];
      if (!loop || loop.type !== "IFCPOLYLOOP") {
        out.unsupported.push(loop?.type ?? "loop");
        continue;
      }
      const pts: Vec3[] = [];
      for (const ref of asRefs(loop.args[0])) {
        const p = this.point3(ref);
        if (p) pts.push(p);
      }
      if (isEnum(orientation) && orientation.enum === "F") pts.reverse();
      if (pts.length >= 3) out.polygons.push(pts);
    }
  }

  /* Extrusions */

  private extrusion(item: StepInstance, out: Collected): ExtrusionSpec | null {
    const profile = this.profile(this.inst(asRef(item.args[0])), out);
    if (!profile) return null;
    const depthRaw = asNumber(item.args[3]);
    if (depthRaw === null || depthRaw <= 0) {
      out.unsupported.push("extrusion_depth");
      return null;
    }
    const position = this.inst(asRef(item.args[1]));
    const origin = position ? (this.point3(asRef(position.args[0])) ?? { x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 };
    const axis = position ? (this.direction(asRef(position.args[1])) ?? { x: 0, y: 0, z: 1 }) : { x: 0, y: 0, z: 1 };
    let ref = position ? (this.direction(asRef(position.args[2])) ?? { x: 1, y: 0, z: 0 }) : { x: 1, y: 0, z: 0 };
    if (Math.abs(dot3(ref, axis)) > 0.999) ref = Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    ref = norm3(add3(ref, scale3(axis, -dot3(ref, axis))));
    const dir = this.direction(asRef(item.args[2])) ?? { x: 0, y: 0, z: 1 };
    // The extrusion direction is given in the position's own frame.
    if (Math.abs(Math.abs(dir.z) - 1) > 1e-6) {
      out.unsupported.push("oblique_extrusion");
      return null;
    }
    const frame: ExtrusionFrame = dir.z > 0 ? { origin, axis, ref } : { origin, axis: scale3(axis, -1), ref: scale3(ref, -1) };
    return { name: undefined, outer: profile.outer, holes: profile.holes, height: depthRaw * this.unitScale, frame };
  }

  private profile(def: StepInstance | null, out: Collected): { outer: Profile; holes: Profile[] } | null {
    if (!def) return null;
    switch (def.type) {
      case "IFCARBITRARYCLOSEDPROFILEDEF": {
        const outer = this.curveProfile(this.inst(asRef(def.args[2])), out);
        return outer ? { outer, holes: [] } : null;
      }
      case "IFCARBITRARYPROFILEDEFWITHVOIDS": {
        const outer = this.curveProfile(this.inst(asRef(def.args[2])), out);
        if (!outer) return null;
        const holes: Profile[] = [];
        for (const ref of asRefs(def.args[3])) {
          const hole = this.curveProfile(this.inst(ref), out);
          if (hole) holes.push(hole);
        }
        return { outer, holes };
      }
      case "IFCRECTANGLEPROFILEDEF": {
        const place = this.placement2(this.inst(asRef(def.args[2])));
        const x = asNumber(def.args[3]);
        const y = asNumber(def.args[4]);
        if (x === null || y === null) return null;
        return { outer: rectAt(place, x * this.unitScale, y * this.unitScale), holes: [] };
      }
      case "IFCRECTANGLEHOLLOWPROFILEDEF": {
        const place = this.placement2(this.inst(asRef(def.args[2])));
        const x = asNumber(def.args[3]);
        const y = asNumber(def.args[4]);
        const wall = asNumber(def.args[5]);
        if (x === null || y === null || wall === null) return null;
        const s = this.unitScale;
        return { outer: rectAt(place, x * s, y * s), holes: [reverseProfile(rectAt(place, (x - 2 * wall) * s, (y - 2 * wall) * s))] };
      }
      case "IFCCIRCLEPROFILEDEF": {
        const place = this.placement2(this.inst(asRef(def.args[2])));
        const r = asNumber(def.args[3]);
        if (r === null) return null;
        return { outer: circleAt(place.origin, r * this.unitScale, true), holes: [] };
      }
      case "IFCCIRCLEHOLLOWPROFILEDEF": {
        const place = this.placement2(this.inst(asRef(def.args[2])));
        const r = asNumber(def.args[3]);
        const wall = asNumber(def.args[4]);
        if (r === null || wall === null) return null;
        const s = this.unitScale;
        return { outer: circleAt(place.origin, r * s, true), holes: [circleAt(place.origin, (r - wall) * s, false)] };
      }
      default:
        out.unsupported.push(def.type);
        return null;
    }
  }

  private placement2(inst: StepInstance | null): { origin: Point; ref: Point } {
    if (!inst) return { origin: { x: 0, y: 0 }, ref: { x: 1, y: 0 } };
    const origin = this.point2(asRef(inst.args[0])) ?? { x: 0, y: 0 };
    const d = this.direction(asRef(inst.args[1]));
    return { origin, ref: d ? { x: d.x, y: d.y } : { x: 1, y: 0 } };
  }

  /** A closed 2D curve as a profile of lines and arcs. */
  private curveProfile(curve: StepInstance | null, out: Collected): Profile | null {
    if (!curve) return null;
    const segs: Seg[] = [];
    if (!this.curveSegments(curve, segs, out, true)) return null;
    return segmentsToProfile(segs);
  }

  private curveSegments(curve: StepInstance, segs: Seg[], out: Collected, sameSense: boolean): boolean {
    const local: Seg[] = [];
    switch (curve.type) {
      case "IFCPOLYLINE": {
        const pts: Point[] = [];
        for (const ref of asRefs(curve.args[0])) {
          const p = this.point2(ref);
          if (p) pts.push(p);
        }
        for (let i = 0; i < pts.length - 1; i++) local.push({ kind: "line", from: pts[i], to: pts[i + 1] });
        break;
      }
      case "IFCINDEXEDPOLYCURVE": {
        const pts = this.pointList(asRef(curve.args[0]))?.map((p) => ({ x: p.x, y: p.y })) ?? null;
        if (!pts) return false;
        const segments = curve.args[1];
        if (!isList(segments) || segments.length === 0) {
          for (let i = 0; i < pts.length - 1; i++) local.push({ kind: "line", from: pts[i], to: pts[i + 1] });
          break;
        }
        for (const seg of segments) {
          if (!isTyped(seg)) continue;
          const idx = asNumbers(seg.args[0]).map((i) => pts[i - 1]).filter((p): p is Point => p !== undefined);
          if (seg.type === "IFCLINEINDEX") {
            for (let i = 0; i < idx.length - 1; i++) local.push({ kind: "line", from: idx[i], to: idx[i + 1] });
          } else if (seg.type === "IFCARCINDEX" && idx.length === 3) {
            const arc = arcThrough(idx[0], idx[1], idx[2]);
            if (arc) local.push(arc);
            else local.push({ kind: "line", from: idx[0], to: idx[2] });
          }
        }
        break;
      }
      case "IFCCOMPOSITECURVE":
      case "IFCCOMPOSITECURVEONSURFACE": {
        for (const ref of asRefs(curve.args[0])) {
          const seg = this.inst(ref);
          if (!seg) continue;
          const sense = isEnum(seg.args[1]) ? seg.args[1].enum !== "F" : true;
          const parent = this.inst(asRef(seg.args[2]));
          if (!parent || !this.curveSegments(parent, local, out, sense)) return false;
        }
        break;
      }
      case "IFCTRIMMEDCURVE": {
        const basis = this.inst(asRef(curve.args[0]));
        const sense = isEnum(curve.args[3]) ? curve.args[3].enum !== "F" : true;
        if (!basis) return false;
        if (basis.type === "IFCCIRCLE") {
          const place = this.placement2(this.inst(asRef(basis.args[0])));
          const r = (asNumber(basis.args[1]) ?? 0) * this.unitScale;
          const a1 = this.trimAngle(curve.args[1], place);
          const a2 = this.trimAngle(curve.args[2], place);
          if (a1 === null || a2 === null) return false;
          const from = pointOnCircle(place, r, a1);
          const to = pointOnCircle(place, r, a2);
          local.push({ kind: "arc", from, to, center: place.origin, ccw: sense });
        } else if (basis.type === "IFCLINE") {
          const p1 = this.trimPoint(curve.args[1]);
          const p2 = this.trimPoint(curve.args[2]);
          if (!p1 || !p2) return false;
          local.push({ kind: "line", from: p1, to: p2 });
        } else {
          out.unsupported.push(basis.type);
          return false;
        }
        break;
      }
      case "IFCCIRCLE": {
        const place = this.placement2(this.inst(asRef(curve.args[0])));
        const r = (asNumber(curve.args[1]) ?? 0) * this.unitScale;
        const a = pointOnCircle(place, r, 0);
        const b = pointOnCircle(place, r, Math.PI);
        local.push({ kind: "arc", from: a, to: b, center: place.origin, ccw: true });
        local.push({ kind: "arc", from: b, to: a, center: place.origin, ccw: true });
        break;
      }
      default:
        out.unsupported.push(curve.type);
        return false;
    }
    if (!sameSense) {
      local.reverse();
      for (const s of local) {
        const from = s.from;
        s.from = s.to;
        s.to = from;
        if (s.kind === "arc") s.ccw = !s.ccw;
      }
    }
    segs.push(...local);
    return true;
  }

  private trimAngle(trim: StepValue | undefined, place: { origin: Point; ref: Point }): number | null {
    if (trim === undefined || !isList(trim)) return null;
    const items: StepValue[] = trim;
    for (const t of items) {
      if (isTyped(t) && t.type === "IFCPARAMETERVALUE") {
        const deg = asNumber(t.args[0]);
        return deg === null ? null : (deg * Math.PI) / 180;
      }
    }
    for (const t of items) {
      const p = this.point2(asRef(t));
      if (p) {
        const d = { x: p.x - place.origin.x, y: p.y - place.origin.y };
        const ux = place.ref;
        const uy = { x: -ux.y, y: ux.x };
        return Math.atan2(d.x * uy.x + d.y * uy.y, d.x * ux.x + d.y * ux.y);
      }
    }
    return null;
  }

  private trimPoint(trim: StepValue | undefined): Point | null {
    if (trim === undefined || !isList(trim)) return null;
    const items: StepValue[] = trim;
    for (const t of items) {
      const p = this.point2(asRef(t));
      if (p) return p;
    }
    return null;
  }
}

/* ─── 2D helpers ────────────────────────────────────────────── */

type Seg = { kind: "line"; from: Point; to: Point } | { kind: "arc"; from: Point; to: Point; center: Point; ccw: boolean };

function pointOnCircle(place: { origin: Point; ref: Point }, r: number, rad: number): Point {
  const ux = place.ref;
  const uy = { x: -ux.y, y: ux.x };
  return { x: place.origin.x + r * (Math.cos(rad) * ux.x + Math.sin(rad) * uy.x), y: place.origin.y + r * (Math.cos(rad) * ux.y + Math.sin(rad) * uy.y) };
}

function rectAt(place: { origin: Point; ref: Point }, x: number, y: number): Profile {
  const ux = place.ref;
  const uy = { x: -ux.y, y: ux.x };
  const corner = (cx: number, cy: number): Point => ({
    x: place.origin.x + cx * ux.x + cy * uy.x,
    y: place.origin.y + cx * ux.y + cy * uy.y,
  });
  const pts = [corner(-x / 2, -y / 2), corner(x / 2, -y / 2), corner(x / 2, y / 2), corner(-x / 2, y / 2)];
  return { start: pts[0], segments: [1, 2, 3, 0].map((i) => ({ kind: "line", to: pts[i] }) as ProfileSegment) };
}

function circleAt(center: Point, r: number, ccw: boolean): Profile {
  const a = { x: center.x + r, y: center.y };
  const b = { x: center.x - r, y: center.y };
  return { start: a, segments: [{ kind: "arc", to: b, center, ccw }, { kind: "arc", to: a, center, ccw }] };
}

function reverseProfile(p: Profile): Profile {
  const pts = [p.start, ...p.segments.map((s) => s.to)];
  pts.pop();
  const rev = pts.slice().reverse();
  const segments: ProfileSegment[] = [];
  for (let i = 0; i < rev.length; i++) {
    const seg = p.segments[(pts.length - 1 - i - 1 + pts.length) % pts.length];
    const to = rev[(i + 1) % rev.length];
    segments.push(seg.kind === "arc" ? { kind: "arc", to, center: seg.center, ccw: !seg.ccw } : { kind: "line", to });
  }
  return { start: rev[0], segments };
}

/** Circle through three points as an arc from a via b to c. */
function arcThrough(a: Point, b: Point, c: Point): Seg | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  const ccw = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;
  return { kind: "arc", from: a, to: c, center, ccw };
}

function near(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
}

function segmentsToProfile(segs: Seg[]): Profile | null {
  const clean = segs.filter((s) => !(s.kind === "line" && near(s.from, s.to)));
  if (clean.length === 0) return null;
  const start = clean[0].from;
  const last = clean[clean.length - 1];
  if (!near(last.to, start)) clean.push({ kind: "line", from: last.to, to: start });
  const segments: ProfileSegment[] = clean.map((s) => (s.kind === "arc" ? { kind: "arc", to: s.to, center: s.center, ccw: s.ccw } : { kind: "line", to: s.to }));
  return { start, segments };
}

/** Every element of an IFC file with its geometry as STEP text. */
export function ifcModel(file: StepFile): IfcModel {
  const reader = new IfcReader(file);
  reader.resolveUnits();
  const elements = reader.elements();
  return { unitScale: reader.unitScale, elements, warnings: [...file.warnings, ...reader.warnings] };
}
