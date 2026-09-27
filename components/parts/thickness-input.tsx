"use client";

/**
 * ThicknessInput — the thickness control of the part forms: a free number
 * in cost mode, a select of the material's benchmarked thicknesses in
 * market mode (lib/parts/material-choices.ts).
 * File path: /components/parts/thickness-input.tsx
 *
 * In the select, a current value that is not benchmarked stays selectable
 * (labelled "not benchmarked") so the form never silently changes a saved
 * value; `emptyLabel` is the null option (— not set — / — keep —). With no
 * material chosen in market mode the list is empty, so the select offers
 * only the null option and a hint tells the user to pick the material first.
 */

import { useContent, useLocale } from "@/components/providers/locale";
import { Select } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { formatMm } from "@/lib/format";
import type { MaterialChoice } from "@/lib/parts/material-choices";

export type ThicknessInputProps = {
  id: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** The chosen material (null = none chosen); `thicknessesMm === null` → free number. */
  choice: MaterialChoice | null;
  /** True when the version is a market version (select even before a material is chosen). */
  market: boolean;
  emptyLabel: string;
  disabled?: boolean;
  invalid?: boolean;
};

const EPS = 1e-6;

export function ThicknessInput({ id, value, onValueChange, choice, market, emptyLabel, disabled = false, invalid = false }: ThicknessInputProps) {
  const c = useContent();
  const locale = useLocale();
  const free = !market || (choice !== null && choice.thicknessesMm === null);
  if (free) {
    return <NumberInput id={id} value={value} onValueChange={onValueChange} min={0} decimals={2} dense disabled={disabled} invalid={invalid} />;
  }
  const options = choice?.thicknessesMm ?? [];
  const current = value !== null && !options.some((t) => Math.abs(t - value) < EPS) ? value : null;
  const label = (t: number) => `${formatMm(t, locale, 2)} mm`;
  return (
    <Select
      id={id}
      dense
      disabled={disabled}
      invalid={invalid}
      value={value === null ? "" : String(value)}
      onChange={(event) => onValueChange(event.target.value === "" ? null : Number(event.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {current !== null && (
        <option value={String(current)}>
          {label(current)} — {c.upload.part.material.notBenchmarked}
        </option>
      )}
      {options.map((t) => (
        <option key={t} value={String(t)}>
          {label(t)}
        </option>
      ))}
    </Select>
  );
}
