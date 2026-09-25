/**
 * Content aggregator — the ONLY place components import dictionaries from.
 * File path: /content/index.ts
 *
 * Every domain lives in its own file: /content/<domain>.ts holds the
 * Polish dictionary AND the TypeScript type; /content/en/<domain>.ts
 * exports the English dictionary of the same type. Adding a string means
 * adding it to both files — the parity test (content/parity.test.ts)
 * fails when the key sets differ.
 *
 * Server components: `const c = getContent(await getLocale())`.
 * Client components: `useContent()` from components/providers/locale.
 */

import type { Locale } from "@/lib/site-config";

import { common as commonPl, type CommonContent } from "@/content/common";
import { common as commonEn } from "@/content/en/common";
import { upload as uploadPl, type UploadContent } from "@/content/upload";
import { upload as uploadEn } from "@/content/en/upload";
import { viewer as viewerPl, type ViewerContent } from "@/content/viewer";
import { viewer as viewerEn } from "@/content/en/viewer";
import { quote as quotePl, type QuoteContent } from "@/content/quote";
import { quote as quoteEn } from "@/content/en/quote";
import { admin as adminPl, type AdminContent } from "@/content/admin";
import { admin as adminEn } from "@/content/en/admin";
import { guide as guidePl, type GuideContent } from "@/content/guide";
import { guide as guideEn } from "@/content/en/guide";
import { flags as flagsPl, type FlagsContent } from "@/content/flags";
import { flags as flagsEn } from "@/content/en/flags";
import { pdf as pdfPl, type PdfContent } from "@/content/pdf";
import { pdf as pdfEn } from "@/content/en/pdf";

export type Content = {
  locale: Locale;
  common: CommonContent;
  upload: UploadContent;
  viewer: ViewerContent;
  quote: QuoteContent;
  admin: AdminContent;
  guide: GuideContent;
  flags: FlagsContent;
  pdf: PdfContent;
};

const CONTENT: Record<Locale, Content> = {
  pl: {
    locale: "pl",
    common: commonPl,
    upload: uploadPl,
    viewer: viewerPl,
    quote: quotePl,
    admin: adminPl,
    guide: guidePl,
    flags: flagsPl,
    pdf: pdfPl,
  },
  en: {
    locale: "en",
    common: commonEn,
    upload: uploadEn,
    viewer: viewerEn,
    quote: quoteEn,
    admin: adminEn,
    guide: guideEn,
    flags: flagsEn,
    pdf: pdfEn,
  },
};

export function getContent(locale: Locale): Content {
  return CONTENT[locale];
}

export type {
  CommonContent,
  UploadContent,
  ViewerContent,
  QuoteContent,
  AdminContent,
  GuideContent,
  FlagsContent,
  PdfContent,
};
