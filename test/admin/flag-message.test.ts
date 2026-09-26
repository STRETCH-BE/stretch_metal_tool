/**
 * Tolerant rule-code → label resolution for the override queue.
 * File path: /test/admin/flag-message.test.ts
 */
import { describe, expect, it } from "vitest";
import { resolveFlagLabel } from "@/lib/admin/flag-message";

describe("resolveFlagLabel", () => {
  it("reads nested flags[code].label, root code objects and plain strings", () => {
    expect(resolveFlagLabel({ flags: { "bend.force_over_limit": { label: "Force", message: "…" } } }, "bend.force_over_limit")).toBe("Force");
    expect(resolveFlagLabel({ "roll.radius_too_small": { message: "Radius" } }, "roll.radius_too_small")).toBe("Radius");
    expect(resolveFlagLabel({ "laser.subcontract": "Subcontract" }, "laser.subcontract")).toBe("Subcontract");
  });

  it("falls back to the code", () => {
    expect(resolveFlagLabel({ title: "flags" }, "unknown.code")).toBe("unknown.code");
    expect(resolveFlagLabel(null, "x")).toBe("x");
  });
});
