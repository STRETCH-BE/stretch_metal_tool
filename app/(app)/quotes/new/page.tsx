/**
 * New quote page — header form → createQuote → redirect to the quote.
 * File path: /app/(app)/quotes/new/page.tsx
 *
 * Sales + admin only. Defaults handed to the form: env fx rate, the
 * active rate version's default margin + margin by class (null when no
 * version is active — the action then falls back to the DB default),
 * validity from siteConfig, payment terms / lead time from content
 * ([CONFIRM] placeholders). `?customer=<id>` preselects a customer.
 */

import type { Metadata } from "next";
import { requireRole, WRITE_ROLES } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { loadRateSnapshot } from "@/lib/rates/load";
import { defaultFxEurPln, siteConfig } from "@/lib/site-config";
import { createQuote } from "@/lib/quotes/actions";
import { listCustomerOptions } from "@/lib/quotes/queries";
import { isUuid } from "@/lib/quotes/shared";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { NewQuoteForm } from "@/components/quote/new-quote-form";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.quote.builder.create.title };
}

type SearchParams = Promise<{ customer?: string | string[] }>;

export default async function NewQuotePage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(WRITE_ROLES);
  const params = await searchParams;
  const c = getContent(await getLocale());
  const t = c.quote.builder.create;

  const supabase = await createClient();
  let marginPct: number | null = null;
  let marginByClass: Record<string, number> = {};
  try {
    const rates = await loadRateSnapshot(supabase);
    marginPct = rates.general.defaultMarginPct;
    marginByClass = rates.general.marginByClass;
  } catch {
    // No active rate version yet — the form shows an empty margin and the
    // create action uses the database default until the admin activates one.
  }
  const customers = await listCustomerOptions();
  const preselected = Array.isArray(params.customer) ? params.customer[0] : params.customer;

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <Panel className="max-w-[880px]">
        <NewQuoteForm
          action={createQuote}
          customers={customers}
          customerId={isUuid(preselected) ? preselected : null}
          defaults={{
            fxEurPln: defaultFxEurPln(),
            marginPct,
            marginByClass,
            validityDays: siteConfig.quoteDefaults.validityDays,
            paymentTerms: c.quote.builder.defaults.paymentTerms,
            leadTime: c.quote.builder.defaults.leadTime,
          }}
        />
      </Panel>
    </>
  );
}
