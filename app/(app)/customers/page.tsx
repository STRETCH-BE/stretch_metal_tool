/**
 * Customers list — dense table with search and pagination.
 * File path: /app/(app)/customers/page.tsx
 *
 * Server component; search is a GET form (?q=) so the URL is shareable
 * and the back button works. `?deleted=1` (after deleteCustomer) shows a
 * confirmation notice. Every signed-in role may read customers; the
 * "new customer" button is hidden from viewers.
 */

import type { Metadata } from "next";
import { getCurrentUser, hasRole, WRITE_ROLES } from "@/lib/auth";
import { getLocale, interpolate } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { listCustomers } from "@/lib/customers/queries";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { CustomersTable } from "@/components/customers/customers-table";

export const metadata: Metadata = { title: "Customers" };

type SearchParams = Promise<{
  q?: string | string[];
  page?: string | string[];
  deleted?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.quote.customers;
  const session = await getCurrentUser();
  const canWrite = hasRole(session, WRITE_ROLES);

  const search = first(params.q).trim();
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);
  const result = await listCustomers({ search, page });

  const listHref = search ? `${routes.customers}?q=${encodeURIComponent(search)}` : routes.customers;
  const noCustomersAtAll = result.total === 0 && !search;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          canWrite ? (
            <Button href={routes.customerNew} size="sm" arrow>
              {t.list.newCustomer}
            </Button>
          ) : undefined
        }
      />

      {first(params.deleted) === "1" && (
        <Notice tone="success" className="mb-4">
          {t.form.deleted}
        </Notice>
      )}

      {noCustomersAtAll ? (
        <EmptyState
          title={t.list.empty}
          body={t.list.emptyBody}
          action={
            canWrite ? (
              <Button href={routes.customerNew} size="sm" arrow>
                {t.list.newCustomer}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Panel
          flush
          title={interpolate(c.common.table.results, { count: result.total })}
          actions={
            <form role="search" method="get" action={routes.customers} className="flex items-center gap-2">
              <label htmlFor="customers-search" className="visually-hidden">
                {t.list.search}
              </label>
              <input
                id="customers-search"
                name="q"
                type="search"
                defaultValue={search}
                placeholder={t.list.searchPlaceholder}
                className="field field-sm field-inline w-[260px] max-w-full"
                autoComplete="off"
              />
              <button type="submit" className="btn btn-ghost btn-sm">
                {c.common.actions.search}
              </button>
            </form>
          }
        >
          <CustomersTable
            rows={result.rows}
            content={c}
            locale={locale}
            emptyMessage={t.list.noResults}
          />
          {result.pageCount > 1 && (
            <div className="px-4 py-3">
              <Pagination page={result.page} pageCount={result.pageCount} href={listHref} />
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
