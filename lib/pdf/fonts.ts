/**
 * Archivo fonts for @react-pdf/renderer — registered once per process
 * from the static TTF instances in /public/fonts/pdf (see the README
 * there). SERVER ONLY (reads the filesystem).
 * File path: /lib/pdf/fonts.ts
 *
 * react-pdf cannot drive variable-font axes, so the "expanded" industrial
 * look (Archivo wdth 125) is a second family, "ArchivoExpanded", with
 * Bold (eyebrows) and Black (headings, wordmark) instances. Paths are
 * absolute via process.cwd() — the only form react-pdf resolves in a
 * Vercel function (next.config.ts ships the TTFs with the PDF route
 * through outputFileTracingIncludes). Hyphenation is disabled: part
 * names, numbers and IBANs must never be split.
 */

import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const PDF_FONT_BODY = "Archivo";
export const PDF_FONT_DISPLAY = "ArchivoExpanded";

let registered = false;

export function pdfFontDir(): string {
  return path.join(process.cwd(), "public", "fonts", "pdf");
}

export function registerPdfFonts(): void {
  if (registered) return;
  const dir = pdfFontDir();
  Font.register({
    family: PDF_FONT_BODY,
    fonts: [
      { src: path.join(dir, "Archivo-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "Archivo-Medium.ttf"), fontWeight: 500 },
      { src: path.join(dir, "Archivo-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: PDF_FONT_DISPLAY,
    fonts: [
      { src: path.join(dir, "ArchivoExpanded-Bold.ttf"), fontWeight: 700 },
      { src: path.join(dir, "ArchivoExpanded-Black.ttf"), fontWeight: 900 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
