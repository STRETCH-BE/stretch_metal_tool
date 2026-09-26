/**
 * RateDiffView — one rate table's diff against the active version: added
 * and removed rows in full, changed rows as key + column + old → new.
 * File path: /components/admin/rate-diff-view.tsx
 *
 * Server component over lib/admin/diff.ts results; numbers, booleans and
 * options are formatted like the grid, JSON columns show their full text.
 */

import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { interpolate } from "@/lib/format";
import type { LooseRow } from "@/lib/admin/db";
import type { DiffResult } from "@/lib/admin/diff";
import { RATE_TABLES, type RateTableName } from "@/lib/admin/tables";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { columnLabel, formatCellValue, jsonDetail } from "@/components/admin/rate-format";

function cell(content: Content, locale: Locale, table: RateTableName, column: string, value: unknown): string {
  const def = RATE_TABLES[table].columns.find((c) => c.name === column);
  if (!def) return String(value ?? "");
  if (def.kind === "json") return jsonDetail(value);
  return formatCellValue(content, locale, def, value);
}

export function RateDiffView({
  table,
  diff,
  content,
  locale,
}: {
  table: RateTableName;
  diff: DiffResult<LooseRow>;
  content: Content;
  locale: Locale;
}) {
  const t = content.admin.rates.diff;
  const def = RATE_TABLES[table];
  const summary = interpolate(t.summary, {
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
    unchanged: diff.unchanged,
  });
  const hasChanges = diff.added.length + diff.removed.length + diff.changed.length > 0;

  return (
    <Panel
      flush
      title={content.admin.rates.tables[table]}
      actions={<span className="num text-[12px] text-text-muted">{summary}</span>}
    >
      {!hasChanges && <p className="px-4 py-4 text-[13px] text-text-muted">{t.noChanges}</p>}
      {diff.changed.length > 0 && (
        <TableWrap>
          <Table dense>
            <thead>
              <tr>
                <Th>{t.changed}</Th>
                <Th>{t.column}</Th>
                <Th align="num">{t.before}</Th>
                <Th align="num">{t.after}</Th>
              </tr>
            </thead>
            <tbody>
              {diff.changed.flatMap((row) =>
                row.columns.map((column, index) => (
                  <tr key={`${row.key}-${column}`}>
                    <Td className="mono">
                      {index === 0 && <StatusChip severity="amber" plain label={row.key} />}
                    </Td>
                    <Td>{columnLabel(content, table, column)}</Td>
                    <Td align="num" muted>
                      {cell(content, locale, table, column, row.before?.[column])}
                    </Td>
                    <Td align="num" className="font-bold">
                      {cell(content, locale, table, column, row.after?.[column])}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {(["added", "removed"] as const).map((kind) => {
        const rows = diff[kind];
        if (rows.length === 0) return null;
        return (
          <TableWrap key={kind}>
            <Table dense>
              <thead>
                <tr>
                  <Th>{kind === "added" ? t.added : t.removed}</Th>
                  {def.columns.map((column) => (
                    <Th key={column.name} align={column.kind === "number" ? "num" : "left"}>
                      {columnLabel(content, table, column.name)}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const data = kind === "added" ? row.after : row.before;
                  return (
                    <tr key={row.key} className={kind === "removed" ? "row-muted" : undefined}>
                      <Td>
                        <StatusChip severity={kind === "added" ? "green" : "red"} plain label={row.key} />
                      </Td>
                      {def.columns.map((column) => (
                        <Td key={column.name} align={column.kind === "number" ? "num" : "left"}>
                          {cell(content, locale, table, column.name, data?.[column.name])}
                        </Td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        );
      })}
    </Panel>
  );
}
