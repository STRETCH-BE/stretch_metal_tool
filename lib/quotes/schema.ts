/**
 * Quote input contracts — zod guards for the JSON columns the pricing glue
 * reads (parts.geometry / annotations, quote_items.extras,
 * quotes.welding_only, quotes.pricing) and for every server-action input
 * (header form, item edits, seams, override requests).
 * File path: /lib/quotes/schema.ts
 *
 * Kept out of the "use server" file (those may export only async
 * functions) and free of Next/Supabase so the builder client, the mapper
 * and the tests share it. Validation messages are CODES (keys of
 * content.quote.errors), never copy.
 *
 * The geometry / annotations guards are deliberately LIGHT: they check the
 * keys the engine dereferences (version, entities, loops, measures,
 * material, triage) and pass the rest through (`looseObject`), because the
 * geometry engine owns that contract and re-validating every entity here
 * would duplicate it. A part whose geometry fails the guard is priced as
 * "no geometry" (red geometry flags) rather than crashing the whole quote.
 * Annotations are merged over EMPTY_ANNOTATIONS so a stored `{}` (the
 * column default) is a valid, empty annotation set.
 *
 * Assembly mode (docs/assembly-mode-design.md §2, §5): the stored
 * `quote_items.forming` and `quotes.shipping` JSON get the same tolerant
 * treatment (parseForming drops malformed operations, parseShipping
 * returns null), the seam / assembly / member action inputs are validated
 * here, and the header gains customer reference, contact person, shipping
 * and price scale. Header text fields added in that round are "keep when
 * omitted" (undefined = leave the column alone, null = clear it) so a
 * client that still posts the old header shape does not erase them. The
 * price scale is NORMALISED (deduplicated, sorted ascending) rather than
 * rejected for order — the user types "100, 50" and means both.
 */

import { z } from "zod";
import { EMPTY_ANNOTATIONS, type PartAnnotations, type PartGeometry } from "@/lib/geometry/types";
import type { ExtraOperation, FormingOperation, FormingResolution, PricedQuote, ShippingInput, WeldingOnlySeam } from "@/lib/pricing/types";
import type { WeldProcess } from "@/lib/geometry/types";
import type { CurrencyCode, Json, QuoteStatus, QuoteTypeDb, SeamTypeDb } from "@/lib/db/types";
import type { WeldingOnlyBlock } from "./types";

/* ─── Error codes ─────────────────────────────────────────── */

export type QuoteErrorCode =
  | "required"
  | "invalid"
  | "tooLong"
  | "invalidNumber"
  | "invalidQty"
  | "invalidMargin"
  | "invalidFx"
  | "invalidCurrency"
  | "invalidType"
  | "invalidStatus"
  | "notFound"
  | "forbidden"
  | "locked"
  | "noRates"
  | "pricing"
  | "config"
  | "cannotSend"
  | "mail"
  | "generic";

export type QuoteActionResult =
  | { ok: true }
  | { ok: false; error: QuoteErrorCode; message?: string };

export const OK: QuoteActionResult = { ok: true };

export function fail(error: QuoteErrorCode, message?: string): QuoteActionResult {
  return message ? { ok: false, error, message } : { ok: false, error };
}

/* ─── Shared primitives ───────────────────────────────────── */

const finite = z.number().refine((v) => Number.isFinite(v), "invalidNumber");
const nonNegative = finite.min(0, "invalidNumber");
const positive = finite.gt(0, "invalidNumber");
const positiveInt = z.number().int("invalidQty").gt(0, "invalidQty");
const nonNegativeInt = z.number().int("invalidNumber").min(0, "invalidNumber");

export const CURRENCIES = ["PLN", "EUR"] as const satisfies readonly CurrencyCode[];
export const QUOTE_TYPES = ["fabrication", "welding_only"] as const satisfies readonly QuoteTypeDb[];
export const QUOTE_STATUSES = ["draft", "pending_override", "sent", "won", "lost"] as const satisfies readonly QuoteStatus[];
export const WELD_PROCESSES = ["mig_mag", "tig", "laser", "mma"] as const satisfies readonly WeldProcess[];
export const TUBE_FAMILIES = ["round", "square", "rectangular", "open"] as const;
export const SEAM_TYPES = ["continuous", "stitch", "tack"] as const satisfies readonly SeamTypeDb[];
/** Longest price scale (extra quantities per item / assembly) a quote may carry. */
export const PRICE_SCALE_MAX = 12;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Like optionalText, but an OMITTED field stays undefined (= keep the stored value); null / "" clear it. */
const optionalTextKeep = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/* ─── Stored JSON guards ──────────────────────────────────── */

