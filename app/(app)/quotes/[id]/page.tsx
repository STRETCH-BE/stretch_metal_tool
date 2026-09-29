/**
 * Quote page — header, parts, breakdown, totals, welding, flags,
 * overrides, audit excerpt and the actions bar (client island
 * QuoteBuilder).
 * File path: /app/(app)/quotes/[id]/page.tsx
 *
 * Server component: loads the bundle (RLS), the rate snapshot the quote
 * is pinned to (or the active one) + the machine park for the live
 * preview, the customer options, the audit excerpt and the send check.
 * `canEdit` = write role and (admin or owner), mirroring can_edit_quote().
 * The audit excerpt is admin-or-owner only (listQuoteAudit gates itself
 * on the session; the builder gets `null` for everyone else and hides
 * the panel). The send check requires a customer e-mail exactly when the
 * mailer is configured — the same rule sendQuote applies on the server.
 * The environment EUR→PLN default is handed to the builder so an EUR →
 * PLN switch in the header starts from a real rate, not the stored 1.
 * A missing rate version does not break the page: the preview is off and
 * the actions report "no active rate version" on save.
 *
 * Assembly mode: the admin-edited job rates (loadJobRates — settings
 * tables; null when they cannot be read so the preview falls back to the
 * legacy path) feed the client preview, and the PDF export guards
 * (exportBlockReasons) disable the download with the reasons listed.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, hasRole, requireUser, ADMIN_ONLY, WRITE_ROLES } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { isMailConfigured } from "@/lib/email";
import { loadCostRateVersionId, loadJobRates, loadMachinePark, loadRateSnapshot } from "@/lib/rates/load";
import type { JobRates, MachinePark, RateSnapshot } from "@/lib/pricing/types";
import { routes } from "@/lib/routes";
import { defaultFxEurPln } from "@/lib/site-config";
import { canSeeQuoteAudit, getQuoteBundle, listCustomerOptions, listQuoteAudit } from "@/lib/quotes/queries";
import { canSend, exportBlockReasons } from "@/lib/quotes/send-guard";
import { isQuoteEditor, isUuid, quoteNumberLabel } from "@/lib/quotes/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QuoteBuilder } from "@/components/quote/quote-builder";

type Params = Promise<{ id: string }>;

const loadBundle = cache(getQuoteBundle);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const c = getContent(await getLocale());
  const bundle = isUuid(id) ? await loadBundle(id) : null;
  return { title: bundle ? quoteNumberLabel(bundle.quote) : c.quote.title };
}

export default async function QuotePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireUser();
  const session = await getCurrentUser();
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.quote.builder;

  const bundle = await loadBundle(id);
  if (!bundle) notFound();

  const supabase = await createClient();
  let rates: RateSnapshot | null = null;
  let machines: MachinePark = [];
  try {
    [rates, machines] = await Promise.all([loadRateSnapshot(supabase, bundle.quote.rate_version_id), loadMachinePark(supabase)]);
  } catch {
    rates = null;
  }
  let costRates: RateSnapshot | null = null;
  if (rates?.general.pricingMode === "market") {
    try {
      const costId = bundle.quote.cost_rate_version_id ?? (await loadCostRateVersionId(supabase, null));
      costRates = costId ? await loadRateSnapshot(supabase, costId) : null;
    } catch {
      costRates = null;
    }
  }
  let jobRates: JobRates | null = null;
  try {
    jobRates = await loadJobRates(supabase);
  } catch (error) {
    console.warn("[quotes] job rates unavailable for the preview", error);
    jobRates = null;
  }
  const [customers, audit] = await Promise.all([listCustomerOptions(), listQuoteAudit(session, bundle.quote)]);

  const canEdit = Boolean(session && hasRole(session, WRITE_ROLES) && isQuoteEditor(session.profile.role, session.user.id, bundle.quote));
  const isAdmin = hasRole(session, ADMIN_ONLY);
  const mailConfigured = isMailConfigured();
  const sendCheck = canSend(bundle, { requireEmail: mailConfigured });
  const exportBlock = exportBlockReasons(bundle);

  const subtitle = [
    bundle.customer?.name ?? t.header.noCustomer,
    t.types[bundle.quote.type],
    c.common.currency[bundle.quote.currency],
  ].join(" · ");

  return (
    <>
      <PageHeader
        eyebrow={t.header.eyebrow}
        title={quoteNumberLabel(bundle.quote)}
        subtitle={subtitle}
        actions={
          <Button href={routes.quotes} variant="ghost" size="sm">
            {c.common.nav.quotes}
          </Button>
        }
      />
      <QuoteBuilder
        bundle={bundle}
        rates={rates}
        costRates={costRates}
        machines={machines}
        jobRates={jobRates}
        customers={customers}
        audit={canSeeQuoteAudit(session, bundle.quote) ? audit : null}
        canEdit={canEdit}
        isAdmin={isAdmin}
        mailConfigured={mailConfigured}
        sendCheck={sendCheck}
        exportBlock={exportBlock}
        fxEurPln={defaultFxEurPln()}
      />
    </>
  );
}
