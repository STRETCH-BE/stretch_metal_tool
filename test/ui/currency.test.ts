/**
 * Default currency by customer country: PL → PLN, everything else → EUR.
 * File path: /test/ui/currency.test.ts
 */
import { describe, expect, it } from "vitest";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";

describe("defaultCurrencyForCountry", () => {
  it("returns PLN for Poland", () => {
    expect(defaultCurrencyForCountry("PL")).toBe("PLN");
    expect(defaultCurrencyForCountry("pl")).toBe("PLN");
    expect(defaultCurrencyForCountry(" PL ")).toBe("PLN");
  });

  it("returns EUR for every other country", () => {
    for (const code of ["DE", "BE", "NL", "GB", "CH", "NO", "UA", "US"]) {
      expect(defaultCurrencyForCountry(code)).toBe("EUR");
    }
  });

  it("falls back to EUR when the country is missing", () => {
    expect(defaultCurrencyForCountry(null)).toBe("EUR");
    expect(defaultCurrencyForCountry(undefined)).toBe("EUR");
    expect(defaultCurrencyForCountry("")).toBe("EUR");
  });
});
