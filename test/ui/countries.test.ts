/**
 * Customer country codes: any ISO 3166-1 alpha-2 code is a valid customer
 * country (the only rule is PL → PLN, else EUR); names come from the
 * content dictionary, then Intl.DisplayNames, then the bare code.
 * File path: /test/ui/countries.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  ALL_COUNTRY_CODES,
  countryName,
  isCountryCode,
  normalizeCountryCode,
  sortCountryCodesByName,
} from "@/lib/customers/countries";
import { getContent } from "@/content";

describe("ALL_COUNTRY_CODES", () => {
  it("is the full ISO 3166-1 alpha-2 list (249) plus XK, unique and upper-case", () => {
    expect(ALL_COUNTRY_CODES).toHaveLength(250);
    expect(new Set(ALL_COUNTRY_CODES).size).toBe(250);
    for (const code of ALL_COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(ALL_COUNTRY_CODES).toContain("XK");
  });

  it("every code has an English display name (guards typos in the list)", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    const unnamed = ALL_COUNTRY_CODES.filter((code) => !names.of(code));
    expect(unnamed).toEqual([]);
  });

  it("covers every curated country in the content dictionary", () => {
    for (const code of Object.keys(getContent("pl").quote.customers.countries)) {
      expect(ALL_COUNTRY_CODES).toContain(code);
    }
  });
});

describe("isCountryCode", () => {
  it("accepts countries outside the curated list (the reviewer's probe set)", () => {
    for (const code of ["US", "TR", "GR", "BG", "RS", "CN", "PL", "XK"]) {
      expect(isCountryCode(code)).toBe(true);
    }
  });

  it("rejects unassigned or malformed codes and un-normalized input", () => {
    for (const code of ["XX", "ZZ", "", "P", "POL", "pl", "1A", "Polska"]) {
      expect(isCountryCode(code)).toBe(false);
    }
    expect(isCountryCode(normalizeCountryCode(" pl "))).toBe(true);
  });
});

describe("countryName", () => {
  const overrides = getContent("pl").quote.customers.countries;

  it("prefers the content dictionary", () => {
    expect(countryName("DE", "pl", overrides)).toBe("Niemcy");
    expect(countryName("de", "pl", overrides)).toBe("Niemcy");
  });

  it("falls back to Intl.DisplayNames per locale", () => {
    expect(countryName("GR", "pl", overrides)).toBe("Grecja");
    expect(countryName("GR", "en")).toBe("Greece");
    expect(countryName("US", "en")).toBe("United States");
  });

  it("never throws: unknown → the code, malformed → the input, empty → \"\"", () => {
    expect(countryName("XX", "en")).toBe("XX");
    expect(countryName("1A", "en")).toBe("1A");
    expect(countryName("", "en")).toBe("");
    expect(countryName(null, "en")).toBe("");
  });
});

describe("sortCountryCodesByName", () => {
  it("orders by the localized name", () => {
    expect(sortCountryCodesByName(["US", "GR", "AT"], "en")).toEqual(["AT", "GR", "US"]);
    // pl: Austria, Grecja, Stany Zjednoczone
    expect(sortCountryCodesByName(["US", "GR", "AT"], "pl")).toEqual(["AT", "GR", "US"]);
    // pl: Niemcy (DE) sorts after Grecja (GR) by name, although DE < GR by code.
    expect(sortCountryCodesByName(["DE", "GR"], "pl")).toEqual(["GR", "DE"]);
  });
});
