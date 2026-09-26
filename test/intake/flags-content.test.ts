/**
 * Flags content completeness — every FlagCode of the pricing catalogue
 * has a non-empty label and message in PL and EN, and the `{param}`
 * placeholders match between the two locales; same for triage states,
 * triage reasons, healing fragments and the upload error codes.
 * File path: /test/intake/flags-content.test.ts
 */
import { describe, expect, it } from "vitest";
import { getContent } from "@/content";
import type { FlagCode } from "@/lib/pricing/types";

/** The catalogue of lib/pricing/README.md (32 codes). */
const FLAG_CODES: FlagCode[] = [
  "geometry.manual",
  "geometry.triage_amber",
  "geometry.triage_red",
  "geometry.units_unconfirmed",
  "geometry.no_material",
  "geometry.no_thickness",
  "laser.thickness_over_limit",
  "laser.blank_exceeds_bed",
  "laser.no_rate_row",
  "laser.slow_contours",
  "laser.subcontract",
  "material.no_price",
  "material.mass_handling",
  "bend.force_over_limit",
  "bend.length_over_limit",
  "bend.hole_near_bend",
  "bend.hole_crosses_bend",
  "bend.short_flange",
  "bend.no_rate_row",
  "roll.radius_too_small",
  "roll.axis_too_long",
  "roll.thickness_over_limit",
  "roll.no_rate_row",
  "weld.no_rate_row",
  "weld.min_order_applied",
  "tube.over_limit",
  "tube.no_rate_row",
  "thread.no_rate_row",
  "feature.no_rate_row",
  "finish.no_rate_row",
  "finish.minimum_applied",
  "rates.placeholder",
];

const TRIAGE_STATES = ["green", "amber_bend_candidates", "amber_forming_unknown", "amber_units", "red_drawing_sheet", "red_no_closed_contour"] as const;

function placeholders(template: string): string[] {
  return Array.from(template.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();
}

const pl = getContent("pl");
const en = getContent("en");

describe("flags content", () => {
  it("covers every FlagCode with non-empty label + message in both locales", () => {
    expect(Object.keys(pl.flags.flags).sort()).toEqual([...FLAG_CODES].sort());
    expect(Object.keys(en.flags.flags).sort()).toEqual([...FLAG_CODES].sort());
    for (const code of FLAG_CODES) {
      for (const dict of [pl, en]) {
        expect(dict.flags.flags[code].label.trim().length, `${dict.locale} ${code} label`).toBeGreaterThan(0);
        expect(dict.flags.flags[code].message.trim().length, `${dict.locale} ${code} message`).toBeGreaterThan(0);
      }
    }
  });

  it("uses the same placeholders in PL and EN for every flag message", () => {
    for (const code of FLAG_CODES) {
      expect(placeholders(pl.flags.flags[code].message), code).toEqual(placeholders(en.flags.flags[code].message));
    }
  });

  it("describes every triage state and reason with matching placeholders", () => {
    for (const state of TRIAGE_STATES) {
      expect(pl.flags.triage[state].label.length).toBeGreaterThan(0);
      expect(en.flags.triage[state].label.length).toBeGreaterThan(0);
      expect(placeholders(pl.flags.triage[state].message)).toEqual(placeholders(en.flags.triage[state].message));
      expect(Boolean(pl.flags.triage[state].action)).toBe(Boolean(en.flags.triage[state].action));
      if (state !== "green") expect(pl.flags.triage[state].action?.length ?? 0).toBeGreaterThan(0);
    }
    for (const reason of Object.keys(pl.flags.triageReasons) as (keyof typeof pl.flags.triageReasons)[]) {
      expect(placeholders(pl.flags.triageReasons[reason])).toEqual(placeholders(en.flags.triageReasons[reason]));
    }
    for (const key of Object.keys(pl.flags.healing.parts) as (keyof typeof pl.flags.healing.parts)[]) {
      expect(placeholders(pl.flags.healing.parts[key])).toEqual(["count"]);
      expect(placeholders(en.flags.healing.parts[key])).toEqual(["count"]);
    }
    expect(placeholders(pl.flags.dropped.item)).toEqual(placeholders(en.flags.dropped.item));
  });

  it("maps every upload / action error code to copy in both locales", () => {
    const codes = Object.keys(pl.upload.errors).sort();
    expect(codes).toEqual(Object.keys(en.upload.errors).sort());
    for (const code of codes as (keyof typeof pl.upload.errors)[]) {
      expect(pl.upload.errors[code].length).toBeGreaterThan(0);
      expect(en.upload.errors[code].length).toBeGreaterThan(0);
    }
    expect(codes).toEqual(expect.arrayContaining(["dwg", "size", "extension", "binary_dxf", "unknown_type", "locked", "forbidden", "no_pdf", "generic"]));
  });
});
