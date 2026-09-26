/**
 * Quote PDF rendering — bundle → Buffer. SERVER ONLY (fonts from disk,
 * react-pdf Node renderer).
 * File path: /lib/pdf/render.ts
 *
 *   renderQuotePdf(bundle, { locale, showOperations?, preparedBy? }) → Buffer
 *
 * Fonts are registered on first use (lib/pdf/fonts.ts); the layout comes
 * from lib/pdf/quote-document.tsx and every string from
 * lib/pdf/view-model.ts + content/pdf. `now` is injectable so tests can
 * render a deterministic document.
 */

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getContent } from "@/content";
import type { QuoteBundle } from "@/lib/quotes/types";
import type { Locale } from "@/lib/site-config";
import { registerPdfFonts } from "./fonts";
import { QuoteDocument } from "./quote-document";
import { buildPdfViewModel, type PdfViewModel } from "./view-model";

export type RenderQuotePdfOptions = {
  locale: Locale;
  showOperations?: boolean;
  preparedBy?: string | null;
  now?: Date;
};

export async function renderQuotePdf(bundle: QuoteBundle, options: RenderQuotePdfOptions): Promise<Buffer> {
  registerPdfFonts();
  const content = getContent(options.locale);
  const model: PdfViewModel = buildPdfViewModel(bundle, {
    locale: options.locale,
    content,
    showOperations: options.showOperations,
    preparedBy: options.preparedBy,
    now: options.now,
  });
  // react-pdf types renderToBuffer as taking a <Document> element; our
  // component returns one, so the cast only bridges the element type.
  const element = createElement(QuoteDocument, { model, content: content.pdf }) as unknown as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(element);
}