const point = z.object({ x: finite, y: finite });
const bbox = z.looseObject({
  minX: finite,
  minY: finite,
  maxX: finite,
  maxY: finite,
  width: finite,
  height: finite,
});

/** Light guard: the keys the pricing engine dereferences on PartGeometry. */
export const geometryGuard = z.looseObject({
  version: z.literal(1),
  source: z.enum(["dxf", "manual", "welding_drawing", "step", "pdf"]),
  entities: z.array(z.looseObject({ id: z.string(), role: z.string(), segments: z.array(z.unknown()) })),
  loops: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
  outerLoopId: z.string().nullable(),
  measures: z.looseObject({
    cutLengthMm: finite,
    pierces: finite,
    bbox,
    blank: z.looseObject({ lengthMm: finite, widthMm: finite, marginMm: finite }),
    netAreaMm2: finite,
    massKg: finite.nullable(),
    holes: z.array(z.unknown()),
    bendLines: z.array(z.unknown()),
    slowContours: z.array(z.unknown()),
    engraveLengthMm: finite,
  }),
  triage: z.looseObject({ state: z.string(), reasons: z.array(z.string()) }),
  material: z.looseObject({ thicknessMm: finite.nullable(), densityKgM3: finite.nullable() }),
});

/** Stored geometry JSON → PartGeometry, or null when missing/malformed. */
export function parseGeometry(json: Json | null | undefined): PartGeometry | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const result = geometryGuard.safeParse(json);
  return result.success ? (result.data as unknown as PartGeometry) : null;
}

const stitch = z.object({ beadLengthMm: nonNegative, pitchMm: positive }).nullable();

const weldAnnotation = z.looseObject({
  id: z.string(),
  entityIds: z.array(z.string()).default([]),
  points: z.array(point).nullable().default(null),
  lengthMm: nonNegative,
  process: z.enum(WELD_PROCESSES),
  beadMm: nonNegative,
  pattern: z.enum(["full", "stitch"]),
  stitch,
  sides: z.union([z.literal(1), z.literal(2)]),
  effectiveLengthMm: nonNegative,
});

const bendAnnotation = z.looseObject({
  id: z.string(),
  entityId: z.string().nullable().default(null),
  start: point,
  end: point,
  lengthMm: finite,
  angleDeg: finite,
  radiusMm: nonNegative.nullable().default(null),
  direction: z.enum(["up", "down"]),
  dieVMm: nonNegative.nullable().default(null),
});

const rollAnnotation = z
  .looseObject({
    radiusMm: nonNegative,
    axis: z.enum(["x", "y"]),
    arcAngleDeg: finite,
    axisLengthMm: nonNegative,
    developedWidthMm: nonNegative,
    cone: z
      .object({ innerRadiusMm: nonNegative, outerRadiusMm: nonNegative, sweepDeg: finite })
      .nullable()
      .default(null),
  })
  .nullable();

export const annotationsGuard = z.looseObject({
  version: z.literal(1).default(1),
  entities: z.record(z.string(), z.object({ role: z.string() })).default({}),
  bends: z.array(bendAnnotation).default([]),
  welds: z.array(weldAnnotation).default([]),
  roll: rollAnnotation.default(null),
  scale: z.unknown().nullable().default(null),
  threads: z.record(z.string(), z.string().nullable()).default({}),
  unitsConfirmed: z.boolean().default(false),
  forming: z.enum(["flat", "bent", "rolled"]).nullable().default(null),
  deletedEntityIds: z.array(z.string()).default([]),
  mirrored: z.boolean().default(false),
  reliefFix: z.boolean().optional(),
});

/** Stored annotations JSON → PartAnnotations (missing keys filled from EMPTY_ANNOTATIONS). */
export function parseAnnotations(json: Json | null | undefined): PartAnnotations {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ...EMPTY_ANNOTATIONS };
  const result = annotationsGuard.safeParse(json);
  if (!result.success) return { ...EMPTY_ANNOTATIONS };
  return { ...EMPTY_ANNOTATIONS, ...(result.data as unknown as PartAnnotations) };
}

