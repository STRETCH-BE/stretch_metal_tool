/**
 * Quotes list — filters (status chips, customer, search), dense table,
 * pagination, "new quote" for write roles.
 * File path: /app/(app)/quotes/page.tsx
 *
 * Server component; filters are GET params (?status=&customer=&q=&page=)
 * so URLs are shareable and the back button works. The middleware sends
 * every signed-in user here after login.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser, hasRole, WRITE_ROLES } from "@/lib/auth";
import { getLocale, interpolate } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import type { QuoteStatus } from "@/lib/db/types";
import { listCustomerOptions, listQuotes } from "@/lib/quotes/queries";
import { QUOTE_STATUSES } from "@/lib/quotes/schema";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { QuotesTable } from "@/components/quote/quotes-table";
import { QUOTE_STATUS_SEVERITY } from "@/components/quote/quote-status-chip";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.quote.builder.list.title };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function listHref(params: { status?: string; customer?: string; q?: string }): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.customer) search.set("customer", params.customer);
  if (params.q) search.set("q", params.q);
  const qs = search.toString();
  return qs ? `${routes.quotes}?${qs}` : routes.quotes;
}

export default async function QuotesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.quote.builder.list;
  const session = await getCurrentUser();
  const canWrite = hasRole(session, WRITE_ROLES);

  const statusParam = first(params.status);
  const status = (QUOTE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as QuoteStatus) : null;
  const customerId = first(params.customer) || null;
  const search = first(params.q).trim();
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);

  const [result, customers] = await Promise.all([
    listQuotes({ status, customerId, search, page }),
    listCustomerOptions(),
  ]);

  const current = { status: status ?? "", customer: customerId ?? "", q: search };
  const noQuotesAtAll = result.total === 0 && !status && !customerId && !search;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          canWrite ? (
            <Button href={routes.quoteNew} size="sm" arrow>
              {t.newQuote}
            </Button>
          ) : undefined
        }
      />

      {noQuotesAtAll ? (
        <EmptyState
          title={t.empty}
          body={t.emptyBody}
          action={
            canWrite ? (
              <Button href={routes.quoteNew} size="sm" arrow>
                {t.newQuote}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Panel
          flush
          title={interpolate(c.common.table.results, { count: result.total })}
          actions={
            <form role="search" method="get" action={routes.quotes} className="flex flex-wrap items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              <label htmlFor="quotes-customer" className="visually-hidden">
                {t.filterCustomer}
              </label>
              <select
                id="quotes-customer"
                name="customer"
                defaultValue={customerId ?? ""}
                className="field field-sm field-inline max-w-[220px]"
              >
                <option value="">{t.allCustomers}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              <label htmlFor="quotes-search" className="visually-hidden">
                {t.search}
              </label>
              <input
                id="quotes-search"
                name="q"
                type="search"
                defaultValue={search}
                placeholder={t.searchPlaceholder}
                className="field field-sm field-inline w-[220px] max-w-full"
                autoComplete="off"
              />
              <button type="submit" className="btn btn-ghost btn-sm">
                {c.common.actions.search}
              </button>
            </form>
          }
        >
          <nav aria-label={t.filterStatus} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Link
              href={listHref({ ...current, status: "" })}
              aria-current={!status ? "page" : undefined}
              className={`chip chip-plain ${!status ? "chip-dark" : "chip-neutral"}`}
            >
              {t.allStatuses}
            </Link>
            {QUOTE_STATUSES.map((value) => (
              <Link key={value} href={listHref({ ...current, status: value })} aria-current={status === value ? "page" : undefined}>
                <StatusChip
                  severity={QUOTE_STATUS_SEVERITY[value]}
                  label={c.common.status[value]}
                  className={status === value ? "outline-2 outline-black" : ""}
                />
              </Link>
            ))}
          </nav>
          <QuotesTable rows={result.rows} content={c} locale={locale} emptyMessage={t.noResults} />
          {result.pageCount > 1 && (
            <div className="px-4 py-3">
              <Pagination page={result.page} pageCount={result.pageCount} href={listHref(current)} />
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
