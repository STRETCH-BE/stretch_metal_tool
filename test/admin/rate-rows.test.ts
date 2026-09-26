/**
 * Rate-row validation (zod per table, codes not copy), natural keys and
 * blank rows.
 * File path: /test/admin/rate-rows.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  RATE_TABLES,
  RATE_TABLE_NAMES,
  blankRateRow,
  csvColumns,
  keyCell,
  rateRowKey,
  validateRateRow,
} from "@/lib/admin/tables";

describe("validateRateRow", () => {
  it("accepts a laser row typed as strings (CSV path) and coerces it", () => {
    const result = validateRateRow("laser", {
      material_code: " S235 ",
      thickness_mm: "1,5",
      in_house: "yes",
      mode: "time",
      speed_m_min: "25",
      pierce_s: "0.2",
      price_per_m: "",
      price_per_pierce: "0",
      gas: "",
      min_contour_mm: "",
      supplier: "",
      id: "ignored",
      placeholder: "true",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toEqual({
      material_code: "S235",
      thickness_mm: 1.5,
      in_house: true,
      mode: "time",
      speed_m_min: 25,
      pierce_s: 0.2,
      price_per_m: null,
      price_per_pierce: 0,
      gas: null,
      min_contour_mm: null,
      supplier: null,
    });
    expect("id" in result.values).toBe(false);
    expect("placeholder" in result.values).toBe(false);
  });

  it("reports codes per column: required, invalidNumber, negative, invalidOption", () => {
    const result = validateRateRow("laser", {
      material_code: "",
      thickness_mm: "abc",
      in_house: true,
      mode: "fast",
      speed_m_min: -1,
      price_per_pierce: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toEqual({
      material_code: "required",
      thickness_mm: "invalidNumber",
      mode: "invalidOption",
      speed_m_min: "negative",
      price_per_pierce: "required",
    });
  });

  it("validates JSON columns with the pricing schemas and reports invalidJson", () => {
    const good = validateRateRow("materials", {
      code: "S235",
      name: "Steel",
      family: "mild_steel",
      density_kg_m3: 7850,
      rm_n_mm2: 400,
      price_per_kg: '[{"maxThicknessMm": 3, "pricePerKg": "1.2"}]',
      sheet_formats: [{ lengthMm: 3000, widthMm: 1500 }],
      scrap_pct_default: 25,
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.values.price_per_kg).toEqual([{ maxThicknessMm: 3, pricePerKg: 1.2 }]);

    const bad = validateRateRow("materials", {
      code: "S235",
      name: "Steel",
      family: "mild_steel",
      density_kg_m3: 7850,
      rm_n_mm2: 400,
      price_per_kg: "[{oops",
      sheet_formats: [{ lengthMm: "x" }],
      scrap_pct_default: 25,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors).toEqual({ price_per_kg: "invalidJson", sheet_formats: "invalidJson" });
  });

  it("validates the single-row general table including margin_by_class", () => {
    const result = validateRateRow("general", {
      machine_rate_eur_h: 70,
      labour_rate_eur_h: 35,
      machining_rate_eur_h: 60,
      default_margin_pct: 30,
      margin_by_class: { key: 25 },
      blank_margin_mm: 10,
      slow_contour_factor: 1.5,
      default_stitch_bead_mm: 30,
      default_stitch_pitch_mm: 60,
      handling_mass_limit_kg: 25,
      handling_surcharge_eur: 5,
      weld_handling_per_part: 3,
    });
    expect(result.ok).toBe(true);
  });

  it("every table accepts its own blank row once the key/required cells are filled in", () => {
    const fill: Record<string, Record<string, unknown>> = {
      general: {
        machine_rate_eur_h: 1, labour_rate_eur_h: 1, machining_rate_eur_h: 1, default_margin_pct: 1, blank_margin_mm: 1,
        slow_contour_factor: 1, default_stitch_bead_mm: 1, default_stitch_pitch_mm: 1, handling_mass_limit_kg: 1,
        handling_surcharge_eur: 1, weld_handling_per_part: 1,
      },
      materials: { code: "X", name: "X", density_kg_m3: 1, rm_n_mm2: 1, scrap_pct_default: 1 },
      laser: { material_code: "X", thickness_mm: 1, price_per_pierce: 0 },
      tube_laser: { wall_mm: 1, price_per_m_cut: 1, handling_per_part: 0, setup: 0 },
      bend: { thickness_mm: 1, length_class_mm: 1, price_per_bend: 1, setup_per_part_type: 0 },
      roll: { thickness_mm: 1, radius_class_mm: 1, price_per_m: 1, setup: 0 },
      weld: { bead_mm: 1, price_per_mm: 1, setup: 0, min_order: 0 },
      thread: { size: "M8", price_each: 1 },
      feature: { code: "X", name: "X", price_each: 1 },
      finish: { code: "X", name: "X", price: 1, minimum: 0 },
    };
    for (const table of RATE_TABLE_NAMES) {
      const result = validateRateRow(table, { ...blankRateRow(table), ...fill[table] });
      expect(result.ok, table).toBe(true);
    }
  });
});

describe("rateRowKey / keyCell", () => {
  it("builds natural keys per table", () => {
    expect(rateRowKey("general", {})).toBe("general");
    expect(rateRowKey("materials", { code: "S235" })).toBe("S235");
    expect(rateRowKey("laser", { material_code: "S235", thickness_mm: "1.50", in_house: true })).toBe("S235|1.5|1");
    expect(rateRowKey("laser", { material_code: "S235", thickness_mm: 1.5, in_house: false })).toBe("S235|1.5|0");
    expect(rateRowKey("tube_laser", { profile_family: "round", wall_mm: 3 })).toBe("round|3");
    expect(rateRowKey("bend", { thickness_mm: 2, length_class_mm: 1000 })).toBe("2|1000");
    expect(rateRowKey("weld", { process: "tig", bead_mm: "4" })).toBe("tig|4");
    expect(rateRowKey("finish", { code: "powder" })).toBe("powder");
  });

  it("normalises numeric strings and trims text", () => {
    expect(keyCell("1.50")).toBe("1.5");
    expect(keyCell(" abc ")).toBe("abc");
    expect(keyCell(null)).toBe("");
  });
});

describe("registry", () => {
  it("declares key columns that exist and csv columns ending with placeholder", () => {
    for (const table of RATE_TABLE_NAMES) {
      const def = RATE_TABLES[table];
      const names = def.columns.map((c) => c.name);
      for (const key of def.keyColumns) expect(names).toContain(key);
      expect(csvColumns(table).at(-1)).toBe("placeholder");
      if (!def.singleRow) expect(def.keyColumns.length).toBeGreaterThan(0);
    }
  });
});
