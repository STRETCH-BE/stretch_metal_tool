/**
 * Quote PDF — renders a synthetic bundle in both locales and both
 * currencies, checks the %PDF header, that the extracted text carries the
 * quote number, the customer name and a formatted price, that cost and
 * margin never appear, and snapshots the page count.
 * File path: /test/pdf/render.test.ts
 */
import { describe, expect, it } from "vitest";
import { getContent } from "@/content";
import { formatMoney, toQuoteCurrency } from "@/lib/format";
import { extractPdfText } from "@/lib/pdf-text";
import { renderQuotePdf } from "@/lib/pdf/render";
import { buildPdfViewModel, thumbnailFromGeometry } from "@/lib/pdf/view-model";
import { parseGeometry } from "@/lib/quotes/schema";
import { makeBundle, makePartRow, priceFixture } from "@/test/quotes/fixtures";

const NOW = new Date("2026-09-25T12:00:00Z");

describe("renderQuotePdf", () => {
  const cases = [
    { locale: "pl" as const, currency: "PLN" as const, fx: 4.3, country: "PL", name: "Acme Metal Sp. z o.o." },
    { locale: "en" as const, currency: "EUR" as const, fx: 1, country: "DE", name: "Muster Metallbau GmbH" },
    { locale: "en" as const, currency: "PLN" as const, fx: 4.3, country: "PL", name: "Acme Metal Sp. z o.o." },
    { locale: "pl" as const, currency: "EUR" as const, fx: 1, country: "DE", name: "Muster Metallbau GmbH" },
  ];

  for (const c of cases) {
    it(`renders ${c.locale.toUpperCase()} in ${c.currency} with number, customer and a formatted price`, async () => {
      const priced = priceFixture();
      const bundle = makeBundle({
        priced,
        quote: { currency: c.currency, fx_rate: c.fx, show_operations_on_pdf: true },
        customer: { name: c.name, country: c.country },
      });
      const pdf = await renderQuotePdf(bundle, { locale: c.locale, showOperations: true, preparedBy: "Jan Kowalski", now: NOW });
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const text = await extractPdfText(pdf);
      const flat = text.text.replace(/\s+/g, " ");
      expect(flat).toContain("SM-2026-0001");
      expect(flat).toContain(c.name);
      const unit = formatMoney(toQuoteCurrency(priced.items[0].unitPrice, c.currency, c.fx), c.currency, c.locale);
      const total = formatMoney(toQuoteCurrency(priced.subtotalPrice, c.currency, c.fx), c.currency, c.locale);
      // pdf text collapses the non-breaking spaces of Intl formatting
      const norm = (s: string) => s.replace(/[\s  ]/g, "");
      expect(norm(flat)).toContain(norm(unit));
      expect(norm(flat)).toContain(norm(total));
      expect(flat).toContain(getContent(c.locale).pdf.totals.net.toUpperCase().slice(0, 5));
      expect(text.pageCount).toMatchSnapshot(`pages-${c.locale}-${c.currency}`);
    }, 30000);
  }

  it("never prints cost or margin, and prints the operation summary only when asked", async () => {
    const priced = priceFixture();
    const bundle = makeBundle({ priced, quote: { show_operations_on_pdf: false } });
    const withOps = await extractPdfText(await renderQuotePdf(bundle, { locale: "en", showOperations: true, now: NOW }));
    const withoutOps = await extractPdfText(await renderQuotePdf(bundle, { locale: "en", showOperations: false, now: NOW }));
    const en = getContent("en");
    expect(withOps.text).toContain(en.pdf.operations.types.bend);
    expect(withoutOps.text).not.toContain(en.pdf.operations.types.bend);
    const costText = formatMoney(toQuoteCurrency(priced.items[0].unitCost, "PLN", 4.3), "PLN", "en").replace(/[\s  ]/g, "");
    expect(withOps.text.replace(/[\s  ]/g, "")).not.toContain(costText);
    expect(withOps.text).not.toMatch(/margin/i);
    expect(withOps.text).not.toMatch(/marża/i);
  }, 30000);

  it("welding as a separate block moves the weld lines out of the parts table", () => {
    const priced = priceFixture();
    const content = getContent("en");
    const plain = buildPdfViewModel(makeBundle({ priced }), { locale: "en", content, now: NOW });
    const separate = buildPdfViewModel(makeBundle({ priced, quote: { welding_separate: true } }), { locale: "en", content, now: NOW });
    expect(plain.welding).toBeNull();
    expect(separate.welding).not.toBeNull();
    expect(separate.welding!.rows).toHaveLength(1);
    expect(separate.rows[0].weldingMoved).toBe(true);
    expect(separate.totals.net).toBe(plain.totals.net);
    expect(separate.rows[0].unitPrice).not.toBe(plain.rows[0].unitPrice);
  });

  it("builds a thumbnail from the stored geometry and skips parts without one", () => {
    const geometry = parseGeometry(makePartRow().geometry);
    const thumb = thumbnailFromGeometry(geometry);
    expect(thumb).not.toBeNull();
    expect(thumb!.paths.length).toBeGreaterThan(30);
    expect(thumb!.paths.some((p) => p.kind === "bend")).toBe(true);
    expect(thumbnailFromGeometry(null)).toBeNull();
    const model = buildPdfViewModel(makeBundle({ parts: [makePartRow({ geometry: null })] }), { locale: "pl", content: getContent("pl"), now: NOW });
    expect(model.rows[0].thumbnail).toBeNull();
  });

  it("uses the sent date for validity when the quote was sent", () => {
    const model = buildPdfViewModel(makeBundle({ quote: { sent_at: "2026-10-01T09:00:00Z", validity_days: 30 } }), {
      locale: "en",
      content: getContent("en"),
      now: NOW,
    });
    expect(model.date).toBe("01/10/2026");
    expect(model.validUntil).toBe("31/10/2026");
  });
});
