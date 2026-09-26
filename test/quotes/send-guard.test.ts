/**
 * Send guard truth table — build prompt Step 2 / spec 5.5: red flag →
 * blocked; pending override → blocked; amber with approved override (or a
 * sales confirmation) → ok; no customer → blocked; plus items/pricing/
 * status rules.
 * File path: /test/quotes/send-guard.test.ts
 */
import { describe, expect, it } from "vitest";
import { canSend } from "@/lib/quotes/send-guard";
import { canSend as canSendFromSend } from "@/lib/quotes/send";
import { ADMIN_ID, USER_ID, amberFlag, makeBundle, makeOverride, redFlag } from "./fixtures";

describe("canSend", () => {
  it("a clean, priced draft with a customer is sendable", () => {
    const bundle = makeBundle({ flags: [] });
    expect(canSend(bundle)).toEqual({ ok: true, reasons: [] });
  });

  it("green flags never block", () => {
    const bundle = makeBundle();
    expect(bundle.flags.some((f) => f.severity === "green")).toBe(true);
    expect(canSend(bundle).ok).toBe(true);
  });

  it("red flag → blocked, even with an approved override for it", () => {
    const bundle = makeBundle({
      flags: [redFlag()],
      overrides: [makeOverride({ rule_code: "bend.force_over_limit", status: "approved", decided_by: ADMIN_ID, decided_at: "2026-09-25T12:00:00Z" })],
    });
    const check = canSend(bundle);
    expect(check.ok).toBe(false);
    expect(check.reasons).toEqual(["red_flags"]);
  });

  it("pending override → blocked", () => {
    const bundle = makeBundle({ flags: [amberFlag()], overrides: [makeOverride({ status: "pending" })] });
    const check = canSend(bundle);
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("pending_override");
    // the amber flag is not "covered" by a pending row either
    expect(check.reasons).toContain("amber_unconfirmed");
  });

  it("amber flag without acceptance → blocked", () => {
    const check = canSend(makeBundle({ flags: [amberFlag()] }));
    expect(check).toEqual({ ok: false, reasons: ["amber_unconfirmed"] });
  });

  it("amber flag with an admin-approved override → ok", () => {
    const bundle = makeBundle({
      flags: [amberFlag()],
      overrides: [makeOverride({ status: "approved", decided_by: ADMIN_ID, decided_at: "2026-09-25T12:00:00Z" })],
    });
    expect(canSend(bundle)).toEqual({ ok: true, reasons: [] });
  });

  it("amber flag with a sales confirmation (self-approved override) → ok", () => {
    const bundle = makeBundle({
      flags: [amberFlag()],
      overrides: [
        makeOverride({ status: "approved", requested_by: USER_ID, decided_by: USER_ID, note: "confirmed by sales", decided_at: "2026-09-25T12:00:00Z" }),
      ],
    });
    expect(canSend(bundle).ok).toBe(true);
  });

  it("a rejected override leaves the amber flag uncovered", () => {
    const bundle = makeBundle({
      flags: [amberFlag()],
      overrides: [makeOverride({ status: "rejected", decided_by: ADMIN_ID, decided_at: "2026-09-25T12:00:00Z" })],
    });
    expect(canSend(bundle).reasons).toEqual(["amber_unconfirmed"]);
  });

  it("an approved override for another part or rule does not cover the flag", () => {
    const otherPart = makeBundle({
      flags: [amberFlag()],
      overrides: [makeOverride({ status: "approved", decided_by: ADMIN_ID, part_id: "99999999-9999-4999-8999-999999999999" })],
    });
    expect(canSend(otherPart).reasons).toEqual(["amber_unconfirmed"]);
    const otherRule = makeBundle({
      flags: [amberFlag()],
      overrides: [makeOverride({ status: "approved", decided_by: ADMIN_ID, rule_code: "bend.short_flange" })],
    });
    expect(canSend(otherRule).reasons).toEqual(["amber_unconfirmed"]);
  });

  it("no customer → blocked", () => {
    const check = canSend(makeBundle({ flags: [], customer: null }));
    expect(check).toEqual({ ok: false, reasons: ["no_customer"] });
  });

  it("customer without e-mail blocks only when e-mail is required", () => {
    const bundle = makeBundle({ flags: [], customer: { email: null } });
    expect(canSend(bundle).ok).toBe(true);
    expect(canSend(bundle, { requireEmail: true }).reasons).toEqual(["no_customer_email"]);
  });

  it("no items and no seams → blocked; items but no pricing → not_priced", () => {
    expect(canSend(makeBundle({ flags: [], items: [], priced: null })).reasons).toEqual(["no_items"]);
    expect(canSend(makeBundle({ flags: [], priced: null })).reasons).toEqual(["not_priced"]);
  });

  it("status: draft ok, pending_override ok once every override is decided, sent/won/lost blocked", () => {
    expect(canSend(makeBundle({ flags: [], quote: { status: "pending_override" } })).ok).toBe(true);
    for (const status of ["sent", "won", "lost"] as const) {
      expect(canSend(makeBundle({ flags: [], quote: { status } })).reasons).toEqual(["status"]);
    }
  });

  it("collects every reason at once", () => {
    const bundle = makeBundle({
      flags: [redFlag(), amberFlag()],
      overrides: [makeOverride({ rule_code: "bend.short_flange", status: "pending" })],
      customer: null,
      quote: { status: "sent" },
    });
    expect(canSend(bundle).reasons.sort()).toEqual(["amber_unconfirmed", "no_customer", "pending_override", "red_flags", "status"].sort());
  });

  it("is re-exported from lib/quotes/send", () => {
    expect(canSendFromSend).toBe(canSend);
  });
});
