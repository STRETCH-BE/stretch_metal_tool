/**
 * IFC reader (lib/geometry/step/ifc.ts) through splitModelSync: units,
 * one part per element, occurrences from shared representation maps,
 * extruded profiles with holes, unsupported items.
 * File path: /test/geometry/ifc.test.ts
 */
import { describe, expect, it } from "vitest";
import { splitModelSync } from "@/lib/geometry/step/analyse";
import { parseStep } from "@/lib/geometry/step/part21";
import { ifcModel, isIfcFile } from "@/lib/geometry/step/ifc";
import { evaluateBrep } from "@/lib/geometry/step/brep";
import { polygonOuter, polygonsOfFacetedBody } from "@/lib/geometry/step/mesh";
import { buildIfc } from "./ifc-builder";
import { tessellatedPlate } from "./mesh-fixtures";

/** The plate's polygons in metres, as an IFC exporter would write them. */
function plateMetres() {
  const body = evaluateBrep(parseStep(tessellatedPlate())).bodies[0];
  return polygonsOfFacetedBody(body).map((poly) => polygonOuter(poly).map((p) => ({ x: p.x / 1000, y: p.y / 1000, z: p.z / 1000 })));
}

describe("ifc", () => {
  it("is recognised by its schema and scaled from metres", () => {
    const text = buildIfc([{ kind: "brep", name: "Plate A", polygons: plateMetres() }]);
    const file = parseStep(text);
    expect(isIfcFile(file)).toBe(true);
    const model = ifcModel(file);
    expect(model.unitScale).toBe(1000);
    expect(model.elements).toHaveLength(1);
    expect(model.elements[0].name).toBe("Plate A");
    const split = splitModelSync(text);
    expect(split.format).toBe("ifc");
    expect(split.parts).toHaveLength(1);
    const g = split.parts[0].geometry;
    expect(g.triage.state).toBe("green");
    expect(g.measures.bbox.width).toBeCloseTo(100, 3);
    expect(g.material.thicknessMm).toBe(5);
    expect(split.parts[0].stepText).toContain("FACETED_BREP");
  });

  it("counts elements sharing a representation map as occurrences of one part", () => {
    const text = buildIfc([
      { kind: "brep", name: "Rib", polygons: plateMetres(), mapShared: "rib" },
      { kind: "brep", name: "Rib", polygons: plateMetres(), mapShared: "rib" },
      { kind: "brep", name: "Rib", polygons: plateMetres(), mapShared: "rib" },
      { kind: "extrusion", name: "Base", rect: { x: 0.2, y: 0.1 }, hole: { r: 0.006 }, depth: 0.004 },
    ]);
    const split = splitModelSync(text);
    expect(split.parts.map((p) => [p.name, p.occurrences])).toEqual([
      ["Rib", 3],
      ["Base", 1],
    ]);
    const base = split.parts[1].geometry;
    expect(base.triage.state).toBe("green");
    expect(base.measures.bbox.width).toBeCloseTo(200, 3);
    expect(base.measures.bbox.height).toBeCloseTo(100, 3);
    expect(base.material.thicknessMm).toBe(4);
    expect(base.measures.holes).toHaveLength(1);
    expect(base.measures.holes[0].diameterMm).toBeCloseTo(12, 3);
  });

  it("groups identical elements without a shared map by name and local geometry; a mirrored copy stays separate", () => {
    const plate = plateMetres();
    const mirrored = plate.map((poly) => poly.map((p) => ({ x: -p.x, y: p.y, z: p.z })));
    const text = buildIfc([
      { kind: "brep", name: "Fassade 4", polygons: plate },
      { kind: "brep", name: "Fassade 4", polygons: plate },
      { kind: "brep", name: "Fassade 4", polygons: plate },
      { kind: "brep", name: "Winkel links", polygons: plate },
      { kind: "brep", name: "Winkel rechts", polygons: mirrored },
      { kind: "brep", name: "Fassade 4", polygons: mirrored },
    ]);
    const split = splitModelSync(text);
    expect(split.parts.map((p) => [p.name, p.occurrences])).toEqual([
      ["Fassade 4", 3],
      ["Winkel links", 1],
      ["Winkel rechts", 1],
      ["Fassade 4", 1],
    ]);
    for (const p of split.parts) expect(p.geometry.triage.state).toBe("green");
  });

  it("groups identical extrusions by name and profile, not by depth", () => {
    const split = splitModelSync(
      buildIfc([
        { kind: "extrusion", name: "Base", rect: { x: 0.2, y: 0.1 }, depth: 0.004 },
        { kind: "extrusion", name: "Base", rect: { x: 0.2, y: 0.1 }, depth: 0.004 },
        { kind: "extrusion", name: "Base", rect: { x: 0.2, y: 0.1 }, depth: 0.006 },
      ])
    );
    expect(split.parts.map((p) => [p.name, p.occurrences, p.geometry.material.thicknessMm])).toEqual([
      ["Base", 2, 4],
      ["Base", 1, 6],
    ]);
  });

  it("keeps a faceted face's holes: a plate whose caps carry the hole as an inner bound", () => {
    const L = 0.1;
    const W = 0.05;
    const t = 0.004;
    const hole = Array.from({ length: 12 }, (_, k) => ({ x: 0.05 + 0.006 * Math.cos((2 * Math.PI * k) / 12), y: 0.025 + 0.006 * Math.sin((2 * Math.PI * k) / 12) }));
    const cap = (z: number, reverse: boolean) => {
      const outer = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }].map((p) => ({ ...p, z }));
      const inner = hole.map((p) => ({ ...p, z }));
      return reverse ? { outer: outer.reverse(), holes: [inner.slice().reverse()] } : { outer, holes: [inner] };
    };
    const walls: { x: number; y: number; z: number }[][] = [];
    const outline = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }];
    for (let i = 0; i < 4; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % 4];
      walls.push([{ ...a, z: 0 }, { ...b, z: 0 }, { ...b, z: t }, { ...a, z: t }]);
    }
    for (let k = 0; k < 12; k++) {
      const a = hole[k];
      const b = hole[(k + 1) % 12];
      walls.push([{ ...a, z: 0 }, { ...a, z: t }, { ...b, z: t }, { ...b, z: 0 }]);
    }
    const text = buildIfc([{ kind: "brep", name: "Lochplatte", polygons: [cap(t, false), cap(0, true), ...walls] }]);
    const split = splitModelSync(text);
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].warnings).toEqual([]);
    const g = split.parts[0].geometry;
    expect(g.triage.state).toBe("green");
    expect(g.measures.holes).toHaveLength(1);
    expect(g.measures.holes[0].diameterMm).toBeCloseTo(12, 0);
    expect(g.material.thicknessMm).toBe(4);
    expect(split.parts[0].stepText).toContain("FACE_BOUND(");
  });

  it("reports unsupported geometry as a manual part", () => {
    const split = splitModelSync(buildIfc([{ kind: "boolean", name: "Cut plate" }]));
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].stepText).toBeNull();
    expect(split.parts[0].warnings).toContain("IFCBOOLEANCLIPPINGRESULT");
    expect(split.parts[0].geometry.triage.state).toBe("red_step_manual");
    expect(split.parts[0].geometry.triage.reasons).toEqual(["step_no_geometry"]);
  });
});
