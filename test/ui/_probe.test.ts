import { describe, expect, it } from "vitest";
import { parseCustomerForm } from "@/lib/customers/schema";
import { activeHref } from "@/components/shell/sidebar";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("probe parseCustomerForm", () => {
  it("empty form → required name, invalid country/class", () => {
    const r = parseCustomerForm(form({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.name).toBe("required");
      expect(r.fieldErrors.country).toBe("invalidCountry");
      expect(r.fieldErrors.customer_class).toBe("invalidClass");
      expect(r.fieldErrors.preferred_locale).toBeUndefined();
    }
  });
  it("normalises country + email", () => {
    const r = parseCustomerForm(form({ name: " Acme ", country: "pl", customer_class: "key", email: " Foo@Bar.COM " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe("Acme");
      expect(r.data.country).toBe("PL");
      expect(r.data.email).toBe("foo@bar.com");
      expect(r.data.vat_id).toBeNull();
      expect(r.data.preferred_locale).toBeNull();
    }
  });
  it("US / TR / GR customers cannot be saved", () => {
    for (const c of ["US", "TR", "GR", "BG", "RS", "CN"]) {
      const r = parseCustomerForm(form({ name: "X", country: c, customer_class: "standard" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors.country).toBe("invalidCountry");
    }
  });
  it("bad email → invalidEmail; 201-char name → tooLong", () => {
    const r = parseCustomerForm(form({ name: "x".repeat(201), country: "DE", customer_class: "standard", email: "nope" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.email).toBe("invalidEmail");
      expect(r.fieldErrors.name).toBe("tooLong");
    }
  });
});

describe("probe activeHref", () => {
  const items = [
    { key: "quotes", href: "/quotes" },
    { key: "newQuote", href: "/quotes/new" },
    { key: "customers", href: "/customers" },
  ] as const;
  it("longest prefix wins", () => {
    expect(activeHref("/quotes/new", [...items])).toBe("/quotes/new");
    expect(activeHref("/quotes/abc", [...items])).toBe("/quotes");
    expect(activeHref("/customers/new", [...items])).toBe("/customers");
    expect(activeHref("/", [...items])).toBeNull();
    expect(activeHref("/parts/abc", [...items])).toBeNull();
  });
});
