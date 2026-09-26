/**
 * AuditTable — dense audit log rows: when, who, action, entity, id (linked
 * for quotes / customers / rate versions) and a native <details> with the
 * before/after JSON (pre, monospace).
 * File path: /components/admin/audit-table.tsx
 *
 * Server component: no JavaScript needed for the expand — <details> is
 * keyboard operable by itself.
 */

import Link from "next/link";
import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { AuditListRow } from "@/lib/admin/audit";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export function entityHref(entity: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entity) {
    case "quotes":
      return routes.quote(entityId);
    case "customers":
      return routes.customer(entityId);
    case "rate_versions":
      return routes.adminRateVersion(entityId);
    case "machines":
      return routes.adminMachine(entityId);
    default:
      return null;
  }
}

function JsonBlock({ label, value, none }: { label: string; value: unknown; none: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="field-label">{label}</p>
      {value === null || value === undefined ? (
        <p className="text-[12px] text-text-faint">{none}</p>
      ) : (
        <pre className="mono max-h-[320px] overflow-auto border border-border bg-surface p-2 text-[11.5px] leading-[1.45] whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditTable({ rows, content, locale }: { rows: AuditListRow[]; content: Content; locale: Locale }) {
  const t = content.admin.audit;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{t.columns.at}</Th>
            <Th>{t.columns.actor}</Th>
            <Th>{t.columns.action}</Th>
            <Th>{t.columns.entity}</Th>
            <Th>{t.columns.entityId}</Th>
            <Th>{t.columns.details}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="row-muted">
              <Td colSpan={6} className="py-8 text-center">
                {t.empty}
              </Td>
            </tr>
          )}
          {rows.map((row) => {
            const href = entityHref(row.entity, row.entity_id);
            return (
              <tr key={row.id}>
                <Td className="num whitespace-nowrap">{formatDateTime(row.at, locale)}</Td>
                <Td muted={!row.actorName}>{row.actorName ?? t.system}</Td>
                <Td className="mono">{row.action}</Td>
                <Td className="mono">{row.entity}</Td>
                <Td className="mono">
                  {href ? (
                    <Link href={href} className="lnk" title={t.openEntity}>
                      {row.entity_id}
                    </Link>
                  ) : (
                    (row.entity_id ?? "—")
                  )}
                </Td>
                <Td>
                  {row.before === null && row.after === null ? (
                    <span className="text-text-faint">{t.details.none}</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-[12px] font-bold tracking-[0.08em] uppercase">
                        {t.details.expand}
                      </summary>
                      <div className="mt-2 flex min-w-[420px] gap-3">
                        <JsonBlock label={t.details.before} value={row.before} none={t.details.none} />
                        <JsonBlock label={t.details.after} value={row.after} none={t.details.none} />
                      </div>
                    </details>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}
