/**
 * Archivo fonts for @react-pdf/renderer — registered once per process
 * from base64 data URLs embedded in lib/pdf/fonts-data.ts (generated
 * from /public/fonts/pdf by scripts/generate-pdf-fonts.mjs). SERVER ONLY.
 * File path: /lib/pdf/fonts.ts
 *
 * Why data URLs instead of file paths: on Vercel a function only sees the
 * files the build tracer shipped, and a missing TTF fails the whole quote
 * PDF (download and send). Embedding the fonts in the bundle removes that
 * dependency entirely; next.config.ts still traces the TTFs for the PDF
 * route as belt and braces, and the files stay in /public for the README
 * and for anyone who wants to inspect them.
 *
 * react-pdf cannot drive variable-font axes, so the "expanded" industrial
 * look (Archivo wdth 125) is a second family, "ArchivoExpanded", with
 * Bold (eyebrows) and Black (headings, wordmark) instances. Hyphenation is
 * disabled: part names, numbers and IBANs must never be split.
 */

import { Font } from "@react-pdf/renderer";
import {
  ArchivoBold,
  ArchivoExpandedBlack,
  ArchivoExpandedBold,
  ArchivoMedium,
  ArchivoRegular,
} from "./fonts-data";

export const PDF_FONT_BODY = "Archivo";
export const PDF_FONT_DISPLAY = "ArchivoExpanded";

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: PDF_FONT_BODY,
    fonts: [
      { src: ArchivoRegular.dataUrl, fontWeight: 400 },
      { src: ArchivoMedium.dataUrl, fontWeight: 500 },
      { src: ArchivoBold.dataUrl, fontWeight: 700 },
    ],
  });
  Font.register({
    family: PDF_FONT_DISPLAY,
    fonts: [
      { src: ArchivoExpandedBold.dataUrl, fontWeight: 700 },
      { src: ArchivoExpandedBlack.dataUrl, fontWeight: 900 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
