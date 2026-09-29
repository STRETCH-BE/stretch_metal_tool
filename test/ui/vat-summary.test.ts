/**
 * VAT summary model + row formatting (components/quote/vat-summary-model.ts):
 * gross shown only above 0 %, the 0 % mode note otherwise, the "unknown"
 * note when the engine returned no VAT, shipping as its own line, Polish
 * money formatting through the builder's formatter.
 * File path: /test/ui/vat-summary.test.ts
 */
import { describe, expect, it } from "vitest";
import { makeMoney } from "@/components/quote/money";
import { vatSummaryModel, vatSummaryRows, type VatSummaryCopy } from "@/components/quote/vat-summary-model";
import { getContent } from "@/content";
import { formatPercent, interpolate } from "@/lib/format";
import type { OperationLine, VatResult } from "@/lib/pricing/types";

const pl = getContent("pl");
const copy: VatSummaryCopy = pl.quote.builder.vat;
const money = makeMoney("EUR", 1, "pl");
const percent = (pct: number) => formatPercent(pct, "pl", pct % 1 === 0 ? 0 : 1);

function shippingLine(costEur: number): OperationLine {
  return {
    id: "shipping",
    type: "shipping",
    label: "shipping",
    driverQty: 30,
    driverUnit: "kg",
    rateRef: { table: "manual", key: "shipping_rates/FI/30", values: {} },
    unitCost: costEur,
    setupShare: 0,
    auto: true,
    notes: null,
    details: {},
  };
}

function vat(over: Partial<VatResult>): VatResult {
  return { mode: "pl_domestic", ratePct: 23, countryCode: "PL", netTotal: 374.96, vatAmount: 86.24, grossTotal: 461.2, ...over };
}

describe("vatSummaryModel", () => {
  it("shows VAT + gross above 0 % and takes the totals from the engine's VatResult", () => {
    const model = vatSummaryModel({ subtotalPrice: 374.96, shipping: shippingLine(45), vat: vat({}) });
    expect(model.showGross).toBe(true);
    expect(model.showNote).toBe(false);
    expect(model.netEur).toBe(374.96);
    expect(model.shippingEur).toBe(45);
    expect(model.vat).toMatchObject({ mode: "pl_domestic", ratePct: 23, amountEur: 86.24, grossEur: 461.2 });
  });

  it("at 0 % shows the mode note instead of a gross line", () => {
    const model = vatSummaryModel({ subtotalPrice: 300, shipping: null, vat: vat({ mode: "reverse_charge", ratePct: 0, countryCode: null, netTotal: 300, vatAmount: 0, grossTotal: 300 }) });
    expect(model.showGross).toBe(false);
    expect(model.showNote).toBe(true);
    expect(model.shippingEur).toBeNull();
  });

  it("without a VatResult keeps the net and marks VAT unknown", () => {
    const model = vatSummaryModel({ subtotalPrice: 120.5, shipping: null, vat: null });
    expect(model.vat).toBeNull();
    expect(model.netEur).toBe(120.5);
    expect(model.showGross).toBe(false);
    expect(model.showNote).toBe(true);
  });
});

describe("vatSummaryRows", () => {
  it("formats net, shipping, VAT rate + amount and gross in Polish", () => {
    const model = vatSummaryModel({ subtotalPrice: 374.96, shipping: shippingLine(45), vat: vat({}) });
    const { rows, note } = vatSummaryRows(model, copy, money, percent, interpolate);
    expect(rows.map((r) => r.key)).toEqual(["net", "shipping", "vat", "gross"]);
    expect(rows[0].value.replace(/\s/g, " ")).toBe("374,96 €");
    expect(rows[2].label).toBe("VAT 23 %");
    expect(rows[2].value.replace(/\s/g, " ")).toBe("86,24 €");
    expect(rows[3].value.replace(/\s/g, " ")).toBe("461,20 €");
    expect(rows[3].emphasis).toBe(true);
    expect(note).toBeNull();
  });

  it("formats a fractional rate with one decimal (Finland 25.5 %)", () => {
    const model = vatSummaryModel({ subtotalPrice: 100, shipping: null, vat: vat({ mode: "b2c_oss", ratePct: 25.5, countryCode: "FI", netTotal: 100, vatAmount: 25.5, grossTotal: 125.5 }) });
    const { rows } = vatSummaryRows(model, copy, money, percent, interpolate);
    expect(rows.find((r) => r.key === "vat")?.label).toBe("VAT 25,5 %");
  });

  it("returns the mode note at 0 % and the unknown note without VAT", () => {
    const zero = vatSummaryModel({ subtotalPrice: 300, shipping: null, vat: vat({ mode: "export", ratePct: 0, countryCode: null, netTotal: 300, vatAmount: 0, grossTotal: 300 }) });
    expect(vatSummaryRows(zero, copy, money, percent, interpolate)).toMatchObject({ note: copy.modes.export });
    expect(vatSummaryRows(zero, copy, money, percent, interpolate).rows.map((r) => r.key)).toEqual(["net"]);
    const unknown = vatSummaryModel({ subtotalPrice: 300, shipping: null, vat: null });
    expect(vatSummaryRows(unknown, copy, money, percent, interpolate).note).toBe(copy.unknown);
  });
});