/* ─── Extras (quote_items.extras) ─────────────────────────── */

export const extraOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("machining"), minutes: nonNegative, note: optionalText(200) }),
  z.object({ type: z.literal("feature"), code: z.string().trim().min(1, "required").max(40, "tooLong"), count: positiveInt }),
  z.object({
    type: z.literal("finish"),
    code: z.string().trim().min(1, "required").max(40, "tooLong"),
    maskingMinutes: nonNegative,
    note: optionalText(200),
    /** Colour of the finish where it matters (powder coating "RAL 9005"); absent on lines saved before v3. */
    colour: optionalText(40).optional(),
  }),
  z.object({
    type: z.literal("tube_cut"),
    profileFamily: z.enum(TUBE_FAMILIES),
    wallMm: nonNegative,
    cutLengthMm: nonNegative,
    metres: nonNegative,
    pricePerMTube: nonNegative.nullable(),
    envelopeMm: nonNegative.nullable().optional(),
    circumscribedMm: nonNegative.nullable().optional(),
    kgPerM: nonNegative.nullable().optional(),
  }),
  z.object({ type: z.literal("other"), label: z.string().trim().min(1, "required").max(120, "tooLong"), unitCost: nonNegative }),
  z.object({ type: z.literal("handling"), unitCost: nonNegative }),
]);

export const extrasSchema = z.array(extraOperationSchema).max(50, "tooLong");

/** Stored extras JSON → ExtraOperation[] (malformed entries are dropped, never crash a quote). */
export function parseExtras(json: Json | null | undefined): ExtraOperation[] {
  if (!Array.isArray(json)) return [];
  const out: ExtraOperation[] = [];
  for (const entry of json) {
    const result = extraOperationSchema.safeParse(entry);
    if (result.success) out.push(result.data as ExtraOperation);
  }
  return out;
}

/* ─── Welding-only block (quotes.welding_only) ────────────── */

export const weldingSeamSchema = z.object({
  id: z.string().trim().min(1, "required").max(80, "tooLong"),
  label: z.string().trim().max(120, "tooLong").default(""),
  process: z.enum(WELD_PROCESSES),
  beadMm: nonNegative,
  lengthMm: nonNegative,
  pattern: z.enum(["full", "stitch"]),
  stitch,
  sides: z.union([z.literal(1), z.literal(2)]),
  qty: positiveInt,
});

export const weldingOnlySchema = z.object({
  seams: z.array(weldingSeamSchema).max(200, "tooLong"),
  partsCount: nonNegativeInt,
});

export function parseWeldingOnly(json: Json | null | undefined): WeldingOnlyBlock | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const result = weldingOnlySchema.safeParse(json);
  if (!result.success) return null;
  return { seams: result.data.seams as WeldingOnlySeam[], partsCount: result.data.partsCount };
}

/* ─── Forming operations (quote_items.forming) ────────────── */

const formingId = z.string().trim().min(1, "required").max(80, "tooLong");

export const formingResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("in_house") }),
  z.object({ kind: z.literal("step_bend"), hits: positiveInt.max(10_000, "invalidQty") }),
  z.object({
    kind: z.literal("subcontract"),
    supplier: z.string().trim().min(1, "required").max(120, "tooLong"),
    costEur: nonNegative,
    extraLeadDays: nonNegativeInt.max(365, "invalidNumber"),
  }),
  z.object({ kind: z.literal("none_needed") }),
]);

/** One stored forming operation (id required). */
export const formingOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    id: formingId,
    kind: z.literal("roll"),
    insideRadiusMm: nonNegative,
    angleDeg: nonNegative.max(360, "invalidNumber"),
    widthMm: nonNegative,
    resolution: formingResolutionSchema.nullable().default(null),
  }),
  z.object({
    id: formingId,
    kind: z.literal("bend"),
    bends: nonNegativeInt.max(10_000, "invalidQty"),
    angleDeg: nonNegative.max(360, "invalidNumber"),
    lengthMm: nonNegative,
    resolution: formingResolutionSchema.nullable().default(null),
  }),
]);

