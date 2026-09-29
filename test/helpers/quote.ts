/**
 * Test fixture — PricingPart / PricingItem / QuoteInput builders with sane
 * defaults, so a test only spells out what it is about.
 * File path: /test/helpers/quote.ts
 */

import type { PartGeometry } from "@/lib/geometry/types";
import type { AssemblySeam, FormingOperation, PricingAssembly, PricingItem, PricingPart, QuoteInput } from "@/lib/pricing/types";
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

/* ─── Assembly mode (docs/assembly-mode-design.md) ────────── */

/** A welded assembly with sane defaults (qty 1, S235 3 mm, no seams). */
export function makeAssembly(overrides: Partial<PricingAssembly> = {}): PricingAssembly {
  return {
    id: "asm-1",
    position: 0,
    name: "Assembly",
    drawingRef: null,
    qty: 1,
    materialCode: "S235",
    thicknessMm: 3,
    seams: [],
    ...overrides,
  };
}

/** A continuous MIG seam of 1 000 mm, one side, counted (not paired). */
export function makeSeam(overrides: Partial<AssemblySeam> = {}): AssemblySeam {
  return {
    id: "seam-1",
    label: null,
    partId: null,
    lengthMm: 1000,
    process: "mig_mag",
    thicknessMm: null,
    type: "continuous",
    stitch: null,
    tackCount: null,
    sides: 1,
    pairedSeamId: null,
    ...overrides,
  };
}

/** A forming operation: a roll (inside R90 over 180°, width 247) by default; pass kind "bend" for a bend op. */
export function makeForming(overrides: Partial<Extract<FormingOperation, { kind: "roll" }>> & { kind?: "roll" }): FormingOperation;
export function makeForming(overrides: Partial<Extract<FormingOperation, { kind: "bend" }>> & { kind: "bend" }): FormingOperation;
export function makeForming(overrides: Partial<FormingOperation> = {}): FormingOperation {
  if (overrides.kind === "bend") {
    return { id: "form-1", kind: "bend", bends: 1, angleDeg: 90, lengthMm: 300, resolution: null, ...overrides };
  }
  const roll = overrides as Partial<Extract<FormingOperation, { kind: "roll" }>>;
  return { id: "form-1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: null, ...roll };
}
