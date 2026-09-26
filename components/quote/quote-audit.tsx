/**
 * QuoteAudit — the last audit entries about a quote (who, when, what).
 * Server-safe; action codes are mapped through content.quote.builder
 * .audit.actions with the raw code as fallback.
 * File path: /components/quote/quote-audit.tsx
 */

import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatDateTime } from "@/lib/format";
import type { QuoteAuditRow } from "@/lib/quotes/types";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export function QuoteAudit({ rows, content, locale }: { rows: QuoteAuditRow[]; content: Content; locale: Locale }) {
  const t = content.quote.builder.audit;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th align="num">{t.columns.when}</Th>
            <Th>{t.columns.who}</Th>
            <Th>{t.columns.action}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="row-muted">
              <Td colSpan={3} className="py-6 text-center">
                {t.empty}
              </Td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <Td align="num">{formatDateTime(row.at, locale)}</Td>
                <Td muted={!row.actorName}>{row.actorName ?? "—"}</Td>
                <Td>{t.actions[row.action] ?? row.action}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