/** Action input: the same operations, ids optional (the action generates missing ones). */
export const formingOperationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    id: formingId.optional(),
    kind: z.literal("roll"),
    insideRadiusMm: nonNegative,
    angleDeg: nonNegative.max(360, "invalidNumber"),
    widthMm: nonNegative,
    resolution: formingResolutionSchema.nullable().optional(),
  }),
  z.object({
    id: formingId.optional(),
    kind: z.literal("bend"),
    bends: nonNegativeInt.max(10_000, "invalidQty"),
    angleDeg: nonNegative.max(360, "invalidNumber"),
    lengthMm: nonNegative,
    resolution: formingResolutionSchema.nullable().optional(),
  }),
]);

export const formingInputSchema = z.array(formingOperationInputSchema).max(50, "tooLong");

export type FormingOperationInput = z.input<typeof formingOperationInputSchema>;

/** Stored forming JSON → FormingOperation[] (malformed entries are dropped, never crash a quote). */
export function parseForming(json: Json | null | undefined): FormingOperation[] {
  if (!Array.isArray(json)) return [];
  const out: FormingOperation[] = [];
  for (const entry of json) {
    const result = formingOperationSchema.safeParse(entry);
    if (result.success) out.push(result.data as FormingOperation);
  }
  return out;
}

export function parseFormingResolution(value: unknown): FormingResolution | null {
  const result = formingResolutionSchema.safeParse(value);
  return result.success ? (result.data as FormingResolution) : null;
}

/* ─── Shipping (quotes.shipping) ──────────────────────────── */

const countryCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), "invalid");

export const shippingInputSchema = z.object({
  countryCode,
  grossKg: nonNegative.max(100_000, "invalidNumber").nullable().default(null),
  costEur: nonNegative.nullable().default(null),
  source: z.enum(["manual", "table"]).default("table"),
  carrier: optionalText(80),
  extraLeadDays: nonNegativeInt.max(365, "invalidNumber").default(0),
});

export type ShippingInputValues = z.input<typeof shippingInputSchema>;

/** Stored shipping JSON → ShippingInput, or null when missing/malformed. */
export function parseShipping(json: Json | null | undefined): ShippingInput | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const result = shippingInputSchema.safeParse(json);
  return result.success ? (result.data as ShippingInput) : null;
}

/* ─── Price scale (quotes.price_scale) ────────────────────── */

/** Positive integer quantities; deduplicated and sorted ascending; at most PRICE_SCALE_MAX distinct values. */
export const priceScaleSchema = z
  .array(positiveInt.max(1_000_000, "invalidQty"))
  .max(100, "tooLong")
  .transform((list) => normalisePriceScale(list))
  .refine((list) => list.length <= PRICE_SCALE_MAX, "tooLong");

/** Keeps the positive integers, deduplicates and sorts ascending (stored rows may hold anything). */
export function normalisePriceScale(values: ReadonlyArray<unknown> | null | undefined): number[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<number>();
  for (const v of values) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/* ─── Pricing snapshot (quotes.pricing) ───────────────────── */

const pricingGuard = z.looseObject({
  items: z.array(z.looseObject({ itemId: z.string(), partId: z.string(), operations: z.array(z.unknown()) })),
  welding: z.unknown().nullable(),
  totalsByType: z.record(z.string(), z.unknown()),
  subtotalCost: finite,
  subtotalPrice: finite,
  marginPct: finite,
  markupPct: finite,
  flags: z.array(z.unknown()),
  usesPlaceholderRates: z.boolean(),
  rateVersionId: z.string(),
  /** Absent in snapshots stored before the engine was versioned → 0 (stale). */
  engineVersion: z.number().optional(),
});

export function parsePricing(json: Json | null | undefined): PricedQuote | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const result = pricingGuard.safeParse(json);
  if (!result.success) return null;
  const stored = result.data as unknown as PricedQuote;
  // Snapshots stored before market mode existed carry none of these fields;
  // older ones also lack inputMarginPct, which then defaults to marginPct
  // (exact for a cost snapshot; a legacy market snapshot reads as stale once
  // and is re-priced on open, which writes the field). engineVersion 0 marks
  // a pricing older than the versioned engine: stale for the same reason.
  const defaults: Pick<PricedQuote, "pricingMode" | "costRateVersionId" | "leadTimeDays" | "leadTimeMultiplier" | "quoteLines" | "inputMarginPct" | "engineVersion" | "assemblies" | "shipping" | "vat" | "priceScale"> = {
    engineVersion: 0,
    assemblies: [],
    shipping: null,
    vat: null,
    priceScale: [],
    pricingMode: "cost",
    costRateVersionId: null,
    leadTimeDays: null,
    leadTimeMultiplier: 1,
    quoteLines: [],
    inputMarginPct: stored.marginPct,
  };
  return { ...defaults, ...stored };
}

