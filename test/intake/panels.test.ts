/**
 * Part-page plumbing: serverKey (lib/parts/server-key.ts) remounts the
 * material / quantity / bend forms when the server value changes, and
 * buildQuickPartColumns (lib/parts/quick-part-columns.ts) nulls file_hash
 * when a quick part replaces an existing part.
 * File path: /test/intake/panels.test.ts
 */
import { describe, expect, it } from "vitest";
import type { PartGeometry } from "@/lib/geometry/types";
import { serverKey } from "@/lib/parts/server-key";
import { buildQuickPartColumns } from "@/lib/parts/quick-part-columns";
import type { QuickPartForm } from "@/lib/parts/schema";

describe("serverKey", () => {
  it("is stable for equal values and changes with any value", () => {
    expect(serverKey("S235", 3)).toBe(serverKey("S235", 3));
    expect(serverKey("S235", 3)).not.toBe(serverKey("S355", 3));
    expect(serverKey("S235", 3)).not.toBe(serverKey("S235", 15));
    expect(serverKey(1)).not.toBe(serverKey(25));
    expect(serverKey("bend-1", "up", 90, 2)).not.toBe(serverKey("bend-1", "up", 120, 2));
  });

  it("tells null, undefined, empty string and their text apart", () => {
    expect(serverKey(null)).not.toBe(serverKey(undefined));
    expect(serverKey(null)).not.toBe(serverKey(""));
    expect(serverKey(null)).not.toBe(serverKey("null"));
    expect(serverKey("a", null)).not.toBe(serverKey("a", 0));
  });
});

describe("buildQuickPartColumns", () => {
  const form: QuickPartForm = {
    name: "bracket",
    lengthMm: 300,
    widthMm: 120,
    thicknessMm: 3,
    materialCode: "s235",
    holes: [{ diameterMm: 8.5, count: 4 }],
    bends: [{ lengthMm: 120, angleDeg: 90, count: 2 }],
    roll: null,
  };

  it("builds a manual part row from the quick-part geometry", () => {
    const { columns, geometry, annotations } = buildQuickPartColumns(form, { code: "S235", densityKgM3: 7850 }, 10, "create");
    expect(columns.source).toBe("manual");
    expect(columns.material_code).toBe("S235");
    expect(columns.thickness_mm).toBe(3);
    expect("file_hash" in columns).toBe(false);
    expect(columns.thumbnail_svg.startsWith("<svg")).toBe(true);
    expect(geometry.measures.bbox.width).toBeCloseTo(300, 3);
    expect(geometry.measures.holes).toHaveLength(4);
    expect(annotations.bends).toHaveLength(2);
    expect((columns.geometry as unknown as PartGeometry).measures.bbox.width).toBeCloseTo(300, 3);
  });

  it("nulls file_hash when replacing an existing part so its annotations never restore onto the real DXF", () => {
    const { columns } = buildQuickPartColumns(form, null, 10, "replace");
    expect("file_hash" in columns).toBe(true);
    expect(columns.file_hash).toBeNull();
    expect(columns.source).toBe("manual");
    // Unknown material code is kept as typed (a missing rate row surfaces as a flag).
    expect(columns.material_code).toBe("s235");
  });
});
