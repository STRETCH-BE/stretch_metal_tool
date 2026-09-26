/**
 * Display formatting of one rate-table cell (read-only grid, diff view).
 * File path: /components/admin/rate-format.ts
 *
 * Server-safe (pure): numbers per locale with the column's precision,
 * booleans and select options through content, JSON columns as a short
 * summary ("3 bands"). Also the client grid's read-only cells use it.
 */

import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatNumber, interpolate } from "@/lib/format";
import type { ColumnDef, RateTableName } from "@/lib/admin/tables";

export function columnLabel(content: Content, table: RateTableName, column: string): string {
  const labels = content.admin.rates.columns[table] as Record<string, string>;
  return labels[column] ?? column;
}

export function optionLabel(content: Content, column: ColumnDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return content.admin.rates.grid.none;
  const group = column.optionGroup
    ? (content.admin.rates.options[column.optionGroup] as Record<string, string>)
    : null;
  return group?.[String(value)] ?? String(value);
}

export function jsonSummary(content: Content, column: ColumnDef, value: unknown): string {
  const j = content.admin.rates.json;
  if (column.jsonKind === "marginByClass") {
    const count = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
    return count === 0 ? j.empty : interpolate(j.margins.summary, { count });
  }
  const count = Array.isArray(value) ? value.length : 0;
  if (count === 0) return j.empty;
  return interpolate(column.jsonKind === "priceBands" ? j.bands.summary : j.formats.summary, { count });
}

export function formatCellValue(content: Content, locale: Locale, column: ColumnDef, value: unknown): string {
  switch (column.kind) {
    case "number": {
      if (value === null || value === undefined || value === "") return content.admin.rates.grid.none;
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return formatNumber(n, locale, { maximumFractionDigits: column.decimals ?? 4 });
    }
    case "bool":
      return value === true || value === "true" ? content.admin.rates.grid.yes : content.admin.rates.grid.no;
    case "select":
      return optionLabel(content, column, value);
    case "json":
      return jsonSummary(content, column, value);
    default:
      return value === null || value === undefined || value === "" ? content.admin.rates.grid.none : String(value);
  }
}

/** Full JSON text for the diff view (compact, key-sorted by JSON.stringify order). */
export function jsonDetail(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