const flagGuard = z.looseObject({
  code: z.string(),
  severity: z.enum(["green", "amber", "red"]),
  partId: z.string().nullable(),
  itemId: z.string().nullable(),
  params: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  overridable: z.boolean(),
});

export function parseFlags(json: Json | null | undefined): PricedQuote["flags"] {
  if (!Array.isArray(json)) return [];
  const out: PricedQuote["flags"] = [];
  for (const entry of json) {
    const result = flagGuard.safeParse(entry);
    if (result.success) out.push(result.data as unknown as PricedQuote["flags"][number]);
  }
  return out;
}

/* ─── Server-action inputs ────────────────────────────────── */

/**
 * Currency ↔ fx sanity rule shared by the header and the new-quote form:
 * a PLN quote must carry a real EUR→PLN rate. The rate tables are EUR and
 * `fx_rate` multiplies them, so a PLN quote saved with the EUR sentinel
 * (1) would ship at roughly a quarter of the price. 1 EUR has been worth
 * more than 1 PLN for the whole life of the currency, so "> 1" is a
 * sanity bound, not a business constant. EUR quotes ignore the field
 * (the actions store 1).
 */
export function fxRateValidFor(currency: CurrencyCode, fxRate: number): boolean {
  return currency === "EUR" || fxRate > 1;
}

const fxMatchesCurrency = { message: "invalidFx", path: ["fxRate"] as (string | number)[] };

export const quoteHeaderSchema = z
  .object({
    customerId: z.string().uuid("invalid").nullable(),
    currency: z.enum(CURRENCIES, "invalidCurrency"),
    fxRate: finite.gt(0, "invalidFx").max(1000, "invalidFx"),
    marginPct: finite.min(0, "invalidMargin").lt(100, "invalidMargin"),
    validityDays: z.number().int("invalidNumber").min(1, "invalidNumber").max(365, "invalidNumber"),
    /** Promised lead time in working days (market mode: rate_leadtime multiplier). */
    leadTimeDays: z.number().int("invalidNumber").min(1, "invalidNumber").max(365, "invalidNumber"),
    leadTimeText: optionalText(200),
    paymentTermsText: optionalText(2000),
    notes: optionalText(4000),
    showOperationsOnPdf: z.boolean(),
    weldingSeparate: z.boolean(),
    /** Assembly mode: omitted = keep the stored value (an old client posting the old shape changes nothing). */
    customerReference: optionalTextKeep(120),
    contactPerson: optionalTextKeep(200),
    shipping: shippingInputSchema.nullable().optional(),
    priceScale: priceScaleSchema.optional(),
  })
  .refine((v) => fxRateValidFor(v.currency, v.fxRate), fxMatchesCurrency);

export type QuoteHeaderInput = z.input<typeof quoteHeaderSchema>;

export const newQuoteSchema = z
  .object({
    type: z.enum(QUOTE_TYPES, "invalidType"),
    customerId: z.string().uuid("invalid").nullable(),
    currency: z.enum(CURRENCIES, "invalidCurrency"),
    fxRate: finite.gt(0, "invalidFx").max(1000, "invalidFx"),
    marginPct: finite.min(0, "invalidMargin").lt(100, "invalidMargin").nullable(),
    validityDays: z.number().int("invalidNumber").min(1, "invalidNumber").max(365, "invalidNumber"),
    leadTimeText: optionalText(200),
    paymentTermsText: optionalText(2000),
    notes: optionalText(4000),
  })
  .refine((v) => fxRateValidFor(v.currency, v.fxRate), fxMatchesCurrency);

export type NewQuoteInput = z.input<typeof newQuoteSchema>;

export const itemUpdateSchema = z.object({
  qty: positiveInt.max(1_000_000, "invalidQty").optional(),
  extras: extrasSchema.optional(),
  scrapPct: nonNegative.max(500, "invalidNumber").nullable().optional(),
  notes: optionalText(1000).optional(),
});

