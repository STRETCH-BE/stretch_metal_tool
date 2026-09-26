/**
 * QuotesTable — dense quote list: number-version (link), customer, type,
 * status chip, parts count, net total in the quote currency, worst flag
 * chip (+ pending override count), updated, owner.
 * File path: /components/quote/quotes-table.tsx
 *
 * Server component: rows come pre-aggregated from lib/quotes/queries
 * listQuotes; formatting per the resolved locale, no client JavaScript.
 */

import Link from "next/link";
import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatDate, formatMoney, interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { quoteNumberLabel } from "@/lib/quotes/shared";
import type { QuoteListRow } from "@/lib/quotes/types";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { QuoteStatusChip } from "./quote-status-chip";

export type QuotesTableProps = {
  rows: QuoteListRow[];
  content: Content;
  locale: Locale;
  emptyMessage: string;
};

export function QuotesTable({ rows, content, locale, emptyMessage }: QuotesTableProps) {
  const t = content.quote.builder;
  const cols = t.list.columns;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{cols.number}</Th>
            <Th>{cols.customer}</Th>
            <Th>{cols.type}</Th>
            <Th>{cols.status}</Th>
            <Th align="num">{cols.parts}</Th>
            <Th align="num">{cols.total}</Th>
            <Th>{cols.flags}</Th>
            <Th align="num">{cols.updated}</Th>
            <Th>{cols.owner}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="row-muted">
              <Td colSpan={9} className="py-8 text-center">
                {emptyMessage}
              </Td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <Link href={routes.quote(row.id)} className="lnk mono font-bold">
                    {quoteNumberLabel(row)}
                  </Link>
                </Td>
                <Td muted={!row.customerName}>
                  {row.customerId && row.customerName ? (
                    <Link href={routes.customer(row.customerId)} className="lnk">
                      {row.customerName}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{t.types[row.type]}</Td>
                <Td>
                  <QuoteStatusChip status={row.status} content={content} />
                </Td>
                <Td align="num">{row.partsCount}</Td>
                <Td align="num" className="money">
                  {formatMoney(row.totalPrice, row.currency, locale)}
                </Td>
                <Td>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {row.worstSeverity ? (
                      <StatusChip severity={row.worstSeverity} label={content.common.severity[row.worstSeverity]} />
                    ) : (
                      <span className="text-text-faint">{t.list.noFlags}</span>
                    )}
                    {row.pendingOverrides > 0 && (
                      <StatusChip
                        severity="amber"
                        plain
                        label={interpolate(t.list.pendingOverrides, { count: row.pendingOverrides })}
                      />
                    )}
                  </span>
                </Td>
                <Td align="num">{formatDate(row.updatedAt, locale)}</Td>
                <Td muted={!row.ownerName}>{row.ownerName ?? "—"}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
