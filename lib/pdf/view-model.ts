/**
 * Quote PDF view model — a pure projection of a QuoteBundle into the
 * strings and shapes the react-pdf document prints. No I/O, so the PDF
 * layout can be tested from a synthetic bundle without a database.
 * File path: /lib/pdf/view-model.ts
 *
 * Rules that live here (and nowhere else):
 *   - The PDF NEVER carries cost, margin or markup: only unit prices,
 *     batch totals and the net total, converted to the quote currency
 *     with the stored fx rate (formatMoney rounds to 0.01 at this
 *     boundary only).
 *   - Welded assemblies (docs/assembly-mode-design.md §5): ONE row per
 *     assembly in the parts table — name, drawing reference, material /
 *     thickness, qty, unit price and total from PricedQuote.assemblies;
 *     rows come first (position order), loose items follow. Member items
 *     (assembly_id pointing at an assembly of the bundle) are NOT rows;
 *     they appear only in the optional appendix "Parts of assembly <name>"
 *     (options.showAssemblyParts, default false) with material, thickness,
 *     qty per assembly and the material note. An unpriceable assembly
 *     (unitPrice null — the export guard blocks the quote upstream) prints
 *     "—" defensively. An item whose assembly_id points nowhere is a
 *     loose row (the mapper prices it loose too).
 *   - Welding as a separate block (quotes.welding_separate on a
 *     fabrication quote): the LOOSE rows' prices exclude the weld lines
 *     (weld seams + welding setup) and those are listed under "Welding"
 *     with their own subtotal — the net total is unchanged because price
 *     is linear in cost. Welding-only quotes always print the block from
 *     pricing.welding. Assembly welding is inside the assembly price and
 *     never moves.
 *   - Totals: packaging (quote line) and shipping (PricedQuote.shipping)
 *     as their own rows above the net total; VAT per §3.4 from
 *     PricedQuote.vat — rate above 0: net, "VAT <rate> %", gross (b2c_oss
 *     adds the OSS note); 0 %: the note of the mode (reverse charge /
 *     export); no VAT result or mode none: today's "prices are net"
 *     notice. All money in the quote currency at the stored fx rate.
 *   - Terms: a B2C customer without payment_terms_text gets the
 *     prepayment default; a B2B customer keeps the editable text and gets
 *     "Requested terms: …" from customers.requested_terms when set. The
 *     lead time is printed ONCE — in the terms block (the meta grid does
 *     not repeat it; `leadTime` stays on the model for the tests).
 *   - Meta grid: customer reference (quotes.customer_reference) and
 *     contact person (quotes.contact_person ?? customers.contact_person),
 *     only when set.
 *   - Price scale (PricedQuote.priceScale): one qty | unit price | total
 *     table per subject (loose item → part name, assembly → its name).
 *   - Material notes (quote_items.material_note, e.g. DC01 for S235):
 *     under the loose row; for members in the appendix row.
 *   - Company block and footer bank data: company_settings merged over
 *     lib/site-config.ts (lib/pdf/company.ts); the footer's red note
 *     appears while any field still carries a placeholder marker.
 *   - Operation summary per part (optional): distinct operation types in
 *     display order with counts, from the persisted PricedQuote; for an
 *     assembly row the assembly's own cost lines (material, cutting,
 *     welding, set-up …) are summarised the same way.
 *   - Thumbnail: outer/hole entities of the stored geometry as SVG path
 *     data (segmentsToPath), capped to keep the PDF small; parts without
 *     geometry and assembly rows print no thumbnail.
 *   - Dates: a sent quote prints its sent_at date and the validity counted
 *     from it; a draft prints "today" (the export moment).
 */

import type { Content } from "@/content";
import type { AssemblyRow, PartRow, QuoteItemRow } from "@/lib/db/types";
import { entityPath, viewBoxFor } from "@/lib/geometry/svg";
import type { PartGeometry } from "@/lib/geometry/types";
import type { CurrencyCode } from "@/lib/db/types";
import { formatDate, formatDateTime, formatMoney, formatNumber, interpolate, toQuoteCurrency } from "@/lib/format";
import { priceFromCost, type OperationLine, type OperationType, type PricedAssembly, type PricedItem, type VatResult } from "@/lib/pricing/types";
import { parseGeometry } from "@/lib/quotes/schema";
import { quoteNumberLabel, quotePdfFileName, summariseOperations, validUntilDate } from "@/lib/quotes/shared";
import type { QuoteBundle } from "@/lib/quotes/types";
import { siteConfig, type Locale } from "@/lib/site-config";
import type { WeldProcess } from "@/lib/geometry/types";
import { companyAddressLines, companyWebLabel, hasCompanyPlaceholders, resolveCompanyProfile } from "./company";

