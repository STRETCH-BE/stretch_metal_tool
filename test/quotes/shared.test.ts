/**
 * Pure quote helpers: number label with version suffix, next version
 * numbering, worst severity, locale resolution, validity dates, editor
 * rule, and the currency default for a new quote (PL → PLN, else EUR).
 * File path: /test/quotes/shared.test.ts
 */
import { describe, expect, it } from "vitest";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";
import { parseNewQuoteForm } from "@/lib/quotes/schema";
import {
  isQuoteEditable,
  isQuoteEditor,
  nextVersionNumber,
  overrideMatchesFlag,
  quoteNumberLabel,
  quotePdfFileName,
  resolveQuoteLocale,
  summariseOperations,
  validUntilDate,
  worstSeverity,
} from "@/lib/quotes/shared";
import type { OperationLine } from "@/lib/pricing/types";

describe("quoteNumberLabel", () => {
  it("prints SM-YYYY-NNNN for version 1 and -vN from version 2", () => {
    expect(quoteNumberLabel({ number: "SM-2026-0001", version: 1 })).toBe("SM-2026-0001");
    expect(quoteNumberLabel({ number: "SM-2026-0001", version: 2 })).toBe("SM-2026-0001-v2");
    expect(quoteNumberLabel({ number: "SM-2026-0042", version: 7 })).toBe("SM-2026-0042-v7");
  });

  it("names the PDF after the label", () => {
    expect(quotePdfFileName({ number: "SM-2026-0001", version: 1 })).toBe("SM-2026-0001.pdf");
    expect(quotePdfFileName({ number: "SM-2026-0001", version: 2 }, "en")).toBe("SM-2026-0001-v2-EN.pdf");
  });
});

describe("nextVersionNumber (duplicate as new version)", () => {
  it("is max + 1, not current + 1", () => {
    expect(nextVersionNumber([1])).toBe(2);
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
    expect(nextVersionNumber([3, 1])).toBe(4);
    expect(nextVersionNumber([])).toBe(1);
  });
});

describe("worstSeverity", () => {
  it("ranks red > amber > green and null without flags", () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([{ severity: "green" }])).toBe("green");
    expect(worstSeverity([{ severity: "green" }, { severity: "amber" }])).toBe("amber");
    expect(worstSeverity([{ severity: "amber" }, { severity: "red" }, { severity: "green" }])).toBe("red");
  });
});

describe("resolveQuoteLocale", () => {
  it("param → customer preference → pl", () => {
    expect(resolveQuoteLocale("en", "pl")).toBe("en");
    expect(resolveQuoteLocale(null, "en")).toBe("en");
    expect(resolveQuoteLocale("xx", null)).toBe("pl");
    expect(resolveQuoteLocale(undefined, undefined)).toBe("pl");
  });
});

describe("validUntilDate", () => {
  it("adds the validity days in UTC", () => {
    expect(validUntilDate("2026-09-25T10:00:00Z", 30).toISOString()).toBe("2026-10-25T10:00:00.000Z");
    expect(validUntilDate("2026-12-20T00:00:00Z", 14).toISOString()).toBe("2027-01-03T00:00:00.000Z");
    expect(validUntilDate("2026-09-25T10:00:00Z", 0).toISOString()).toBe("2026-09-25T10:00:00.000Z");
  });
});

describe("isQuoteEditor / isQuoteEditable", () => {
  it("admin always, sales only own, viewer never", () => {
    const quote = { created_by: "u1" };
    expect(isQuoteEditor("admin", "x", quote)).toBe(true);
    expect(isQuoteEditor("sales", "u1", quote)).toBe(true);
    expect(isQuoteEditor("sales", "u2", quote)).toBe(false);
    expect(isQuoteEditor("viewer", "u1", quote)).toBe(false);
  });
  it("only draft and pending_override are editable", () => {
    expect(isQuoteEditable("draft")).toBe(true);
    expect(isQuoteEditable("pending_override")).toBe(true);
    expect(isQuoteEditable("sent")).toBe(false);
    expect(isQuoteEditable("won")).toBe(false);
    expect(isQuoteEditable("lost")).toBe(false);
  });
});

describe("overrideMatchesFlag", () => {
  it("matches on rule code and part scope", () => {
    expect(overrideMatchesFlag({ rule_code: "a", part_id: "p" }, { code: "a", partId: "p" })).toBe(true);
    expect(overrideMatchesFlag({ rule_code: "a", part_id: null }, { code: "a", partId: null })).toBe(true);
    expect(overrideMatchesFlag({ rule_code: "a", part_id: "p" }, { code: "a", partId: "q" })).toBe(false);
    expect(overrideMatchesFlag({ rule_code: "b", part_id: "p" }, { code: "a", partId: "p" })).toBe(false);
  });
});

describe("currency defaulting for a new quote", () => {
  it("PL → PLN, anything else → EUR", () => {
    expect(defaultCurrencyForCountry("PL")).toBe("PLN");
    expect(defaultCurrencyForCountry("DE")).toBe("EUR");
    expect(defaultCurrencyForCountry("be")).toBe("EUR");
  });

  it("the new-quote form accepts PLN/EUR only and parses localized numbers", () => {
    const form = new FormData();
    form.set("type", "fabrication");
    form.set("customerId", "");
    form.set("currency", "PLN");
    form.set("fxRate", "4,30");
    form.set("marginPct", "32,5");
    form.set("validityDays", "30");
    form.set("leadTimeText", "10 dni");
    form.set("paymentTermsText", "14 dni");
    form.set("notes", "");
    const parsed = parseNewQuoteForm(form);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toMatchObject({ currency: "PLN", fxRate: 4.3, marginPct: 32.5, validityDays: 30, customerId: null, notes: null });
    }
    form.set("currency", "USD");
    const bad = parseNewQuoteForm(form);
    expect(bad).toEqual({ ok: false, error: "invalidCurrency" });
    form.set("currency", "EUR");
    form.set("marginPct", "100");
    expect(parseNewQuoteForm(form)).toEqual({ ok: false, error: "invalidMargin" });
  });
});

describe("summariseOperations", () => {
  it("groups lines by type in display order", () => {
    const line = (type: OperationLine["type"], unitCost: number): OperationLine => ({
      id: `${type}-${unitCost}`,
      type,
      label: type,
      driverQty: 1,
      driverUnit: "each",
      rateRef: { table: "manual", key: "x", values: {} },
      unitCost,
      setupShare: 0,
      auto: true,
      notes: null,
      details: {},
    });
    const summary = summariseOperations([line("bend", 1), line("laser_cut", 2), line("bend", 3), line("setup", 0.5)]);
    expect(summary).toEqual([
      { type: "laser_cut", count: 1, unitCost: 2 },
      { type: "bend", count: 2, unitCost: 4 },
      { type: "setup", count: 1, unitCost: 0.5 },
    ]);
  });
});
