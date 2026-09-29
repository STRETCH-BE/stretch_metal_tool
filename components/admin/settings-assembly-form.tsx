"use client";

/**
 * AssemblyRatesForm — the single assembly_rates row (labour rate, gas and
 * wire, tack seconds, fit-up / deburr / handling minutes, distortion
 * factor, step-bend seconds, roll minutes) as a .field grid with one Save.
 * File path: /components/admin/settings-assembly-form.tsx
 *
 * Controlled text values seeded from the row (keyed by updated_at in the
 * page so a save remounts it), parsed by saveAssemblyRates. When the row
 * is still the migration's calibration placeholder the amber chip sits by
 * the title; saving once — even unchanged — confirms it.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";
import { useToast } from "@/components/ui/toast";
import { formatNumberInput } from "@/lib/number-input";
import { JOB_RATE_DEFAULTS } from "@/lib/pricing/job-rates";
import type { AssemblyRatesRow } from "@/lib/db/types";
import { ASSEMBLY_RATE_FIELDS, type AssemblyRateField, type AssemblyRatesInput, type SettingsActionResult } from "@/lib/admin/settings-types";
import { saveAssemblyRates } from "@/lib/admin/settings-actions";
import { settingsErrorText } from "@/components/admin/settings-table";

/** Column → engine default of the seeded calibration placeholder (shown when the row is missing). */
const DEFAULTS: Record<AssemblyRateField, number> = {
  labour_rate_eur_h: JOB_RATE_DEFAULTS.assembly.labourRateEurH,
  gas_wire_eur_h: JOB_RATE_DEFAULTS.assembly.gasWireEurH,
  tack_seconds: JOB_RATE_DEFAULTS.assembly.tackSeconds,
  fitup_min_per_part: JOB_RATE_DEFAULTS.assembly.fitupMinPerPart,
  deburr_min_per_part: JOB_RATE_DEFAULTS.assembly.deburrMinPerPart,
  handling_min_per_assembly: JOB_RATE_DEFAULTS.assembly.handlingMinPerAssembly,
  distortion_factor: JOB_RATE_DEFAULTS.assembly.distortionFactor,
  step_bend_seconds_per_hit: JOB_RATE_DEFAULTS.assembly.stepBendSecondsPerHit,
  roll_min_per_m: JOB_RATE_DEFAULTS.assembly.rollMinPerM,
};

export function AssemblyRatesForm({ row }: { row: AssemblyRatesRow | null }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.admin.settings;
  const f = t.assembly.fields;
  const { toast } = useToast();
  const [values, setValues] = useState<AssemblyRatesInput>(() => {
    const out = {} as AssemblyRatesInput;
    for (const field of ASSEMBLY_RATE_FIELDS) {
      out[field] = formatNumberInput(row ? row[field] : DEFAULTS[field], locale, { maxDecimals: 4, grouping: false });
    }
    return out;
  });
  const [failure, setFailure] = useState<Extract<SettingsActionResult, { ok: false }> | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveAssemblyRates(values);
      if (result.ok) {
        setFailure(null);
        toast(t.notices.saved, { tone: "success" });
      } else {
        setFailure(result);
        toast(t.errors[result.error], { tone: "error" });
      }
    });
  };

  const placeholder = row === null || row.placeholder;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {placeholder ? <StatusChip severity="amber" label={t.placeholderChip} /> : <StatusChip severity="green" label={t.confirmedChip} />}
      </div>
      {failure && <Notice tone="error">{settingsErrorText(failure, t.errors, t.fieldPrefix, f)}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ASSEMBLY_RATE_FIELDS.map((field) => (
          <Field key={field} label={f[field]} htmlFor={`assembly-${field}`} help={field === "distortion_factor" ? t.assembly.distortionHelp : undefined}>
            <Input
              id={`assembly-${field}`}
              value={String(values[field])}
              onChange={(event) => setValues((prev) => ({ ...prev, [field]: event.target.value }))}
              inputMode="decimal"
              disabled={pending}
              invalid={failure?.field === field}
              required
              num
              dense
            />
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? c.common.actions.saving : t.actions.save}
          <span aria-hidden="true" className="btn-arrow">
            →
          </span>
        </button>
      </div>
    </form>
  );
}
