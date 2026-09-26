/**
 * Header state rules of the builder (components/quote/header-state.ts):
 * an EUR quote switched to PLN must start from the environment EUR→PLN
 * default, never from the stored sentinel 1; PLN rates round-trip; the
 * EUR side always saves 1.
 * File path: /test/quotes/header-state.test.ts
 */
import { describe, expect, it } from "vitest";
import { effectiveFxRate, headerFromBundle, headerFxInvalid, headerToInput, seedFxRate } from "@/components/quote/header-state";
import { makeBundle } from "./fixtures";

const FX_DEFAULT = 4.3;

describe("header-state", () => {
  it("an EUR quote (fx_rate 1) switched to PLN uses the default rate, not 1", () => {
    const header = headerFromBundle(makeBundle({ quote: { currency: "EUR", fx_rate: 1 } }), FX_DEFAULT);
    expect(effectiveFxRate(header)).toBe(1);
    expect(headerToInput(header).fxRate).toBe(1);
    const switched = { ...header, currency: "PLN" as const };
    expect(effectiveFxRate(switched)).toBe(FX_DEFAULT);
    expect(headerToInput(switched)).toMatchObject({ currency: "PLN", fxRate: FX_DEFAULT });
    expect(headerFxInvalid(switched)).toBe(false);
  });

  it("a PLN quote keeps its stored rate and saves 1 once switched to EUR, then gets its rate back", () => {
    const header = headerFromBundle(makeBundle({ quote: { currency: "PLN", fx_rate: 4.35 } }), FX_DEFAULT);
    expect(headerToInput(header).fxRate).toBe(4.35);
    const asEur = { ...header, currency: "EUR" as const };
    expect(headerToInput(asEur)).toMatchObject({ currency: "EUR", fxRate: 1 });
    expect(headerFxInvalid(asEur)).toBe(false);
    expect(headerToInput({ ...asEur, currency: "PLN" }).fxRate).toBe(4.35);
  });

  it("a PLN quote with a nonsensical stored rate is seeded with the default", () => {
    expect(seedFxRate(1, FX_DEFAULT)).toBe(FX_DEFAULT);
    expect(seedFxRate("0.23", FX_DEFAULT)).toBe(FX_DEFAULT);
    expect(seedFxRate(null, FX_DEFAULT)).toBe(FX_DEFAULT);
    expect(seedFxRate("4.2", FX_DEFAULT)).toBe(4.2);
    const header = headerFromBundle(makeBundle({ quote: { currency: "PLN", fx_rate: 1 } }), FX_DEFAULT);
    expect(headerToInput(header).fxRate).toBe(FX_DEFAULT);
  });

  it("flags a PLN rate the user typed at or below 1 as invalid (the server rejects it too)", () => {
    const header = headerFromBundle(makeBundle(), FX_DEFAULT);
    expect(headerFxInvalid({ ...header, fxRate: 1 })).toBe(true);
    expect(headerFxInvalid({ ...header, fxRate: 0.5 })).toBe(true);
    expect(headerFxInvalid({ ...header, fxRate: 4.1 })).toBe(false);
    expect(headerFxInvalid({ ...header, currency: "EUR", fxRate: 1 })).toBe(false);
  });

  it("maps every header field to the action input", () => {
    const bundle = makeBundle({ quote: { customer_id: null, lead_time_text: null, notes: "n", show_operations_on_pdf: true, welding_separate: true } });
    const input = headerToInput(headerFromBundle(bundle, FX_DEFAULT));
    expect(input).toEqual({
      customerId: null,
      currency: "PLN",
      fxRate: 4.3,
      marginPct: 30,
      validityDays: 30,
      leadTimeText: "",
      paymentTermsText: "Przelew 14 dni",
      notes: "n",
      showOperationsOnPdf: true,
      weldingSeparate: true,
    });
  });
});
