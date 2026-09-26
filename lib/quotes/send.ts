/**
 * Sending a quote — re-price on the server, re-check the send guard,
 * render the PDF, store it in the quote-files bucket, e-mail it when the
 * Graph mailer is configured, then flip the status to `sent`.
 * File path: /lib/quotes/send.ts
 *
 *   canSend(bundle, options?)         → { ok, reasons[] }   (pure, lib/quotes/send-guard.ts)
 *   sendQuote(quoteId, { locale })    → SendResult
 *
 * Amber flags: a sales confirmation is stored as an override row with
 * status 'approved' and decided_by = requested_by (note "confirmed by
 * sales", see actions.ts confirmFlag). There is no acknowledgement
 * column on quotes; keeping confirmations in `overrides` means one
 * audit trail and one matching rule for confirmations and admin
 * approvals alike. Red flags are never sendable. See send-guard.ts.
 *
 * Order of operations matters: (1) repriceQuote — the client never
 * decides prices; (2) canSend on the freshly priced bundle; (3) PDF
 * render; (4) upload to Storage + files row (kind quote_pdf) with the
 * admin client (route handlers never receive file bodies, and the PDF
 * is server-generated); (5) mail when configured — a mail failure does
 * NOT roll back: the PDF is stored and the status is still set, the
 * caller reports `mailed: false` (the user downloads and sends by
 * hand); (6) status sent + sent_at; (7) audit "quote.send".
 *
 * Locale: explicit param → customer.preferred_locale → pl. Reply-to is
 * QUOTE_FROM_ADDRESS (env.quoteFromAddress()).
 */

import { createHash } from "node:crypto";
import { env, QUOTE_FILES_BUCKET } from "@/lib/env";
import { isMailConfigured, sendMail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContent } from "@/content";
import { interpolate, formatDate } from "@/lib/format";
import { renderQuotePdf } from "@/lib/pdf/render";
import { siteConfig, type Locale } from "@/lib/site-config";
import { requireQuoteEditor } from "./access";
import { loadQuoteBundle } from "./queries";
import { repriceQuote } from "./reprice";
import { canSend } from "./send-guard";
import { quoteNumberLabel, quotePdfFileName, resolveQuoteLocale, validUntilDate } from "./shared";
import type { QuoteBundle, SendResult } from "./types";

export { canSend } from "./send-guard";

export type SendQuoteOptions = {
  locale?: Locale | null;
  /** Skip the mailer even when configured (download-only send). */
  skipMail?: boolean;
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Subject + plain text + HTML body from content.pdf.email for a bundle. */
export function buildQuoteEmail(
  bundle: QuoteBundle,
  locale: Locale,
  options: { senderName: string | null; fileName: string }
): { subject: string; text: string; html: string } {
  const t = getContent(locale).pdf.email;
  const quote = bundle.quote;
  const number = quoteNumberLabel(quote);
  const validUntil = formatDate(validUntilDate(quote.sent_at ?? new Date(), Number(quote.validity_days) || 0), locale);
  const params = {
    number,
    customer: bundle.customer?.name ?? "",
    validUntil,
    company: siteConfig.legalName,
    sender: options.senderName ?? siteConfig.name,
    file: options.fileName,
  };
  const subject = interpolate(t.subject, params);
  const lines = [
    t.greeting,
    "",
    interpolate(t.body, params),
    "",
    interpolate(t.attachmentNote, params),
    "",
    t.closing,
    interpolate(t.signature, params),
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0a0a0a">${lines
    .map((line) => (line === "" ? "<br/>" : `<p style="margin:0">${escapeHtml(line).replace(/\n/g, "<br/>")}</p>`))
    .join("")}</div>`;
  return { subject, text, html };
}

export async function sendQuote(quoteId: string, options: SendQuoteOptions = {}): Promise<SendResult> {
  const { session } = await requireQuoteEditor(quoteId, { editableOnly: true });

  // 1. Server-side prices, never the client's.
  await repriceQuote(quoteId);

  const admin = createAdminClient();
  const bundle = await loadQuoteBundle(admin, quoteId);
  if (!bundle) return { sent: false, mailed: false, pdfPath: null, reasons: ["status"] };

  // 2. Guard on the fresh bundle.
  const mailPossible = isMailConfigured() && !options.skipMail;
  const check = canSend(bundle, { requireEmail: false });
  if (!check.ok) return { sent: false, mailed: false, pdfPath: null, reasons: check.reasons };

  const locale = resolveQuoteLocale(options.locale, bundle.customer?.preferred_locale ?? null);
  const senderName = session.profile.full_name?.trim() || session.profile.email;

  // 3. Render.
  const pdf = await renderQuotePdf(bundle, {
    locale,
    showOperations: bundle.quote.show_operations_on_pdf,
    preparedBy: senderName,
  });
  const fileName = quotePdfFileName(bundle.quote, locale);

  // 4. Store (private bucket, admin client) + files row.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storagePath = `quotes/${quoteId}/${stamp}-${fileName}`;
  const { error: uploadError } = await admin.storage
    .from(QUOTE_FILES_BUCKET)
    .upload(storagePath, pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error(`sendQuote/upload: ${uploadError.message}`);
  const { error: fileError } = await admin.from("files").insert({
    storage_path: storagePath,
    original_name: fileName,
    mime: "application/pdf",
    size: pdf.byteLength,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    kind: "quote_pdf",
    uploaded_by: session.user.id,
  });
  if (fileError) throw new Error(`sendQuote/files: ${fileError.message}`);

  // 5. Mail (best effort).
  let mailed = false;
  const to = bundle.customer?.email ?? null;
  if (mailPossible && to) {
    const mail = buildQuoteEmail(bundle, locale, { senderName, fileName });
    try {
      await sendMail({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        replyTo: env.quoteFromAddress() ?? undefined,
        attachments: [{ name: fileName, contentType: "application/pdf", contentBytes: pdf.toString("base64") }],
      });
      mailed = true;
    } catch (error) {
      console.error("[quotes] sendMail failed", error);
      mailed = false;
    }
  }

  // 6. Status.
  const sentAt = new Date().toISOString();
  const { error: statusError } = await admin
    .from("quotes")
    .update({ status: "sent", sent_at: sentAt })
    .eq("id", quoteId);
  if (statusError) throw new Error(`sendQuote/status: ${statusError.message}`);

  // 7. Audit.
  await logAudit({
    actor: session.user.id,
    action: "quote.send",
    entity: "quotes",
    entityId: quoteId,
    before: { status: bundle.quote.status },
    after: { status: "sent", sent_at: sentAt, mailed, to: mailed ? to : null, pdf: storagePath, locale },
  });

  return { sent: true, mailed, pdfPath: storagePath };
}
