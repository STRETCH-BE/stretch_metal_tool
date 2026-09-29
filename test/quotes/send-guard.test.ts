/**
 * Send guard truth table — build prompt Step 2 / spec 5.5: red flag →
 * blocked; pending override → blocked; amber with approved override (or a
 * sales confirmation) → ok; no customer → blocked; plus items/pricing/
 * status rules. Export guards (docs/assembly-mode-design.md §5):
 * customer_missing, customer_type_missing, company_placeholders,
 * forming_unresolved — through exportBlockReasons and inside canSend.
 * File path: /test/quotes/send-guard.test.ts
 */
import { describe, expect, it } from "vitest";
import type { CustomerRow } from "@/lib/db/types";
import { canSend, exportBlockReasons } from "@/lib/quotes/send-guard";
import { canSend as canSendFromSend } from "@/lib/quotes/send";
import { ADMIN_ID, USER_ID, amberFlag, makeBundle, makeCompanySettings, makeOverride, redFlag } from "./fixtures";

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

describe("export guards", () => {
  it("a complete customer, confirmed company data and no forming flag → nothing blocks the export", () => {
    expect(exportBlockReasons(makeBundle({ flags: [] }))).toEqual([]);
    expect(exportBlockReasons(makeBundle({ flags: [], company: makeCompanySettings() }))).toEqual([]);
  });

  it("no customer → no_customer (not customer_missing)", () => {
    expect(exportBlockReasons(makeBundle({ flags: [], customer: null }))).toEqual(["no_customer"]);
  });

  it("a customer with a blank name or address → customer_missing", () => {
    expect(exportBlockReasons(makeBundle({ flags: [], customer: { name: "  " } }))).toEqual(["customer_missing"]);
    expect(exportBlockReasons(makeBundle({ flags: [], customer: { address: null } }))).toEqual(["customer_missing"]);
    expect(exportBlockReasons(makeBundle({ flags: [], customer: { address: "" } }))).toEqual(["customer_missing"]);
    expect(canSend(makeBundle({ flags: [], customer: { address: "" } })).reasons).toEqual(["customer_missing"]);
  });

  it("customer_type neither b2b nor b2c (null from a pre-migration row) → customer_type_missing", () => {
    const nullType = { customer_type: null as unknown as CustomerRow["customer_type"] };
    expect(exportBlockReasons(makeBundle({ flags: [], customer: nullType }))).toEqual(["customer_type_missing"]);
    expect(exportBlockReasons(makeBundle({ flags: [], customer: { customer_type: "b2c" } }))).toEqual([]);
    const bogus = { customer_type: "private" as unknown as CustomerRow["customer_type"] };
    expect(canSend(makeBundle({ flags: [], customer: bogus })).reasons).toEqual(["customer_type_missing"]);
  });

  it("placeholder markers in any company_settings field → company_placeholders", () => {
    for (const over of [{ nip: "PL0000000000" }, { bank_name: "Bank [CONFIRM]" }, { regon: "000-000-000" }, { swift: "XXXXPLPW" }, { iban_eur: "PL00 1234" }]) {
      const check = exportBlockReasons(makeBundle({ flags: [], company: makeCompanySettings(over) }));
      expect(check, JSON.stringify(over)).toEqual(["company_placeholders"]);
    }
    expect(canSend(makeBundle({ flags: [], company: makeCompanySettings({ krs: "XXXX" }) })).reasons).toEqual(["company_placeholders"]);
  });

  it("a blank company_settings field falls back to site-config and is not a placeholder", () => {
    expect(exportBlockReasons(makeBundle({ flags: [], company: makeCompanySettings({ street: "", nip: "" }) }))).toEqual([]);
  });

  it("a red forming.not_feasible or forming.suspected flag → forming_unresolved (and red_flags for the send)", () => {
    const notFeasible = redFlag({ code: "forming.not_feasible", params: { kind: "roll", reason: "min_radius", value: 90, limit: 200 } });
    const suspected = redFlag({ code: "forming.suspected", params: { hint: "roll_annotation" } });
    expect(exportBlockReasons(makeBundle({ flags: [notFeasible] }))).toEqual(["forming_unresolved"]);
    expect(exportBlockReasons(makeBundle({ flags: [suspected] }))).toEqual(["forming_unresolved"]);
    expect(canSend(makeBundle({ flags: [notFeasible] })).reasons).toEqual(["red_flags", "forming_unresolved"]);
    // a resolved forming operation is amber (step_bend / subcontract) — not an export block
    const resolved = amberFlag({ code: "forming.step_bend", params: { hits: 19 } });
    expect(exportBlockReasons(makeBundle({ flags: [resolved] }))).toEqual([]);
    expect(canSend(makeBundle({ flags: [resolved] })).reasons).toEqual(["amber_unconfirmed"]);
    // another red flag is not a forming problem
    expect(exportBlockReasons(makeBundle({ flags: [redFlag()] }))).toEqual([]);
  });

  it("export reasons block the export of a draft and a sent quote alike, and every one of them is a canSend reason", () => {
    const blocked = makeBundle({
      flags: [redFlag({ code: "forming.not_feasible" })],
      customer: { name: "", customer_type: null as unknown as CustomerRow["customer_type"] },
      company: makeCompanySettings({ nip: "PL00" }),
    });
    const expected = ["customer_missing", "customer_type_missing", "company_placeholders", "forming_unresolved"];
    expect(exportBlockReasons(blocked)).toEqual(expected);
    const sent = { ...blocked, quote: { ...blocked.quote, status: "sent" as const } };
    expect(exportBlockReasons(sent)).toEqual(expected);
    const send = canSend(sent);
    for (const reason of expected) expect(send.reasons).toContain(reason);
    expect(send.reasons).toContain("status");
  });
});