export type ItemUpdateInput = z.input<typeof itemUpdateSchema>;

/* ─── Assembly mode action inputs ─────────────────────────── */

export const assemblyInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(200, "tooLong"),
  drawingRef: optionalText(120),
  qty: positiveInt.max(1_000_000, "invalidQty"),
  materialCode: optionalText(40),
  thicknessMm: positive.max(1000, "invalidNumber").nullable().optional().transform((v) => v ?? null),
  notes: optionalText(2000),
});

export const assemblyUpdateSchema = z.object({
  name: z.string().trim().min(1, "required").max(200, "tooLong").optional(),
  drawingRef: optionalTextKeep(120),
  qty: positiveInt.max(1_000_000, "invalidQty").optional(),
  materialCode: optionalTextKeep(40),
  thicknessMm: positive.max(1000, "invalidNumber").nullable().optional(),
  notes: optionalTextKeep(2000),
});

/** createAssembly input (the exact shape the builder posts). */
export type AssemblyInput = {
  name: string;
  drawingRef?: string | null;
  qty: number;
  materialCode?: string | null;
  thicknessMm?: number | null;
  notes?: string | null;
};

export const itemAssemblySchema = z.object({
  assemblyId: z.string().uuid("invalid").nullable(),
  qtyPerAssembly: positiveInt.max(100_000, "invalidQty").optional(),
});

export const itemMaterialOverrideSchema = z.object({
  materialOverride: z.boolean(),
  materialNote: optionalText(500),
});

/** A seam of a welded assembly as the builder / viewer posts it (addSeam, addSeamFromPart; Partial for updateSeam). */
export type SeamInput = {
  label?: string | null;
  partId?: string | null;
  entityIds?: string[];
  points?: { x: number; y: number }[] | null;
  lengthMm: number;
  process: WeldProcess;
  thicknessMm?: number | null;
  seamType: "continuous" | "stitch" | "tack";
  stitchBeadMm?: number | null;
  stitchPitchMm?: number | null;
  tackCount?: number | null;
  sides?: 1 | 2;
};

const seamInputBase = z.object({
  label: optionalText(120),
  partId: z.string().uuid("invalid").nullable().optional().transform((v) => v ?? null),
  entityIds: z.array(z.string().trim().min(1, "required").max(80, "tooLong")).max(500, "tooLong").default([]),
  points: z.array(point).max(2000, "tooLong").nullable().optional().transform((v) => v ?? null),
  lengthMm: nonNegative.max(1_000_000, "invalidNumber"),
  process: z.enum(WELD_PROCESSES, "invalid"),
  thicknessMm: positive.max(1000, "invalidNumber").nullable().optional().transform((v) => v ?? null),
  seamType: z.enum(SEAM_TYPES, "invalid"),
  stitchBeadMm: positive.nullable().optional().transform((v) => v ?? null),
  stitchPitchMm: positive.nullable().optional().transform((v) => v ?? null),
  tackCount: nonNegativeInt.max(100_000, "invalidQty").nullable().optional().transform((v) => v ?? null),
  sides: z.union([z.literal(1), z.literal(2)], "invalid").default(1),
});

/**
 * Full seam: a stitch seam needs its bead and pitch, a tack seam its tack
 * count (both "required"); the fields of the other patterns are ignored by
 * the engine but kept as typed.
 */
export const seamInputSchema = seamInputBase.superRefine((v, ctx) => {
  if (v.seamType === "stitch" && (v.stitchBeadMm === null || v.stitchPitchMm === null)) {
    ctx.addIssue({ code: "custom", message: "required", path: [v.stitchBeadMm === null ? "stitchBeadMm" : "stitchPitchMm"] });
  }
  if (v.seamType === "tack" && v.tackCount === null) {
    ctx.addIssue({ code: "custom", message: "required", path: ["tackCount"] });
  }
});

/**
 * updateSeam patch: every field optional and WITHOUT defaults (zod's
 * .partial() would still fill entityIds [] / sides 1 and reset the stored
 * values); the action merges the defined keys over the stored row and
 * re-validates the result with seamInputSchema.
 */
