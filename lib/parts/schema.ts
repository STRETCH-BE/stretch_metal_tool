/**
 * Zod schemas for everything the part actions and intake routes accept
 * from the browser: annotations, quick-part form, triage answers, bend
 * params, material, quantity, tolerance, file-route bodies.
 * File path: /lib/parts/schema.ts
 *
 * Pure (no Next/Supabase). Two flavours for annotations:
 *   - `annotationsSchema` — strict shape for what the viewer sends;
 *   - `parseStoredAnnotations(json)` — lenient reader for parts.annotations
 *     rows (an empty `{}` default or an older shape falls back field by
 *     field to EMPTY_ANNOTATIONS instead of failing the whole page).
 * Numeric bounds are sanity limits (a 20 m part, 200 mm sheet), not
 * business rules — feasibility lives in lib/pricing.
 */

import { z } from "zod";
import { EMPTY_ANNOTATIONS, type PartAnnotations, type QuickPartInput } from "@/lib/geometry/types";
import { DEFAULT_TOLERANCE_MM, MAX_TOLERANCE_MM } from "@/lib/geometry/heal";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidSchema = z.string().regex(UUID_RE);

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* ─── Annotations ─────────────────────────────────────────── */

const pointSchema = z.object({ x: z.number(), y: z.number() });

export const entityRoleSchema = z.enum(["cut", "hole", "bend_up", "bend_down", "weld", "engrave", "ignore", "unknown"]);

export const bendAnnotationSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().nullable(),
  start: pointSchema,
  end: pointSchema,
  lengthMm: z.number().min(0),
  angleDeg: z.number().min(0).max(180),
  radiusMm: z.number().min(0).nullable(),
  direction: z.enum(["up", "down"]),
  dieVMm: z.number().min(0).nullable(),
});

export const weldAnnotationSchema = z.object({
  id: z.string().min(1),
  entityIds: z.array(z.string()),
  points: z.array(pointSchema).nullable(),
  lengthMm: z.number().min(0),
  process: z.enum(["mig_mag", "tig", "laser", "mma"]),
  beadMm: z.number().min(0),
  pattern: z.enum(["full", "stitch"]),
  stitch: z.object({ beadLengthMm: z.number().min(0), pitchMm: z.number().positive() }).nullable(),
  sides: z.union([z.literal(1), z.literal(2)]),
  effectiveLengthMm: z.number().min(0),
});

export const rollAnnotationSchema = z.object({
  radiusMm: z.number().min(0),
  axis: z.enum(["x", "y"]),
  arcAngleDeg: z.number().min(0).max(360),
  axisLengthMm: z.number().min(0),
  developedWidthMm: z.number().min(0),
  cone: z
    .object({ innerRadiusMm: z.number().min(0), outerRadiusMm: z.number().min(0), sweepDeg: z.number().min(0).max(360) })
    .nullable(),
});

export const scaleAnnotationSchema = z.object({
  factor: z.number().positive(),
  from: pointSchema,
  to: pointSchema,
  measuredMm: z.number().min(0),
  realMm: z.number().min(0),
});

export const annotationsSchema = z.object({
  version: z.literal(1),
  entities: z.record(z.string(), z.object({ role: entityRoleSchema })),
  bends: z.array(bendAnnotationSchema),
  welds: z.array(weldAnnotationSchema),
  roll: rollAnnotationSchema.nullable(),
  scale: scaleAnnotationSchema.nullable(),
  threads: z.record(z.string(), z.string().nullable()),
  unitsConfirmed: z.boolean(),
  forming: z.enum(["flat", "bent", "rolled"]).nullable(),
  deletedEntityIds: z.array(z.string()),
  mirrored: z.boolean(),
});

/** Lenient reader for a stored parts.annotations value. */
export function parseStoredAnnotations(value: unknown): PartAnnotations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_ANNOTATIONS };
  const raw = value as Record<string, unknown>;
  const pick = <K extends keyof PartAnnotations>(key: K, schema: z.ZodType<PartAnnotations[K]>): PartAnnotations[K] => {
    const parsed = schema.safeParse(raw[key]);
    return parsed.success ? parsed.data : EMPTY_ANNOTATIONS[key];
  };
  return {
    version: 1,
    entities: pick("entities", annotationsSchema.shape.entities),
    bends: pick("bends", annotationsSchema.shape.bends),
    welds: pick("welds", annotationsSchema.shape.welds),
    roll: pick("roll", annotationsSchema.shape.roll),
    scale: pick("scale", annotationsSchema.shape.scale),
    threads: pick("threads", annotationsSchema.shape.threads),
    unitsConfirmed: pick("unitsConfirmed", annotationsSchema.shape.unitsConfirmed),
    forming: pick("forming", annotationsSchema.shape.forming),
    deletedEntityIds: pick("deletedEntityIds", annotationsSchema.shape.deletedEntityIds),
    mirrored: pick("mirrored", annotationsSchema.shape.mirrored),
  };
}

