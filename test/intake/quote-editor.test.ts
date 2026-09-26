/**
 * canEditQuoteAs (lib/parts/quote-editor.ts) mirrors SQL can_edit_quote:
 * admin, or the sales owner; viewers and other sales users never.
 * File path: /test/intake/quote-editor.test.ts
 */
import { describe, expect, it } from "vitest";
import { canEditQuoteAs } from "@/lib/parts/quote-editor";

const quote = { created_by: "owner" };

describe("canEditQuoteAs", () => {
  it("admin always, sales only as the owner, viewer never", () => {
    expect(canEditQuoteAs(quote, { id: "anyone", role: "admin" })).toBe(true);
    expect(canEditQuoteAs(quote, { id: "owner", role: "sales" })).toBe(true);
    expect(canEditQuoteAs(quote, { id: "other", role: "sales" })).toBe(false);
    expect(canEditQuoteAs(quote, { id: "owner", role: "viewer" })).toBe(false);
  });

  it("rejects a missing user or a quote without an owner (unless admin)", () => {
    expect(canEditQuoteAs(quote, null)).toBe(false);
    expect(canEditQuoteAs(quote, undefined)).toBe(false);
    expect(canEditQuoteAs({ created_by: null }, { id: "owner", role: "sales" })).toBe(false);
    expect(canEditQuoteAs({ created_by: null }, { id: "x", role: "admin" })).toBe(true);
  });
});
