/**
 * Action-input schemas: the currency ↔ fx rule (a PLN quote must carry a
 * real EUR→PLN rate; the EUR sentinel 1 is rejected with `invalidFx`) on
 * both the header and the new-quote inputs.
 * File path: /test/quotes/schema.test.ts
 */
import { describe, expect, it } from "vitest";
import { firstErrorCode, fxRateValidFor, newQuoteSchema, quoteHeaderSchema, type QuoteHeaderInput } from "@/lib/quotes/schema";
import { CUSTOMER_ID } from "./fixtures";

const header: QuoteHeaderInput = {
  customerId: CUSTOMER_ID,
  currency: "PLN",
  fxRate: 4.35,
  marginPct: 30,
  validityDays: 30,
  leadTimeText: "",
  paymentTermsText: "",
  notes: "",
  showOperationsOnPdf: false,
  weldingSeparate: false,
};

function code(result: { success: boolean; error?: unknown }): string | null {
  return result.success ? null : firstErrorCode(result.error as never);
}

describe("fxRateValidFor", () => {
  it("PLN needs a rate above 1, EUR ignores the field", () => {
    expect(fxRateValidFor("PLN", 4.3)).toBe(true);
    expect(fxRateValidFor("PLN", 1)).toBe(false);
    expect(fxRateValidFor("PLN", 0.23)).toBe(false);
    expect(fxRateValidFor("EUR", 1)).toBe(true);
    expect(fxRateValidFor("EUR", 4.3)).toBe(true);
  });
});

describe("quoteHeaderSchema", () => {
  it("accepts PLN with a real rate and EUR with 1", () => {
    expect(quoteHeaderSchema.safeParse(header).success).toBe(true);
    expect(quoteHeaderSchema.safeParse({ ...header, currency: "EUR", fxRate: 1 }).success).toBe(true);
  });

  it("rejects PLN with the EUR sentinel (1) or a rate below 1 as invalidFx", () => {
    expect(code(quoteHeaderSchema.safeParse({ ...header, fxRate: 1 }))).toBe("invalidFx");
    expect(code(quoteHeaderSchema.safeParse({ ...header, fxRate: 0.23 }))).toBe("invalidFx");
    expect(code(quoteHeaderSchema.safeParse({ ...header, fxRate: 0 }))).toBe("invalidFx");
  });
});

describe("newQuoteSchema", () => {
  const base = { type: "fabrication", customerId: null, currency: "PLN", fxRate: 4.3, marginPct: 30, validityDays: 30, leadTimeText: "", paymentTermsText: "", notes: "" };

  it("applies the same currency ↔ fx rule", () => {
    expect(newQuoteSchema.safeParse(base).success).toBe(true);
    expect(newQuoteSchema.safeParse({ ...base, currency: "EUR", fxRate: 1 }).success).toBe(true);
    expect(code(newQuoteSchema.safeParse({ ...base, fxRate: 1 }))).toBe("invalidFx");
  });
});