export type PdfThumbnail = {
  viewBox: string;
  /** Stroke width in viewBox units (0.6 % of the larger side). */
  strokeWidth: number;
  paths: { d: string; kind: "cut" | "hole" | "bend" }[];
};

export type PdfRowKind = "item" | "assembly";

export type PdfPartRow = {
  kind: PdfRowKind;
  position: number;
  name: string;
  /** Muted line under the name (assembly: kind · drawing · parts count). */
  subline: string | null;
  material: string;
  thickness: string;
  qty: string;
  unitPrice: string;
  total: string;
  thumbnail: PdfThumbnail | null;
  operations: { label: string; count: string }[];
  /** Weld lines moved to the welding block (welding_separate). */
  weldingMoved: boolean;
  /** quote_items.material_note of a loose item, already interpolated into the content template. */
  materialNote: string | null;
};

export type PdfWeldingRow = { seam: string; process: string; length: string; qty: string };

export type PdfAssemblyPartRow = {
  position: number;
  name: string;
  material: string;
  thickness: string;
  qtyPerAssembly: string;
  materialNote: string | null;
};

export type PdfAssemblyAppendix = { assemblyId: string; heading: string; rows: PdfAssemblyPartRow[] };

export type PdfPriceScaleRow = { qty: string; unitPrice: string; total: string };
export type PdfPriceScaleTable = { subjectId: string; kind: "item" | "assembly"; subject: string; rows: PdfPriceScaleRow[] };

/** Printed when the VAT rate is above 0: the rate row and the gross total. */
export type PdfVatBlock = { rateLabel: string; amount: string; gross: string };

export type PdfViewModel = {
  locale: Locale;
  fileName: string;
  title: string;
  documentTitle: string;
  numberLabel: string;
  version: string;
  date: string;
  validUntil: string;
  /** The lead time text (printed once, in the terms block). */
  leadTime: string | null;
  currency: string;
  preparedBy: string | null;
  customerReference: string | null;
  contactPerson: string | null;
  company: {
    brand: string;
    legalName: string;
    addressLines: string[];
    nip: string;
    regon: string;
    krs: string;
    phone: string;
    email: string;
    web: string;
  };
  customer: { name: string; addressLines: string[]; vatId: string | null; email: string | null } | null;
  rows: PdfPartRow[];
  showOperations: boolean;
  /** "Parts of assembly …" tables — empty unless options.showAssemblyParts. */
  assemblyParts: PdfAssemblyAppendix[];
  welding: { rows: PdfWeldingRow[]; total: string; minOrderApplied: boolean } | null;
  totals: {
    partsSubtotal: string | null;
    weldingSubtotal: string | null;
    packaging: string | null;
    shipping: string | null;
    net: string;
    vat: PdfVatBlock | null;
    /** Note under the totals: the 0 % VAT note by mode, the OSS note, or the "prices are net" notice; null when nothing applies. */
    netNotice: string | null;
  };
  priceScale: { tables: PdfPriceScaleTable[]; note: string } | null;
  terms: { validity: string; leadTime: string | null; payment: string | null; requestedTerms: string | null; notes: string | null; generic: string };
  footer: { bank: string; iban: string; swift: string; website: string; generated: string; confirmNote: string | null };
};

export type PdfViewModelOptions = {
  locale: Locale;
  content: Content;
  showOperations?: boolean;
  /** Print the "Parts of assembly …" appendix listing the members of every assembly (default false). */
  showAssemblyParts?: boolean;
  preparedBy?: string | null;
  /** "Now" for drafts — injectable for deterministic tests. */
  now?: Date;
};

const MAX_THUMBNAIL_ENTITIES = 600;
const DASH = "—";

