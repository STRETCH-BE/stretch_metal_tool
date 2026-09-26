/**
 * Quote PDF — the @react-pdf/renderer document in the STRETCH identity:
 * Archivo (expanded Black wordmark + red square, expanded Bold tracked
 * eyebrows, Regular/Medium body 9–10 pt), hairline rules, zero radius,
 * red #e00000 as the only accent. A4, print-safe margins. SERVER ONLY.
 * File path: /lib/pdf/quote-document.tsx
 *
 * Literal hex values are used in this stylesheet on purpose: react-pdf
 * has no access to the CSS custom properties of app/globals.css, so the
 * design tokens are repeated here verbatim (red #e00000, black #0a0a0a,
 * surface #f4f3f1, hairline #e6e3de, muted #54514b, faint #6e6b66).
 *
 * The document is dumb: every string and number arrives formatted in
 * the PdfViewModel (lib/pdf/view-model.ts), which is where the
 * "never print cost or margin" rule is enforced. Thumbnails are <Svg>
 * paths built from the stored geometry (segmentsToPath).
 *
 * The @jsxRuntime pragma below is for Vitest (esbuild), whose JSX
 * transform is classic by default and would look for a global `React`;
 * Next's SWC compiler already uses the automatic runtime and ignores it.
 */
/** @jsxRuntime automatic @jsxImportSource react */

import { Document, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { PdfContent } from "@/content/pdf";
import { PDF_FONT_BODY, PDF_FONT_DISPLAY } from "./fonts";
import type { PdfPartRow, PdfThumbnail, PdfViewModel } from "./view-model";

const RED = "#e00000";
const BLACK = "#0a0a0a";
const SURFACE = "#f4f3f1";
const LINE = "#e6e3de";
const MUTED = "#54514b";
const FAINT = "#6e6b66";
const WHITE = "#ffffff";

const s = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_BODY,
    fontSize: 9,
    lineHeight: 1.4,
    color: BLACK,
    paddingTop: 40,
    paddingBottom: 92,
    paddingHorizontal: 44,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: BLACK,
    paddingBottom: 12,
    marginBottom: 16,
  },
  wordmarkRow: { flexDirection: "row", alignItems: "baseline" },
  wordmark: { fontFamily: PDF_FONT_DISPLAY, fontWeight: 900, fontSize: 18, letterSpacing: -0.5 },
  wordmarkRed: { color: RED },
  wordmarkSquare: { width: 5, height: 5, backgroundColor: RED, marginLeft: 3 },
  companyBlock: { alignItems: "flex-end", fontSize: 7.5, color: MUTED, lineHeight: 1.35 },
  companyName: { color: BLACK, fontWeight: 700, fontSize: 8 },
  eyebrow: {
    fontFamily: PDF_FONT_DISPLAY,
    fontWeight: 700,
    fontSize: 8,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: FAINT,
    marginBottom: 4,
  },
  eyebrowRule: { width: 22, height: 2, backgroundColor: RED, marginBottom: 6 },
  title: { fontFamily: PDF_FONT_DISPLAY, fontWeight: 900, fontSize: 22, textTransform: "uppercase", letterSpacing: -0.4, marginBottom: 2 },
  number: { fontFamily: PDF_FONT_BODY, fontWeight: 700, fontSize: 12, marginBottom: 14 },
  metaGrid: { flexDirection: "row", gap: 24, marginBottom: 18 },
  metaCol: { flexGrow: 1, flexBasis: 0 },
  metaLabel: { fontSize: 7, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: MUTED, marginBottom: 2 },
  metaValue: { fontSize: 9.5, fontWeight: 500, marginBottom: 6 },
  customerName: { fontSize: 11, fontWeight: 700 },
  section: { marginTop: 10, marginBottom: 6 },
  table: { borderTopWidth: 1.5, borderTopColor: BLACK },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5, alignItems: "center" },
  th: { fontSize: 7, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: MUTED, paddingVertical: 4 },
  td: { fontSize: 9 },
  tdBold: { fontSize: 9, fontWeight: 700 },
  num: { textAlign: "right" },
  cellPos: { width: 22 },
  cellThumb: { width: 54, paddingRight: 6 },
  cellName: { flexGrow: 1, flexBasis: 0, paddingRight: 6 },
  cellMaterial: { width: 80, paddingRight: 6 },
  cellThickness: { width: 52, paddingRight: 6 },
  cellQty: { width: 42 },
  cellPrice: { width: 78 },
  cellTotal: { width: 84 },
  thumbBox: { width: 48, height: 32, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  opsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3 },
  opChip: { fontSize: 7, color: MUTED, borderWidth: 0.5, borderColor: LINE, paddingHorizontal: 4, paddingVertical: 1 },
  weldCellSeam: { flexGrow: 1, flexBasis: 0, paddingRight: 6 },
  weldCellProcess: { width: 70 },
  weldCellLength: { width: 90 },
  weldCellQty: { width: 42 },
  totalsBlock: { marginTop: 10, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3, width: 260 },
  totalsLabel: { flexGrow: 1, fontSize: 9, color: MUTED },
  totalsValue: { width: 100, textAlign: "right", fontSize: 9, fontWeight: 500 },
  netRow: { borderTopWidth: 1.5, borderTopColor: BLACK, marginTop: 4, paddingTop: 6 },
  netLabel: { flexGrow: 1, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 },
  netValue: { width: 110, textAlign: "right", fontSize: 13, fontWeight: 700 },
  netNotice: { fontSize: 7.5, color: FAINT, marginTop: 4 },
  terms: { marginTop: 18, fontSize: 8.5, color: MUTED, lineHeight: 1.5 },
  termsLine: { marginBottom: 2 },
  footer: {
    position: "absolute",
    left: 44,
    right: 44,
    bottom: 30,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 8,
    fontSize: 7,
    color: FAINT,
    lineHeight: 1.4,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerNote: { color: RED, marginTop: 2 },
  redBar: { width: 3, backgroundColor: RED, marginRight: 8 },
  minOrder: { fontSize: 7.5, color: FAINT, marginTop: 3 },
});

