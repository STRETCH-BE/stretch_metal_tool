"use client";

/**
 * MachineHourCalculator — inputs (persisted in localStorage only) →
 * live breakdown from lib/admin/machine-hour.ts → "use as machine rate in
 * a new rate version" form (createVersionFromMachineRateAction).
 * File path: /components/admin/machine-hour-calculator.tsx
 *
 * No database table: the inputs are a per-browser convenience
 * (STORAGE_KEY). Every localStorage access is wrapped so a blocked
 * storage never breaks the page. The rate posted to the server is the
 * canonical numeric string of the computed total.
 */

import { useActionState, useEffect, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { NumberInput } from "@/components/ui/number-input";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, Td, Th } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import {
  EMPTY_MACHINE_HOUR_INPUTS,
  MACHINE_HOUR_FIELDS,
  coerceMachineHourInputs,
  computeMachineHour,
  type MachineHourInputs,
} from "@/lib/admin/machine-hour";
import { createVersionFromMachineRateAction } from "@/lib/admin/calculator-actions";
import { INITIAL_USE_AS_RATE_STATE } from "@/lib/admin/calculator-types";

const STORAGE_KEY = "smtool.machine-hour.v1";

function readStored(): MachineHourInputs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? coerceMachineHourInputs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStored(inputs: MachineHourInputs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    // storage blocked — the calculator still works for this page view
  }
}

const HELP: Partial<Record<keyof MachineHourInputs, "utilisation" | "operatorShare" | "overhead" | "depreciation">> = {
  utilisationPct: "utilisation",
  operatorSharePct: "operatorShare",
  overheadPct: "overhead",
  usefulLifeYears: "depreciation",
};

export function MachineHourCalculator() {
  const c = useContent();
  const locale = useLocale();
  const t = c.admin.calculator;
  const [inputs, setInputs] = useState<MachineHourInputs>(EMPTY_MACHINE_HOUR_INPUTS);
  const [loaded, setLoaded] = useState(false);
  const [state, formAction] = useActionState(createVersionFromMachineRateAction, INITIAL_USE_AS_RATE_STATE);

  useEffect(() => {
    const stored = readStored();
    // Hydrate from browser storage after mount (SSR-safe: the server renders the empty inputs).
    if (stored) setInputs(stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) writeStored(inputs);
  }, [inputs, loaded]);

  const result = computeMachineHour(inputs);
  const money = (value: number) => formatNumber(value, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows: { key: keyof typeof t.breakdown; value: number; strong?: boolean }[] = [
    { key: "depreciation", value: result.depreciation },
    { key: "service", value: result.service },
    { key: "fixed", value: result.fixed },
    { key: "energy", value: result.energy },
    { key: "gas", value: result.gas },
    { key: "operator", value: result.operator },
    { key: "tooling", value: result.tooling },
    { key: "subtotal", value: result.subtotal, strong: true },
    { key: "overhead", value: result.overhead },
  ];

  const rateText = result.valid && result.total > 0 ? String(Math.round(result.total * 10000) / 10000) : "";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel
        title={t.sectionInputs}
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInputs(EMPTY_MACHINE_HOUR_INPUTS)}>
            {t.reset}
          </button>
        }
      >
        <p className="mb-5 text-[12.5px] text-text-faint">{t.storedHint}</p>
        <div className="grid gap-5 md:grid-cols-2">
          {MACHINE_HOUR_FIELDS.map((field) => {
            const helpKey = HELP[field];
            return (
              <Field key={field} label={t.fields[field]} htmlFor={`mh-${field}`} help={helpKey ? t.help[helpKey] : undefined}>
                <NumberInput
                  id={`mh-${field}`}
                  value={inputs[field]}
                  onValueChange={(v) => setInputs((current) => ({ ...current, [field]: v ?? 0 }))}
                  min={0}
                  decimals={field.endsWith("Pct") || field === "energyPriceEurPerKwh" ? 2 : undefined}
                />
              </Field>
            );
          })}
        </div>
      </Panel>

      <div className="flex flex-col gap-6">
        <Panel flush title={t.sectionResult}>
          {!result.valid && (
            <div className="px-4 pt-4">
              <Notice tone="info">{t.invalidInputs}</Notice>
            </div>
          )}
          <Table dense>
            <thead>
              <tr>
                <Th>{t.sectionResult}</Th>
                <Th align="num">{t.perHour}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={row.strong ? "font-bold" : undefined}>
                  <Td>{t.breakdown[row.key]}</Td>
                  <Td align="num">{money(row.value)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td>{t.breakdown.total}</Td>
                <Td align="num" className="money">
                  {money(result.total)} {t.perHour}
                </Td>
              </tr>
            </tfoot>
          </Table>
        </Panel>

        <Panel title={t.useAsRate.title}>
          <form action={formAction} className="flex flex-col gap-4" noValidate>
            <p className="text-[13px] text-text-muted">{t.useAsRate.body}</p>
            {state.status === "error" && state.error && (
              <Notice tone="error">{t.useAsRate[state.error]}</Notice>
            )}
            <input type="hidden" name="rate" value={rateText} />
            <Field label={t.useAsRate.rateLabel} htmlFor="mh-rate-display">
              <output id="mh-rate-display" className="money block text-[18px] font-bold">
                {money(result.total)} {t.perHour}
              </output>
            </Field>
            <Field label={t.useAsRate.label} htmlFor="mh-label" requiredLabel={c.common.ui.required}>
              <input
                id="mh-label"
                name="label"
                type="text"
                className="field"
                required
                maxLength={120}
                defaultValue={state.label ?? ""}
                placeholder={t.useAsRate.labelPlaceholder}
                autoComplete="off"
              />
            </Field>
            <div>
              <SubmitButton arrow disabled={!rateText}>
                {t.useAsRate.submit}
              </SubmitButton>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