export function thumbnailFromGeometry(geometry: PartGeometry | null, deleted: ReadonlySet<string> = new Set()): PdfThumbnail | null {
  if (!geometry || geometry.entities.length === 0) return null;
  const paths: PdfThumbnail["paths"] = [];
  for (const entity of geometry.entities) {
    if (paths.length >= MAX_THUMBNAIL_ENTITIES) break;
    if (deleted.has(entity.id)) continue;
    if (entity.role === "cut") paths.push({ d: entityPath(entity), kind: "cut" });
    else if (entity.role === "hole") paths.push({ d: entityPath(entity), kind: "hole" });
    else if (entity.role === "bend_up" || entity.role === "bend_down") paths.push({ d: entityPath(entity), kind: "bend" });
  }
  if (paths.length === 0) return null;
  const bbox = geometry.measures.bbox;
  const side = Math.max(bbox.width, bbox.height, 1);
  const padding = side * 0.04;
  return { viewBox: viewBoxFor(bbox, padding), strokeWidth: side * 0.006, paths };
}

function isWeldLine(line: OperationLine): boolean {
  return line.type === "weld" || (line.type === "setup" && line.label === "weld_setup");
}

function addressLines(address: string | null | undefined): string[] {
  return (address ?? "")
    .split(/\r?\n|,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim() ?? "";
  return t === "" ? null : t;
}

function deletedEntityIds(part: PartRow | undefined): Set<string> {
  if (!part || !part.annotations || typeof part.annotations !== "object" || Array.isArray(part.annotations)) return new Set();
  const ids = (part.annotations as { deletedEntityIds?: unknown }).deletedEntityIds;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/** Members of an assembly in item position order (an assembly_id pointing at no assembly of the bundle = loose). */
function membersByAssembly(items: readonly QuoteItemRow[], assemblies: readonly AssemblyRow[]): Map<string, QuoteItemRow[]> {
  const map = new Map<string, QuoteItemRow[]>(assemblies.map((a) => [a.id, []]));
  for (const item of items) {
    if (!item.assembly_id) continue;
    map.get(item.assembly_id)?.push(item);
  }
  return map;
}

export function buildPdfViewModel(bundle: QuoteBundle, options: PdfViewModelOptions): PdfViewModel {
  const { locale, content } = options;
  const t = content.pdf;
  const { quote, customer, pricing } = bundle;
  const currency = quote.currency;
  const fx = Number(quote.fx_rate) || 1;
  const money = (eur: number) => formatMoney(toQuoteCurrency(eur, currency, fx), currency, locale);
  const moneyOrDash = (eur: number | null) => (eur !== null && Number.isFinite(eur) ? money(eur) : DASH);
  const mm = (value: number | string | null | undefined): string => {
    const n = value === null || value === undefined ? NaN : Number(value);
    return Number.isFinite(n) ? `${formatNumber(n, locale)} ${content.common.units.mm}` : DASH;
  };
  const now = options.now ?? new Date();
  const dateBase = quote.sent_at ? new Date(quote.sent_at) : now;
  const validUntil = validUntilDate(dateBase, Number(quote.validity_days) || 0);
  const showOperations = options.showOperations ?? quote.show_operations_on_pdf;
  const showAssemblyParts = options.showAssemblyParts ?? false;
  const weldingSeparate = quote.type === "fabrication" && quote.welding_separate;
  const marginPct = pricing?.marginPct ?? (Number(quote.margin_pct) || 0);

  const pricedById = new Map<string, PricedItem>((pricing?.items ?? []).map((i) => [i.itemId, i]));
  const pricedAssemblyById = new Map<string, PricedAssembly>((pricing?.assemblies ?? []).map((a) => [a.assemblyId, a]));
  const partsById = new Map(bundle.parts.map((p) => [p.id, p]));
  const assemblies = [...bundle.assemblies].sort((a, b) => a.position - b.position);
  const members = membersByAssembly(bundle.items, assemblies);
  const assemblyById = new Map(assemblies.map((a) => [a.id, a]));
  const isMember = (item: QuoteItemRow) => item.assembly_id !== null && assemblyById.has(item.assembly_id);

  const summarise = (lines: readonly OperationLine[]) =>
    summariseOperations(lines).map((s) => ({ label: t.operations.types[s.type as OperationType], count: formatNumber(s.count, locale) }));
  const materialNoteOf = (item: QuoteItemRow) => {
    const note = trimmed(item.material_note);
    return note ? interpolate(t.parts.materialNote, { note }) : null;
  };

  let partsSubtotalEur = 0;
  let movedWeldEur = 0;
  const separateRows: PdfWeldingRow[] = [];
  const rows: PdfPartRow[] = [];

  // Assemblies first: one row each.
  for (const assembly of assemblies) {
    const priced = pricedAssemblyById.get(assembly.id);
    const qty = Number(assembly.qty);
    const unitPriceEur = priced?.unitPrice ?? null;
    const totalEur = priced ? (priced.batchPrice ?? (unitPriceEur !== null ? unitPriceEur * qty : null)) : null;
    if (totalEur !== null) partsSubtotalEur += totalEur;
    const partsCount = (members.get(assembly.id) ?? []).reduce((sum, m) => sum + (Number(m.qty_per_assembly) || 1), 0);
    // Member names stay out of the customer document (members are appendix-only), so the notes alone.
    const memberNotes = [...new Set((members.get(assembly.id) ?? []).map((m) => trimmed(m.material_note)).filter((n): n is string => n !== null))];
    const ref = trimmed(assembly.drawing_ref);
    const subline = [t.assemblies.kind, ref ? interpolate(t.assemblies.drawingRef, { ref }) : null, interpolate(t.assemblies.partsCount, { count: formatNumber(partsCount, locale) })]
      .filter((s): s is string => s !== null)
      .join(" · ");
    rows.push({
      kind: "assembly",
      position: rows.length + 1,
      name: assembly.name,
      subline,
      material: trimmed(assembly.material_code) ?? t.parts.noMaterial,
      thickness: mm(assembly.thickness_mm),
      qty: formatNumber(qty, locale),
      unitPrice: moneyOrDash(unitPriceEur),
      total: moneyOrDash(totalEur),
      thumbnail: null,
      operations: priced ? summarise(priced.operations) : [],
      weldingMoved: false,
      // A member's DC01-for-S235 note belongs on the quote itself (design §2),
      // not only in the optional appendix: one line per noted member.
      materialNote: memberNotes.length > 0 ? interpolate(t.parts.materialNote, { note: memberNotes.join(" · ") }) : null,
    });
  }

  // Loose items (members are appendix-only).
  for (const item of bundle.items) {
    if (isMember(item)) continue;
    const part = partsById.get(item.part_id);
    const priced = pricedById.get(item.id);
    const qty = Number(item.qty);
    let unitPriceEur: number | null = priced ? priced.unitPrice : null;
    let weldingMoved = false;
    if (priced && weldingSeparate) {
      const weldLines = priced.operations.filter(isWeldLine);
      if (weldLines.length > 0) {
        const weldCost = weldLines.reduce((sum, l) => sum + l.unitCost, 0);
        unitPriceEur = priceFromCost(priced.unitCost - weldCost, marginPct);
        movedWeldEur += priceFromCost(weldCost, marginPct) * qty;
        weldingMoved = true;
        for (const line of weldLines) {
          if (line.type !== "weld") continue;
          const process = String(line.details.process ?? "");
          const length = typeof line.details.effectiveLengthMm === "number" ? line.details.effectiveLengthMm : line.driverQty;
          separateRows.push({
            seam: `${part?.name ?? item.part_id} · ${line.label === "weld" ? t.operations.types.weld : line.label}`,
            process: t.welding.processes[process as WeldProcess] ?? process,
            length: `${formatNumber(length, locale, { maximumFractionDigits: 0 })} ${content.common.units.mm}`,
            qty: formatNumber(qty, locale),
          });
        }
      }
    }
    if (unitPriceEur !== null) partsSubtotalEur += unitPriceEur * qty;
    const geometry = part ? parseGeometry(part.geometry) : null;
    const operations = priced ? summarise(priced.operations.filter((l) => !(weldingMoved && isWeldLine(l)))) : [];
    rows.push({
      kind: "item",
      position: rows.length + 1,
      name: part?.name ?? "",
      subline: null,
      material: part?.material_code ?? t.parts.noMaterial,
      thickness: mm(part?.thickness_mm),
      qty: formatNumber(qty, locale),
      unitPrice: moneyOrDash(unitPriceEur),
      total: unitPriceEur !== null ? money(unitPriceEur * qty) : DASH,
      thumbnail: part?.source === "manual" ? null : thumbnailFromGeometry(geometry, deletedEntityIds(part)),
      operations,
      weldingMoved,
      materialNote: materialNoteOf(item),
    });
  }

  // Appendix: the members of every assembly (material / thickness inherited from the assembly when the part has none).
  const assemblyParts: PdfAssemblyAppendix[] = showAssemblyParts
    ? assemblies.map((assembly) => ({
        assemblyId: assembly.id,
        heading: interpolate(t.assemblies.appendixHeading, { name: assembly.name }),
        rows: (members.get(assembly.id) ?? []).map((item, index) => {
          const part = partsById.get(item.part_id);
          return {
            position: index + 1,
            name: part?.name ?? "",
            material: trimmed(part?.material_code) ?? trimmed(assembly.material_code) ?? t.parts.noMaterial,
            thickness: mm(part?.thickness_mm ?? assembly.thickness_mm),
            qtyPerAssembly: formatNumber(Number(item.qty_per_assembly) || 1, locale),
            materialNote: materialNoteOf(item),
          };
        }),
      }))
    : [];

  let welding: PdfViewModel["welding"] = null;
  let weldingSubtotalEur: number | null = null;
  if (pricing?.welding) {
    const block = pricing.welding;
    const weldingRows: PdfWeldingRow[] = block.operations
      .filter((line) => line.type === "weld" && line.details.seamId !== undefined)
      .map((line) => ({
        seam: line.label === "weld" ? t.operations.types.weld : line.label,
        process: t.welding.processes[String(line.details.process) as WeldProcess] ?? String(line.details.process ?? ""),
        length: `${formatNumber(Number(line.details.effectiveLengthMm ?? line.driverQty), locale, { maximumFractionDigits: 0 })} ${content.common.units.mm}`,
        qty: formatNumber(Number(line.details.qty ?? 1), locale),
      }));
    weldingSubtotalEur = block.price;
    welding = { rows: weldingRows, total: money(block.price), minOrderApplied: block.minOrderApplied };
  } else if (weldingSeparate && separateRows.length > 0) {
    weldingSubtotalEur = movedWeldEur;
    welding = { rows: separateRows, total: money(movedWeldEur), minOrderApplied: false };
  }

  // Quote-level lines shown on their own: packaging (quote line) and shipping (PricedQuote.shipping).
  // Setups and the order charge sit inside the part / assembly prices, as 247 does.
  const packagingEur = (pricing?.quoteLines ?? []).filter((l) => l.type === "packaging").reduce((sum, l) => sum + l.unitCost, 0);
  const shippingEur = pricing?.shipping ? pricing.shipping.unitCost : null;
  const netEur = pricing ? pricing.subtotalPrice : partsSubtotalEur + (weldingSubtotalEur ?? 0);
  const { vat, netNotice } = vatBlock(pricing?.vat ?? null, netEur, currency, fx, t, locale);

  const numberLabel = quoteNumberLabel(quote);
  const sender = options.preparedBy ?? null;
  const leadDays = Number(quote.lead_time_days);
  const leadTime =
    trimmed(quote.lead_time_text) ??
    (pricing?.pricingMode === "market" && Number.isFinite(leadDays) && leadDays > 0
      ? interpolate(t.terms.leadTimeDays, { days: formatNumber(leadDays, locale) })
      : null);

  // Terms: B2C without a typed text → prepayment default; B2B keeps the text and prints the requested terms.
  const paymentText = trimmed(quote.payment_terms_text);
  const isB2c = customer?.customer_type === "b2c";
  const payment = paymentText ? interpolate(t.terms.payment, { terms: paymentText }) : isB2c ? t.terms.prepayment : null;
  const requested = customer && customer.customer_type === "b2b" ? trimmed(customer.requested_terms) : null;
  const requestedTerms = requested ? interpolate(t.terms.requestedTerms, { terms: requested }) : null;

  // Price scale: one table per subject.
  const scaleTables: PdfPriceScaleTable[] = (pricing?.priceScale ?? [])
    .filter((scale) => scale.entries.length > 0)
    .map((scale) => {
      const subject =
        scale.kind === "assembly"
          ? assemblyById.get(scale.subjectId)?.name ?? scale.subjectId
          : partsById.get(bundle.items.find((i) => i.id === scale.subjectId)?.part_id ?? "")?.name ?? scale.subjectId;
      return {
        subjectId: scale.subjectId,
        kind: scale.kind,
        subject,
        rows: scale.entries.map((e) => ({ qty: formatNumber(e.qty, locale), unitPrice: moneyOrDash(e.unitPrice), total: moneyOrDash(e.total) })),
      };
    });

  const profile = resolveCompanyProfile(bundle.company ?? null);
  const web = companyWebLabel(profile);

  return {
    locale,
    fileName: quotePdfFileName(quote, locale),
    title: t.title,
    documentTitle: interpolate(t.documentTitle, { number: numberLabel }),
    numberLabel,
    version: String(quote.version),
    date: formatDate(dateBase, locale),
    validUntil: formatDate(validUntil, locale),
    leadTime,
    currency,
    preparedBy: sender,
    customerReference: trimmed(quote.customer_reference),
    contactPerson: trimmed(quote.contact_person) ?? trimmed(customer?.contact_person),
    company: {
      brand: profile.brand,
      legalName: profile.legalName,
      addressLines: companyAddressLines(profile, locale),
      nip: profile.nip,
      regon: profile.regon,
      krs: profile.krs,
      phone: profile.phone,
      email: profile.email,
      web,
    },
    customer: customer
      ? { name: customer.name, addressLines: addressLines(customer.address), vatId: customer.vat_id, email: customer.email }
      : null,
    rows,
    showOperations,
    assemblyParts,
    welding,
    totals: {
      partsSubtotal: welding || packagingEur > 0 || shippingEur !== null ? money(partsSubtotalEur) : null,
      weldingSubtotal: welding && weldingSubtotalEur !== null ? money(weldingSubtotalEur) : null,
      packaging: packagingEur > 0 ? money(packagingEur) : null,
      shipping: shippingEur !== null ? money(shippingEur) : null,
      net: money(netEur),
      vat,
      netNotice,
    },
    priceScale: scaleTables.length > 0 ? { tables: scaleTables, note: t.priceScale.note } : null,
    terms: {
      validity: interpolate(t.terms.validity, { date: formatDate(validUntil, locale) }),
      leadTime: leadTime ? interpolate(t.terms.leadTime, { leadTime }) : null,
      payment,
      requestedTerms,
      notes: null,
      generic: t.terms.generic,
    },
    footer: {
      bank: `${t.footer.bank}: ${profile.bankName}`,
      iban: `${t.footer.iban} (${currency}): ${currency === "PLN" ? profile.ibanPln : profile.ibanEur}`,
      swift: `${t.footer.swift}: ${profile.swift}`,
      website: web,
      generated: interpolate(t.footer.generated, { date: formatDateTime(now, locale), app: siteConfig.appName }),
      confirmNote: hasCompanyPlaceholders(profile) ? t.footer.confirmNote : null,
    },
  };
}

/**
 * The VAT presentation (design §3.4): rate above 0 → the rate row and the
 * gross total (plus the OSS note under b2c_oss); 0 % → the note of the
 * mode; no VAT result / mode none / an unexpected 0 % → the net notice.
 */
const round2 = (value: number) => Number(value.toFixed(2));

/**
 * The printed VAT block is derived from the PRINTED net (quote currency,
 * rounded to the cent), so net + VAT = gross holds on paper; rounding the
 * three engine numbers independently is off by a cent in a quarter of the
 * quotes.
 */
function vatBlock(
  vat: VatResult | null,
  netEur: number,
  currency: CurrencyCode,
  fx: number,
  t: Content["pdf"],
  locale: Locale
): { vat: PdfVatBlock | null; netNotice: string | null } {
  if (!vat || vat.mode === "none") return { vat: null, netNotice: t.totals.netNotice };
  if (vat.ratePct > 0) {
    const netQ = round2(toQuoteCurrency(netEur, currency, fx));
    const vatQ = round2((netQ * vat.ratePct) / 100);
    const grossQ = round2(netQ + vatQ);
    return {
      vat: {
        rateLabel: interpolate(t.totals.vat.rate, { rate: formatNumber(vat.ratePct, locale) }),
        amount: formatMoney(vatQ, currency, locale),
        gross: formatMoney(grossQ, currency, locale),
      },
      netNotice: vat.mode === "b2c_oss" ? t.totals.vat.ossNote : null,
    };
  }
  if (vat.mode === "reverse_charge") return { vat: null, netNotice: t.totals.vat.reverseChargeNote };
  if (vat.mode === "export") return { vat: null, netNotice: t.totals.vat.exportNote };
  return { vat: null, netNotice: t.totals.netNotice };
}
