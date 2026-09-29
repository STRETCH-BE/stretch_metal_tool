/**
 * Action-input schemas: the currency ↔ fx rule (a PLN quote must carry a
 * real EUR→PLN rate; the EUR sentinel 1 is rejected with `invalidFx`) on
 * both the header and the new-quote inputs; the assembly-mode contracts
 * (forming operations, shipping, price scale, seam / assembly inputs and
 * the header additions with their keep-when-omitted rule).
 * File path: /test/quotes/schema.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  assemblyInputSchema,
  assemblyUpdateSchema,
  firstErrorCode,
  formingInputSchema,
  fxRateValidFor,
  itemAssemblySchema,
  newQuoteSchema,
  normalisePriceScale,
  parseForming,
  parseFormingResolution,
  parseShipping,
  priceScaleSchema,
  quoteHeaderSchema,
  seamInputSchema,
  seamPatchSchema,
  type QuoteHeaderInput,
  type SeamInput,
} from "@/lib/quotes/schema";
import { CUSTOMER_ID, PART_ID } from "./fixtures";

const header: QuoteHeaderInput = {
  customerId: CUSTOMER_ID,
  currency: "PLN",
  fxRate: 4.35,
  marginPct: 30,
  validityDays: 30,
  leadTimeDays: 11,
  leadTimeText: "",
  paymentTermsText: "",
  notes: "",
  showOperationsOnPdf: false,
  weldingSeparate: false,
};

function code(result: { success: boolean; error?: unknown }): string | null {
  return result.success ? null : firstErrorCode(result.error as never);
}

describe("fxRateValidFor", () => {
  it("PLN needs a rate above 1, EUR ignores the field", () => {
    expect(fxRateValidFor("PLN", 4.3)).toBe(true);
    expect(fxRateValidFor("PLN", 1)).toBe(false);
    expect(fxRateValidFor("PLN", 0.23)).toBe(false);
    expect(fxRateValidFor("EUR", 1)).toBe(true);
    expect(fxRateValidFor("EUR", 4.3)).toBe(true);
  });
});

describe("quoteHeaderSchema", () => {
  it("accepts PLN with a real rate and EUR with 1", () => {
    expect(quoteHeaderSchema.safeParse(header).success).toBe(true);
    expect(quoteHeaderSchema.safeParse({ ...header, currency: "EUR", fxRate: 1 }).success).toBe(true);
  });

  it("rejects PLN with the EUR sentinel (1) or a rate below 1 as invalidFx", () => {
    expect(code(quoteHeaderSchema.safeParse({ ...header, fxRate: 1 }))).toBe("invalidFx");
    expect(code(quoteHeaderSchema.safeParse({ ...header, fxRate: 0.23 }))).toBe("invalidFx");
    expect(code(quoteHeaderSchema.safeParse({ ...header, fxRate: 0 }))).toBe("invalidFx");
  });
});

describe("newQuoteSchema", () => {
  const base = { type: "fabrication", customerId: null, currency: "PLN", fxRate: 4.3, marginPct: 30, validityDays: 30, leadTimeText: "", paymentTermsText: "", notes: "" };

  it("applies the same currency ↔ fx rule", () => {
    expect(newQuoteSchema.safeParse(base).success).toBe(true);
    expect(newQuoteSchema.safeParse({ ...base, currency: "EUR", fxRate: 1 }).success).toBe(true);
    expect(code(newQuoteSchema.safeParse({ ...base, fxRate: 1 }))).toBe("invalidFx");
  });
});

describe("quoteHeaderSchema — assembly-mode fields", () => {
  it("omitted fields stay undefined (keep the stored value), empty strings and null clear them", () => {
    const parsed = quoteHeaderSchema.safeParse(header);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.customerReference).toBeUndefined();
    expect(parsed.data.contactPerson).toBeUndefined();
    expect(parsed.data.shipping).toBeUndefined();
    expect(parsed.data.priceScale).toBeUndefined();
    const cleared = quoteHeaderSchema.safeParse({ ...header, customerReference: "", contactPerson: null, shipping: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data).toMatchObject({ customerReference: null, contactPerson: null, shipping: null });
  });

  it("accepts reference, contact, shipping and a price scale", () => {
    const parsed = quoteHeaderSchema.safeParse({
      ...header,
      customerReference: " N260580 ",
      contactPerson: "Anna Nowak",
      shipping: { countryCode: "fi", grossKg: 12.5, costEur: null, source: "table", carrier: "", extraLeadDays: 2 },
      priceScale: [100, 20, 50, 100],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.customerReference).toBe("N260580");
    expect(parsed.data.shipping).toEqual({ countryCode: "FI", grossKg: 12.5, costEur: null, source: "table", carrier: null, extraLeadDays: 2 });
    expect(parsed.data.priceScale).toEqual([20, 50, 100]);
  });

  it("rejects a bad country, a too-long reference and a price scale with non-positive quantities", () => {
    expect(code(quoteHeaderSchema.safeParse({ ...header, shipping: { countryCode: "Finland", grossKg: null, costEur: null, source: "manual", carrier: null, extraLeadDays: 0 } }))).toBe("invalid");
    expect(code(quoteHeaderSchema.safeParse({ ...header, customerReference: "x".repeat(121) }))).toBe("tooLong");
    expect(code(quoteHeaderSchema.safeParse({ ...header, priceScale: [10, 0] }))).toBe("invalidQty");
    expect(code(quoteHeaderSchema.safeParse({ ...header, priceScale: [10, 2.5] }))).toBe("invalidQty");
  });
});

describe("price scale", () => {
  it("normalises to sorted unique positive integers, at most 12", () => {
    expect(normalisePriceScale([500, 20, 20, "100", 0, -5, 2.5, null])).toEqual([20, 100, 500]);
    expect(normalisePriceScale(null)).toEqual([]);
    const ok = priceScaleSchema.safeParse([1000, 500, 200, 100, 50, 20, 20]);
    expect(ok.success && ok.data).toEqual([20, 50, 100, 200, 500, 1000]);
    expect(code(priceScaleSchema.safeParse(Array.from({ length: 13 }, (_, i) => i + 1)))).toBe("tooLong");
    // duplicates collapse before the length rule
    expect(priceScaleSchema.safeParse([...Array.from({ length: 12 }, (_, i) => i + 1), 1]).success).toBe(true);
  });
});

describe("parseForming / formingInputSchema", () => {
  it("keeps valid operations (resolution null by default) and drops malformed ones", () => {
    const ops = parseForming([
      { id: "r1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247 },
      { id: "b1", kind: "bend", bends: 2, angleDeg: 90, lengthMm: 300, resolution: { kind: "in_house" } },
      { id: "r2", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "step_bend", hits: 19 } },
      { id: "s1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "subcontract", supplier: "Walcownia X", costEur: 45, extraLeadDays: 5 } },
      { kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247 },
      { id: "bad", kind: "roll", insideRadiusMm: -1, angleDeg: 180, widthMm: 247 },
      { id: "bad2", kind: "bend", bends: 1.5, angleDeg: 90, lengthMm: 10 },
      { id: "bad3", kind: "fold" },
      "junk",
    ]);
    expect(ops.map((o) => o.id)).toEqual(["r1", "b1", "r2", "s1"]);
    expect(ops[0].resolution).toBeNull();
    expect(ops[2].resolution).toEqual({ kind: "step_bend", hits: 19 });
    expect(ops[3].resolution).toEqual({ kind: "subcontract", supplier: "Walcownia X", costEur: 45, extraLeadDays: 5 });
    expect(parseForming(null)).toEqual([]);
    expect(parseForming({})).toEqual([]);
  });

  it("the action input accepts operations without ids and validates resolutions", () => {
    const ok = formingInputSchema.safeParse([{ kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "none_needed" } }]);
    expect(ok.success).toBe(true);
    expect(code(formingInputSchema.safeParse([{ kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "step_bend", hits: 0 } }]))).toBe("invalidQty");
    expect(code(formingInputSchema.safeParse([{ kind: "bend", bends: 1, angleDeg: 90, lengthMm: 10, resolution: { kind: "subcontract", supplier: "", costEur: 1, extraLeadDays: 0 } }]))).toBe("required");
    expect(parseFormingResolution({ kind: "in_house" })).toEqual({ kind: "in_house" });
    expect(parseFormingResolution({ kind: "magic" })).toBeNull();
  });
});

describe("parseShipping", () => {
  it("returns the ShippingInput with defaults, null for junk", () => {
    expect(parseShipping({ countryCode: "de" })).toEqual({ countryCode: "DE", grossKg: null, costEur: null, source: "table", carrier: null, extraLeadDays: 0 });
    expect(parseShipping({ countryCode: "PL", grossKg: 11.8, costEur: 18, source: "manual", carrier: "DPD", extraLeadDays: 1 })).toEqual({ countryCode: "PL", grossKg: 11.8, costEur: 18, source: "manual", carrier: "DPD", extraLeadDays: 1 });
    expect(parseShipping({ countryCode: "POL" })).toBeNull();
    expect(parseShipping(null)).toBeNull();
    expect(parseShipping([])).toBeNull();
  });
});

describe("seamInputSchema", () => {
  const base: SeamInput = { lengthMm: 1250, process: "mig_mag", seamType: "continuous" };

  it("fills the defaults of a continuous seam", () => {
    const parsed = seamInputSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({
      label: null,
      partId: null,
      entityIds: [],
      points: null,
      lengthMm: 1250,
      process: "mig_mag",
      thicknessMm: null,
      seamType: "continuous",
      stitchBeadMm: null,
      stitchPitchMm: null,
      tackCount: null,
      sides: 1,
    });
  });

  it("a stitch seam needs bead and pitch, a tack seam its tack count", () => {
    expect(code(seamInputSchema.safeParse({ ...base, seamType: "stitch", stitchBeadMm: 30 }))).toBe("required");
    expect(seamInputSchema.safeParse({ ...base, seamType: "stitch", stitchBeadMm: 30, stitchPitchMm: 60 }).success).toBe(true);
    expect(code(seamInputSchema.safeParse({ ...base, seamType: "tack" }))).toBe("required");
    expect(seamInputSchema.safeParse({ ...base, lengthMm: 0, seamType: "tack", tackCount: 11 }).success).toBe(true);
  });

  it("validates part id, process, sides and lengths", () => {
    expect(code(seamInputSchema.safeParse({ ...base, partId: "nope" }))).toBe("invalid");
    expect(seamInputSchema.safeParse({ ...base, partId: PART_ID, entityIds: ["e1"], points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], sides: 2 }).success).toBe(true);
    expect(code(seamInputSchema.safeParse({ ...base, process: "glue" }))).toBe("invalid");
    expect(code(seamInputSchema.safeParse({ ...base, sides: 3 }))).toBe("invalid");
    expect(code(seamInputSchema.safeParse({ ...base, lengthMm: -1 }))).toBe("invalidNumber");
    expect(code(seamInputSchema.safeParse({ ...base, tackCount: 2.5 }))).toBe("invalidNumber");
  });

  it("the patch schema accepts partial input and fills NO defaults (a patch must not reset stored fields)", () => {
    const patch = seamPatchSchema.safeParse({ lengthMm: 1260 });
    expect(patch.success).toBe(true);
    if (patch.success) expect(patch.data).toEqual({ lengthMm: 1260 });
    const cleared = seamPatchSchema.safeParse({ label: "", partId: null, sides: 2 });
    expect(cleared.success && cleared.data).toEqual({ label: null, partId: null, sides: 2 });
    expect(code(seamPatchSchema.safeParse({ sides: 3 }))).toBe("invalid");
  });
});

describe("assembly + member inputs", () => {
  it("assemblyInputSchema requires a name and a positive qty", () => {
    const ok = assemblyInputSchema.safeParse({ name: " Box ", qty: 2 });
    expect(ok.success && ok.data).toEqual({ name: "Box", drawingRef: null, qty: 2, materialCode: null, thicknessMm: null, notes: null });
    expect(code(assemblyInputSchema.safeParse({ name: "", qty: 1 }))).toBe("required");
    expect(code(assemblyInputSchema.safeParse({ name: "Box", qty: 0 }))).toBe("invalidQty");
    expect(code(assemblyInputSchema.safeParse({ name: "Box", qty: 1, thicknessMm: 0 }))).toBe("invalidNumber");
    const patch = assemblyUpdateSchema.safeParse({ qty: 3, drawingRef: "" });
    expect(patch.success && patch.data).toEqual({ qty: 3, drawingRef: null });
  });

  it("itemAssemblySchema", () => {
    expect(itemAssemblySchema.safeParse({ assemblyId: null }).success).toBe(true);
    expect(code(itemAssemblySchema.safeParse({ assemblyId: "x" }))).toBe("invalid");
    expect(code(itemAssemblySchema.safeParse({ assemblyId: CUSTOMER_ID, qtyPerAssembly: 0 }))).toBe("invalidQty");
  });
});
