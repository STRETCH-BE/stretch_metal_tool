/**
 * Quote PDF rendering — bundle → Buffer. SERVER ONLY (fonts from disk,
 * react-pdf Node renderer).
 * File path: /lib/pdf/render.ts
 *
 *   renderQuotePdf(bundle, { locale, showOperations?, showAssemblyParts?, preparedBy? }) → Buffer
 *
 * Fonts are registered on first use (lib/pdf/fonts.ts); the layout comes
 * from lib/pdf/quote-document.tsx and every string from
 * lib/pdf/view-model.ts + content/pdf. `now` is injectable so tests can
 * render a deterministic document. `showAssemblyParts` adds the "Parts of
 * assembly …" appendix (members of every welded assembly); off by default
 * because an assembly is one line on the quote. The export guard
 * (lib/quotes/send-guard.ts exportBlockReasons) is the CALLER's job — the
 * PDF route and the send action run it; this function renders whatever it
 * is given (tests render blocked bundles on purpose).
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
  showAssemblyParts?: boolean;
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
    showAssemblyParts: options.showAssemblyParts,
    preparedBy: options.preparedBy,
    now: options.now,
  });
  // react-pdf types renderToBuffer as taking a <Document> element; our
  // component returns one, so the cast only bridges the element type.
  const element = createElement(QuoteDocument, { model, content: content.pdf }) as unknown as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(element);
}
