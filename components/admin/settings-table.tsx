"use client";

/**
 * SettingsTable — dense table whose every row is an inline form: the
 * cells are inputs, Enter or the Save button writes the row through the
 * given action, a blank row at the bottom adds one, a confirm-step
 * button deletes. Shared by the VAT, packaging, shipping, job-setup and
 * weld-speed settings pages (components/admin/settings-row-tables.tsx
 * declares the columns and maps values to the typed actions).
 * File path: /components/admin/settings-table.tsx
 *
 * Values are edited as text (numbers as the user types them, "1,5" or
 * "1.5" — the actions parse them) so the table never formats behind the
 * user's back. Rows are keyed by natural key + updated_at: a save
 * revalidates the page, the server sends fresh rows, and the changed row
 * remounts with its confirmed values (placeholder chip → confirmed). Key
 * columns of an existing row are read-only text — the natural key is how
 * the action finds the row; a new key is a new row. The placeholder column
 * shows the amber "placeholder — confirm" chip until the admin saves the
 * row once; tables without a placeholder column (VAT) hide it.
 */

import { useState, useTransition, type KeyboardEvent } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Input, Select } from "@/components/ui/field";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, interpolate } from "@/lib/format";
import type { SettingsActionResult } from "@/lib/admin/settings-types";

export type SettingsColumn = {
  name: string;
  label: string;
  kind: "text" | "number" | "select";
  options?: readonly { value: string; label: string }[];
  /** Natural key: read-only on existing rows, editable on the add row. */
  keyField?: boolean;
  required?: boolean;
  maxLength?: number;
  /** Cell width hint. */
  width?: "xs" | "sm" | "md" | "lg";
};

export type SettingsEditableRow = {
  /** Natural key (also the React key together with updatedAt). */
  key: string;
  /** Column values as text, plus hidden pass-through values such as `id`. */
  values: Record<string, string>;
  /** null = the table has no placeholder column. */
  placeholder: boolean | null;
  updatedAt: string | null;
};

export type SettingsTableProps = {
  columns: SettingsColumn[];
  rows: SettingsEditableRow[];
  /** Blank values of the add row; omit to disable adding. */
  blank?: Record<string, string>;
  save: (values: Record<string, string>, existing: boolean) => Promise<SettingsActionResult>;
  remove?: (values: Record<string, string>) => Promise<SettingsActionResult>;
  /** Show the placeholder / confirmed chip column. */
  placeholderColumn: boolean;
  emptyText: string;
};

const WIDTH: Record<NonNullable<SettingsColumn["width"]>, string> = {
  xs: "w-[90px] min-w-[90px]",
  sm: "w-[130px] min-w-[130px]",
  md: "w-[200px] min-w-[200px]",
  lg: "w-[280px] min-w-[280px]",
};

/** Error toast text for a failed action: the code's copy plus the field label when the action names one. */
export function settingsErrorText(
  result: Extract<SettingsActionResult, { ok: false }>,
  errors: Record<Extract<SettingsActionResult, { ok: false }>["error"], string>,
  fieldPrefix: string,
  fieldLabels: Record<string, string>
): string {
  const parts = [errors[result.error]];
  if (result.field) parts.push(interpolate(fieldPrefix, { field: fieldLabels[result.field] ?? result.field }));
  if (result.message) parts.push(`(${result.message})`);
  return parts.join(" ");
}

