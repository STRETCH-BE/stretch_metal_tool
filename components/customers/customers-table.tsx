/**
 * CustomersTable — dense list: name (link), country, class chip, VAT id,
 * e-mail, number of quotes, last quote date.
 * File path: /components/customers/customers-table.tsx
 *
 * Server component: receives rows + the resolved content and locale, so
 * it formats dates per locale without any client JavaScript.
 */

import Link from "next/link";
import type { Content } from "@/content";
import type { CustomerClassCode } from "@/content/quote";
import type { Locale } from "@/lib/site-config";
import { formatDate } from "@/lib/i18n";
import { countryName } from "@/lib/customers/countries";
import { routes } from "@/lib/routes";
import type { CustomerListRow } from "@/lib/customers/queries";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export type CustomersTableProps = {
  rows: CustomerListRow[];
  content: Content;
  locale: Locale;
  /** Shown as a single full-width row when `rows` is empty. */
  emptyMessage: string;
};

/** Country name: the content dictionary first, then Intl.DisplayNames, then the code. */
export function countryLabel(content: Content, code: string): string {
  return countryName(code, content.locale, content.quote.customers.countries);
}

export function classLabel(content: Content, code: string): string {
  const classes = content.quote.customers.classes as Record<string, string>;
  return classes[code] ?? code;
}

const CLASS_SEVERITY: Record<CustomerClassCode, "neutral" | "green" | "amber" | "dark"> = {
  standard: "neutral",
  key: "green",
  new: "amber",
  distributor: "neutral",
};

export function CustomersTable({ rows, content, locale, emptyMessage }: CustomersTableProps) {
  const cols = content.quote.customers.list.columns;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{cols.name}</Th>
            <Th>{cols.country}</Th>
            <Th>{cols.customerClass}</Th>
            <Th>{cols.vatId}</Th>
            <Th>{cols.email}</Th>
            <Th align="num">{cols.quotes}</Th>
            <Th align="num">{cols.lastQuote}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="row-muted">
              <Td colSpan={7} className="py-8 text-center">
                {emptyMessage}
              </Td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <Link href={routes.customer(row.id)} className="lnk font-bold">
                    {row.name}
                  </Link>
                </Td>
                <Td>
                  <span className="mono mr-2 text-text-faint">{row.country}</span>
                  {countryLabel(content, row.country)}
                </Td>
                <Td>
                  <StatusChip
                    severity={CLASS_SEVERITY[row.customer_class as CustomerClassCode] ?? "neutral"}
                    label={classLabel(content, row.customer_class)}
                  />
                </Td>
                <Td className="mono" muted={!row.vat_id}>
                  {row.vat_id ?? "—"}
                </Td>
                <Td muted={!row.email}>{row.email ?? "—"}</Td>
                <Td align="num">{row.quoteCount}</Td>
                <Td align="num" muted={!row.lastQuoteAt}>
                  {row.lastQuoteAt ? formatDate(row.lastQuoteAt, locale) : "—"}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
