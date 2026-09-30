/**
 * Test helper — minimal IFC4 files: a project in metres with elements
 * whose bodies are faceted breps (polygons), extruded profiles, mapped
 * items shared by several elements, or an unsupported boolean result.
 * File path: /test/geometry/ifc-builder.ts
 */
import type { Vec3 } from "@/lib/geometry/step/brep";
import { polygonHoles, polygonOuter, type MeshPolygon } from "@/lib/geometry/step/mesh";

export type IfcElementSpec =
  | { kind: "brep"; name: string; polygons: MeshPolygon[]; mapShared?: string }
  | { kind: "extrusion"; name: string; rect: { x: number; y: number }; hole?: { r: number }; depth: number }
  | { kind: "boolean"; name: string };

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}.` : String(n);
}

export function buildIfc(elements: IfcElementSpec[], opts: { unit?: "m" | "mm" } = {}): string {
  const lines: string[] = [];
  let next = 1;
  const add = (text: string): number => {
    const id = next++;
    lines.push(`#${id} = ${text};`);
    return id;
  };
  const point = (p: Vec3): number => add(`IFCCARTESIANPOINT((${fmt(p.x)},${fmt(p.y)},${fmt(p.z)}))`);
  const point2 = (x: number, y: number): number => add(`IFCCARTESIANPOINT((${fmt(x)},${fmt(y)}))`);

  const origin = add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const dirZ = add(`IFCDIRECTION((0.,0.,1.))`);
  const dirX = add(`IFCDIRECTION((1.,0.,0.))`);
  const axis = add(`IFCAXIS2PLACEMENT3D(#${origin},#${dirZ},#${dirX})`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT('Plan','Model',3,1.E-06,#${axis},$)`);
  const unit = add(opts.unit === "mm" ? `IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)` : `IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const units = add(`IFCUNITASSIGNMENT((#${unit}))`);
  const history = add(`IFCOWNERHISTORY($,$,$,.ADDED.,0,$,$,0)`);
  add(`IFCPROJECT('proj',#${history},'Project',$,$,$,$,(#${context}),#${units})`);
  const placement = add(`IFCLOCALPLACEMENT($,#${axis})`);

  const maps = new Map<string, number>();
  const brepRep = (polygons: MeshPolygon[]): number => {
    const polyLoop = (ring: Vec3[]): number => add(`IFCPOLYLOOP((${ring.map((p) => `#${point(p)}`).join(",")}))`);
    const faces = polygons.map((poly) => {
      const bounds = [add(`IFCFACEOUTERBOUND(#${polyLoop(polygonOuter(poly))},.T.)`)];
      for (const hole of polygonHoles(poly)) bounds.push(add(`IFCFACEBOUND(#${polyLoop(hole)},.T.)`));
      return add(`IFCFACE((${bounds.map((b) => `#${b}`).join(",")}))`);
    });
    const shell = add(`IFCCLOSEDSHELL((${faces.map((f) => `#${f}`).join(",")}))`);
    const brep = add(`IFCFACETEDBREP(#${shell})`);
    return add(`IFCSHAPEREPRESENTATION(#${context},'Body','Brep',(#${brep}))`);
  };

  for (const el of elements) {
    let rep: number;
    if (el.kind === "brep") {
      if (el.mapShared) {
        let map = maps.get(el.mapShared);
        if (!map) {
          map = add(`IFCREPRESENTATIONMAP(#${axis},#${brepRep(el.polygons)})`);
          maps.set(el.mapShared, map);
        }
        const op = add(`IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#${origin},1.,$)`);
        const mapped = add(`IFCMAPPEDITEM(#${map},#${op})`);
        rep = add(`IFCSHAPEREPRESENTATION(#${context},'Body','MappedRepresentation',(#${mapped}))`);
      } else {
        rep = brepRep(el.polygons);
      }
    } else if (el.kind === "extrusion") {
      const { x, y } = el.rect;
      const list = add(`IFCCARTESIANPOINTLIST2D(((0.,0.),(${fmt(x)},0.),(${fmt(x)},${fmt(y)}),(0.,${fmt(y)})))`);
      const outer = add(`IFCINDEXEDPOLYCURVE(#${list},(IFCLINEINDEX((1,2,3,4,1))),.F.)`);
      let profile: number;
      if (el.hole) {
        const c = add(`IFCAXIS2PLACEMENT2D(#${point2(x / 2, y / 2)},$)`);
        const circle = add(`IFCCIRCLE(#${c},${fmt(el.hole.r)})`);
        profile = add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#${outer},(#${circle}))`);
      } else {
        profile = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${outer})`);
      }
      const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${axis},#${dirZ},${fmt(el.depth)})`);
      rep = add(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`);
    } else {
      const bool = add(`IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#${origin},#${origin})`);
      rep = add(`IFCSHAPEREPRESENTATION(#${context},'Body','Clipping',(#${bool}))`);
    }
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
    add(`IFCBUILDINGELEMENTPROXY('${el.name.slice(0, 22)}',#${history},'${el.name}',$,$,#${placement},#${shape},$,.ELEMENT.)`);
  }

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('IFC4'),'2;1');",
    "FILE_NAME('test.ifc','2026-01-01T00:00:00',(''),(''),'tests','tests','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
