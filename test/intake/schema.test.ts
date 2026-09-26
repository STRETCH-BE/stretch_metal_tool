/**
 * Zod schemas of the part actions and routes (lib/parts/schema.ts):
 * lenient stored-annotation reader, quick-part form, triage answers,
 * route bodies.
 * File path: /test/intake/schema.test.ts
 */
import { describe, expect, it } from "vitest";
import { EMPTY_ANNOTATIONS } from "@/lib/geometry/types";
import {
  annotationsSchema,
  bendParamsSchema,
  completeBodySchema,
  parseStoredAnnotations,
  quickPartFormSchema,
  quickPartInputFrom,
  signBodySchema,
  threadSizeSchema,
  toleranceSchema,
  triageAnswerSchema,
} from "@/lib/parts/schema";

describe("parseStoredAnnotations", () => {
  it("returns the empty object for {} / null / junk and keeps valid fields of a partial row", () => {
    expect(parseStoredAnnotations({})).toEqual(EMPTY_ANNOTATIONS);
    expect(parseStoredAnnotations(null)).toEqual(EMPTY_ANNOTATIONS);
    expect(parseStoredAnnotations("x")).toEqual(EMPTY_ANNOTATIONS);
    const partial = parseStoredAnnotations({ threads: { a: "M8", b: null }, forming: "bent", bends: "broken", scale: { factor: -1 } });
    expect(partial.threads).toEqual({ a: "M8", b: null });
    expect(partial.forming).toBe("bent");
    expect(partial.bends).toEqual([]);
    expect(partial.scale).toBeNull();
  });

  it("annotationsSchema accepts the empty annotations and rejects a wrong role", () => {
    expect(annotationsSchema.safeParse(EMPTY_ANNOTATIONS).success).toBe(true);
    expect(annotationsSchema.safeParse({ ...EMPTY_ANNOTATIONS, entities: { e: { role: "magic" } } }).success).toBe(false);
  });
});

describe("quick part form", () => {
  it("validates and maps to the engine input", () => {
    const parsed = quickPartFormSchema.safeParse({
      name: " Bracket ",
      lengthMm: 200,
      widthMm: 120,
      thicknessMm: 3,
      materialCode: null,
      holes: [{ diameterMm: 6.647, count: 4 }],
      bends: [{ lengthMm: 120, angleDeg: 90, count: 2 }],
      roll: null,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.name).toBe("Bracket");
    const input = quickPartInputFrom(parsed.data, 7850, 10);
    expect(input).toMatchObject({ name: "Bracket", densityKgM3: 7850, blankMarginMm: 10, roll: null });
    expect(input.holes).toEqual([{ diameterMm: 6.647, count: 4 }]);
  });

  it("rejects zero sizes, fractional counts and out-of-range angles", () => {
    const ok = { name: "a", lengthMm: 1, widthMm: 1, thicknessMm: 1, materialCode: null, holes: [], bends: [], roll: null };
    expect(quickPartFormSchema.safeParse({ ...ok, lengthMm: 0 }).success).toBe(false);
    expect(quickPartFormSchema.safeParse({ ...ok, holes: [{ diameterMm: 5, count: 1.5 }] }).success).toBe(false);
    expect(quickPartFormSchema.safeParse({ ...ok, bends: [{ lengthMm: 10, angleDeg: 180, count: 1 }] }).success).toBe(false);
    expect(quickPartFormSchema.safeParse({ ...ok, name: "" }).success).toBe(false);
  });
});

describe("small schemas", () => {
  it("triage answers, bend params, thread sizes, tolerance", () => {
    expect(triageAnswerSchema.safeParse({ kind: "candidates", role: "bend_up" }).success).toBe(true);
    expect(triageAnswerSchema.safeParse({ kind: "candidates", role: "weld" }).success).toBe(false);
    expect(triageAnswerSchema.safeParse({ kind: "units", confirmed: false }).success).toBe(false);
    expect(triageAnswerSchema.safeParse({ kind: "forming", value: "rolled" }).success).toBe(true);
    expect(bendParamsSchema.safeParse({ angleDeg: 90, radiusMm: null, direction: "down" }).success).toBe(true);
    expect(bendParamsSchema.safeParse({ angleDeg: 0, radiusMm: null, direction: "down" }).success).toBe(false);
    expect(threadSizeSchema.safeParse("M10x1").success).toBe(true);
    expect(threadSizeSchema.safeParse("m8").success).toBe(true);
    expect(threadSizeSchema.safeParse(null).success).toBe(true);
    expect(threadSizeSchema.safeParse("banana").success).toBe(false);
    expect(toleranceSchema.safeParse(0.5).success).toBe(true);
    expect(toleranceSchema.safeParse(0.6).success).toBe(false);
    expect(toleranceSchema.safeParse(0.001).success).toBe(false);
  });

  it("route bodies", () => {
    const quoteId = "11111111-1111-4111-8111-111111111111";
    expect(signBodySchema.safeParse({ quoteId, fileName: "a.dxf", size: 10 }).success).toBe(true);
    expect(signBodySchema.safeParse({ quoteId: "nope", fileName: "a.dxf", size: 10 }).success).toBe(false);
    expect(signBodySchema.safeParse({ quoteId, fileName: "", size: 10 }).success).toBe(false);
    expect(
      completeBodySchema.safeParse({ quoteId, fileId: quoteId, path: `quotes/${quoteId}/${quoteId}/a.dxf`, originalName: "a.dxf", size: 10 }).success
    ).toBe(true);
  });
});
