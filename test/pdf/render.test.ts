/**
 * Quote PDF — renders a synthetic bundle in both locales and both
 * currencies, checks the %PDF header, that the extracted text carries the
 * quote number, the customer name and a formatted price, that cost and
 * margin never appear, and snapshots the page count. The assembly-mode
 * block (docs/assembly-mode-design.md §5) checks the view model and the
 * extracted text of test/pdf/helpers.ts makeAssemblyBundle: one row per
 * assembly, members only in the appendix, VAT block / 0 % notes, customer
 * reference + contact person, price scale, shipping line, terms by
 * customer type, company block from company_settings, material notes.
 * File path: /test/pdf/render.test.ts
 */
import { describe, expect, it } from "vitest";
import { getContent } from "@/content";
import { formatMoney, interpolate, toQuoteCurrency } from "@/lib/format";
import { extractPdfText } from "@/lib/pdf-text";
import { renderQuotePdf } from "@/lib/pdf/render";
import { buildPdfViewModel, thumbnailFromGeometry } from "@/lib/pdf/view-model";
import { parseGeometry } from "@/lib/quotes/schema";
import type { QuoteBundle } from "@/lib/quotes/types";
import { makeBundle, makeCompanySettings, makePartRow, priceFixture } from "@/test/quotes/fixtures";
import {
  ASSEMBLY_UNIT_PRICE_EUR,
  LOOSE_NAME,
  MATERIAL_NOTE,
  MEMBER_NAME_1,
  MEMBER_NAME_2,
  SHIPPING_EUR,
  makeAssemblyBundle,
  vatResult,
} from "./helpers";

const NOW = new Date("2026-09-25T12:00:00Z");
const en = getContent("en");
const pl = getContent("pl");
const eur = (value: number) => formatMoney(value, "EUR", "en");
/** pdf text collapses the non-breaking spaces of Intl formatting */
const norm = (s: string) => s.replace(/[\s  ]/g, "");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

async function textOf(bundle: QuoteBundle, options: { locale?: "pl" | "en"; showAssemblyParts?: boolean; showOperations?: boolean } = {}): Promise<string> {
  const pdf = await renderQuotePdf(bundle, { locale: options.locale ?? "en", showOperations: options.showOperations ?? false, showAssemblyParts: options.showAssemblyParts, now: NOW });
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  return (await extractPdfText(pdf)).text.replace(/\s+/g, " ");
}

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
      const unit = formatMoney(toQuoteCurrency(priced.items[0].unitPrice ?? Number.NaN, c.currency, c.fx), c.currency, c.locale);
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

