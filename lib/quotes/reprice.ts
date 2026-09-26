/**
 * Server-side re-pricing — the only path that writes prices. Every
 * mutation that changes a price input (qty, extras, scrap, margin, fx,
 * currency, customer, seams, annotations, material, thickness) ends by
 * calling this, and so does sending (Step 12: "never trust client-side
 * prices; the server re-prices on save and on send").
 * File path: /lib/quotes/reprice.ts
 *
 *   repriceQuote(quoteId, opts?) → PricedQuote | null
 *
 * Clients and trust:
 *   - Reads use the RLS client AS THE USER (a quote the user cannot see is
 *     `null`, never priced), and the user must pass isQuoteEditor (admin,
 *     or a sales owner) — the same rule as can_edit_quote() in SQL.
 *   - Persistence writes use the ADMIN client. Reason: the writes touch
 *     quotes.pricing/flags/subtotals/rate_version_id, quote_items and the
 *     operations rows in one deterministic sweep, and the pin of
 *     rate_version_id must succeed even for a quote created before a
 *     version was activated; keeping that on one client avoids partial
 *     writes when RLS would reject a single statement. It is therefore
 *     ONLY called after the access check above, or with `opts.admin =
 *     true` from a trusted server action that already ran
 *     requireQuoteEditor / requireRole (the admin override queue, the
 *     price route after assertRole). With `opts.admin` the reads use the
 *     admin client too (no request session needed).
 *
 * Locked quotes (status sent / won / lost) are NEVER re-priced, in either
 * mode: QuoteAccessError("locked"). The pinned rate version keeps the
 * rates stable, but the machines table is not versioned and a re-run
 * would rewrite operations, flags and priced_at on a quote the customer
 * already holds (Step 2: "reopening an old quote shows the old price";
 * Step 14.5). Every server action already refuses locked quotes through
 * requireQuoteEditor({ editableOnly: true }); this check makes the price
 * route and any trusted caller obey the same rule.
 *
 * Rate version: quotes.rate_version_id is pinned to the active version the
 * first time a quote is priced and never changed afterwards (old quotes
 * keep their old prices; "duplicate as new version" re-pins).
 *
 * Money: engine amounts (EUR) go to quotes.pricing, quote_items.unit_*,
 * operations.unit_cost; quotes.subtotal_cost/_price are stored in the
 * QUOTE CURRENCY (mapper.ts) for the list views.
 *
 * Idempotent and deterministic: the same rows + the same rate version
 * yield the same PricedQuote; operations are delete+insert per item so a
 * second run leaves exactly the same set. Returns null (and clears the
 * pricing columns) when there is nothing to price.
 */

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadActiveRateVersionId, loadMachinePark, loadRateSnapshot, type RatesClient } from "@/lib/rates/load";
import { priceQuote } from "@/lib/pricing/price-quote";
import type { PricedQuote } from "@/lib/pricing/types";
import { QuoteAccessError } from "./access";
import { buildQuoteInput, emptyPersistence, hasPriceableContent, pricedToPersistence } from "./mapper";
import { loadQuoteBundle } from "./queries";
import { isQuoteEditable, isQuoteEditor, isUuid } from "./shared";

export type RepriceOptions = {
  /** Trusted caller (already role-checked): skip the session check, read with the admin client. */
  admin?: boolean;
};

export async function repriceQuote(quoteId: string, opts: RepriceOptions = {}): Promise<PricedQuote | null> {
  if (!isUuid(quoteId)) return null;

  let reader: RatesClient;
  let session: Awaited<ReturnType<typeof getCurrentUser>> = null;
  if (opts.admin) {
    reader = createAdminClient();
  } else {
    session = await getCurrentUser();
    if (!session) throw new QuoteAccessError("unauthenticated");
    reader = await createClient();
  }

  const bundle = await loadQuoteBundle(reader, quoteId);
  if (!bundle) return null;
  if (session && !isQuoteEditor(session.profile.role, session.user.id, bundle.quote)) {
    throw new QuoteAccessError("forbidden");
  }
  if (!isQuoteEditable(bundle.quote.status)) throw new QuoteAccessError("locked");

  const admin = createAdminClient();

  let versionId = bundle.quote.rate_version_id;
  if (!versionId) {
    versionId = await loadActiveRateVersionId(reader);
    const { error } = await admin.from("quotes").update({ rate_version_id: versionId }).eq("id", quoteId);
    if (error) throw new Error(`repriceQuote/pin: ${error.message}`);
  }

  const [rates, machines] = await Promise.all([loadRateSnapshot(reader, versionId), loadMachinePark(reader)]);
  const input = buildQuoteInput({
    quote: bundle.quote,
    customer: bundle.customer,
    items: bundle.items,
    parts: bundle.parts,
    rates,
  });

  const pricedAt = new Date().toISOString();
  if (!hasPriceableContent(input)) {
    const itemIds = bundle.items.map((i) => i.id);
    if (itemIds.length) {
      const { error } = await admin.from("operations").delete().in("quote_item_id", itemIds);
      if (error) throw new Error(`repriceQuote/clear-operations: ${error.message}`);
    }
    const { error } = await admin.from("quotes").update({ ...emptyPersistence(), priced_at: pricedAt }).eq("id", quoteId);
    if (error) throw new Error(`repriceQuote/clear: ${error.message}`);
    return null;
  }

  const priced = priceQuote(input, rates, machines);
  const persistence = pricedToPersistence(priced, bundle.quote);

  for (const item of persistence.items) {
    const { error } = await admin
      .from("quote_items")
      .update({ unit_cost: item.unit_cost, unit_price: item.unit_price, flags: item.flags })
      .eq("id", item.id);
    if (error) throw new Error(`repriceQuote/item ${item.id}: ${error.message}`);
  }

  const itemIds = bundle.items.map((i) => i.id);
  if (itemIds.length) {
    const { error } = await admin.from("operations").delete().in("quote_item_id", itemIds);
    if (error) throw new Error(`repriceQuote/delete-operations: ${error.message}`);
  }
  if (persistence.operations.length) {
    const { error } = await admin.from("operations").insert(persistence.operations);
    if (error) throw new Error(`repriceQuote/insert-operations: ${error.message}`);
  }

  const { error } = await admin
    .from("quotes")
    .update({ ...persistence.quote, priced_at: pricedAt })
    .eq("id", quoteId);
  if (error) throw new Error(`repriceQuote/quote: ${error.message}`);

  return priced;
}
