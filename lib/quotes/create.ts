/**
 * Create a draft quote — shared by the upload page (standalone upload
 * creates a draft first) and the "new quote" form.
 * File path: /lib/quotes/create.ts
 *
 * Numbering comes from the SECURITY DEFINER function next_quote_number()
 * (SM-YYYY-NNNN). Currency defaults from the customer's country (PLN for
 * Poland, EUR otherwise), the fx rate from the env default, the margin
 * and the rate version from the active rate version. Runs as the signed-in
 * user (RLS: sales + admin may insert).
 */

import { createClient } from "@/lib/supabase/server";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";
import { defaultFxEurPln, siteConfig } from "@/lib/site-config";
import type { CurrencyCode, QuoteTypeDb } from "@/lib/db/types";

export type CreateDraftQuoteInput = {
  createdBy: string;
  type?: QuoteTypeDb;
  customerId?: string | null;
  currency?: CurrencyCode | null;
  fxRate?: number | null;
  marginPct?: number | null;
  validityDays?: number | null;
  leadTimeText?: string | null;
  paymentTermsText?: string | null;
  notes?: string | null;
};

export type CreatedQuote = { id: string; number: string };

export async function createDraftQuote(
  input: CreateDraftQuoteInput
): Promise<CreatedQuote> {
  const supabase = await createClient();

  const { data: number, error: numberError } = await supabase.rpc(
    "next_quote_number"
  );
  if (numberError || !number) {
    throw new Error(
      `next_quote_number failed: ${numberError?.message ?? "no number"}`
    );
  }

  let currency = input.currency ?? null;
  if (!currency && input.customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("country, customer_class")
      .eq("id", input.customerId)
      .maybeSingle();
    currency = customer ? defaultCurrencyForCountry(customer.country) : null;
  }
  currency = currency ?? "PLN";

  const { data: version } = await supabase
    .from("rate_versions")
    .select("id")
    .eq("active", true)
    .maybeSingle();
  let marginPct = input.marginPct ?? null;
  if (marginPct == null && version) {
    const { data: general } = await supabase
      .from("rate_general")
      .select("default_margin_pct")
      .eq("rate_version_id", version.id)
      .maybeSingle();
    marginPct = general ? Number(general.default_margin_pct) : null;
  }

  const fxRate =
    input.fxRate ?? (currency === "PLN" ? defaultFxEurPln() : 1);

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      number,
      version: 1,
      type: input.type ?? "fabrication",
      status: "draft",
      customer_id: input.customerId ?? null,
      currency,
      fx_rate: fxRate,
      margin_pct: marginPct ?? 30,
      validity_days: input.validityDays ?? siteConfig.quoteDefaults.validityDays,
      lead_time_text: input.leadTimeText ?? null,
      payment_terms_text: input.paymentTermsText ?? null,
      rate_version_id: version?.id ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy,
    })
    .select("id, number")
    .single();

  if (error || !quote) {
    throw new Error(`quote insert failed: ${error?.message ?? "no row"}`);
  }
  return { id: quote.id, number: quote.number };
}
