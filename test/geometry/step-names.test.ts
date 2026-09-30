/**
 * STEP string decoding (lib/geometry/step/part21.ts): Part 21 escapes and
 * the mojibake repair of names a converter wrote as Latin-1 UTF-8 bytes.
 * File path: /test/geometry/step-names.test.ts
 */
import { describe, expect, it } from "vitest";
import { decodeStepString, parseStep, repairMojibake } from "@/lib/geometry/step/part21";
import { stepBodyInfos } from "@/lib/geometry/step/assembly";
import { buildStep, rect } from "./step-builder";

describe("STEP names", () => {
  it("repairs UTF-8 read as Latin-1, including the hidden C1 control of ß", () => {
    expect(repairMojibake("StÃ¼tzenfuÃ\u009F")).toBe("Stützenfuß");
    expect(decodeStepString("StÃ¼tzenfuÃ\u009F kurz")).toBe("Stützenfuß kurz");
    expect(repairMojibake("Verblechung Tropfkante links")).toBe("Verblechung Tropfkante links");
  });

  it("leaves clean UTF-8, Latin-1 that is not mojibake and U+FFFD untouched", () => {
    expect(decodeStepString("Stützenfuß")).toBe("Stützenfuß");
    expect(decodeStepString("Fenstersturz �bergang")).toBe("Fenstersturz �bergang");
    expect(decodeStepString("Gięta ława")).toBe("Gięta ława");
    // Ã followed by a letter outside the continuation range is not a UTF-8 pair.
    expect(decodeStepString("SÃO PAULO")).toBe("SÃO PAULO");
  });

  it("still decodes Part 21 escapes; a string mixing escaped Latin-1 with mojibake is left as decoded (no partial repair)", () => {
    expect(decodeStepString("St\\X2\\00FC\\X0\\tzenfu\\X\\DF")).toBe("Stützenfuß");
    expect(decodeStepString("St\u00C3\u00BCtze \\S\\d")).toBe("St\u00C3\u00BCtze ä");
  });

  it("product names of a converted assembly come out repaired", () => {
    const text = buildStep([{ outer: rect(50, 30), height: 3 }], { products: [{ name: "plate" }] }).replace("PRODUCT('plate','plate'", "PRODUCT('StÃ¼tzenfuÃ\u009F','StÃ¼tzenfuÃ\u009F'");
    const infos = Array.from(stepBodyInfos(parseStep(text)).values());
    expect(infos.map((i) => i.name)).toEqual(["Stützenfuß"]);
  });
});