export const seamPatchSchema = z.object({
  label: optionalTextKeep(120),
  partId: z.string().uuid("invalid").nullable().optional(),
  entityIds: z.array(z.string().trim().min(1, "required").max(80, "tooLong")).max(500, "tooLong").optional(),
  points: z.array(point).max(2000, "tooLong").nullable().optional(),
  lengthMm: nonNegative.max(1_000_000, "invalidNumber").optional(),
  process: z.enum(WELD_PROCESSES, "invalid").optional(),
  thicknessMm: positive.max(1000, "invalidNumber").nullable().optional(),
  seamType: z.enum(SEAM_TYPES, "invalid").optional(),
  stitchBeadMm: positive.nullable().optional(),
  stitchPitchMm: positive.nullable().optional(),
  tackCount: nonNegativeInt.max(100_000, "invalidQty").nullable().optional(),
  sides: z.union([z.literal(1), z.literal(2)], "invalid").optional(),
});

export type SeamInputValues = z.output<typeof seamInputSchema>;

export const overrideRequestSchema = z.object({
  quoteId: z.string().uuid("invalid"),
  flagCode: z.string().trim().min(1, "required").max(80, "tooLong"),
  partId: z.string().uuid("invalid").nullable(),
  itemId: z.string().uuid("invalid").nullable(),
  note: z.string().trim().min(3, "required").max(2000, "tooLong"),
});

export type OverrideRequestInput = z.input<typeof overrideRequestSchema>;

export const decisionStatusSchema = z.enum(["won", "lost"], "invalidStatus");

/** First issue → error code (unknown messages collapse to "invalid"). */
export function firstErrorCode(error: z.ZodError): QuoteErrorCode {
  const message = error.issues[0]?.message;
  const known: readonly QuoteErrorCode[] = [
    "required",
    "invalid",
    "tooLong",
    "invalidNumber",
    "invalidQty",
    "invalidMargin",
    "invalidFx",
    "invalidCurrency",
    "invalidType",
    "invalidStatus",
  ];
  return (known as readonly string[]).includes(message ?? "") ? (message as QuoteErrorCode) : "invalid";
}

/* ─── FormData readers (new-quote form) ───────────────────── */

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** "1 234,56" / "1234.56" → number, "" → null. Mirrors lib/number-input parsing for server use. */
export function formNumber(formData: FormData, key: string): number | null {
  const raw = formString(formData, key).trim();
  if (raw === "") return null;
  const normalised = raw.replace(/[\s ]/g, "").replace(",", ".");
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export type NewQuoteFormValues = {
  type: string;
  customerId: string;
  currency: string;
  fxRate: string;
  marginPct: string;
  validityDays: string;
  leadTimeText: string;
  paymentTermsText: string;
  notes: string;
};

export type NewQuoteFormState = {
  status: "idle" | "error";
  error?: QuoteErrorCode;
  values?: NewQuoteFormValues;
};

export const INITIAL_NEW_QUOTE_STATE: NewQuoteFormState = { status: "idle" };

export function readNewQuoteForm(formData: FormData): NewQuoteFormValues {
  return {
    type: formString(formData, "type"),
    customerId: formString(formData, "customerId"),
    currency: formString(formData, "currency"),
    fxRate: formString(formData, "fxRate"),
    marginPct: formString(formData, "marginPct"),
    validityDays: formString(formData, "validityDays"),
    leadTimeText: formString(formData, "leadTimeText"),
    paymentTermsText: formString(formData, "paymentTermsText"),
    notes: formString(formData, "notes"),
  };
}

export function parseNewQuoteForm(formData: FormData):
  | { ok: true; data: z.output<typeof newQuoteSchema> }
  | { ok: false; error: QuoteErrorCode } {
  const values = readNewQuoteForm(formData);
  const marginPct = formNumber(formData, "marginPct");
  const result = newQuoteSchema.safeParse({
    type: values.type,
    customerId: values.customerId || null,
    currency: values.currency,
    fxRate: formNumber(formData, "fxRate"),
    marginPct: marginPct,
    validityDays: formNumber(formData, "validityDays"),
    leadTimeText: values.leadTimeText,
    paymentTermsText: values.paymentTermsText,
    notes: values.notes,
  });
  if (!result.success) return { ok: false, error: firstErrorCode(result.error) };
  return { ok: true, data: result.data };
}
