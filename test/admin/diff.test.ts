/**
 * Row diff by natural key — added / removed / changed, normalisation of
 * numeric strings and JSON key order.
 * File path: /test/admin/diff.test.ts
 */
import { describe, expect, it } from "vitest";
import { cellsEqual, diffRows, normalizeCell } from "@/lib/admin/diff";
import { rateRowKey } from "@/lib/admin/tables";

type Row = Record<string, unknown>;

const keyOf = (row: Row) => rateRowKey("laser", row);
const COLUMNS = ["mode", "speed_m_min", "price_per_m", "gas", "supplier"];

const base: Row[] = [
  { material_code: "S235", thickness_mm: 1, in_house: true, mode: "time", speed_m_min: "25", price_per_m: null, gas: "O2", supplier: null },
  { material_code: "S235", thickness_mm: 2, in_house: true, mode: "time", speed_m_min: 16, price_per_m: null, gas: "O2", supplier: null },
  { material_code: "S235", thickness_mm: 15, in_house: false, mode: "per_m", speed_m_min: null, price_per_m: 4.5, gas: null, supplier: "ACME" },
];

describe("diffRows", () => {
  it("classifies added, removed and changed rows by natural key", () => {
    const target: Row[] = [
      { ...base[0], speed_m_min: 25 }, // same value, string vs number
      { ...base[1], speed_m_min: 17, gas: "N2" }, // changed
      { material_code: "S235", thickness_mm: 3, in_house: true, mode: "time", speed_m_min: 11, price_per_m: null, gas: "O2", supplier: null }, // added
    ];
    const diff = diffRows(base, target, keyOf, COLUMNS);
    expect(diff.unchanged).toBe(1);
    expect(diff.added.map((d) => d.key)).toEqual(["S235|3|1"]);
    expect(diff.removed.map((d) => d.key)).toEqual(["S235|15|0"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].key).toBe("S235|2|1");
    expect(diff.changed[0].columns).toEqual(["speed_m_min", "gas"]);
    expect(diff.changed[0].before?.speed_m_min).toBe(16);
    expect(diff.changed[0].after?.speed_m_min).toBe(17);
  });

  it("treats a numeric string and a number as equal, and null/undefined as equal", () => {
    expect(cellsEqual("1.50", 1.5)).toBe(true);
    expect(cellsEqual(" 2 ", 2)).toBe(true);
    expect(cellsEqual(null, undefined)).toBe(true);
    expect(cellsEqual("", null)).toBe(false);
    expect(cellsEqual("abc", "abd")).toBe(false);
  });

  it("compares JSON columns structurally regardless of key order", () => {
    const a = [{ pricePerKg: 1.2, maxThicknessMm: 3 }];
    const b = [{ maxThicknessMm: 3, pricePerKg: 1.2 }];
    expect(cellsEqual(a, b)).toBe(true);
    expect(cellsEqual(a, [{ maxThicknessMm: 3, pricePerKg: 1.3 }])).toBe(false);
    expect(normalizeCell({ b: 1, a: [1, "2"] })).toBe('{"a":[1,2],"b":1}');
  });

  it("sorts every bucket by key and counts unchanged rows", () => {
    const rows: Row[] = [
      { material_code: "B", thickness_mm: 1, in_house: true, mode: "time" },
      { material_code: "A", thickness_mm: 1, in_house: true, mode: "time" },
    ];
    const diff = diffRows([], rows, keyOf, ["mode"]);
    expect(diff.added.map((d) => d.key)).toEqual(["A|1|1", "B|1|1"]);
    expect(diffRows(rows, rows, keyOf, ["mode"]).unchanged).toBe(2);
  });
});