function Thumbnail({ thumb }: { thumb: PdfThumbnail | null }) {
  if (!thumb) return <View style={s.thumbBox} />;
  return (
    <View style={s.thumbBox}>
      <Svg viewBox={thumb.viewBox} style={{ width: 44, height: 28 }} preserveAspectRatio="xMidYMid meet">
        {thumb.paths.map((p, i) => (
          <Path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.kind === "bend" ? RED : p.kind === "hole" ? MUTED : BLACK}
            strokeWidth={thumb.strokeWidth}
            strokeDasharray={p.kind === "bend" ? `${thumb.strokeWidth * 4} ${thumb.strokeWidth * 2}` : undefined}
          />
        ))}
      </Svg>
    </View>
  );
}

function PartRow({ row, showOperations }: { row: PdfPartRow; showOperations: boolean }) {
  return (
    <View style={s.tr} wrap={false}>
      <Text style={[s.td, s.cellPos]}>{row.position}</Text>
      <View style={s.cellThumb}>
        <Thumbnail thumb={row.thumbnail} />
      </View>
      <View style={s.cellName}>
        <Text style={s.tdBold}>{row.name}</Text>
        {showOperations && row.operations.length > 0 && (
          <View style={s.opsRow}>
            {row.operations.map((op, i) => (
              <Text key={i} style={s.opChip}>
                {op.label} × {op.count}
              </Text>
            ))}
          </View>
        )}
      </View>
      <Text style={[s.td, s.cellMaterial]}>{row.material}</Text>
      <Text style={[s.td, s.cellThickness]}>{row.thickness}</Text>
      <Text style={[s.td, s.num, s.cellQty]}>{row.qty}</Text>
      <Text style={[s.td, s.num, s.cellPrice]}>{row.unitPrice}</Text>
      <Text style={[s.tdBold, s.num, s.cellTotal]}>{row.total}</Text>
    </View>
  );
}

