/**
 * Heuristic title-block reader against the real extractor output of the
 * two customer drawings (/test/fixtures/*.pdf.txt) plus targeted cases,
 * and the content parity of every code the module emits (no copy in lib/).
 * File path: /test/ai/heuristics.test.ts
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { heuristicSuggestions, normalizeThreadSize } from "@/lib/ai/heuristics";
import {
  FINISH_CODES,
  MATERIAL_FAMILIES,
  SUGGESTION_NOTE_CODES,
  type SuggestionNote,
} from "@/lib/ai/types";
import { getContent } from "@/content";
import { interpolate } from "@/lib/i18n";

function fixture(name: string): string {
  return fs.readFileSync(`test/fixtures/${name}.pdf.txt`, "utf8");
}

function callouts(notes: SuggestionNote[], code: "hole" | "hole_fit"): string[] {
  return notes.filter((n) => n.code === code).map((n) => String(n.params?.callout));
}

describe("heuristicSuggestions on 200005 (15 mm S355 plate with threads)", () => {
  const s = heuristicSuggestions(fixture("200005"), "200005.pdf");

  it("reads the title block", () => {
    expect(s.source).toBe("heuristic");
    expect(s.model).toBeNull();
    expect(s.partNumber).toBe("200005");
    expect(s.material).toBe("S355");
    expect(s.materialFamily).toBe("mild_steel");
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

  it("treats 'n 13 (6x)' as a Ø13 hole note, not a thread", () => {
    expect(callouts(s.notes, "hole")).toContain("Ø13 (6×)");
    expect(callouts(s.notes, "hole")).toContain("Ø10 (4×)");
    expect(callouts(s.notes, "hole_fit").some((c) => c.startsWith("Ø35 H7"))).toBe(true);
  });

  it("keeps chamfers out of the bend angles", () => {
    expect(s.bends).toBeNull();
    expect(s.notes).toContainEqual({ code: "chamfer", params: { a: "2", b: "45" } });
    expect(s.notes).toContainEqual({ code: "chamfer", params: { a: "1", b: "45" } });
    expect(s.notes.some((n) => n.code === "angles_no_context")).toBe(false);
  });
});

describe("heuristicSuggestions on 200164 (2 mm DC01 bent strip)", () => {
  const s = heuristicSuggestions(fixture("200164"), "200164.pdf");

  it("reads the title block", () => {
    expect(s.partNumber).toBe("200164");
    expect(s.material).toBe("DC01");
    expect(s.materialFamily).toBe("mild_steel");
    expect(s.thicknessMm).toBe(2);
    expect(s.dimensionsMm).toEqual({ length: 554.3, width: 60 });
    expect(s.weightKg).toBe(0.51);
    expect(s.quantity).toBeNull();
    expect(s.threads).toEqual([]);
    expect(s.tolerances).toContain("2768-mK");
  });

  it("only notes the 45° / 13° angles because no bend context word exists", () => {
    expect(s.bends).toBeNull();
    expect(s.notes).toContainEqual({ code: "angles_no_context", params: { list: "45°, 13°" } });
  });

  it("lists the hole callouts with their decimal comma kept", () => {
    expect(callouts(s.notes, "hole")).toContain("Ø5,5 (30×)");
    expect(callouts(s.notes, "hole")).toContain("Ø8,5 (2×)");
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
    expect(normalizeThreadSize("banana")).toBeNull();
  });
});

describe("bend count is never read from an angle (review finding)", () => {
  it("'BEND 90 °' is an angle, not 90 bends", () => {
    expect(heuristicSuggestions("BEND 90 ° S235").bends).toEqual({ count: null, angles: [90] });
    expect(heuristicSuggestions("BENDS 45 °").bends).toEqual({ count: null, angles: [45] });
    expect(heuristicSuggestions("BEND 90°").bends).toEqual({ count: null, angles: [90] });
    expect(heuristicSuggestions("BEND 12.5 ° DC01").bends).toEqual({ count: null, angles: [12.5] });
  });

  it("an explicit label or 'Nx bends' still gives the count", () => {
    expect(heuristicSuggestions("BENDS: 3 90 °").bends).toEqual({ count: 3, angles: [90] });
    expect(heuristicSuggestions("BENDS = 4").bends).toEqual({ count: 4, angles: [] });
    expect(heuristicSuggestions("2x BENDS 90 °").bends).toEqual({ count: 2, angles: [90] });
    expect(heuristicSuggestions("3 Abkantungen 90 °").bends).toEqual({ count: 3, angles: [90] });
  });
});

describe("heuristicSuggestions targeted cases", () => {
  it("returns an empty suggestion for empty text", () => {
    const s = heuristicSuggestions("");
    expect(s.material).toBeNull();
    expect(s.materialFamily).toBeNull();
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
    expect(s.notes).toContainEqual({ code: "chamfer", params: { a: "2", b: "45" } });
  });

  it("reads bends from Polish context words without directions", () => {
    const s = heuristicSuggestions("Gięcie 90 ° blacha 3x100x50 DC01");
    expect(s.bends).toEqual({ count: null, angles: [90] });
    expect(s.bends?.directions).toBeUndefined();
  });

  it("recognises material grades and derives the family", () => {
    expect(heuristicSuggestions("MATERIAL: 1.4301").material).toBe("1.4301");
    expect(heuristicSuggestions("MATERIAL: 1.4301").materialFamily).toBe("stainless");
    expect(heuristicSuggestions("AlMg3 t=3").material).toBe("AlMg3");
    expect(heuristicSuggestions("AlMg3 t=3").materialFamily).toBe("aluminium");
    expect(heuristicSuggestions("S235JR blacha").material).toBe("S235JR");
    expect(heuristicSuggestions("S235JR blacha").materialFamily).toBe("mild_steel");
    expect(heuristicSuggestions("CuZn37 t=2").materialFamily).toBe("brass");
    expect(heuristicSuggestions("Cu-ETP t=2").materialFamily).toBe("copper");
  });

  it("gives only a family code (no invented grade) when just a material word is written", () => {
    const s = heuristicSuggestions("stal nierdzewna szczotkowana");
    expect(s.material).toBeNull();
    expect(s.materialFamily).toBe("stainless");
    expect(heuristicSuggestions("Aluminium 3 mm").materialFamily).toBe("aluminium");
    expect(heuristicSuggestions("mosiądz").materialFamily).toBe("brass");
    expect(heuristicSuggestions("mild steel").materialFamily).toBe("mild_steel");
  });

  it("notes extra material tokens instead of picking one silently", () => {
    const s = heuristicSuggestions("S355 spawane do 1.4301");
    expect(s.material).toBe("S355");
    expect(s.notes).toContainEqual({ code: "other_materials", params: { list: "1.4301" } });
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

  it("reads finish keywords and RAL codes as codes, never as words", () => {
    expect(heuristicSuggestions("malowanie proszkowe RAL 7016").finish).toEqual({
      code: "powder_coating",
      ral: "7016",
      text: null,
    });
    expect(heuristicSuggestions("ocynkowane ogniowo").finish).toEqual({
      code: "galvanised",
      ral: null,
      text: null,
    });
    expect(heuristicSuggestions("kolor RAL 9005").finish).toEqual({ code: null, ral: "9005", text: null });
    expect(heuristicSuggestions("deburr all edges").finish?.code).toBe("deburred");
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
    expect(s.notes).toContainEqual({ code: "thread_repeated", params: { size: "M6", seen: 2 } });
  });

  it("does not read bolt lengths as thread pitches", () => {
    expect(heuristicSuggestions("M6x20 screws").threads).toEqual([{ size: "M6", count: null }]);
  });
});

describe("no visible copy in lib/ (CLAUDE.md) — every code has a label in both dictionaries", () => {
  const samples = [
    fixture("200005"),
    fixture("200164"),
    "BEND UP 90 ° 2x45 ° R5 R10 S355 spawane do 1.4301 M6 (4x) M6 (4x) Ø35 H7 (2x)",
    "malowanie proszkowe RAL 7016 stal nierdzewna",
  ];

  it("heuristic notes are coded objects, never free text", () => {
    for (const text of samples) {
      for (const note of heuristicSuggestions(text).notes) {
        expect(SUGGESTION_NOTE_CODES).toContain(note.code);
        expect(note.code).not.toBe("text");
        for (const value of Object.values(note.params ?? {})) {
          // Language-neutral params: symbols, digits, grade tokens — no sentences.
          expect(String(value)).not.toMatch(/\b(?:seen|callout|fit|machining|context|other|tokens)\b/i);
        }
      }
    }
  });

  it.each(["pl", "en"] as const)("%s dictionary covers every note, finish and family code with clean templates", (locale) => {
    const c = getContent(locale).upload.aiSuggestions;
    for (const code of SUGGESTION_NOTE_CODES) expect(c.notes[code]).toBeTruthy();
    for (const code of FINISH_CODES) expect(c.finishCodes[code]).toBeTruthy();
    for (const family of MATERIAL_FAMILIES) expect(c.materialFamilies[family]).toBeTruthy();

    const rendered = [
      interpolate(c.notes.hole, { callout: "Ø13 (6×)" }),
      interpolate(c.notes.hole_fit, { callout: "Ø35 H7" }),
      interpolate(c.notes.chamfer, { a: "2", b: "45" }),
      interpolate(c.notes.radii, { list: "R5, R10" }),
      interpolate(c.notes.angles_no_context, { list: "45°, 13°" }),
      interpolate(c.notes.other_materials, { list: "1.4301" }),
      interpolate(c.notes.thread_repeated, { size: "M6", seen: 2 }),
      interpolate(c.notes.ai_unavailable, {}),
      interpolate(c.notes.pdf_too_large, {}),
      interpolate(c.notes.ai_value_dropped, { field: c.fields.quantity, value: "0" }),
      interpolate(c.notes.text, { text: "gwint M8 ×8" }),
      interpolate(c.ralLabel, { ral: "7016" }),
    ];
    for (const line of rendered) expect(line).not.toMatch(/\{\w+\}/);
    expect(rendered[0]).toContain("Ø13 (6×)");
    expect(rendered[2]).toContain("2×45°");
  });
});
