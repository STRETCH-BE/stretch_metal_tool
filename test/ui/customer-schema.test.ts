/**
 * Customer form contract: parseCustomerForm accepts any ISO country,
 * normalises input, reports error CODES per field and always echoes the
 * raw submitted values (the form re-populates from them after React 19's
 * automatic form reset).
 * File path: /test/ui/customer-schema.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_FIELDS,
  PREFERRED_COUNTRY_CODES,
  parseCustomerForm,
  readCustomerFormValues,
} from "@/lib/customers/schema";
import { ALL_COUNTRY_CODES } from "@/lib/customers/countries";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const VALID = {
  name: "Acme GmbH",
  vat_id: "DE123456789",
  country: "DE",
  address: "Hauptstr. 1",
  email: "Buyer@Acme.DE",
  phone: "+49 30 1234",
  customer_class: "key",
  preferred_locale: "en",
  notes: "",
};

describe("parseCustomerForm — country", () => {
  it("accepts countries outside the curated select list", () => {
    for (const country of ["US", "TR", "GR", "BG", "RS", "CN", "JP", "XK"]) {
      const result = parseCustomerForm(form({ ...VALID, country }));
      expect(result.ok, country).toBe(true);
      if (result.ok) expect(result.data.country).toBe(country);
    }
  });

  it("normalises case and whitespace", () => {
    const result = parseCustomerForm(form({ ...VALID, country: " de " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.country).toBe("DE");
  });

  it("rejects unassigned codes and names with invalidCountry", () => {
    for (const country of ["XX", "Polska", "POL", ""]) {
      const result = parseCustomerForm(form({ ...VALID, country }));
      expect(result.ok, country).toBe(false);
      if (!result.ok) expect(result.fieldErrors.country).toBe("invalidCountry");
    }
  });

  it("keeps the curated list a strict subset of the valid codes", () => {
    for (const code of PREFERRED_COUNTRY_CODES) expect(ALL_COUNTRY_CODES).toContain(code);
    expect(PREFERRED_COUNTRY_CODES.length).toBeLessThan(ALL_COUNTRY_CODES.length);
  });
});

describe("parseCustomerForm — values echo", () => {
  it("returns the raw submitted strings next to the field errors", () => {
    const typed = {
      name: "",
      vat_id: "PL1234567890",
      country: "DE",
      address: "ul. Długa 1\n00-001 Warszawa",
      email: "not-an-email",
      phone: "+48 600 000 000",
      customer_class: "new",
      preferred_locale: "pl",
      notes: "Pays late.",
    };
    const result = parseCustomerForm(form(typed));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toEqual({ name: "required", email: "invalidEmail" });
    expect(result.values).toEqual(typed);
  });

  it("reads every field, defaulting missing ones to an empty string", () => {
    const values = readCustomerFormValues(form({ name: "Only name" }));
    expect(Object.keys(values).sort()).toEqual([...CUSTOMER_FIELDS].sort());
    expect(values.name).toBe("Only name");
    expect(values.country).toBe("");
    expect(values.notes).toBe("");
  });

  it("also returns the values on success (transformed data stays separate)", () => {
    const result = parseCustomerForm(form(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.email).toBe("Buyer@Acme.DE");
    expect(result.data.email).toBe("buyer@acme.de");
    expect(result.data.notes).toBeNull();
    expect(result.data.preferred_locale).toBe("en");
  });
});