export type QuoteDocumentProps = { model: PdfViewModel; content: PdfContent };

export function QuoteDocument({ model, content: t }: QuoteDocumentProps) {
  return (
    <Document title={model.documentTitle} author={model.company.legalName} language={model.locale}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow} fixed>
          <View>
            <View style={s.wordmarkRow}>
              <Text style={s.wordmark}>
                <Text style={s.wordmarkRed}>STRETCH</Text>
                <Text>METAL</Text>
              </Text>
              <View style={s.wordmarkSquare} />
            </View>
          </View>
          <View style={s.companyBlock}>
            <Text style={s.companyName}>{model.company.legalName}</Text>
            {model.company.addressLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            <Text>
              {t.company.nip} {model.company.nip}
            </Text>
            <Text>
              {t.company.phone} {model.company.phone} · {model.company.email}
            </Text>
          </View>
        </View>

        <Text style={s.eyebrow}>{t.title}</Text>
        <View style={s.eyebrowRule} />
        <Text style={s.title}>{t.title}</Text>
        <Text style={s.number}>{model.numberLabel}</Text>

        <View style={s.metaGrid}>
          <View style={[s.metaCol, { flexGrow: 1.6 }]}>
            <Text style={s.metaLabel}>{t.meta.customer}</Text>
            {model.customer ? (
              <>
                <Text style={s.customerName}>{model.customer.name}</Text>
                {model.customer.addressLines.map((line, i) => (
                  <Text key={i} style={s.metaValue}>
                    {line}
                  </Text>
                ))}
                {model.customer.vatId && (
                  <Text style={s.metaValue}>
                    {t.meta.vatId}: {model.customer.vatId}
                  </Text>
                )}
              </>
            ) : (
              <Text style={s.metaValue}>—</Text>
            )}
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>{t.meta.number}</Text>
            <Text style={s.metaValue}>{model.numberLabel}</Text>
            <Text style={s.metaLabel}>{t.meta.version}</Text>
            <Text style={s.metaValue}>{model.version}</Text>
            <Text style={s.metaLabel}>{t.meta.currency}</Text>
            <Text style={s.metaValue}>{model.currency}</Text>
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>{t.meta.date}</Text>
            <Text style={s.metaValue}>{model.date}</Text>
            <Text style={s.metaLabel}>{t.meta.validUntil}</Text>
            <Text style={s.metaValue}>{model.validUntil}</Text>
            {model.leadTime && (
              <>
                <Text style={s.metaLabel}>{t.meta.leadTime}</Text>
                <Text style={s.metaValue}>{model.leadTime}</Text>
              </>
            )}
            {model.preparedBy && (
              <>
                <Text style={s.metaLabel}>{t.meta.preparedBy}</Text>
                <Text style={s.metaValue}>{model.preparedBy}</Text>
              </>
            )}
          </View>
        </View>

        {model.rows.length > 0 && (
          <View style={s.section}>
            <Text style={s.eyebrow}>{t.parts.heading}</Text>
            <View style={s.table}>
              <View style={s.tr} fixed>
                <Text style={[s.th, s.cellPos]}>{t.parts.columns.position}</Text>
                <Text style={[s.th, s.cellThumb]}>{t.parts.columns.thumbnail}</Text>
                <Text style={[s.th, s.cellName]}>{t.parts.columns.name}</Text>
                <Text style={[s.th, s.cellMaterial]}>{t.parts.columns.material}</Text>
                <Text style={[s.th, s.cellThickness]}>{t.parts.columns.thickness}</Text>
                <Text style={[s.th, s.num, s.cellQty]}>{t.parts.columns.qty}</Text>
                <Text style={[s.th, s.num, s.cellPrice]}>{t.parts.columns.unitPrice}</Text>
                <Text style={[s.th, s.num, s.cellTotal]}>{t.parts.columns.total}</Text>
              </View>
              {model.rows.map((row) => (
                <PartRow key={row.position} row={row} showOperations={model.showOperations} />
              ))}
            </View>
          </View>
        )}

        {model.welding && (
          <View style={s.section}>
            <Text style={s.eyebrow}>{t.welding.heading}</Text>
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={[s.th, s.weldCellSeam]}>{t.welding.columns.seam}</Text>
                <Text style={[s.th, s.weldCellProcess]}>{t.welding.columns.process}</Text>
                <Text style={[s.th, s.num, s.weldCellLength]}>{t.welding.columns.length}</Text>
                <Text style={[s.th, s.num, s.weldCellQty]}>{t.welding.columns.qty}</Text>
              </View>
              {model.welding.rows.map((row, i) => (
                <View key={i} style={s.tr} wrap={false}>
                  <Text style={[s.td, s.weldCellSeam]}>{row.seam}</Text>
                  <Text style={[s.td, s.weldCellProcess]}>{row.process}</Text>
                  <Text style={[s.td, s.num, s.weldCellLength]}>{row.length}</Text>
                  <Text style={[s.td, s.num, s.weldCellQty]}>{row.qty}</Text>
                </View>
              ))}
              <View style={s.tr}>
                <Text style={[s.tdBold, s.weldCellSeam]}>{t.welding.total}</Text>
                <Text style={[s.tdBold, s.num, { width: 202 }]}>{model.welding.total}</Text>
              </View>
            </View>
            {model.welding.minOrderApplied && <Text style={s.minOrder}>{t.welding.minOrderNote}</Text>}
          </View>
        )}

        <View style={s.totalsBlock} wrap={false}>
          {model.totals.partsSubtotal && (
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{t.totals.partsSubtotal}</Text>
              <Text style={s.totalsValue}>{model.totals.partsSubtotal}</Text>
            </View>
          )}
          {model.totals.weldingSubtotal && (
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{t.totals.weldingSubtotal}</Text>
              <Text style={s.totalsValue}>{model.totals.weldingSubtotal}</Text>
            </View>
          )}
          <View style={[s.totalsRow, s.netRow]}>
            <Text style={s.netLabel}>{t.totals.net}</Text>
            <Text style={s.netValue}>{model.totals.net}</Text>
          </View>
          <Text style={s.netNotice}>{model.totals.netNotice}</Text>
        </View>

        <View style={s.terms} wrap={false}>
          <Text style={s.eyebrow}>{t.terms.heading}</Text>
          <Text style={s.termsLine}>{model.terms.validity}</Text>
          {model.terms.leadTime && <Text style={s.termsLine}>{model.terms.leadTime}</Text>}
          {model.terms.payment && <Text style={s.termsLine}>{model.terms.payment}</Text>}
          <Text style={s.termsLine}>{model.terms.generic}</Text>
        </View>

        <View style={s.footer} fixed>
          <View style={s.footerRow}>
            <Text>
              {model.company.legalName} · {model.company.addressLines.join(", ")}
            </Text>
            <Text
              render={({ pageNumber, totalPages }) =>
                t.meta.page.replace("{page}", String(pageNumber)).replace("{pages}", String(totalPages))
              }
            />
          </View>
          <Text>
            {model.footer.bank} · {model.footer.iban} · {model.footer.swift}
          </Text>
          <Text>
            {t.company.nip} {model.company.nip} · {t.company.regon} {model.company.regon} · {t.company.krs} {model.company.krs} ·{" "}
            {t.footer.website} {model.footer.website}
          </Text>
          <Text>{model.footer.generated}</Text>
          {model.footer.confirmNote && <Text style={s.footerNote}>{model.footer.confirmNote}</Text>}
        </View>
      </Page>
    </Document>
  );
}

/** Exposed for tests: the token hexes used above. */
export const PDF_COLOURS = { RED, BLACK, SURFACE, LINE, MUTED, FAINT, WHITE } as const;
