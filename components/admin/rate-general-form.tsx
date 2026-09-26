"use client";

/**
 * RateGeneralForm — the single-row rate_general table as a vertical
 * label/value form (twelve columns side by side would not fit 1024 px).
 * File path: /components/admin/rate-general-form.tsx
 *
 * Same contract as the grid: edits are local, Enter or Save calls
 * saveRateRow (ref {} → the version's one row), Escape reverts; the
 * JSON margin-by-class column opens the sub-editor modal.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition, type KeyboardEvent } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { PlaceholderBadge } from "@/components/ui/placeholder-badge";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { interpolate } from "@/lib/format";
import type { LooseRow } from "@/lib/admin/db";
import { saveRateRow } from "@/lib/admin/rates-actions";
import { RATE_TABLES } from "@/lib/admin/tables";
import { RateCell } from "@/components/admin/rate-cell";
import { JsonCellModal } from "@/components/admin/json-editors";
import { columnLabel, formatCellValue } from "@/components/admin/rate-format";

const TABLE = "general" as const;

function pick(row: LooseRow | null): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of RATE_TABLES[TABLE].columns) values[column.name] = row?.[column.name] ?? null;
  return values;
}

export function RateGeneralForm({
  versionId,
  row,
  editable,
}: {
  versionId: string;
  row: LooseRow | null;
  editable: boolean;
}) {
  const c = useContent();
  const locale = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const def = RATE_TABLES[TABLE];
  const t = c.admin.rates.grid;

  const [values, setValues] = useState(() => pick(row));
  const [original, setOriginal] = useState(() => pick(row));
  const [placeholder, setPlaceholder] = useState(Boolean(row?.placeholder));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [jsonColumn, setJsonColumn] = useState<string | null>(null);

  const [prevRow, setPrevRow] = useState(row);
  if (row !== prevRow) {
    setPrevRow(row);
    if (!dirty && !saving) {
      setValues(pick(row));
      setOriginal(pick(row));
      setPlaceholder(Boolean(row?.placeholder));
    }
  }

  const errorText = (code: string, message?: string) =>
    interpolate((c.admin.rates.errors as Record<string, string>)[code] ?? c.admin.rates.errors.generic, {
      message: message ?? "",
    });

  const setCell = (column: string, value: unknown) => {
    setValues((current) => ({ ...current, [column]: value }));
    setFieldErrors((current) => {
      const rest = { ...current };
      delete rest[column];
      return rest;
    });
    setDirty(true);
    setError(null);
  };

  const save = () => {
    if (!editable || saving) return;
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const result = await saveRateRow({ versionId, table: TABLE, ref: {}, values });
      setSaving(false);
      if (result.ok) {
        const fresh = pick(result.row);
        setValues(fresh);
        setOriginal(fresh);
        setPlaceholder(Boolean(result.row.placeholder));
        setDirty(false);
        setFieldErrors({});
        toast(t.saved, { tone: "success" });
        router.refresh();
      } else {
        setError(result.error === "validation" ? c.admin.rates.errors.validation : errorText(result.error, result.message));
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  };

  const revert = () => {
    setValues(original);
    setDirty(false);
    setError(null);
    setFieldErrors({});
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      save();
    } else if (event.key === "Escape" && dirty) {
      event.preventDefault();
      revert();
    }
  };

  const editingColumn = jsonColumn ? def.columns.find((col) => col.name === jsonColumn) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {placeholder && <PlaceholderBadge />}
        {dirty && <StatusChip severity="amber" label={t.unsaved} />}
        {!editable && <StatusChip severity="neutral" plain label={t.readOnly} />}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="max-w-[760px]">
        <Table dense>
          <thead>
            <tr>
              <Th>{c.admin.rates.diff.column}</Th>
              <Th align="num">{c.admin.rates.tables.general}</Th>
            </tr>
          </thead>
          <tbody onKeyDown={editable ? onKeyDown : undefined}>
            {def.columns.map((column) => (
              <tr key={column.name}>
                <Td>
                  <label htmlFor={`general-${column.name}`} className="font-bold">
                    {columnLabel(c, TABLE, column.name)}
                  </label>
                </Td>
                <Td align="num">
                  {editable ? (
                    <>
                      <RateCell
                        id={`general-${column.name}`}
                        column={column}
                        value={values[column.name]}
                        label={columnLabel(c, TABLE, column.name)}
                        onChange={(value) => setCell(column.name, value)}
                        onOpenJson={() => setJsonColumn(column.name)}
                        disabled={saving}
                        invalid={Boolean(fieldErrors[column.name])}
                      />
                      {fieldErrors[column.name] && (
                        <span className="field-error block">{errorText(fieldErrors[column.name])}</span>
                      )}
                    </>
                  ) : (
                    formatCellValue(c, locale, column, values[column.name])
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
              {saving ? t.saving : t.saveRow}
            </button>
            {dirty && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={revert} disabled={saving}>
                {t.revertRow}
              </button>
            )}
          </span>
          <span className="text-[12px] text-text-faint">{t.keyboardHint}</span>
        </div>
      )}
      {editingColumn && (
        <JsonCellModal
          key={editingColumn.name}
          column={editingColumn}
          value={values[editingColumn.name]}
          open
          onClose={() => setJsonColumn(null)}
          onApply={(value) => {
            setCell(editingColumn.name, value);
            setJsonColumn(null);
          }}
        />
      )}
    </div>
  );
}
