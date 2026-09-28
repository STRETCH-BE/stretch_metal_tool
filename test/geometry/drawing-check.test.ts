/**
 * Drawing cross-checks (lib/geometry/step/drawing-check.ts) on text laid
 * out like the SST drawings: parts list, revision table, title block.
 * File path: /test/geometry/drawing-check.test.ts
 */
import { describe, expect, it } from "vitest";
import { checkDrawing, compareHardware, parseHardwareRows, revisionFromDrawing, revisionFromFileName } from "@/lib/geometry/step/drawing-check";
import type { HardwareLine } from "@/lib/geometry/types";

const TEXT = `
Réf  Qt  Designation
1    5   Goujon M3x8
2    4   Goujon M3x15
3    10  Insert M4 ACAO470ZP
IND.  DATE        MODIFICATION
A     12/01/2024  Création
F     03/02/2026  Alu 25/10ème
G     12/03/2026  Epargne peinture ajoutée
MATIERE : Alu 25/10ème
MATIERE : DC01 2mm
FINITION : RAL9005 Granité
`;

describe("drawing check", () => {
  it("reads the parts list rows with kind, size and quantity", () => {
    expect(parseHardwareRows(TEXT)).toMatchObject([
      { kind: "weld_stud", size: "M3X8", qty: 5 },
      { kind: "weld_stud", size: "M3X15", qty: 4 },
      { kind: "insert", size: "M4", qty: 10 },
    ]);
  });

  it("takes the latest revision letter, the file-name revision, the current material line and the finish", () => {
    expect(revisionFromDrawing(TEXT)).toBe("G");
    expect(revisionFromFileName("M040120_G - Carrosserie de face avant L1 GM.stp")).toBe("G");
    expect(revisionFromFileName("M040400_F - Carrosserie d_embase L1")).toBe("F");
    expect(revisionFromFileName("200005")).toBeNull();
    const d = checkDrawing(TEXT);
    expect(d.material).toBe("DC01 2mm");
    expect(d.finish).toBe("RAL9005 Granité");
    expect(d.masking).toBe(true);
    expect(checkDrawing("nothing here").masking).toBe(false);
  });

  it("compares drawing quantities with detected hardware by kind and size", () => {
    const detected: HardwareLine[] = [
      { kind: "weld_stud", size: "M3x8", qty: 5, featureCode: null, productName: null, source: "geometry", positions: [], diameterMm: 3, lengthMm: 8.1 },
      { kind: "weld_stud", size: "M3x15", qty: 4, featureCode: null, productName: null, source: "geometry", positions: [], diameterMm: 3, lengthMm: 15.1 },
      { kind: "insert", size: "M4", qty: 10, featureCode: "insert_m4", productName: "ACAO470ZP", source: "name", positions: [], diameterMm: null, lengthMm: null },
    ];
    expect(compareHardware(parseHardwareRows(TEXT), detected)).toEqual([]);
    const fewer = detected.map((h) => (h.size === "M4" ? { ...h, qty: 9 } : h));
    expect(compareHardware(parseHardwareRows(TEXT), fewer)).toEqual([{ kind: "insert", size: "M4", drawingQty: 10, modelQty: 9 }]);
  });
});
