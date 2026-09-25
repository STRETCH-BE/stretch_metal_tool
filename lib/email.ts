/**
 * Microsoft Graph email helper.
 * File path: /lib/email.ts
 *
 * Authenticates to Microsoft Graph using OAuth 2.0 client-credentials
 * and sends email from the configured mailbox. The app should be
 * restricted via an Exchange Application Access Policy to send only from
 * MS_GRAPH_FROM_ADDRESS, so a leaked secret cannot impersonate other
 * mailboxes in the tenant.
 *

 * Ported verbatim from the stretch_metal website (itself ported from
 * stretch-sufit) so quote e-mails leave from the same Microsoft 365
 * mailbox setup. Extended there with
 * `attachments` (Graph #microsoft.graph.fileAttachment entries) so the
 * RFQ route can forward the customer's technical drawings inline in the
 * lead email. Attachments ride in the sendMail JSON body — fine for the
 * 4 MB total the RFQ route enforces (Graph's request cap sits well
 * above that after base64 inflation).
 *
 * Required env vars:
 *   MS_GRAPH_TENANT_ID       Microsoft 365 tenant (directory) ID
 *   MS_GRAPH_CLIENT_ID       App registration application ID
 *   MS_GRAPH_CLIENT_SECRET   App registration client secret VALUE
 *   MS_GRAPH_FROM_ADDRESS    Mailbox to send from
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_BASE = "https://login.microsoftonline.com";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

// In-memory token cache — survives for the lifetime of the serverless
// instance (typically minutes). Saves a token request on every send.
let cachedToken: { value: string; expiresAt: number } | null = null;

/** True when every env var needed to actually send mail is present. */
export function isMailConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET &&
      process.env.MS_GRAPH_FROM_ADDRESS
  );
}

async function getAccessToken(): Promise<string> {
  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Microsoft Graph env vars missing. Set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, and MS_GRAPH_CLIENT_SECRET in Vercel."
    );
  }

  // Reuse cached token if it has at least 60 seconds of life left
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const tokenUrl = `${TOKEN_BASE}/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Microsoft Graph token request failed (${res.status}): ${errorText}`
    );
  }

  const data = (await res.json()) as TokenResponse;
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

export type MailAttachment = {
  /** Filename as shown in the mail client — sanitize before passing. */
  name: string;
  /** MIME type, e.g. "application/pdf"; unknown CAD types use octet-stream. */
  contentType: string;
  /** Base64-encoded file bytes. */
  contentBytes: string;
};

export type SendMailOptions = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Reply-To header — clicking Reply in Outlook sends to this address */
  replyTo?: string;
  /** Sets the Outlook importance flag — "high" shows a red ! marker */
  importance?: "low" | "normal" | "high";
  /** Files attached as Graph fileAttachment entries (base64 payloads). */
  attachments?: MailAttachment[];
};

function toRecipients(addresses?: string | string[]) {
  if (!addresses) return undefined;
  const list = Array.isArray(addresses) ? addresses : [addresses];
  return list.map((address) => ({ emailAddress: { address } }));
}

/**
 * Send an email via Microsoft Graph as the configured mailbox.
 * Throws on any failure — callers wrap in try/catch.
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  const from = process.env.MS_GRAPH_FROM_ADDRESS;
  if (!from) {
    throw new Error("MS_GRAPH_FROM_ADDRESS env var not set.");
  }

  const token = await getAccessToken();

  const message = {
    message: {
      subject: options.subject,
      importance: options.importance || "normal",
      body: {
        contentType: "HTML",
        content: options.html,
      },
      toRecipients: toRecipients(options.to),
      ccRecipients: toRecipients(options.cc),
      replyTo: options.replyTo ? toRecipients(options.replyTo) : undefined,
      attachments: options.attachments?.length
        ? options.attachments.map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.name,
            contentType: attachment.contentType,
            contentBytes: attachment.contentBytes,
          }))
        : undefined,
    },
    saveToSentItems: true,
  };

  const sendUrl = `${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`;
  const res = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
    cache: "no-store",
  });

  // Graph returns 202 Accepted on success with no body
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Microsoft Graph sendMail failed (${res.status}): ${errorText}`
    );
  }
}
