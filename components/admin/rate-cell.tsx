"use client";

/**
 * RateCell — one editable cell of the rate grid, chosen by column kind:
 * NumberInput, text Input, Select (with an empty option when nullable),
 * checkbox, or a button that opens the JSON sub-editor.
 * File path: /components/admin/rate-cell.tsx
 *
 * Every control is dense and carries aria-label = column label + row so
 * the grid is navigable with a screen reader; `invalid` marks the cell
 * after a server validation error (aria-invalid → red border).
 */

import { useContent } from "@/components/providers/locale";
import { Input, Select } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import type { ColumnDef } from "@/lib/admin/tables";
import { jsonSummary, optionLabel } from "@/components/admin/rate-format";

export type RateCellProps = {
  id: string;
  column: ColumnDef;
  value: unknown;
  label: string;
  onChange: (value: unknown) => void;
  onOpenJson?: () => void;
  disabled?: boolean;
  invalid?: boolean;
};

export function RateCell({ id, column, value, label, onChange, onOpenJson, disabled, invalid }: RateCellProps) {
  const c = useContent();
  switch (column.kind) {
    case "number":
      return (
        <NumberInput
          id={id}
          aria-label={label}
          dense
          value={typeof value === "number" ? value : value === null || value === undefined || value === "" ? null : Number(value)}
          onValueChange={onChange}
          decimals={column.decimals}
          min={column.min ?? 0}
          disabled={disabled}
          invalid={invalid}
          className="min-w-[96px]"
        />
      );
    case "text":
      return (
        <Input
          id={id}
          aria-label={label}
          dense
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
          maxLength={column.maxLength}
          disabled={disabled}
          invalid={invalid}
          className="min-w-[120px]"
        />
      );
    case "select":
      return (
        <Select
          id={id}
          aria-label={label}
          dense
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          disabled={disabled}
          invalid={invalid}
          className="min-w-[120px]"
        >
          {column.nullable && <option value="">{c.admin.rates.grid.none}</option>}
          {(column.options ?? []).map((option) => (
            <option key={option} value={option}>
              {optionLabel(c, column, option)}
            </option>
          ))}
        </Select>
      );
    case "bool":
      return (
        <input
          id={id}
          type="checkbox"
          className="checkbox"
          aria-label={label}
          checked={value === true || value === "true"}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          aria-invalid={invalid ? "true" : undefined}
        />
      );
    case "json":
      return (
        <button
          id={id}
          type="button"
          className={`btn btn-ghost btn-sm ${invalid ? "border-red text-red" : ""}`.trim()}
          onClick={onOpenJson}
          disabled={disabled}
          aria-label={`${label}: ${c.admin.rates.grid.edit}`}
        >
          {jsonSummary(c, column, value)}
        </button>
      );
  }
}
