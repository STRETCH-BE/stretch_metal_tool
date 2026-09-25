/**
 * NumberInput parsing/formatting helpers — Polish "1 234,56", English
 * "1,234.56" and plain "1234.56" must all parse to the same value.
 * File path: /test/ui/number-input.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  constrainNumber,
  formatNumberInput,
  isPartialNumberInput,
  parseNumberInput,
} from "@/lib/number-input";

describe("parseNumberInput", () => {
  it("accepts Polish formatting with spaces and a comma decimal", () => {
    expect(parseNumberInput("1 234,56")).toBe(1234.56);
    expect(parseNumberInput("1 234,56")).toBe(1234.56); // NBSP (Intl output)
    expect(parseNumberInput("1 234,56")).toBe(1234.56); // narrow NBSP
    expect(parseNumberInput("12 345 678,9")).toBe(12345678.9);
  });

  it("accepts plain programmer input", () => {
    expect(parseNumberInput("1234.56")).toBe(1234.56);
    expect(parseNumberInput("1234")).toBe(1234);
    expect(parseNumberInput("-12.5")).toBe(-12.5);
    expect(parseNumberInput("+3")).toBe(3);
    expect(parseNumberInput(".5")).toBe(0.5);
    expect(parseNumberInput("7.")).toBe(7);
  });

  it("accepts English grouping with a dot decimal", () => {
    expect(parseNumberInput("1,234.56")).toBe(1234.56);
    expect(parseNumberInput("1,234,567")).toBe(1234567);
    expect(parseNumberInput("1.234,56")).toBe(1234.56); // German style
  });

  it("treats a single comma as the decimal separator", () => {
    expect(parseNumberInput("1,5")).toBe(1.5);
    expect(parseNumberInput("0,25")).toBe(0.25);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("   ")).toBeNull();
    expect(parseNumberInput(null)).toBeNull();
    expect(parseNumberInput(undefined)).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("12abc")).toBeNull();
    expect(parseNumberInput("1..2")).toBeNull();
    expect(parseNumberInput("1,2,3.4.5")).toBeNull();
    expect(parseNumberInput("-")).toBeNull();
  });
});

describe("formatNumberInput", () => {
  it("formats per locale and round-trips through parse", () => {
    const pl = formatNumberInput(1234.56, "pl");
    const en = formatNumberInput(1234.56, "en");
    expect(pl.replace(/ | /g, " ")).toBe("1 234,56");
    expect(en).toBe("1,234.56");
    expect(parseNumberInput(pl)).toBe(1234.56);
    expect(parseNumberInput(en)).toBe(1234.56);
  });

  it("respects fixed decimals and grouping", () => {
    expect(formatNumberInput(5, "en", { decimals: 2 })).toBe("5.00");
    expect(formatNumberInput(1234.5, "en", { grouping: false })).toBe("1234.5");
    expect(formatNumberInput(1.23456, "en")).toBe("1.2346");
  });

  it("returns an empty string for null / non-finite", () => {
    expect(formatNumberInput(null, "pl")).toBe("");
    expect(formatNumberInput(undefined, "en")).toBe("");
    expect(formatNumberInput(Number.NaN, "en")).toBe("");
  });
});

describe("isPartialNumberInput", () => {
  it("allows intermediate keystrokes", () => {
    expect(isPartialNumberInput("1,")).toBe(true);
    expect(isPartialNumberInput("-")).toBe(true);
    expect(isPartialNumberInput("1 2")).toBe(true);
    expect(isPartialNumberInput("")).toBe(true);
  });
  it("rejects letters", () => {
    expect(isPartialNumberInput("1a")).toBe(false);
  });
});

describe("constrainNumber", () => {
  it("rounds and clamps", () => {
    expect(constrainNumber(1.2345, { decimals: 2 })).toBe(1.23);
    expect(constrainNumber(-5, { min: 0 })).toBe(0);
    expect(constrainNumber(500, { max: 100 })).toBe(100);
  });
});
