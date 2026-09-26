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
 */

import { z } from "zod";
import { EMPTY_ANNOTATIONS, type PartAnnotations, type PartGeometry } from "@/lib/geometry/types";
import type { ExtraOperation, PricedQuote, WeldingOnlySeam } from "@/lib/pricing/types";
import type { CurrencyCode, Json, QuoteStatus, QuoteTypeDb } from "@/lib/db/types";
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
export const WELD_PROCESSES = ["mig_mag", "tig", "laser", "mma"] as const;
export const TUBE_FAMILIES = ["round", "square", "rectangular", "open"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

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
});

export function parsePricing(json: Json | null | undefined): PricedQuote | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const result = pricingGuard.safeParse(json);
  return result.success ? (result.data as unknown as PricedQuote) : null;
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
    leadTimeText: optionalText(200),
    paymentTermsText: optionalText(2000),
    notes: optionalText(4000),
    showOperationsOnPdf: z.boolean(),
    weldingSeparate: z.boolean(),
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
