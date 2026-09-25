/**
 * Test fixture — PricingPart / PricingItem / QuoteInput builders with sane
 * defaults, so a test only spells out what it is about.
 * File path: /test/helpers/quote.ts
 */

import type { PartGeometry } from "@/lib/geometry/types";
import type { PricingItem, PricingPart, QuoteInput } from "@/lib/pricing/types";
import { makeAnnotations } from "./geometry";

export function makePricingPart(
  overrides: Partial<PricingPart> & { geometry: PartGeometry }
): PricingPart {
  const { geometry } = overrides;
  return {
    id: "part-1",
    name: "Part",
    source: geometry.source,
    materialCode: "S235",
    thicknessMm: geometry.material.thicknessMm,
    annotations: makeAnnotations(),
    ...overrides,
  };
}

export function makeItem(overrides: Partial<PricingItem> & { partId: string }): PricingItem {
  return {
    id: "item-1",
    qty: 1,
    extras: [],
    scrapPct: null,
    ...overrides,
  };
}

export function makeQuoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    type: "fabrication",
    marginPct: 30,
    customerClass: null,
    items: [],
    parts: [],
    weldingOnly: null,
    ...overrides,
  };
}
