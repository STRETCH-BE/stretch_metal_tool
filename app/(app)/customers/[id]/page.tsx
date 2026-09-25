/**
 * Customer page — edit form + the customer's quote history.
 * File path: /app/(app)/customers/[id]/page.tsx
 *
 * Every role may open it; the form is read-only for viewers and the
 * delete button (inline confirm → deleteCustomer) is admin-only. The
 * history lists the customer's quotes newest first with totals in each
 * quote's own currency; rows link to the quote builder.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, hasRole, WRITE_ROLES, ADMIN_ONLY } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { getCustomer, listCustomerQuotes } from "@/lib/customers/queries";
import { deleteCustomer, updateCustomer } from "@/lib/customers/actions";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { CustomerForm } from "@/components/customers/customer-form";
import { CustomerQuotesTable } from "@/components/customers/customer-quotes-table";
import { classLabel, countryLabel } from "@/components/customers/customers-table";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ created?: string | string[]; error?: string | string[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Request-scoped dedupe: generateMetadata and the page share one read. */
const loadCustomer = cache(getCustomer);

/** Tab title = the customer's name (falls back to the localized "Customer"). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const c = getContent(await getLocale());
  const customer = UUID.test(id) ? await loadCustomer(id) : null;
  return { title: customer?.name ?? c.quote.customers.editEyebrow };
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;

  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.quote.customers;
  const session = await getCurrentUser();
  const canWrite = hasRole(session, WRITE_ROLES);
  const isAdmin = hasRole(session, ADMIN_ONLY);

  const [customer, quotes] = await Promise.all([loadCustomer(id), listCustomerQuotes(id)]);
  if (!customer) notFound();

  const currency = defaultCurrencyForCountry(customer.country);
  const subtitle = [
    `${customer.country} · ${countryLabel(c, customer.country)}`,
    classLabel(c, customer.customer_class),
    c.common.currency[currency],
  ].join(" · ");

  return (
    <>
      <PageHeader
        eyebrow={t.editEyebrow}
        title={customer.name}
        subtitle={subtitle}
        actions={
          <>
            <Button href={routes.quoteNew} variant="ghost" size="sm" arrow>
              {c.common.nav.newQuote}
            </Button>
            {isAdmin && (
              <ConfirmButton
                action={deleteCustomer.bind(null, customer.id)}
                question={t.form.deleteConfirm}
                variant="ghost"
              >
                {t.form.deleteCustomer}
              </ConfirmButton>
            )}
          </>
        }
      />

      {first(query.created) === "1" && (
        <Notice tone="success" className="mb-4">
          {t.form.created}
        </Notice>
      )}
      {first(query.error) === "delete" && (
        <Notice tone="error" className="mb-4">
          {t.errors.generic}
        </Notice>
      )}

      <div className="flex flex-col gap-6">
        <Panel className="max-w-[880px]" title={t.form.sectionDetails}>
          <CustomerForm
            mode="edit"
            action={updateCustomer.bind(null, customer.id)}
            customer={customer}
            readOnly={!canWrite}
          />
        </Panel>

        <Panel
          flush
          title={t.history.title}
          actions={<StatusChip severity="neutral" plain label={String(quotes.length)} />}
        >
          <CustomerQuotesTable quotes={quotes} content={c} locale={locale} />
        </Panel>
      </div>
    </>
  );
}
