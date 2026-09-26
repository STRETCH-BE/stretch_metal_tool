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
 *   - Welding as a separate block (quotes.welding_separate on a
 *     fabrication quote): the parts table prices exclude the weld lines
 *     (weld seams + welding setup) and those are listed under "Welding"
 *     with their own subtotal — the net total is unchanged because price
 *     is linear in cost. Welding-only quotes always print the block from
 *     pricing.welding.
 *   - Operation summary per part (optional): distinct operation types in
 *     display order with counts, from the persisted PricedQuote.
 *   - Thumbnail: outer/hole entities of the stored geometry as SVG path
 *     data (segmentsToPath), capped to keep the PDF small; parts without
 *     geometry print no thumbnail.
 *   - Dates: a sent quote prints its sent_at date and the validity counted
 *     from it; a draft prints "today" (the export moment).
 */

import type { Content } from "@/content";
import { entityPath, viewBoxFor } from "@/lib/geometry/svg";
import type { PartGeometry } from "@/lib/geometry/types";
import { formatDate, formatDateTime, formatMoney, formatNumber, interpolate, toQuoteCurrency } from "@/lib/format";
import { priceFromCost, type OperationLine, type OperationType, type PricedItem } from "@/lib/pricing/types";
import { parseGeometry } from "@/lib/quotes/schema";
import { quoteNumberLabel, quotePdfFileName, summariseOperations, validUntilDate } from "@/lib/quotes/shared";
import type { QuoteBundle } from "@/lib/quotes/types";
import { siteConfig, type Locale } from "@/lib/site-config";
import type { WeldProcess } from "@/lib/geometry/types";

export type PdfThumbnail = {
  viewBox: string;
  /** Stroke width in viewBox units (0.6 % of the larger side). */
  strokeWidth: number;
  paths: { d: string; kind: "cut" | "hole" | "bend" }[];
};

export type PdfPartRow = {
  position: number;
  name: string;
  material: string;
  thickness: string;
  qty: string;
  unitPrice: string;
  total: string;
  thumbnail: PdfThumbnail | null;
  operations: { label: string; count: string }[];
  /** Weld lines moved to the welding block (welding_separate). */
  weldingMoved: boolean;
};

export type PdfWeldingRow = { seam: string; process: string; length: string; qty: string };

export type PdfViewModel = {
  locale: Locale;
  fileName: string;
  title: string;
  documentTitle: string;
  numberLabel: string;
  version: string;
  date: string;
  validUntil: string;
  leadTime: string | null;
  currency: string;
  preparedBy: string | null;
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
  welding: { rows: PdfWeldingRow[]; total: string; minOrderApplied: boolean } | null;
  totals: { partsSubtotal: string | null; weldingSubtotal: string | null; net: string; netNotice: string };
  terms: { validity: string; leadTime: string | null; payment: string | null; notes: string | null; generic: string };
  footer: { bank: string; iban: string; swift: string; website: string; generated: string; confirmNote: string | null };
};

export type PdfViewModelOptions = {
  locale: Locale;
  content: Content;
  showOperations?: boolean;
  preparedBy?: string | null;
  /** "Now" for drafts — injectable for deterministic tests. */
  now?: Date;
};

const MAX_THUMBNAIL_ENTITIES = 600;

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

