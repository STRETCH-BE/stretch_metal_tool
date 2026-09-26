/**
 * Flag / triage / healing / dropped message helpers (lib/parts/flag-message.ts).
 * File path: /test/intake/flag-message.test.ts
 */
import { describe, expect, it } from "vitest";
import { getContent } from "@/content";
import {
  droppedSummary,
  fillTemplate,
  flagLabel,
  flagMessage,
  healingSentence,
  translateParams,
  triageMessage,
  triageReasons,
  triageSeverity,
} from "@/lib/parts/flag-message";
import type { HealingReport } from "@/lib/geometry/types";

const en = getContent("en").flags;
const pl = getContent("pl").flags;

describe("fillTemplate", () => {
  it("interpolates, formats numbers per locale and marks missing params", () => {
    expect(fillTemplate("{a} and {b}", { a: 1, b: "x" })).toBe("1 and x");
    expect(fillTemplate("{a}", { a: 2224.5 }, "pl")).toBe("2224,5");
    expect(fillTemplate("{a}", { a: 12345.678 }, "en")).toBe("12,345.68");
    expect(fillTemplate("{missing}", {})).toBe("—");
    expect(fillTemplate("{a}", { a: Number.NaN })).toBe("—");
  });
});

describe("flagMessage", () => {
  it("renders the catalogue message with translated enum params", () => {
    const text = flagMessage(
      en,
      { code: "laser.thickness_over_limit", params: { limitMm: 12.7, thicknessMm: 15, family: "mild_steel", rowThicknessMm: 15, supplier: "ACME" } },
      "en"
    );
    expect(text).toBe("15 mm exceeds the 12.7 mm limit of our laser for mild steel. Cutting priced from the supplier rate ACME (row 15 mm).");
    expect(flagLabel(en, { code: "laser.thickness_over_limit" })).toBe("Subcontract — above the laser limit");
  });

  it("translates state / reason / what / process and maps seamId to weldId", () => {
    const params = translateParams(pl, { state: "amber_units", reason: "over_limit", what: "wall", process: "tig", seamId: "s1" });
    expect(params.state).toBe(pl.triage.amber_units.label);
    expect(params.reason).toBe(pl.laserReasons.over_limit);
    expect(params.what).toBe(pl.tubeLimits.wall);
    expect(params.process).toBe("TIG");
    expect(params.weldId).toBe("s1");
    expect(flagMessage(en, { code: "weld.no_rate_row", params: { seamId: "s1", process: "mma", beadMm: 4 } })).toBe(
      "Seam s1: no rate for process stick (MMA) and bead 4 mm."
    );
  });

  it("falls back to the code for an unknown flag", () => {
    expect(flagMessage(en, { code: "made.up" as never })).toBe("made.up");
  });
});

describe("triage helpers", () => {
  it("interpolates details into the state message and the reasons", () => {
    const triage = { state: "amber_bend_candidates" as const, reasons: ["interior_open_lines" as const, "multi_part" as const], candidateEntityIds: ["a", "b"], details: { count: 2, partCount: 3 } };
    expect(triageMessage(en, triage)).toContain("2 open lines");
    expect(triageReasons(en, triage)).toEqual(["2 open lines inside the outline without a role", "The file holds 3 separate parts — the largest is priced"]);
    expect(triageSeverity("green")).toBe("green");
    expect(triageSeverity("amber_units")).toBe("amber");
    expect(triageSeverity("red_drawing_sheet")).toBe("red");
  });
});

describe("healing + dropped", () => {
  const report: HealingReport = { toleranceMm: 0.01, gapsJoined: 3, duplicatesRemoved: 2, overlapsRemoved: 0, zeroLengthRemoved: 0, splinesFlattened: 1, ellipsesFlattened: 0, blocksExploded: 0, loopsClosed: 0 };

  it("builds the sentence from the non-zero counters in both locales", () => {
    expect(healingSentence(en, report)).toBe("Joined 3 gaps, removed 2 duplicates, flattened 1 splines");
    expect(healingSentence(pl, report)).toBe("Połączone przerwy: 3, usunięte duplikaty: 2, spłaszczone splajny: 1");
    expect(healingSentence(en, { ...report, gapsJoined: 0, duplicatesRemoved: 0, splinesFlattened: 0 })).toBe(en.healing.nothing);
  });

  it("aggregates dropped entities by type + reason, largest first", () => {
    const lines = droppedSummary(en, [
      { type: "POINT", layer: "IV_ARC_CENTERS", count: 47, reason: "not_geometry" },
      { type: "LINE", layer: "IV_FEATURE_PROFILES_DOWN", count: 12, reason: "ignored_layer" },
      { type: "ARC", layer: "IV_FEATURE_PROFILES_DOWN", count: 12, reason: "ignored_layer" },
      { type: "LINE", layer: "IV_TANGENT", count: 8, reason: "ignored_layer" },
    ]);
    expect(lines[0]).toBe("POINT × 47 (layer IV_ARC_CENTERS) — not geometry");
    expect(lines[1]).toBe("LINE × 20 (layer IV_FEATURE_PROFILES_DOWN, IV_TANGENT) — ignored layer");
    expect(lines).toHaveLength(3);
  });
});
