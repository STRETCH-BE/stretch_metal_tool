/**
 * Heuristic title-block reader against the real extractor output of the
 * two customer drawings (/test/fixtures/*.pdf.txt) plus targeted cases.
 * File path: /test/ai/heuristics.test.ts
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { heuristicSuggestions, normalizeThreadSize } from "@/lib/ai/heuristics";

function fixture(name: string): string {
  return fs.readFileSync(`test/fixtures/${name}.pdf.txt`, "utf8");
}

describe("heuristicSuggestions on 200005 (15 mm S355 plate with threads)", () => {
  const s = heuristicSuggestions(fixture("200005"), "200005.pdf");

  it("reads the title block", () => {
    expect(s.source).toBe("heuristic");
    expect(s.model).toBeNull();
    expect(s.partNumber).toBe("200005");
    expect(s.material).toBe("S355");
    expect(s.thicknessMm).toBe(15);
    expect(s.dimensionsMm).toEqual({ length: 500, width: 220 });
    expect(s.weightKg).toBe(11.69);
    expect(s.finish).toBeNull();
    expect(s.tolerances).toContain("2768-mK");
    expect(s.tolerances).toContain("ISO 8015");
    expect(s.confidence).toBe("low");
  });

  it("never guesses the quantity from dimension or hole numbers", () => {
    expect(s.quantity).toBeNull();
  });

  it("reads M8x1.25 (8x) as M8 ×8 and M10x1 (6x) as M10x1 ×6", () => {
    expect(s.threads).toEqual([
      { size: "M8", count: 8 },
      { size: "M10x1", count: 6 },
    ]);
  });

  it("treats 'n 13 (6x)' as a Ø13 hole in the notes, not a thread", () => {
    expect(s.notes).toContain("Ø13 (6×)");
    expect(s.notes).toContain("Ø10 (4×)");
    expect(s.notes.some((n) => n.startsWith("Ø35 H7"))).toBe(true);
  });

  it("keeps chamfers out of the bend angles", () => {
    expect(s.bends).toBeNull();
    expect(s.notes).toContain("Chamfer 2×45°");
    expect(s.notes).toContain("Chamfer 1×45°");
    expect(s.notes.some((n) => n.startsWith("Angles seen"))).toBe(false);
  });
});

describe("heuristicSuggestions on 200164 (2 mm DC01 bent strip)", () => {
  const s = heuristicSuggestions(fixture("200164"), "200164.pdf");

  it("reads the title block", () => {
    expect(s.partNumber).toBe("200164");
    expect(s.material).toBe("DC01");
    expect(s.thicknessMm).toBe(2);
    expect(s.dimensionsMm).toEqual({ length: 554.3, width: 60 });
    expect(s.weightKg).toBe(0.51);
    expect(s.quantity).toBeNull();
    expect(s.threads).toEqual([]);
    expect(s.tolerances).toContain("2768-mK");
  });

  it("only notes the 45° / 13° angles because no bend context word exists", () => {
    expect(s.bends).toBeNull();
    expect(s.notes).toContain("Angles seen: 45°, 13° (no bend context)");
  });

  it("lists the hole callouts with their decimal comma kept", () => {
    expect(s.notes).toContain("Ø5,5 (30×)");
    expect(s.notes).toContain("Ø8,5 (2×)");
  });
});

describe("normalizeThreadSize", () => {
  it("drops the coarse pitch and keeps a fine one", () => {
    expect(normalizeThreadSize("M8x1.25")).toBe("M8");
    expect(normalizeThreadSize("M8x1,25")).toBe("M8");
    expect(normalizeThreadSize("M10x1")).toBe("M10x1");
    expect(normalizeThreadSize("M10x1.5")).toBe("M10");
    expect(normalizeThreadSize("M6")).toBe("M6");
    expect(normalizeThreadSize("m 2.5")).toBe("M2.5");
    expect(normalizeThreadSize("hole")).toBeNull();
  });
});

describe("heuristicSuggestions targeted cases", () => {
  it("returns an empty suggestion for empty text", () => {
    const s = heuristicSuggestions("");
    expect(s.material).toBeNull();
    expect(s.threads).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.confidence).toBe("low");
  });

  it("reads the quantity only from an explicit label", () => {
    expect(heuristicSuggestions("PLECH 3x400x200 QTY: 50").quantity).toBe(50);
    expect(heuristicSuggestions("Ilość: 12 szt.").quantity).toBe(12);
    expect(heuristicSuggestions("25 pcs S235JR").quantity).toBe(25);
    expect(heuristicSuggestions("PLECH 15x500x220 n 13 (6x) M8 (8x)").quantity).toBeNull();
  });

  it("reads bends when a bend context word exists", () => {
    const s = heuristicSuggestions("BEND UP 90 ° BEND DOWN 45 ° 2x45 ° 2x BENDS S235JR");
    expect(s.bends).toEqual({ count: 2, angles: [90, 45], directions: ["up", "down"] });
    expect(s.notes).toContain("Chamfer 2×45°");
  });

  it("reads bends from Polish context words without directions", () => {
    const s = heuristicSuggestions("Gięcie 90 ° blacha 3x100x50 DC01");
    expect(s.bends).toEqual({ count: null, angles: [90] });
    expect(s.bends?.directions).toBeUndefined();
  });

  it("recognises material grades, stainless numbers and aluminium", () => {
    expect(heuristicSuggestions("MATERIAL: 1.4301").material).toBe("1.4301");
    expect(heuristicSuggestions("AlMg3 t=3").material).toBe("AlMg3");
    expect(heuristicSuggestions("S235JR blacha").material).toBe("S235JR");
    expect(heuristicSuggestions("stal nierdzewna szczotkowana").material).toBe("stainless steel");
  });

  it("notes extra material tokens instead of picking one silently", () => {
    const s = heuristicSuggestions("S355 spawane do 1.4301");
    expect(s.material).toBe("S355");
    expect(s.notes).toContain("Other material tokens: 1.4301");
  });

  it("reads the thickness from a label when there is no PLECH pattern", () => {
    expect(heuristicSuggestions("Grubość: 4 mm S235").thicknessMm).toBe(4);
    expect(heuristicSuggestions("t = 2,5 DC01").thicknessMm).toBe(2.5);
    expect(heuristicSuggestions("Grubość: 4 mm").dimensionsMm).toBeNull();
  });

  it("reads the weight in grams and kilograms", () => {
    expect(heuristicSuggestions("Gewicht: 850 g").weightKg).toBe(0.85);
    expect(heuristicSuggestions("masa 3,2 kg").weightKg).toBe(3.2);
  });

  it("reads finish keywords and RAL codes", () => {
    expect(heuristicSuggestions("malowanie proszkowe RAL 7016").finish).toBe(
      "powder coating, RAL 7016"
    );
    expect(heuristicSuggestions("ocynkowane ogniowo").finish).toBe("galvanised / zinc plated");
    expect(heuristicSuggestions("kolor RAL 9005").finish).toBe("RAL 9005");
    expect(heuristicSuggestions("S355").finish).toBeNull();
  });

  it("takes the part number from the file name, then the title block", () => {
    expect(heuristicSuggestions("x", "uploads/200164.pdf").partNumber).toBe("200164");
    expect(heuristicSuggestions("x", "AB-1234_rev2.PDF").partNumber).toBe("AB-1234_rev2");
    expect(heuristicSuggestions("A3 200005.ipt S355", "bracket.pdf").partNumber).toBe("200005");
    expect(heuristicSuggestions("no id here", "bracket.pdf").partNumber).toBeNull();
  });

  it("keeps the largest count when the same thread callout repeats", () => {
    const s = heuristicSuggestions("M6 (4x) view A ... M6 (4x) view B");
    expect(s.threads).toEqual([{ size: "M6", count: 4 }]);
    expect(s.notes).toContain("M6: callout seen 2× — count not summed");
  });

  it("does not read bolt lengths as thread pitches", () => {
    expect(heuristicSuggestions("M6x20 screws").threads).toEqual([{ size: "M6", count: null }]);
  });
});
