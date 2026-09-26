/**
 * sendQuote end to end with mocks: re-price → guard → PDF → storage +
 * files row → mail → status sent → audit; blocked cases return reasons
 * and change nothing. Includes the mailer ↔ customer e-mail rule: with
 * the Graph mailer configured a customer without an address blocks the
 * send (no_customer_email) instead of flipping the quote to sent.
 * File path: /test/quotes/send.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID } from "@/test/helpers/rates";
import { ITEM_ID, QUOTE_ID, USER_ID, makeCustomer, makeItemRow, makePartRow, makeQuoteRow, redFlag } from "./fixtures";

const state = vi.hoisted(() => ({
  db: null as unknown as { from: unknown },
  session: null as unknown,
  mailConfigured: true,
  sendMail: vi.fn(async () => undefined),
  logAudit: vi.fn(async () => undefined),
  renderQuotePdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake")),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.db) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.db) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => state.session) }));
vi.mock("@/lib/audit", () => ({ logAudit: state.logAudit }));
vi.mock("@/lib/email", () => ({ isMailConfigured: () => state.mailConfigured, sendMail: state.sendMail }));
vi.mock("@/lib/pdf/render", () => ({ renderQuotePdf: state.renderQuotePdf }));
vi.mock("@/lib/rates/load", () => ({
  loadActiveRateVersionId: vi.fn(async () => RATE_VERSION_ID),
  loadRateSnapshot: vi.fn(async () => RATE_SNAPSHOT_V1),
  loadMachinePark: vi.fn(async () => MACHINE_PARK),
}));

import { buildQuoteEmail, sendQuote } from "@/lib/quotes/send";
import { makeBundle } from "./fixtures";

function seed(quote: Partial<ReturnType<typeof makeQuoteRow>> = {}, customer: Partial<ReturnType<typeof makeCustomer>> = {}) {
  const db = new FakeSupabase({
    quotes: [makeQuoteRow(quote)],
    customers: [makeCustomer(customer)],
    quote_items: [makeItemRow()],
    parts: [makePartRow()],
    operations: [],
    overrides: [],
    files: [],
    rate_versions: [{ id: RATE_VERSION_ID, label: "v1", active: true }],
  });
  state.db = db;
  return db;
}

describe("sendQuote", () => {
  beforeEach(() => {
    state.session = { user: { id: USER_ID }, profile: { id: USER_ID, role: "sales", full_name: "Jan Kowalski", email: "jan@x" } };
    state.mailConfigured = true;
    state.sendMail.mockClear();
    state.logAudit.mockClear();
    state.renderQuotePdf.mockClear();
  });

  it("re-prices, stores the PDF, mails it, marks the quote sent and audits", async () => {
    const db = seed();
    const result = await sendQuote(QUOTE_ID, { locale: "en" });
    expect(result).toMatchObject({ sent: true, mailed: true, mail: "sent" });
    expect(result.pdfPath).toMatch(new RegExp(`^quotes/${QUOTE_ID}/.*SM-2026-0001-EN\\.pdf$`));
    const quote = db.tables.quotes[0];
    expect(quote.status).toBe("sent");
    expect(typeof quote.sent_at).toBe("string");
    expect(quote.pricing).toMatchObject({ rateVersionId: RATE_VERSION_ID });
    expect(db.tables.operations.filter((o) => o.quote_item_id === ITEM_ID).length).toBeGreaterThan(5);
    expect(db.tables.files[0]).toMatchObject({ kind: "quote_pdf", mime: "application/pdf", original_name: "SM-2026-0001-EN.pdf", uploaded_by: USER_ID });
    expect(db.writes.some((w) => w.op === "upload" && w.bucket === "quote-files")).toBe(true);
    expect(state.renderQuotePdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locale: "en", preparedBy: "Jan Kowalski" }));
    expect(state.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "zakupy@acme-metal.pl",
        subject: expect.stringContaining("SM-2026-0001"),
        attachments: [expect.objectContaining({ name: "SM-2026-0001-EN.pdf", contentType: "application/pdf" })],
      })
    );
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.send", entityId: QUOTE_ID }));
  });

  it("uses the customer's preferred locale when none is given, and skips mailing when not configured", async () => {
    const db = seed({}, { preferred_locale: "en" });
    state.mailConfigured = false;
    const result = await sendQuote(QUOTE_ID);
    expect(result).toMatchObject({ sent: true, mailed: false, mail: "off" });
    expect(state.sendMail).not.toHaveBeenCalled();
    expect(db.tables.quotes[0].status).toBe("sent");
    expect(state.renderQuotePdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locale: "en" }));
  });

  it("a mail failure keeps the PDF and the sent status but reports mailed: false", async () => {
    const db = seed();
    state.sendMail.mockRejectedValueOnce(new Error("graph down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await sendQuote(QUOTE_ID, { locale: "pl" });
    expect(result).toMatchObject({ sent: true, mailed: false, mail: "failed" });
    expect(db.tables.quotes[0].status).toBe("sent");
    expect(db.tables.files).toHaveLength(1);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ after: expect.objectContaining({ mail: "failed", to: null }) }));
    vi.restoreAllMocks();
  });

  it("with the mailer configured, a customer without an e-mail blocks the send (no_customer_email) and changes nothing", async () => {
    const db = seed({}, { email: null });
    const result = await sendQuote(QUOTE_ID, { locale: "pl" });
    expect(result).toEqual({ sent: false, mailed: false, pdfPath: null, reasons: ["no_customer_email"] });
    expect(db.tables.quotes[0].status).toBe("draft");
    expect(db.tables.quotes[0].sent_at).toBeNull();
    expect(db.tables.files).toHaveLength(0);
    expect(state.renderQuotePdf).not.toHaveBeenCalled();
    expect(state.sendMail).not.toHaveBeenCalled();
    expect(state.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "quote.send" }));
  });

  it("without the mailer a customer without an e-mail is a download-only send (mail: off)", async () => {
    const db = seed({}, { email: null });
    state.mailConfigured = false;
    const result = await sendQuote(QUOTE_ID, { locale: "pl" });
    expect(result).toMatchObject({ sent: true, mailed: false, mail: "off" });
    expect(db.tables.quotes[0].status).toBe("sent");
    expect(state.sendMail).not.toHaveBeenCalled();
  });

  it("skipMail makes a download-only send even with the mailer configured", async () => {
    const db = seed({}, { email: null });
    const result = await sendQuote(QUOTE_ID, { locale: "pl", skipMail: true });
    expect(result).toMatchObject({ sent: true, mailed: false, mail: "off" });
    expect(db.tables.quotes[0].status).toBe("sent");
    expect(state.sendMail).not.toHaveBeenCalled();
  });

  it("is blocked by the guard after re-pricing (no customer) and changes nothing", async () => {
    const db = seed({ customer_id: null });
    const result = await sendQuote(QUOTE_ID, { locale: "pl" });
    expect(result).toEqual({ sent: false, mailed: false, pdfPath: null, reasons: ["no_customer"] });
    expect(db.tables.quotes[0].status).toBe("draft");
    expect(db.tables.files).toHaveLength(0);
    expect(state.sendMail).not.toHaveBeenCalled();
    expect(state.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "quote.send" }));
  });

  it("re-prices before deciding: stale red flags on the row do not block a clean part", async () => {
    // the stored flags say red, but the fresh pricing run has no red flag for 200164
    const db = seed({ flags: [redFlag()] });
    const result = await sendQuote(QUOTE_ID, { locale: "pl" });
    expect(result.sent).toBe(true);
    expect((db.tables.quotes[0].flags as { severity: string }[]).some((f) => f.severity === "red")).toBe(false);
  });

  it("refuses locked quotes and strangers", async () => {
    seed({ status: "sent" });
    await expect(sendQuote(QUOTE_ID)).rejects.toMatchObject({ code: "locked" });
    seed();
    state.session = { user: { id: "other" }, profile: { id: "other", role: "sales" } };
    await expect(sendQuote(QUOTE_ID)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("buildQuoteEmail", () => {
  it("interpolates number, customer, validity and sender in both locales", () => {
    const bundle = makeBundle({ quote: { sent_at: "2026-10-01T09:00:00Z", validity_days: 30 } });
    const pl = buildQuoteEmail(bundle, "pl", { senderName: "Jan Kowalski", fileName: "SM-2026-0001.pdf" });
    expect(pl.subject).toContain("SM-2026-0001");
    expect(pl.text).toContain("Acme Metal Sp. z o.o.");
    expect(pl.text).toContain("31.10.2026");
    expect(pl.text).toContain("Jan Kowalski");
    expect(pl.html).toContain("<p");
    const en = buildQuoteEmail(bundle, "en", { senderName: null, fileName: "SM-2026-0001.pdf" });
    expect(en.text).toContain("31/10/2026");
    expect(en.text).toContain("SM-2026-0001.pdf");
  });
});
