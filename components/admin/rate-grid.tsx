"use client";

/**
 * RateGrid — dense editable grid for one rate table of a DRAFT version
 * (read-only rendering for active / used versions).
 * File path: /components/admin/rate-grid.tsx
 *
 * Rows are edited locally and saved one at a time through the
 * saveRateRow server action (Enter anywhere in the row, or the Save
 * button); Escape reverts the row; Tab moves between cells as native
 * inputs do. Add row appends a blank local row (saved on first Save);
 * Delete asks inline (ConfirmButton) and calls deleteRateRow. Server
 * validation errors come back as codes per column and mark the cells.
 *
 * Server re-renders (router.refresh after a save, another tab's import)
 * hand in a new `rows` array: it is merged during render — rows the user
 * is editing (dirty or saving) and unsaved new rows are kept, everything
 * else is replaced — so nothing typed is lost and nothing stale lingers.
 *
 * A yellow PlaceholderBadge marks rows still carrying seed values; saving
 * clears it (the action sets placeholder = false).
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PlaceholderBadge } from "@/components/ui/placeholder-badge";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { interpolate } from "@/lib/format";
import type { LooseRow } from "@/lib/admin/db";
import { deleteRateRow, saveRateRow } from "@/lib/admin/rates-actions";
import type { RateRowRef } from "@/lib/admin/rates-types";
import { RATE_TABLES, blankRateRow, rateRowKey, type RateTableName } from "@/lib/admin/tables";
import type { RateErrorCode } from "@/content/admin";
import { RateCell } from "@/components/admin/rate-cell";
import { JsonCellModal } from "@/components/admin/json-editors";
import { columnLabel, formatCellValue } from "@/components/admin/rate-format";

export type GridRow = {
  localId: string;
  ref: RateRowRef;
  values: Record<string, unknown>;
  original: Record<string, unknown>;
  placeholder: boolean;
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
};

function pickValues(table: RateTableName, row: LooseRow): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of RATE_TABLES[table].columns) values[column.name] = row[column.name] ?? null;
  return values;
}

export function refOf(table: RateTableName, row: LooseRow): RateRowRef {
  const def = RATE_TABLES[table];
  if (def.singleRow) return {};
  if (def.hasId) return { id: typeof row.id === "string" ? row.id : null };
  return { key: typeof row.code === "string" ? row.code : null };
}

function serverIdentity(table: RateTableName, ref: RateRowRef): string {
  return RATE_TABLES[table].singleRow ? "general" : (ref.id ?? ref.key ?? "");
}

export function toGridRow(table: RateTableName, row: LooseRow): GridRow {
  const values = pickValues(table, row);
  const ref = refOf(table, row);
  return {
    localId: `srv:${serverIdentity(table, ref)}`,
    ref,
    values,
    original: values,
    placeholder: Boolean(row.placeholder),
    isNew: false,
    dirty: false,
    saving: false,
    error: null,
    fieldErrors: {},
  };
}

/** Server rows win unless the local row is mid-edit; unsaved new rows stay. */
export function mergeRows(local: GridRow[], server: GridRow[]): GridRow[] {
  const localById = new Map(local.map((row) => [row.localId, row] as const));
  const merged = server.map((row) => {
    const current = localById.get(row.localId);
    return current && (current.dirty || current.saving) ? current : row;
  });
  for (const row of local) if (row.isNew) merged.push(row);
  return merged;
}

export type RateGridProps = {
  versionId: string;
  table: RateTableName;
  rows: LooseRow[];
  editable: boolean;
};

