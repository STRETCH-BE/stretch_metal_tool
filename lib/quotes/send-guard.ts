/**
 * Send guard — the pure rule that decides whether a quote may leave the
 * building. Used by the send action (server, after re-pricing) and by the
 * quote page (to disable the button and list the reasons).
 * File path: /lib/quotes/send-guard.ts
 *
 * Rules (build prompt Step 2, spec 5.5):
 *   red_flags          any red flag — never overridable, not even by the admin
 *                      (a red *.no_rate_row would ship an operation at 0 €)
 *   pending_override   any override row still pending
 *   amber_unconfirmed  an amber flag with neither an approved override nor a
 *                      sales confirmation
 *   no_customer        no customer attached
 *   no_customer_email  customer has no e-mail (only when mailing is required)
 *   no_items           nothing priced (no items and no welding seams)
 *   not_priced         no pricing snapshot yet
 *   status             quote is already sent / won / lost
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
 */

import { overrideMatchesFlag } from "./shared";
import type { QuoteBundle, SendBlockReason, SendCheck } from "./types";

export type SendGuardInput = Pick<QuoteBundle, "quote" | "customer" | "items" | "flags" | "overrides" | "pricing" | "weldingOnly">;

export type SendGuardOptions = {
  /** Require a customer e-mail (true when the mailer is configured and mailing is expected). */
  requireEmail?: boolean;
};

export function canSend(bundle: SendGuardInput, options: SendGuardOptions = {}): SendCheck {
  const reasons: SendBlockReason[] = [];
  const { quote, customer, flags, overrides } = bundle;

  const pending = overrides.filter((o) => o.status === "pending");
  const approved = overrides.filter((o) => o.status === "approved");

  const sendableStatus = quote.status === "draft" || (quote.status === "pending_override" && pending.length === 0);
  if (!sendableStatus) reasons.push("status");

  if (!customer) reasons.push("no_customer");
  else if (options.requireEmail && !customer.email) reasons.push("no_customer_email");

  const seams = bundle.weldingOnly?.seams.length ?? 0;
  if (bundle.items.length === 0 && seams === 0) reasons.push("no_items");
  else if (!bundle.pricing) reasons.push("not_priced");

  if (flags.some((f) => f.severity === "red")) reasons.push("red_flags");
  if (pending.length > 0) reasons.push("pending_override");

  const amberUncovered = flags.some(
    (flag) => flag.severity === "amber" && !approved.some((o) => overrideMatchesFlag(o, flag))
  );
  if (amberUncovered) reasons.push("amber_unconfirmed");

  return { ok: reasons.length === 0, reasons };
}
