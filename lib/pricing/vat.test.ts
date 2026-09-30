/**
 * computeVat — the owner's rule (docs/assembly-mode-design.md §3.4) as a
 * matrix: home country, VAT id abroad (EU / non-EU), no VAT id abroad with
 * and without OSS, the B2B amber, and no customer / no country.
 * File path: /lib/pricing/vat.test.ts
 */
import { describe, expect, it } from "vitest";
import { JOB_RATE_DEFAULTS } from "./job-rates";
import type { CustomerType } from "./types";
import { EU_COUNTRY_CODES, computeVat, hasVatId, isEuCountry } from "./vat";

const NET = 1000;
const rates = (ossActive = false) => ({ ...JOB_RATE_DEFAULTS, ossActive });
const vat = (customerType: CustomerType | null, customerCountry: string | null, customerVatId: string | null, ossActive = false) =>
  computeVat({ customerType, customerCountry, customerVatId, netTotalEur: NET }, rates(ossActive));

describe("computeVat matrix", () => {
  it("PL b2b with and without a VAT id → pl_domestic 23 % (the PL row), gross 1230, no flag", () => {
    for (const id of ["PL5732911703", null, "  "]) {
      const r = vat("b2b", "PL", id)!;
      expect(r.vat).toEqual({ mode: "pl_domestic", ratePct: 23, countryCode: "PL", netTotal: NET, vatAmount: 230, grossTotal: 1230 });
      expect(r.flags).toEqual([]);
    }
    expect(vat("b2c", "pl", null)!.vat.mode).toBe("pl_domestic");
  });

  it("FI b2b with a VAT id → reverse_charge 0 % (EU), country null", () => {
    const r = vat("b2b", "FI", "FI12345678")!;
    expect(r.vat).toMatchObject({ mode: "reverse_charge", ratePct: 0, countryCode: null, vatAmount: 0, grossTotal: NET });
    expect(r.flags).toEqual([]);
    // the rate follows the VAT id, not the customer type
    expect(vat("b2c", "FI", "FI12345678")!.vat.mode).toBe("reverse_charge");
  });

  it("FI b2c without a VAT id: OSS off → b2c_domestic 23 % (PL rate); OSS on → b2c_oss 25.5 % (the FI row)", () => {
    const off = vat("b2c", "FI", null, false)!;
    expect(off.vat).toMatchObject({ mode: "b2c_domestic", ratePct: 23, countryCode: "PL", vatAmount: 230, grossTotal: 1230 });
    expect(off.flags).toEqual([]);
    const on = vat("b2c", "FI", null, true)!;
    expect(on.vat).toMatchObject({ mode: "b2c_oss", ratePct: 25.5, countryCode: "FI", vatAmount: 255, grossTotal: 1255 });
    expect(on.flags).toEqual([]);
  });

  it("OSS on but the destination has no vat_rates row (IT) → the PL rate, b2c_domestic, amber vat.no_rate (design §3.4)", () => {
    const rates = { ...JOB_RATE_DEFAULTS, ossActive: true };
    const r = computeVat({ customerType: "b2c", customerCountry: "IT", customerVatId: null, netTotalEur: 1000 }, rates)!;
    expect(r.vat).toMatchObject({ mode: "b2c_domestic", ratePct: 23, countryCode: "PL", grossTotal: 1230 });
    expect(r.flags).toEqual([expect.objectContaining({ code: "vat.no_rate", severity: "amber", overridable: true, params: { countryCode: "IT", fallbackPct: 23 } })]);
  });

  it("no vat_rates row for the home country → the taxed modes are red vat.no_rate (never a silent 0 %)", () => {
    const rates = { ...JOB_RATE_DEFAULTS, vatRates: { FI: 25.5, DE: 19 } };
    const pl = computeVat({ customerType: "b2b", customerCountry: "PL", customerVatId: "PL5732911703", netTotalEur: 1000 }, rates)!;
    expect(pl.vat).toMatchObject({ mode: "pl_domestic", ratePct: 0 });
    expect(pl.flags).toEqual([expect.objectContaining({ code: "vat.no_rate", severity: "red", overridable: false, params: { countryCode: "PL" } })]);
    const abroad = computeVat({ customerType: "b2c", customerCountry: "FI", customerVatId: null, netTotalEur: 1000 }, rates)!;
    expect(abroad.vat.mode).toBe("b2c_domestic");
    expect(abroad.flags.some((f) => f.code === "vat.no_rate" && f.severity === "red")).toBe(true);
    // a VAT id abroad never needs the home row
    const rc = computeVat({ customerType: "b2b", customerCountry: "DE", customerVatId: "DE123", netTotalEur: 1000 }, rates)!;
    expect(rc.vat.mode).toBe("reverse_charge");
    expect(rc.flags).toEqual([]);
  });

  it("DE b2b without a VAT id → 23 % (b2c_domestic) + amber customer.vat_id_missing (overridable); OSS does not change a B2B customer", () => {
    for (const oss of [false, true]) {
      const r = vat("b2b", "DE", "", oss)!;
      expect(r.vat).toMatchObject({ mode: "b2c_domestic", ratePct: 23, countryCode: "PL" });
      expect(r.flags).toHaveLength(1);
      expect(r.flags[0]).toMatchObject({ code: "customer.vat_id_missing", severity: "amber", overridable: true, partId: null, itemId: null });
      expect(r.flags[0].params).toMatchObject({ countryCode: "DE", ratePct: 23 });
    }
  });

  it("NO / CH / US with a VAT id → export 0 %", () => {
    for (const cc of ["NO", "CH", "US"]) {
      const r = vat("b2b", cc, "123")!;
      expect(r.vat).toMatchObject({ mode: "export", ratePct: 0, countryCode: null, grossTotal: NET });
      expect(r.flags).toEqual([]);
    }
  });

  it("US b2c without a VAT id → 23 % b2c_domestic (no OSS outside the EU, even when active)", () => {
    const r = vat("b2c", "US", null, true)!;
    expect(r.vat).toMatchObject({ mode: "b2c_domestic", ratePct: 23, countryCode: "PL" });
    expect(r.flags).toEqual([]);
  });

  it("no country → mode none, 0 %, gross = net; unknown customer type keeps working", () => {
    expect(vat("b2b", null, null)!.vat).toEqual({ mode: "none", ratePct: 0, countryCode: null, netTotal: NET, vatAmount: 0, grossTotal: NET });
    expect(vat(null, "FI", null)!.vat.mode).toBe("b2c_domestic");
    expect(vat(null, "FI", null)!.flags).toEqual([]);
  });

  it("no customer at all (no type, country or VAT id) → null", () => {
    expect(vat(null, null, null)).toBeNull();
    expect(vat(null, "", "  ")).toBeNull();
  });

  it("amounts follow the net total; a company outside PL uses its own home row", () => {
    const r = computeVat({ customerType: "b2c", customerCountry: "de", customerVatId: null, netTotalEur: 250 }, { vatRates: { DE: 19, PL: 23 }, ossActive: false, homeCountry: "DE" })!;
    expect(r.vat).toMatchObject({ mode: "pl_domestic", ratePct: 19, countryCode: "DE", vatAmount: 47.5, grossTotal: 297.5 });
  });

  it("helpers: EU membership set (27 states + EL), VAT id trimming", () => {
    expect(EU_COUNTRY_CODES.size).toBe(28);
    expect(isEuCountry("pl")).toBe(true);
    expect(isEuCountry("GB")).toBe(false);
    expect(isEuCountry(null)).toBe(false);
    expect(hasVatId("  ")).toBe(false);
    expect(hasVatId(" X ")).toBe(true);
  });
});
