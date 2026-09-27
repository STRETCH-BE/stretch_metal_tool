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
import { polygonsOfFacetedBody } from "@/lib/geometry/step/mesh";
import { buildIfc } from "./ifc-builder";
import { tessellatedPlate } from "./mesh-fixtures";

/** The plate's polygons in metres, as an IFC exporter would write them. */
function plateMetres() {
  const body = evaluateBrep(parseStep(tessellatedPlate())).bodies[0];
  return polygonsOfFacetedBody(body).map((poly) => poly.map((p) => ({ x: p.x / 1000, y: p.y / 1000, z: p.z / 1000 })));
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

  it("reports unsupported geometry as a manual part", () => {
    const split = splitModelSync(buildIfc([{ kind: "boolean", name: "Cut plate" }]));
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].stepText).toBeNull();
    expect(split.parts[0].warnings).toContain("IFCBOOLEANCLIPPINGRESULT");
    expect(split.parts[0].geometry.triage.state).toBe("red_step_manual");
    expect(split.parts[0].geometry.triage.reasons).toEqual(["step_no_geometry"]);
  });
});
