/**
 * RFC 4180 parser / writer — quotes, commas inside quotes, CRLF, BOM,
 * embedded line breaks, doubled quotes, semicolon detection, round trip.
 * File path: /test/admin/csv.test.ts
 */
import { describe, expect, it } from "vitest";
import { csvEscape, detectDelimiter, parseCsv, parseCsvRecords, toCsv } from "@/lib/admin/csv";

describe("parseCsv", () => {
  it("splits plain fields and LF records", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF and a missing trailing line break", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops a UTF-8 BOM", () => {
    expect(parseCsv("﻿code,name\nS235,Steel")).toEqual([
      ["code", "name"],
      ["S235", "Steel"],
    ]);
  });

  it("keeps commas, line breaks and doubled quotes inside quoted fields", () => {
    const text = 'code,name\n"S235","Steel, ""black""\nplate"\n';
    expect(parseCsv(text)).toEqual([
      ["code", "name"],
      ["S235", 'Steel, "black"\nplate'],
    ]);
  });

  it("keeps empty fields and skips blank lines", () => {
    expect(parseCsv("a,,c\n\n,,\n1,2,3\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("supports a semicolon delimiter", () => {
    expect(parseCsv("a;b\n1,5;2", { delimiter: ";" })).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });

  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow(/unterminated/);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("parseCsvRecords", () => {
  it("maps rows onto normalised header names with 1-based line numbers", () => {
    const { header, records } = parseCsvRecords(" Code ,Price_Per_M\nS235,1.5\n\nS355,2\n");
    expect(header).toEqual(["code", "price_per_m"]);
    expect(records).toEqual([
      { line: 2, values: { code: "S235", price_per_m: "1.5" } },
      { line: 4, values: { code: "S355", price_per_m: "2" } },
    ]);
  });

  it("counts blank lines and line breaks inside quotes towards physical line numbers", () => {
    const { records } = parseCsvRecords('a,b\n"x\ny",1\n\n\nz,2\n');
    expect(records.map((r) => r.line)).toEqual([2, 6]);
  });

  it("fills missing cells with empty strings", () => {
    const { records } = parseCsvRecords("a,b,c\n1");
    expect(records[0].values).toEqual({ a: "1", b: "", c: "" });
  });
});

describe("detectDelimiter", () => {
  it("prefers the separator that occurs more often on the header line", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a,b;c")).toBe(",");
  });
});

describe("toCsv / csvEscape", () => {
  it("quotes only what needs quoting and uses CRLF", () => {
    const csv = toCsv(["code", "name", "json"], [["S235", 'Steel, "black"', { a: 1 }], ["x", null, true]]);
    expect(csv).toBe('code,name,json\r\nS235,"Steel, ""black""","{""a"":1}"\r\nx,,true\r\n');
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      ["S235", "Steel, black\nplate", "1.5"],
      ["", 'q"uote', "0"],
    ];
    expect(parseCsv(toCsv(["a", "b", "c"], rows))).toEqual([["a", "b", "c"], ...rows]);
  });

  it("escapes semicolons too (spreadsheets in a PL locale)", () => {
    expect(csvEscape("a;b")).toBe('"a;b"');
  });
});