export function buildPdfViewModel(bundle: QuoteBundle, options: PdfViewModelOptions): PdfViewModel {
  const { locale, content } = options;
  const t = content.pdf;
  const { quote, customer, pricing } = bundle;
  const currency = quote.currency;
  const fx = Number(quote.fx_rate) || 1;
  const money = (eur: number) => formatMoney(toQuoteCurrency(eur, currency, fx), currency, locale);
  const now = options.now ?? new Date();
  const dateBase = quote.sent_at ? new Date(quote.sent_at) : now;
  const validUntil = validUntilDate(dateBase, Number(quote.validity_days) || 0);
  const showOperations = options.showOperations ?? quote.show_operations_on_pdf;
  const weldingSeparate = quote.type === "fabrication" && quote.welding_separate;
  const marginPct = pricing?.marginPct ?? (Number(quote.margin_pct) || 0);

  const pricedById = new Map<string, PricedItem>((pricing?.items ?? []).map((i) => [i.itemId, i]));
  const partsById = new Map(bundle.parts.map((p) => [p.id, p]));

  let partsSubtotalEur = 0;
  let movedWeldEur = 0;
  const separateRows: PdfWeldingRow[] = [];

  const rows: PdfPartRow[] = bundle.items
    .map((item, index) => {
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
      const deleted = new Set<string>(
        part && part.annotations && typeof part.annotations === "object" && !Array.isArray(part.annotations)
          ? ((part.annotations as { deletedEntityIds?: unknown }).deletedEntityIds as string[] | undefined) ?? []
          : []
      );
      const thickness = part?.thickness_mm != null ? Number(part.thickness_mm) : null;
      const operations = priced
        ? summariseOperations(priced.operations.filter((l) => !(weldingMoved && isWeldLine(l)))).map((s) => ({
            label: t.operations.types[s.type as OperationType],
            count: formatNumber(s.count, locale),
          }))
        : [];
      return {
        position: index + 1,
        name: part?.name ?? "",
        material: part?.material_code ?? t.parts.noMaterial,
        thickness: thickness !== null && Number.isFinite(thickness) ? `${formatNumber(thickness, locale)} ${content.common.units.mm}` : "—",
        qty: formatNumber(qty, locale),
        unitPrice: unitPriceEur !== null ? money(unitPriceEur) : "—",
        total: unitPriceEur !== null ? money(unitPriceEur * qty) : "—",
        thumbnail: part?.source === "manual" ? null : thumbnailFromGeometry(geometry, deleted),
        operations,
        weldingMoved,
      };
    });

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

  const netEur = pricing ? pricing.subtotalPrice : partsSubtotalEur + (weldingSubtotalEur ?? 0);
  const numberLabel = quoteNumberLabel(quote);
  const sender = options.preparedBy ?? null;
  const leadTime = quote.lead_time_text?.trim() || null;
  const payment = quote.payment_terms_text?.trim() || null;
  const legal = siteConfig.legal;
  const hasPlaceholders = legal.nip.startsWith("000") || legal.ibanPln.startsWith("PL00");

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
    company: {
      brand: siteConfig.displayName,
      legalName: siteConfig.legalName,
      addressLines: [
        siteConfig.contact.address.street,
        `${siteConfig.contact.address.postalCode} ${siteConfig.contact.address.city}`,
        siteConfig.contact.address.country === "PL" ? (locale === "pl" ? "Polska" : "Poland") : siteConfig.contact.address.country,
      ],
      nip: legal.nip,
      regon: legal.regon,
      krs: legal.krs,
      phone: siteConfig.contact.phoneDisplay,
      email: siteConfig.contact.email,
      web: siteConfig.websiteUrl.replace(/^https?:\/\//, ""),
    },
    customer: customer
      ? { name: customer.name, addressLines: addressLines(customer.address), vatId: customer.vat_id, email: customer.email }
      : null,
    rows,
    showOperations,
    welding,
    totals: {
      partsSubtotal: welding ? money(partsSubtotalEur) : null,
      weldingSubtotal: welding && weldingSubtotalEur !== null ? money(weldingSubtotalEur) : null,
      net: money(netEur),
      netNotice: t.totals.netNotice,
    },
    terms: {
      validity: interpolate(t.terms.validity, { date: formatDate(validUntil, locale) }),
      leadTime: leadTime ? interpolate(t.terms.leadTime, { leadTime }) : null,
      payment: payment ? interpolate(t.terms.payment, { terms: payment }) : null,
      notes: null,
      generic: t.terms.generic,
    },
    footer: {
      bank: `${t.footer.bank}: ${legal.bankName}`,
      iban: `${t.footer.iban} (${currency}): ${currency === "PLN" ? legal.ibanPln : legal.ibanEur}`,
      swift: `${t.footer.swift}: ${legal.swift}`,
      website: siteConfig.websiteUrl.replace(/^https?:\/\//, ""),
      generated: interpolate(t.footer.generated, { date: formatDateTime(now, locale), app: siteConfig.appName }),
      confirmNote: hasPlaceholders ? t.footer.confirmNote : null,
    },
  };
}
