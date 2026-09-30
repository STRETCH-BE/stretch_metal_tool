/**
 * Send guard — the pure rule that decides whether a quote may leave the
 * building. Used by the send action (server, after re-pricing), by the
 * quote page (to disable the button and list the reasons) and — through
 * `exportBlockReasons` — by the PDF route, which refuses to render a
 * document the guard would not let out.
 * File path: /lib/quotes/send-guard.ts
 *
 * Rules (build prompt Step 2, spec 5.5):
 *   red_flags          any red flag — never overridable, not even by the admin
 *                      (a red *.no_rate_row would ship an operation at 0 €);
 *                      the one exception is geometry.reference_body, which an
 *                      admin may approve as "real part" (the body is then
 *                      priced again) — an APPROVED override covers it
 *   pending_override   any override row still pending
 *   amber_unconfirmed  an amber flag with neither an approved override nor a
 *                      sales confirmation
 *   no_customer        no customer attached
 *   no_customer_email  customer has no e-mail (only when mailing is required)
 *   no_items           nothing priced (no items and no welding seams)
 *   not_priced         no pricing snapshot yet
 *   status             quote is already sent / won / lost
 *
 * Export guards (docs/assembly-mode-design.md §5) — they block the PDF of
 * a DRAFT too (exportBlockReasons), and canSend includes them:
 *   no_customer            (as above — a quote PDF without an addressee is
 *                          useless and the VAT mode is "none")
 *   customer_missing       a customer whose name or address is blank
 *   customer_type_missing  customer_type is neither b2b nor b2c (a row from
 *                          before the migration reads null)
 *   company_placeholders   a company_settings field — or, when the table is
 *                          empty, a lib/site-config.ts default — still holds
 *                          "000-000", "PL00", "XXXX" or "[CONFIRM]"
 *                          (lib/pdf/company.ts, the same check the PDF
 *                          footer note uses)
 *   forming_unresolved     a red forming.not_feasible / forming.suspected
 *                          flag: the engine's truth — an infeasible roll or
 *                          bend without a step-bend / subcontract resolution,
 *                          or a drawing that hints at forming nobody
 *                          confirmed. Such an item / assembly is unpriceable.
 *
 * Amber confirmation = an override row with status 'approved' whose
 * decided_by equals requested_by (created by the sales user through the
 * "confirm" button — see lib/quotes/actions.ts confirmFlag). There is no
 * separate acknowledgement column; storing confirmations as self-approved
 * overrides keeps one audit trail and one matching rule
 * (overrideMatchesFlag) for both kinds of acceptance. A rejected override
 * leaves the flag uncovered, so the quote stays blocked until a new
 * request is approved.
 *
 * `pending_override` status with no pending rows left is treated like
 * draft: the admin queue flips the status back on decision, but if it
 * did not, a decided quote must not stay un-sendable for a stale status.
 *
 * Client-safe: imported by components/quote/quote-builder.tsx, so nothing
 * here (nor in lib/pdf/company.ts) may touch Next, Supabase or react-pdf.
 */

import type { CustomerRow } from "@/lib/db/types";
import { hasCompanyPlaceholders, resolveCompanyProfile } from "@/lib/pdf/company";
import type { Flag, FlagCode } from "@/lib/pricing/types";
import { overrideMatchesFlag } from "./shared";
import type { QuoteBundle, SendBlockReason, SendCheck } from "./types";

export type SendGuardInput = Pick<
  QuoteBundle,
  "quote" | "customer" | "items" | "flags" | "overrides" | "pricing" | "weldingOnly" | "assemblies" | "company"
>;

/** What the export guard reads — a subset of SendGuardInput (the PDF route passes the whole bundle). */
export type ExportGuardInput = Pick<SendGuardInput, "customer" | "company" | "flags">;

export type SendGuardOptions = {
  /** Require a customer e-mail (true when the mailer is configured and mailing is expected). */
  requireEmail?: boolean;
};

/** Red flags of these codes mean an unresolved forming operation (lib/pricing/forming.ts). */
const FORMING_UNRESOLVED_CODES: ReadonlySet<FlagCode> = new Set<FlagCode>(["forming.not_feasible", "forming.suspected"]);

function isBlank(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** no_customer / customer_missing / customer_type_missing for the attached customer. */
function customerReasons(customer: CustomerRow | null): SendBlockReason[] {
  if (!customer) return ["no_customer"];
  const reasons: SendBlockReason[] = [];
  if (isBlank(customer.name) || isBlank(customer.address)) reasons.push("customer_missing");
  // `customer_type` is typed non-null, but a row read before the migration
  // (or through a stale schema cache) carries null / undefined at runtime.
  const type: unknown = customer.customer_type;
  if (type !== "b2b" && type !== "b2c") reasons.push("customer_type_missing");
  return reasons;
}

function formingUnresolved(flags: ReadonlyArray<Flag>): boolean {
  return flags.some((f) => f.severity === "red" && FORMING_UNRESOLVED_CODES.has(f.code));
}

/**
 * The reasons that block the PDF EXPORT of a quote in ANY status, drafts
 * included (the PDF route answers 422 with them). Empty = the document may
 * be rendered. Every reason here is also a canSend reason.
 */
export function exportBlockReasons(bundle: ExportGuardInput): SendBlockReason[] {
  const reasons: SendBlockReason[] = [...customerReasons(bundle.customer)];
  if (hasCompanyPlaceholders(resolveCompanyProfile(bundle.company ?? null))) reasons.push("company_placeholders");
  if (formingUnresolved(bundle.flags)) reasons.push("forming_unresolved");
  return reasons;
}

export function canSend(bundle: SendGuardInput, options: SendGuardOptions = {}): SendCheck {
  const reasons: SendBlockReason[] = [];
  const { quote, customer, flags, overrides } = bundle;

  const pending = overrides.filter((o) => o.status === "pending");
  const approved = overrides.filter((o) => o.status === "approved");

  const sendableStatus = quote.status === "draft" || (quote.status === "pending_override" && pending.length === 0);
  if (!sendableStatus) reasons.push("status");

  reasons.push(...customerReasons(customer));
  if (customer && options.requireEmail && !customer.email) reasons.push("no_customer_email");

  const seams = bundle.weldingOnly?.seams.length ?? 0;
  if (bundle.items.length === 0 && seams === 0) reasons.push("no_items");
  else if (!bundle.pricing) reasons.push("not_priced");

  if (flags.some((f) => f.severity === "red" && !(f.code === "geometry.reference_body" && approved.some((o) => overrideMatchesFlag(o, f))))) reasons.push("red_flags");
  if (pending.length > 0) reasons.push("pending_override");

  const amberUncovered = flags.some(
    (flag) => flag.severity === "amber" && !approved.some((o) => overrideMatchesFlag(o, flag))
  );
  if (amberUncovered) reasons.push("amber_unconfirmed");

  if (hasCompanyPlaceholders(resolveCompanyProfile(bundle.company ?? null))) reasons.push("company_placeholders");
  if (formingUnresolved(flags)) reasons.push("forming_unresolved");

  return { ok: reasons.length === 0, reasons };
}