export function RateGrid({ versionId, table, rows, editable }: RateGridProps) {
  const c = useContent();
  const locale = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const def = RATE_TABLES[table];
  const t = c.admin.rates.grid;

  const [grid, setGrid] = useState<GridRow[]>(() => rows.map((row) => toGridRow(table, row)));
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setGrid(mergeRows(grid, rows.map((row) => toGridRow(table, row))));
  }
  const [jsonEdit, setJsonEdit] = useState<{ localId: string; column: string } | null>(null);
  const newSeq = useRef(0);

  const patchRow = (localId: string, patch: Partial<GridRow> | ((row: GridRow) => GridRow)) =>
    setGrid((current) =>
      current.map((row) =>
        row.localId === localId ? (typeof patch === "function" ? patch(row) : { ...row, ...patch }) : row
      )
    );

  const errorText = (code: RateErrorCode | string, message?: string): string => {
    const template = (c.admin.rates.errors as Record<string, string>)[code] ?? c.admin.rates.errors.generic;
    return interpolate(template, { message: message ?? "" });
  };

  const setCell = (localId: string, column: string, value: unknown) =>
    patchRow(localId, (row) => {
      const rest = { ...row.fieldErrors };
      delete rest[column];
      return { ...row, values: { ...row.values, [column]: value }, dirty: true, fieldErrors: rest, error: null };
    });

  const save = (row: GridRow) => {
    if (!editable || row.saving) return;
    patchRow(row.localId, { saving: true, error: null });
    startTransition(async () => {
      const result = await saveRateRow({ versionId, table, ref: row.ref, values: row.values });
      if (result.ok) {
        const fresh = toGridRow(table, result.row);
        setGrid((current) => current.map((r) => (r.localId === row.localId ? fresh : r)));
        toast(t.saved, { tone: "success" });
        router.refresh();
      } else {
        patchRow(row.localId, {
          saving: false,
          error: result.error === "validation" ? c.admin.rates.errors.validation : errorText(result.error, result.message),
          fieldErrors: result.fieldErrors ?? {},
        });
      }
    });
  };

  const revert = (row: GridRow) => {
    if (row.isNew) setGrid((current) => current.filter((r) => r.localId !== row.localId));
    else patchRow(row.localId, { values: row.original, dirty: false, error: null, fieldErrors: {} });
  };

  const remove = async (row: GridRow) => {
    if (row.isNew) {
      setGrid((current) => current.filter((r) => r.localId !== row.localId));
      return;
    }
    const result = await deleteRateRow({ versionId, table, ref: row.ref });
    if (result.ok) {
      setGrid((current) => current.filter((r) => r.localId !== row.localId));
      toast(t.deleted, { tone: "success" });
      router.refresh();
    } else {
      patchRow(row.localId, { error: errorText(result.error, result.message) });
    }
  };

  const addRow = () => {
    const localId = `new:${++newSeq.current}`;
    const values = blankRateRow(table);
    setGrid((current) => [
      ...current,
      {
        localId,
        ref: {},
        values,
        original: values,
        placeholder: false,
        isNew: true,
        dirty: true,
        saving: false,
        error: null,
        fieldErrors: {},
      },
    ]);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: GridRow) => {
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && !(target instanceof HTMLButtonElement) && !(target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      save(row);
    } else if (event.key === "Escape" && row.dirty) {
      event.preventDefault();
      revert(row);
    }
  };

  const editingRow = jsonEdit ? grid.find((row) => row.localId === jsonEdit.localId) : undefined;
  const editingColumn = jsonEdit ? def.columns.find((col) => col.name === jsonEdit.column) : undefined;
  const columnCount = def.columns.length + 2;

  return (
    <div className="flex flex-col gap-3">
      <TableWrap>
        <Table dense stickyHead>
          <thead>
            <tr>
              {def.columns.map((column) => (
                <Th key={column.name} align={column.kind === "number" ? "num" : "left"}>
                  {columnLabel(c, table, column.name)}
                </Th>
              ))}
              <Th>{t.placeholderColumn}</Th>
              {editable && <Th>{t.actionsColumn}</Th>}
            </tr>
          </thead>
          <tbody>
            {grid.length === 0 && (
              <tr className="row-muted">
                <Td colSpan={columnCount} className="py-6 text-center">
                  {t.noRows}
                </Td>
              </tr>
            )}
            {grid.map((row) => {
              const rowKey = row.isNew ? t.newRow : rateRowKey(table, row.values);
              const rowError = row.error;
              return (
                <tr
                  key={row.localId}
                  onKeyDown={editable ? (event) => onRowKeyDown(event, row) : undefined}
                  aria-label={interpolate(t.rowLabel, { key: rowKey })}
                  className={row.dirty ? "bg-surface" : undefined}
                >
                  {def.columns.map((column) => {
                    const invalid = Boolean(row.fieldErrors[column.name]);
                    const cellId = `${table}-${row.localId}-${column.name}`;
                    if (!editable) {
                      return (
                        <Td key={column.name} align={column.kind === "number" ? "num" : "left"} className={column.kind === "text" ? "mono" : undefined}>
                          {formatCellValue(c, locale, column, row.values[column.name])}
                        </Td>
                      );
                    }
                    return (
                      <Td key={column.name} align={column.kind === "number" ? "num" : "left"}>
                        <RateCell
                          id={cellId}
                          column={column}
                          value={row.values[column.name]}
                          label={`${columnLabel(c, table, column.name)} — ${rowKey}`}
                          onChange={(value) => setCell(row.localId, column.name, value)}
                          onOpenJson={() => setJsonEdit({ localId: row.localId, column: column.name })}
                          disabled={row.saving}
                          invalid={invalid}
                        />
                        {invalid && (
                          <span className="field-error block">{errorText(row.fieldErrors[column.name])}</span>
                        )}
                      </Td>
                    );
                  })}
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {row.placeholder && <PlaceholderBadge />}
                      {row.isNew && <StatusChip severity="neutral" label={t.newRow} />}
                      {row.dirty && !row.isNew && <StatusChip severity="amber" label={t.unsaved} />}
                    </span>
                    {rowError && (
                      <span className="field-error block" role="alert">
                        {rowError}
                      </span>
                    )}
                  </Td>
                  {editable && (
                    <Td>
                      <span className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!row.dirty || row.saving}
                          onClick={() => save(row)}
                        >
                          {row.saving ? t.saving : t.saveRow}
                        </button>
                        {row.dirty && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => revert(row)} disabled={row.saving}>
                            {t.revertRow}
                          </button>
                        )}
                        {!def.singleRow &&
                          (row.isNew ? (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(row)}>
                              {t.deleteRow}
                            </button>
                          ) : (
                            <ConfirmButton action={() => remove(row)} question={t.deleteRowQuestion} variant="ghost">
                              {t.deleteRow}
                            </ConfirmButton>
                          ))}
                      </span>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {editable && !def.singleRow ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}>
            {t.addRow}
          </button>
        ) : (
          <span />
        )}
        {editable ? (
          <span className="text-[12px] text-text-faint">{t.keyboardHint}</span>
        ) : (
          <StatusChip severity="neutral" plain label={t.readOnly} />
        )}
      </div>

      {editingRow && editingColumn && (
        <JsonCellModal
          key={`${editingRow.localId}-${editingColumn.name}`}
          column={editingColumn}
          value={editingRow.values[editingColumn.name]}
          open
          onClose={() => setJsonEdit(null)}
          onApply={(value) => {
            setCell(editingRow.localId, editingColumn.name, value);
            setJsonEdit(null);
          }}
        />
      )}
    </div>
  );
}
