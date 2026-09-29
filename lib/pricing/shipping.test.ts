/**
 * The shipping line: manual cost as typed, the shipping_rates band of the
 * destination by gross mass (typed or computed), and amber shipping.missing
 * when nothing prices the shipment of a customer abroad.
 * File path: /lib/pricing/shipping.test.ts
 */
import { describe, expect, it } from "vitest";
import { JOB_RATES } from "@/test/helpers/rates";
import { pickShippingBand, shippingLine } from "./shipping";
import type { ShippingInput } from "./types";

const RATES = JOB_RATES.shipping;
const ctx = (customerCountry: string | null, placeholder = true) => ({ customerCountry, homeCountry: "PL", placeholder });
const table = (over: Partial<ShippingInput> = {}): ShippingInput => ({ countryCode: "FI", grossKg: null, costEur: null, source: "table", carrier: null, extraLeadDays: 0, ...over });

describe("pickShippingBand", () => {
  it("takes the first band of the country (case-insensitive) with max_kg ≥ gross kg; none → null", () => {
    expect(pickShippingBand(RATES, "FI", 16)).toMatchObject({ countryCode: "FI", maxKg: 30, priceEur: 45 });
    expect(pickShippingBand(RATES, "fi", 4.9)).toMatchObject({ maxKg: 5, priceEur: 20 });
    expect(pickShippingBand(RATES, "FI", 30)).toMatchObject({ maxKg: 30 });
    expect(pickShippingBand(RATES, "FI", 30.01)).toMatchObject({ maxKg: 100, priceEur: 120 });
    expect(pickShippingBand(RATES, "FI", 2000)).toBeNull();
    expect(pickShippingBand(RATES, "SE", 1)).toBeNull();
  });
});

describe("shippingLine", () => {
  it("manual → the cost as typed, driver = the computed gross kg, no flag", () => {
    const r = shippingLine({ countryCode: "FI", grossKg: null, costEur: 37.5, source: "manual", carrier: "DHL", extraLeadDays: 2 }, RATES, 16, ctx("FI"));
    expect(r.flags).toEqual([]);
    expect(r.line).toMatchObject({ id: "quote:shipping", type: "shipping", label: "shipping", driverQty: 16, driverUnit: "kg", unitCost: 37.5, setupShare: 0 });
    expect(r.line?.rateRef).toMatchObject({ table: "manual", key: "shipping/manual" });
    expect(r.line?.details).toMatchObject({ countryCode: "FI", grossKg: 16, massSource: "computed", carrier: "DHL", source: "manual", extraLeadDays: 2 });
  });

  it("table → the FI 30 kg band for 16 kg computed (45 €); a typed 40 kg picks the 100 kg band (120 €)", () => {
    const computed = shippingLine(table(), RATES, 16, ctx("FI"));
    expect(computed.flags).toEqual([]);
    expect(computed.line).toMatchObject({ unitCost: 45, driverQty: 16 });
    expect(computed.line?.rateRef).toMatchObject({ table: "manual", key: "shipping_rates/FI/30" });
    expect(computed.line?.rateRef.values).toMatchObject({ countryCode: "FI", maxKg: 30, priceEur: 45, carrier: "courier", source: "table", placeholder: true });
    expect(computed.line?.details).toMatchObject({ countryCode: "FI", grossKg: 16, massSource: "computed", carrier: "courier", maxKg: 30 });
    const typed = shippingLine(table({ grossKg: 40, countryCode: "fi" }), RATES, 16, ctx("FI"));
    expect(typed.line).toMatchObject({ unitCost: 120, driverQty: 40 });
    expect(typed.line?.details).toMatchObject({ massSource: "typed", maxKg: 100, carrier: "pallet" });
  });

  it("no band for the destination / mass → amber shipping.missing { countryCode, grossKg }, no line", () => {
    const r = shippingLine(table({ countryCode: "SE" }), RATES, 16, ctx("SE"));
    expect(r.line).toBeNull();
    expect(r.flags).toEqual([{ code: "shipping.missing", severity: "amber", partId: null, itemId: null, params: { countryCode: "SE", grossKg: 16 }, overridable: true }]);
    expect(shippingLine(table({ grossKg: 5000 }), RATES, 16, ctx("FI")).flags[0]?.params).toEqual({ countryCode: "FI", grossKg: 5000 });
  });

  it("no input: a customer abroad → amber shipping.missing; a domestic or unknown customer → nothing", () => {
    expect(shippingLine(null, RATES, 16, ctx("FI")).flags.map((f) => f.code)).toEqual(["shipping.missing"]);
    expect(shippingLine(undefined, RATES, 16, ctx("FI")).line).toBeNull();
    expect(shippingLine(null, RATES, 16, ctx("PL"))).toEqual({ line: null, flags: [] });
    expect(shippingLine(null, RATES, 16, ctx("pl "))).toEqual({ line: null, flags: [] });
    expect(shippingLine(null, RATES, 16, ctx(null))).toEqual({ line: null, flags: [] });
  });

  it("manual without a cost → amber shipping.missing; a table input without a country falls back to the customer's", () => {
    expect(shippingLine({ ...table(), source: "manual" }, RATES, 16, ctx("FI")).flags.map((f) => f.code)).toEqual(["shipping.missing"]);
    const r = shippingLine(table({ countryCode: "" }), RATES, 16, ctx("DE"));
    expect(r.line).toMatchObject({ unitCost: 35 });
    expect(r.line?.details.countryCode).toBe("DE");
  });
});