describe("assembly mode", () => {
  it("prints an assembly as ONE row (name, drawing, material, qty, price) and no member rows", () => {
    const model = buildPdfViewModel(makeAssemblyBundle(), { locale: "en", content: en, now: NOW });
    expect(model.rows.map((r) => r.kind)).toEqual(["assembly", "item"]);
    const asm = model.rows[0];
    expect(asm.position).toBe(1);
    expect(asm.name).toBe("Heat store box rev 3");
    expect(asm.subline).toBe(`${en.pdf.assemblies.kind} · drawing HSB-3 · parts: 3`);
    expect(asm.material).toBe("S235");
    expect(asm.thickness).toBe("3 mm");
    expect(asm.qty).toBe("1");
    expect(asm.unitPrice).toBe(eur(ASSEMBLY_UNIT_PRICE_EUR));
    expect(asm.total).toBe(eur(ASSEMBLY_UNIT_PRICE_EUR));
    expect(asm.thumbnail).toBeNull();
    expect(model.rows[1]).toMatchObject({ kind: "item", position: 2, name: LOOSE_NAME, qty: "50" });
    expect(model.rows.map((r) => r.name)).not.toContain(MEMBER_NAME_1);
    expect(model.rows.map((r) => r.name)).not.toContain(MEMBER_NAME_2);
    expect(model.assemblyParts).toEqual([]);
  });

  it("renders '—' for an unpriceable assembly instead of a number", () => {
    const model = buildPdfViewModel(makeAssemblyBundle({ assemblyUnitPrice: null }), { locale: "en", content: en, now: NOW });
    expect(model.rows[0].unitPrice).toBe("—");
    expect(model.rows[0].total).toBe("—");
  });

  it("lists the members only in the appendix when showAssemblyParts is set, with inherited material and the material note", () => {
    const model = buildPdfViewModel(makeAssemblyBundle(), { locale: "en", content: en, now: NOW, showAssemblyParts: true });
    expect(model.assemblyParts).toHaveLength(1);
    const apx = model.assemblyParts[0];
    expect(apx.heading).toBe("Parts of assembly Heat store box rev 3");
    expect(apx.rows).toEqual([
      { position: 1, name: MEMBER_NAME_1, material: "DC01", thickness: "2 mm", qtyPerAssembly: "2", materialNote: interpolate(en.pdf.parts.materialNote, { note: MATERIAL_NOTE }) },
      { position: 2, name: MEMBER_NAME_2, material: "S235", thickness: "3 mm", qtyPerAssembly: "1", materialNote: null },
    ]);
    // the loose row stays in the parts table, without a note of its own
    expect(model.rows[1].materialNote).toBeNull();
  });

  it("text: the assembly is one line, members appear only with the appendix", async () => {
    const bundle = makeAssemblyBundle();
    const plain = await textOf(bundle);
    expect(count(plain, "Heat store box rev 3")).toBe(1);
    expect(plain).toContain("HSB-3");
    expect(plain).toContain(LOOSE_NAME);
    expect(plain).not.toContain(MEMBER_NAME_1);
    expect(plain).not.toContain(MEMBER_NAME_2);
    expect(norm(plain)).not.toContain(norm("PARTS OF ASSEMBLY"));
    // a member's DC01-for-S235 note is printed under the assembly row itself (design §2)
    expect(plain).toContain(MATERIAL_NOTE);

    const withParts = await textOf(bundle, { showAssemblyParts: true });
    // eyebrows are uppercase and letter-spaced: pdfjs returns them with a space between glyphs
    expect(norm(withParts)).toContain(norm("PARTS OF ASSEMBLY HEAT STORE BOX REV 3"));
    expect(withParts).toContain(MEMBER_NAME_1);
    expect(withParts).toContain(MEMBER_NAME_2);
    expect(withParts).toContain(MATERIAL_NOTE);
    // the assembly line itself is still printed once (the appendix heading is uppercase)
    expect(count(withParts, "Heat store box rev 3")).toBe(1);
  }, 30000);

  it("VAT 23 %: net, the VAT row and the gross total in the quote currency, derived from the printed net", async () => {
    const bundle = makeAssemblyBundle();
    const model = buildPdfViewModel(bundle, { locale: "en", content: en, now: NOW });
    const net = bundle.pricing!.subtotalPrice;
    const round2 = (v: number) => Number(v.toFixed(2));
    const netQ = round2(net);
    const vatQ = round2(netQ * 0.23);
    const grossQ = round2(netQ + vatQ);
    expect(model.totals.net).toBe(eur(net));
    expect(model.totals.vat).toEqual({ rateLabel: "VAT 23 %", amount: eur(vatQ), gross: eur(grossQ) });
    expect(model.totals.netNotice).toBeNull();

    const text = await textOf(bundle);
    expect(text).toContain("VAT 23 %");
    expect(text).toContain(en.pdf.totals.vat.gross.toUpperCase());
    expect(norm(text)).toContain(norm(eur(grossQ)));
    expect(text).not.toContain(en.pdf.totals.netNotice);

    // PLN quote: the same block converted at the stored fx rate
    const pln = buildPdfViewModel(makeAssemblyBundle({ quote: { currency: "PLN", fx_rate: 4.3 } }), { locale: "pl", content: pl, now: NOW });
    const netPln = round2(net * 4.3);
    const vatPln = round2(netPln * 0.23);
    expect(pln.totals.vat?.gross).toBe(formatMoney(round2(netPln + vatPln), "PLN", "pl"));
    expect(pln.totals.vat?.rateLabel).toBe("VAT 23 %");
  }, 30000);

  it("printed net + printed VAT = printed gross, also for a sub-cent net, in EUR and PLN", () => {
    const parseEn = (s: string) => Number(s.replace(/[^\d.]/g, ""));
    const parsePl = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", "."));
    for (const price of [290.03, 290.12, 123.456, 77.777, 300]) {
      const enModel = buildPdfViewModel(makeAssemblyBundle({ assemblyUnitPrice: price }), { locale: "en", content: en, now: NOW });
      expect(enModel.totals.vat).not.toBeNull();
      expect(parseEn(enModel.totals.net) + parseEn(enModel.totals.vat!.amount)).toBeCloseTo(parseEn(enModel.totals.vat!.gross), 6);
      const plModel = buildPdfViewModel(makeAssemblyBundle({ assemblyUnitPrice: price, quote: { currency: "PLN", fx_rate: 4.3 } }), { locale: "pl", content: pl, now: NOW });
      expect(parsePl(plModel.totals.net) + parsePl(plModel.totals.vat!.amount)).toBeCloseTo(parsePl(plModel.totals.vat!.gross), 6);
    }
  });

  it("0 % VAT prints the note of the mode (reverse charge / export) and no gross; mode none keeps the net notice", async () => {
    const reverse = makeAssemblyBundle({ vat: (net) => vatResult("reverse_charge", 0, net), customer: { country: "DE", vat_id: "DE123456789" } });
    const rc = buildPdfViewModel(reverse, { locale: "en", content: en, now: NOW });
    expect(rc.totals.vat).toBeNull();
    expect(rc.totals.netNotice).toBe(en.pdf.totals.vat.reverseChargeNote);
    const rcPl = buildPdfViewModel(reverse, { locale: "pl", content: pl, now: NOW });
    expect(rcPl.totals.netNotice).toBe("Wewnątrzwspólnotowa dostawa towarów – odwrotne obciążenie, art. 138 dyrektywy 2006/112/WE");

    const exportModel = buildPdfViewModel(makeAssemblyBundle({ vat: (net) => vatResult("export", 0, net) }), { locale: "en", content: en, now: NOW });
    expect(exportModel.totals.vat).toBeNull();
    expect(exportModel.totals.netNotice).toBe("Export – 0 % VAT");

    const none = buildPdfViewModel(makeAssemblyBundle({ vat: null }), { locale: "en", content: en, now: NOW });
    expect(none.totals.vat).toBeNull();
    expect(none.totals.netNotice).toBe(en.pdf.totals.netNotice);

    const oss = buildPdfViewModel(makeAssemblyBundle({ vat: (net) => vatResult("b2c_oss", 25.5, net) }), { locale: "en", content: en, now: NOW });
    expect(oss.totals.vat?.rateLabel).toBe("VAT 25.5 %");
    expect(oss.totals.netNotice).toBe(en.pdf.totals.vat.ossNote);

    const text = await textOf(reverse);
    expect(text).toContain("art. 138 Directive 2006/112/EC");
    expect(text).not.toContain("VAT 0 %");
    expect(text).not.toContain(en.pdf.totals.vat.gross.toUpperCase());
  }, 30000);

  it("prints the customer reference and the contact person (quote first, then customer) when set, and the lead time once", async () => {
    const bundle = makeAssemblyBundle();
    const model = buildPdfViewModel(bundle, { locale: "en", content: en, now: NOW });
    expect(model.customerReference).toBe("N260580");
    expect(model.contactPerson).toBe("Anna Nowak");
    expect(buildPdfViewModel(makeAssemblyBundle({ quote: { contact_person: "Jan Kowalski" } }), { locale: "en", content: en, now: NOW }).contactPerson).toBe("Jan Kowalski");
    const bare = buildPdfViewModel(makeAssemblyBundle({ quote: { customer_reference: "  " }, customer: { contact_person: null } }), { locale: "en", content: en, now: NOW });
    expect(bare.customerReference).toBeNull();
    expect(bare.contactPerson).toBeNull();

    const text = await textOf(bundle);
    expect(norm(text)).toContain(norm(en.pdf.meta.customerReference.toUpperCase()));
    expect(text).toContain("N260580");
    expect(text).toContain("Anna Nowak");
    expect(count(text, "dni roboczych")).toBe(1);
    expect(text).toContain("Lead time: 10–15 dni roboczych.");
  }, 30000);

  it("prints one price-scale table per subject with qty / unit price / total and the set-up note", async () => {
    const bundle = makeAssemblyBundle({ priceScale: [20, 50] });
    const model = buildPdfViewModel(bundle, { locale: "en", content: en, now: NOW });
    expect(model.priceScale).not.toBeNull();
    expect(model.priceScale!.tables.map((t) => [t.kind, t.subject])).toEqual([
      ["item", LOOSE_NAME],
      ["assembly", "Heat store box rev 3"],
    ]);
    const asmTable = model.priceScale!.tables[1];
    expect(asmTable.rows).toEqual([
      { qty: "20", unitPrice: eur(280), total: eur(5600) },
      { qty: "50", unitPrice: eur(250), total: eur(12500) },
    ]);
    expect(model.priceScale!.note).toBe(en.pdf.priceScale.note);
    expect(buildPdfViewModel(makeAssemblyBundle(), { locale: "en", content: en, now: NOW }).priceScale).toBeNull();

    const text = await textOf(bundle);
    expect(norm(text)).toContain(norm(en.pdf.priceScale.heading.toUpperCase()));
    expect(text).toContain(en.pdf.priceScale.note);
    expect(norm(text)).toContain(norm(eur(12500)));
  }, 30000);

  it("prints shipping as its own line under the subtotals and inside the net total", async () => {
    const bundle = makeAssemblyBundle();
    const model = buildPdfViewModel(bundle, { locale: "en", content: en, now: NOW });
    expect(model.totals.shipping).toBe(eur(SHIPPING_EUR));
    expect(model.totals.partsSubtotal).not.toBeNull();
    const withoutShipping = buildPdfViewModel(makeAssemblyBundle({ shippingEur: null }), { locale: "en", content: en, now: NOW });
    expect(withoutShipping.totals.shipping).toBeNull();

    const text = await textOf(bundle);
    expect(text).toContain(en.pdf.totals.shipping);
    expect(norm(text)).toContain(norm(eur(SHIPPING_EUR)));
  }, 30000);

  it("terms: a B2C customer without typed terms gets the prepayment default; B2B keeps the text and prints the requested terms", () => {
    const b2c = buildPdfViewModel(makeAssemblyBundle({ customer: { customer_type: "b2c", requested_terms: "30 days" }, quote: { payment_terms_text: null } }), { locale: "en", content: en, now: NOW });
    expect(b2c.terms.payment).toBe(en.pdf.terms.prepayment);
    expect(b2c.terms.requestedTerms).toBeNull();

    const b2cTyped = buildPdfViewModel(makeAssemblyBundle({ customer: { customer_type: "b2c" }, quote: { payment_terms_text: "50 % up front" } }), { locale: "en", content: en, now: NOW });
    expect(b2cTyped.terms.payment).toBe("Payment terms: 50 % up front");

    const b2b = buildPdfViewModel(makeAssemblyBundle({ customer: { customer_type: "b2b", requested_terms: "30 days net, 2 % within 14 days" }, quote: { payment_terms_text: "14 days" } }), { locale: "en", content: en, now: NOW });
    expect(b2b.terms.payment).toBe("Payment terms: 14 days");
    expect(b2b.terms.requestedTerms).toBe("Payment terms requested by the customer: 30 days net, 2 % within 14 days");

    const b2bEmpty = buildPdfViewModel(makeAssemblyBundle({ customer: { customer_type: "b2b" }, quote: { payment_terms_text: "" } }), { locale: "en", content: en, now: NOW });
    expect(b2bEmpty.terms.payment).toBeNull();
    expect(b2bEmpty.terms.requestedTerms).toBeNull();
  });

  it("company block: company_settings wins where set, site-config fills the blanks, placeholders raise the footer note", () => {
    const company = makeCompanySettings({ legal_name: "Alto Design Sp. z o.o. — oddział", street: "", email: "oferty@stretchmetal.pl", iban_eur: "PL99 0000 1111 2222 3333 4444 5555" });
    const model = buildPdfViewModel(makeAssemblyBundle({ company }), { locale: "en", content: en, now: NOW });
    expect(model.company.legalName).toBe("Alto Design Sp. z o.o. — oddział");
    expect(model.company.addressLines).toEqual(["ul. Legionów 59", "42-200 Częstochowa", "Poland"]);
    expect(model.company.email).toBe("oferty@stretchmetal.pl");
    expect(model.company.web).toBe("stretchmetal.pl");
    expect(model.footer.iban).toBe("IBAN (EUR): PL99 0000 1111 2222 3333 4444 5555");
    expect(model.footer.confirmNote).toBeNull();

    const placeholder = buildPdfViewModel(makeAssemblyBundle({ company: makeCompanySettings({ nip: "PL0000000000" }) }), { locale: "en", content: en, now: NOW });
    expect(placeholder.footer.confirmNote).toBe(en.pdf.footer.confirmNote);

    const noRow = buildPdfViewModel(makeAssemblyBundle({ company: null }), { locale: "pl", content: pl, now: NOW });
    expect(noRow.company.legalName).toBe("Alto Design Sp. z o.o.");
    expect(noRow.company.addressLines[2]).toBe("Polska");
  });

  it("prints a loose item's material note under its row", async () => {
    const bundle = makeAssemblyBundle({ items: [], parts: [] });
    bundle.items[2].material_note = MATERIAL_NOTE;
    const model = buildPdfViewModel(bundle, { locale: "en", content: en, now: NOW });
    expect(model.rows[1].materialNote).toBe(`Material note: ${MATERIAL_NOTE}`);
    const text = await textOf(bundle);
    expect(text).toContain(`Material note: ${MATERIAL_NOTE}`);
  }, 30000);

  it("an item whose assembly_id points at no assembly of the bundle is a loose row", () => {
    const bundle = makeAssemblyBundle();
    bundle.items[2].assembly_id = "00000000-0000-4000-8000-00000000dead";
    const model = buildPdfViewModel(bundle, { locale: "en", content: en, now: NOW });
    expect(model.rows.map((r) => r.name)).toEqual(["Heat store box rev 3", LOOSE_NAME]);
  });

  it("assembly render page count", async () => {
    const pdf = await renderQuotePdf(makeAssemblyBundle({ priceScale: [20, 50] }), { locale: "en", showOperations: true, showAssemblyParts: true, now: NOW });
    const text = await extractPdfText(pdf);
    expect(text.pageCount).toMatchSnapshot("pages-assembly-en-EUR");
  }, 30000);
});
