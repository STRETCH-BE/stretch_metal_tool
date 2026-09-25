/**
 * CustomerQuotesTable — a customer's quote history: number, version,
 * type, status chip, date, total in the quote's own currency.
 * File path: /components/customers/customer-quotes-table.tsx
 *
 * Server component. Rows link to the quote page (routes.quote). Totals
 * are `subtotal_price` as stored by server-side pricing, in the quote
 * currency — never recomputed here.
 */

import Link from "next/link";
import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import type { QuoteStatus } from "@/lib/db/types";
import { formatDate, formatMoney } from "@/lib/i18n";
import { routes } from "@/lib/routes";
import type { CustomerQuoteRow } from "@/lib/customers/queries";
import { StatusChip, type ChipSeverity } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export const QUOTE_STATUS_SEVERITY: Record<QuoteStatus, ChipSeverity> = {
  draft: "neutral",
  pending_override: "amber",
  sent: "dark",
  won: "green",
  lost: "red",
};

export type CustomerQuotesTableProps = {
  quotes: CustomerQuoteRow[];
  content: Content;
  locale: Locale;
};

export function CustomerQuotesTable({ quotes, content, locale }: CustomerQuotesTableProps) {
  const h = content.quote.customers.history;
  const statusLabels = content.common.status;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{h.columns.number}</Th>
            <Th align="num">{h.columns.version}</Th>
            <Th>{h.columns.type}</Th>
            <Th>{h.columns.status}</Th>
            <Th align="num">{h.columns.date}</Th>
            <Th align="num">{h.columns.total}</Th>
          </tr>
        </thead>
        <tbody>
          {quotes.length === 0 ? (
            <tr className="row-muted">
              <Td colSpan={6} className="py-8 text-center">
                {h.empty}
              </Td>
            </tr>
          ) : (
            quotes.map((quote) => (
              <tr key={quote.id}>
                <Td>
                  <Link href={routes.quote(quote.id)} className="lnk mono font-bold">
                    {quote.number}
                  </Link>
                </Td>
                <Td align="num">v{quote.version}</Td>
                <Td>{h.types[quote.type]}</Td>
                <Td>
                  <StatusChip
                    severity={QUOTE_STATUS_SEVERITY[quote.status]}
                    label={statusLabels[quote.status]}
                  />
                </Td>
                <Td align="num">{formatDate(quote.sent_at ?? quote.created_at, locale)}</Td>
                <Td align="num" className="money">
                  {formatMoney(Number(quote.subtotal_price), quote.currency, locale)}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
