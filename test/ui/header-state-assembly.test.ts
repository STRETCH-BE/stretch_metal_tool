/**
 * Header state — assembly-mode fields (components/quote/header-state.ts):
 * customer reference, contact person, shipping (typed vs computed mass,
 * manual vs table cost) and the price scale round-trip bundle → state →
 * updateQuoteHeader input; the invalid-shipping guard; the legacy
 * fields keep their old mapping.
 * File path: /test/ui/header-state-assembly.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  defaultShippingState,
  effectivePriceScale,
  headerFromBundle,
  headerToInput,
  shippingFromInput,
  shippingInvalid,
  shippingToInput,
} from "@/components/quote/header-state";
import { computePreview, draftFromBundle } from "@/components/quote/preview";
import type { ShippingInput } from "@/lib/pricing/types";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";
import { ASSEMBLY_ID, makeAssemblyRow, makeBundle, makeItemRow, makeSeamRow } from "@/test/quotes/fixtures";

const FX = 4.3;
const shipping: ShippingInput = { countryCode: "FI", grossKg: null, costEur: null, source: "table", carrier: null, extraLeadDays: 2 };

describe("headerFromBundle (assembly mode)", () => {
  it("reads the reference, contact, shipping and price scale from the quote row", () => {
    const header = headerFromBundle(makeBundle({ quote: { customer_reference: "N260580", contact_person: "Jan Kowalski", shipping, price_scale: [100, 20, 20, 50] } }), FX);
    expect(header.customerReference).toBe("N260580");
    expect(header.contactPerson).toBe("Jan Kowalski");
    expect(header.shipping).toEqual({ countryCode: "FI", grossKg: null, costEur: null, source: "table", carrier: "", extraLeadDays: 2 });
    expect(header.priceScaleEnabled).toBe(true);
    expect(header.priceScale).toEqual([20, 50, 100]);
  });

  it("defaults to empty fields, no shipping and the scale toggle off", () => {
    const header = headerFromBundle(makeBundle(), FX);
    expect(header.customerReference).toBe("");
    expect(header.contactPerson).toBe("");
    expect(header.shipping).toBeNull();
    expect(header.priceScaleEnabled).toBe(false);
    expect(header.priceScale).toEqual([]);
  });
});

describe("headerToInput (assembly mode)", () => {
  it("always posts the new columns: trimmed text or null, the shipping block, the effective scale", () => {
    const header = headerFromBundle(makeBundle({ quote: { customer_reference: "  N1 ", shipping, price_scale: [20, 50] } }), FX);
    const input = headerToInput(header);
    expect(input.customerReference).toBe("N1");
    expect(input.contactPerson).toBeNull();
    expect(input.shipping).toEqual({ countryCode: "FI", grossKg: null, costEur: null, source: "table", carrier: null, extraLeadDays: 2 });
    expect(input.priceScale).toEqual([20, 50]);
    // The legacy fields are untouched.
    expect(input).toMatchObject({ currency: "PLN", fxRate: 4.3, marginPct: 30, validityDays: 30, leadTimeDays: 11 });
  });

  it("posts [] when the scale toggle is off and keeps the list for a later re-enable", () => {
    const header = { ...headerFromBundle(makeBundle({ quote: { price_scale: [20, 50] } }), FX), priceScaleEnabled: false };
    expect(headerToInput(header).priceScale).toEqual([]);
    expect(effectivePriceScale({ ...header, priceScaleEnabled: true })).toEqual([20, 50]);
    expect(effectivePriceScale({ priceScaleEnabled: true, priceScale: [50, 20, 20] })).toEqual([20, 50]);
  });

  it("a manual shipping cost is posted only with source manual; a typed mass only when positive", () => {
    expect(shippingToInput({ countryCode: "de", grossKg: 12.5, costEur: 35, source: "manual", carrier: " DHL ", extraLeadDays: 1 })).toEqual({
      countryCode: "DE",
      grossKg: 12.5,
      costEur: 35,
      source: "manual",
      carrier: "DHL",
      extraLeadDays: 1,
    });
    expect(shippingToInput({ countryCode: "DE", grossKg: 0, costEur: 35, source: "table", carrier: "", extraLeadDays: 0 })).toEqual({
      countryCode: "DE",
      grossKg: null,
      costEur: null,
      source: "table",
      carrier: null,
      extraLeadDays: 0,
    });
    expect(shippingToInput(null)).toBeNull();
  });
});

describe("shipping helpers", () => {
  it("defaultShippingState starts at the customer's country with the carrier table and computed mass", () => {
    expect(defaultShippingState("fi")).toEqual({ countryCode: "FI", grossKg: null, costEur: null, source: "table", carrier: "", extraLeadDays: 0 });
    expect(defaultShippingState(null).countryCode).toBe("PL");
  });

  it("shippingFromInput drops a stored cost of a table-sourced block", () => {
    expect(shippingFromInput({ ...shipping, source: "table", costEur: 99 })?.costEur).toBeNull();
    expect(shippingFromInput({ ...shipping, source: "manual", costEur: 99 })?.costEur).toBe(99);
  });

  it("shippingInvalid blocks a manual block without a cost and a bad country", () => {
    expect(shippingInvalid(null)).toBe(false);
    expect(shippingInvalid(defaultShippingState("DE"))).toBe(false);
    expect(shippingInvalid({ ...defaultShippingState("DE"), source: "manual", costEur: null })).toBe(true);
    expect(shippingInvalid({ ...defaultShippingState("DE"), source: "manual", costEur: 12 })).toBe(false);
    expect(shippingInvalid({ ...defaultShippingState("DE"), countryCode: "" })).toBe(true);
  });
});

describe("preview draft (assembly mode)", () => {
  it("carries shipping and price scale into the draft and prices the legacy path without job rates", () => {
    const bundle = makeBundle({ quote: { shipping, price_scale: [20, 50] } });
    const draft = draftFromBundle(bundle);
    expect(draft.shipping).toEqual(shipping);
    expect(draft.priceScale).toEqual([20, 50]);
    const preview = computePreview(bundle, RATE_SNAPSHOT_V1, MACHINE_PARK, draft, { costRates: null, jobRates: null });
    expect(preview.error).toBeNull();
    expect(preview.priced?.items).toHaveLength(1);
    // Legacy engine path: no assemblies, no VAT, no price scale without job rates.
    expect(preview.priced?.assemblies).toEqual([]);
    expect(preview.priced?.vat).toBeNull();
  });

  it("with job rates prices the bundle's assembly, VAT and price scale like the server", () => {
    const bundle = makeBundle({
      quote: { shipping, price_scale: [20] },
      items: [makeItemRow({ assembly_id: ASSEMBLY_ID, qty_per_assembly: 2 })],
      assemblies: [makeAssemblyRow({ qty: 1 })],
      seams: [makeSeamRow()],
    });
    const preview = computePreview(bundle, RATE_SNAPSHOT_V1, MACHINE_PARK, draftFromBundle(bundle), { costRates: null, jobRates: JOB_RATES });
    expect(preview.error).toBeNull();
    expect(preview.priced?.assemblies).toHaveLength(1);
    expect(preview.priced?.assemblies[0]).toMatchObject({ assemblyId: ASSEMBLY_ID, qty: 1, seamLengthMm: 1250 });
    expect(preview.priced?.vat).toMatchObject({ mode: "pl_domestic", ratePct: 23 });
    expect(preview.priced?.shipping?.details).toMatchObject({ countryCode: "FI", source: "table" });
    expect(preview.priced?.priceScale.map((s) => s.subjectId)).toEqual([ASSEMBLY_ID]);
  });
});