function EditorRow({
  columns,
  row,
  isNew,
  save,
  remove,
  placeholderColumn,
  onAdded,
}: {
  columns: SettingsColumn[];
  row: SettingsEditableRow;
  isNew: boolean;
  save: SettingsTableProps["save"];
  remove?: SettingsTableProps["remove"];
  placeholderColumn: boolean;
  onAdded?: () => void;
}) {
  const c = useContent();
  const locale = useLocale();
  const t = c.admin.settings;
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(row.values);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldLabels = Object.fromEntries(columns.map((col) => [col.name, col.label]));

  const set = (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value }));

  const submit = () =>
    startTransition(async () => {
      const result = await save(values, !isNew);
      if (result.ok) {
        setInvalidField(null);
        toast(t.notices.saved, { tone: "success" });
        if (isNew) {
          setValues(row.values);
          onAdded?.();
        }
      } else {
        setInvalidField(result.field ?? null);
        toast(settingsErrorText(result, t.errors, t.fieldPrefix, fieldLabels), { tone: "error" });
      }
    });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && !pending) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <tr className={isNew ? "row-muted" : undefined}>
      {columns.map((col) => {
        const value = values[col.name] ?? "";
        const readOnly = col.keyField && !isNew;
        const id = `${isNew ? "new" : row.key}-${col.name}`;
        return (
          <Td key={col.name} align={col.kind === "number" ? "num" : undefined} className={col.width ? WIDTH[col.width] : undefined}>
            {readOnly ? (
              <span className="mono font-bold">{col.options?.find((o) => o.value === value)?.label ?? value}</span>
            ) : col.kind === "select" ? (
              <Select
                id={id}
                aria-label={col.label}
                value={value}
                onChange={(event) => set(col.name, event.target.value)}
                onKeyDown={onKeyDown}
                disabled={pending}
                invalid={invalidField === col.name}
                dense
              >
                {col.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                aria-label={col.label}
                value={value}
                onChange={(event) => set(col.name, event.target.value)}
                onKeyDown={onKeyDown}
                disabled={pending}
                invalid={invalidField === col.name}
                inputMode={col.kind === "number" ? "decimal" : undefined}
                maxLength={col.maxLength}
                required={col.required}
                num={col.kind === "number"}
                dense
              />
            )}
          </Td>
        );
      })}
      {placeholderColumn && (
        <Td>
          {isNew || row.placeholder === null ? null : row.placeholder ? (
            <StatusChip severity="amber" plain label={t.placeholderChip} />
          ) : (
            <StatusChip severity="green" plain label={t.confirmedChip} />
          )}
        </Td>
      )}
      <Td className="num whitespace-nowrap" muted>
        {row.updatedAt && !isNew ? formatDateTime(row.updatedAt, locale) : ""}
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={submit}>
            {isNew ? t.actions.add : t.actions.save}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </button>
          {!isNew && remove && (
            <ConfirmButton
              question={t.actions.deleteQuestion}
              variant="danger"
              disabled={pending}
              action={async () => {
                const result = await remove(values);
                toast(result.ok ? t.notices.deleted : settingsErrorText(result, t.errors, t.fieldPrefix, fieldLabels), {
                  tone: result.ok ? "success" : "error",
                });
              }}
            >
              {t.actions.delete}
            </ConfirmButton>
          )}
        </div>
      </Td>
    </tr>
  );
}

export function SettingsTable({ columns, rows, blank, save, remove, placeholderColumn, emptyText }: SettingsTableProps) {
  const c = useContent();
  const t = c.admin.settings;
  // Remount the add row after a successful add so it clears to the blank values.
  const [addKey, setAddKey] = useState(0);

  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            {columns.map((col) => (
              <Th key={col.name} align={col.kind === "number" ? "num" : undefined}>
                {col.label}
              </Th>
            ))}
            {placeholderColumn && <Th>{t.columns.placeholder}</Th>}
            <Th align="num">{t.columns.updated}</Th>
            <Th>{t.columns.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !blank && (
            <tr>
              <td colSpan={columns.length + (placeholderColumn ? 3 : 2)} className="px-4 py-6 text-[13.5px] text-text-muted">
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <EditorRow
              key={`${row.key}:${row.updatedAt ?? ""}`}
              columns={columns}
              row={row}
              isNew={false}
              save={save}
              remove={remove}
              placeholderColumn={placeholderColumn}
            />
          ))}
          {blank && (
            <EditorRow
              key={`new:${addKey}`}
              columns={columns}
              row={{ key: "new", values: blank, placeholder: null, updatedAt: null }}
              isNew
              save={save}
              placeholderColumn={placeholderColumn}
              onAdded={() => setAddKey((k) => k + 1)}
            />
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