/* ─── Quick part ──────────────────────────────────────────── */

export const quickPartFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  lengthMm: z.number().positive().max(20000),
  widthMm: z.number().positive().max(20000),
  thicknessMm: z.number().positive().max(200),
  materialCode: z.string().trim().min(1).max(40).nullable(),
  holes: z.array(z.object({ diameterMm: z.number().positive().max(5000), count: z.number().int().min(1).max(10000) })).max(50),
  bends: z
    .array(z.object({ lengthMm: z.number().positive().max(20000), angleDeg: z.number().min(1).max(179), count: z.number().int().min(1).max(200) }))
    .max(50),
  roll: z.object({ radiusMm: z.number().positive().max(100000), axisLengthMm: z.number().positive().max(20000) }).nullable(),
});

export type QuickPartForm = z.infer<typeof quickPartFormSchema>;

/** Form → engine input (density and blank margin come from the rates on the server). */
export function quickPartInputFrom(form: QuickPartForm, densityKgM3: number | null, blankMarginMm?: number): QuickPartInput {
  return {
    name: form.name,
    lengthMm: form.lengthMm,
    widthMm: form.widthMm,
    thicknessMm: form.thicknessMm,
    densityKgM3,
    holes: form.holes.map((h) => ({ diameterMm: h.diameterMm, count: h.count })),
    bends: form.bends.map((b) => ({ lengthMm: b.lengthMm, angleDeg: b.angleDeg, count: b.count })),
    roll: form.roll ? { radiusMm: form.roll.radiusMm, axisLengthMm: form.roll.axisLengthMm } : null,
    blankMarginMm,
  };
}

/* ─── Triage answers, bends, threads, material, qty ───────── */

export const candidateRoleSchema = z.enum(["bend_up", "bend_down", "ignore", "cut"]);
export type CandidateRole = z.infer<typeof candidateRoleSchema>;

export const triageAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("candidates"), role: candidateRoleSchema }),
  z.object({ kind: z.literal("units"), confirmed: z.literal(true) }),
  z.object({ kind: z.literal("forming"), value: z.enum(["flat", "bent", "rolled"]) }),
]);
export type TriageAnswer = z.infer<typeof triageAnswerSchema>;

export const bendParamsSchema = z.object({
  angleDeg: z.number().min(1).max(179),
  radiusMm: z.number().min(0).max(1000).nullable(),
  direction: z.enum(["up", "down"]),
});
export type BendParams = z.infer<typeof bendParamsSchema>;

export const threadSizeSchema = z
  .string()
  .trim()
  .regex(/^M\d{1,3}(?:[x×]\d+(?:[.,]\d+)?)?$/i)
  .nullable();

export const materialSchema = z.object({
  materialCode: z.string().trim().min(1).max(40).nullable(),
  thicknessMm: z.number().positive().max(200).nullable(),
});
export type MaterialInput = z.infer<typeof materialSchema>;

export const qtySchema = z.number().int().min(1).max(1_000_000);
export const partNameSchema = z.string().trim().min(1).max(120);
export const toleranceSchema = z.number().min(DEFAULT_TOLERANCE_MM).max(MAX_TOLERANCE_MM);
export const suggestionFieldSchema = z.enum(["material", "thicknessMm", "qty", "threads", "bends", "finish"]);

/* ─── Route bodies ────────────────────────────────────────── */

export const signBodySchema = z.object({
  quoteId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
});

export const completeBodySchema = z.object({
  quoteId: uuidSchema,
  fileId: uuidSchema,
  path: z.string().min(1).max(600),
  originalName: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
});

export const geometryBodySchema = z.object({
  partId: uuidSchema,
  toleranceMm: toleranceSchema.optional(),
});

export const prefillBodySchema = z.object({ partId: uuidSchema });
