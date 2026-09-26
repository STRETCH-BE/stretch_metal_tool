"use client";

/**
 * MachineForm — typed limits form per machine kind on top of the limits
 * JSON, with a raw-JSON fallback view; posts name + limits (JSON string)
 * to updateMachineAction.
 * File path: /components/admin/machine-form.tsx
 *
 * The typed form edits a plain object (state) shaped like the kind's
 * limits type; on submit it is serialised into the hidden `limits`
 * field. The raw view edits the same JSON as text. Server validation
 * issues (zod path + message) are listed under the form, and the
 * submitted texts are echoed back so React 19's form reset loses nothing.
 */

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { NumberInput } from "@/components/ui/number-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { interpolate } from "@/lib/format";
import type { MachineRow, MaterialFamilyDb, WeldProcessDb } from "@/lib/db/types";
import { INITIAL_MACHINE_FORM_STATE, type MachineFormState } from "@/lib/admin/machines";
import { MATERIAL_FAMILIES, WELD_PROCESSES } from "@/lib/admin/tables";

type Limits = Record<string, unknown>;

function asRecord(value: unknown): Limits {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Limits) } : {};
}

function numberAt(limits: Limits, key: string): number | null {
  const v = limits[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function familyNumber(limits: Limits, key: string, family: MaterialFamilyDb): number | null {
  const record = asRecord(limits[key]);
  const v = record[family];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function familyPair(limits: Limits, family: MaterialFamilyDb, index: 0 | 1): number | null {
  const record = asRecord(limits.wallThicknessMm);
  const pair = record[family];
  const v = Array.isArray(pair) ? pair[index] : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function MachineForm({
  machine,
  action,
}: {
  machine: MachineRow;
  action: (state: MachineFormState, formData: FormData) => Promise<MachineFormState>;
}) {
  const c = useContent();
  const t = c.admin.machines.edit;
  const { toast } = useToast();
  const [state, formAction] = useActionState(action, INITIAL_MACHINE_FORM_STATE);
  const [mode, setMode] = useState<"typed" | "raw">("typed");
  const [limits, setLimits] = useState<Limits>(() => asRecord(machine.limits));
  const [rawText, setRawText] = useState(() => JSON.stringify(machine.limits, null, 2));
  const handled = useRef<MachineFormState | null>(null);

  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "saved") {
      toast(t.saved, { tone: "success" });
      if (state.machine) {
        setLimits(asRecord(state.machine.limits));
        setRawText(JSON.stringify(state.machine.limits, null, 2));
      }
    }
  }, [state, toast, t.saved]);

  const serialised = useMemo(() => JSON.stringify(limits), [limits]);
  const limitsField = mode === "typed" ? serialised : rawText;

  const set = (key: string, value: unknown) => setLimits((current) => ({ ...current, [key]: value }));
  const setFamily = (key: string, family: MaterialFamilyDb, value: number | null) =>
    setLimits((current) => ({ ...current, [key]: { ...asRecord(current[key]), [family]: value } }));
  const setPair = (family: MaterialFamilyDb, index: 0 | 1, value: number | null) =>
    setLimits((current) => {
      const record = asRecord(current.wallThicknessMm);
      const existing = Array.isArray(record[family]) ? [...(record[family] as unknown[])] : [null, null];
      existing[index] = value;
      return { ...current, wallThicknessMm: { ...record, [family]: existing } };
    });

  const switchMode = (next: string) => {
    if (next === mode) return;
    if (next === "raw") {
      setRawText(JSON.stringify(limits, null, 2));
      setMode("raw");
    } else {
      try {
        setLimits(asRecord(JSON.parse(rawText)));
        setMode("typed");
      } catch {
        toast(c.admin.machines.errors.invalidJson, { tone: "error" });
      }
    }
  };

  const numberField = (key: string, label: string, decimals = 1) => (
    <Field key={key} label={label} htmlFor={`m-${key}`}>
      <NumberInput
        id={`m-${key}`}
        value={numberAt(limits, key)}
        onValueChange={(v) => set(key, v)}
        decimals={decimals}
        min={0}
      />
    </Field>
  );

  const kindFields = () => {
    switch (machine.kind) {
      case "flat_laser": {
        const f = t.fields.flat_laser;
        return (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              {numberField("bedLengthMm", f.bedLengthMm, 0)}
              {numberField("bedWidthMm", f.bedWidthMm, 0)}
              {numberField("zMm", f.zMm, 0)}
              {numberField("edgeMarginMm", f.edgeMarginMm, 1)}
            </div>
            <FamilyGrid title={`${f.maxThicknessMm} — ${t.perFamily}`}>
              {MATERIAL_FAMILIES.map((family) => (
                <Field key={family} label={t.families[family]} htmlFor={`m-max-${family}`}>
                  <NumberInput
                    id={`m-max-${family}`}
                    value={familyNumber(limits, "maxThicknessMm", family)}
                    onValueChange={(v) => setFamily("maxThicknessMm", family, v)}
                    decimals={2}
                    min={0}
                  />
                </Field>
              ))}
            </FamilyGrid>
          </>
        );
      }
      case "tube_laser": {
        const f = t.fields.tube_laser;
        return (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              {numberField("maxRoundDiameterMm", f.maxRoundDiameterMm, 0)}
              {numberField("maxRectSideMm", f.maxRectSideMm, 0)}
              {numberField("maxCircumscribedMm", f.maxCircumscribedMm, 0)}
              {numberField("maxLengthMm", f.maxLengthMm, 0)}
              {numberField("maxKgPerM", f.maxKgPerM, 1)}
              {numberField("maxRawWeightKg", f.maxRawWeightKg, 1)}
            </div>
            <FamilyGrid title={`${f.wallThicknessMm} — ${t.perFamily}`}>
              {MATERIAL_FAMILIES.map((family) => (
                <div key={family} className="flex flex-col gap-2">
                  <span className="field-label">{t.families[family]}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {([0, 1] as const).map((index) => (
                      <Field
                        key={index}
                        label={index === 0 ? f.modeA : f.modeB}
                        htmlFor={`m-wall-${family}-${index}`}
                      >
                        <NumberInput
                          id={`m-wall-${family}-${index}`}
                          dense
                          value={familyPair(limits, family, index)}
                          onValueChange={(v) => setPair(family, index, v)}
                          decimals={2}
                          min={0}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              ))}
            </FamilyGrid>
          </>
        );
      }
      case "press_brake": {
        const f = t.fields.press_brake;
        return (
          <div className="grid gap-5 md:grid-cols-2">
            {numberField("forceKN", f.forceKN, 0)}
            {numberField("bendLengthMm", f.bendLengthMm, 0)}
            {numberField("betweenColumnsMm", f.betweenColumnsMm, 0)}
            {numberField("openHeightMm", f.openHeightMm, 0)}
            {numberField("dieFactor", f.dieFactor, 2)}
          </div>
        );
      }
      case "roll": {
        const f = t.fields.roll;
        return (
          <div className="grid gap-5 md:grid-cols-2">
            {numberField("maxWidthMm", f.maxWidthMm, 0)}
            {numberField("minRadiusMm", f.minRadiusMm, 0)}
            {numberField("maxThicknessMm", f.maxThicknessMm, 2)}
          </div>
        );
      }
      case "weld": {
        const selected = new Set(Array.isArray(limits.processes) ? (limits.processes as string[]) : []);
        const toggle = (process: WeldProcessDb, on: boolean) => {
          const next = WELD_PROCESSES.filter((p) => (p === process ? on : selected.has(p)));
          set("processes", next);
        };
        return (
          <fieldset className="flex flex-col gap-2">
            <legend className="field-label">{t.fields.weld.processes}</legend>
            {WELD_PROCESSES.map((process) => (
              <label key={process} className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={selected.has(process)}
                  onChange={(event) => toggle(process, event.target.checked)}
                />
                {t.processes[process]}
              </label>
            ))}
          </fieldset>
        );
      }
    }
  };

  const errorMessage =
    state.status === "error" && state.error
      ? interpolate(c.admin.machines.errors[state.error], { message: state.message ?? "" })
      : null;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {errorMessage && <Notice tone="error">{errorMessage}</Notice>}
      {state.status === "error" && state.issues && state.issues.length > 0 && (
        <div className="text-[13px]">
          <p className="font-bold text-red">{t.issuesTitle}</p>
          <ul className="mono list-none text-[12px]">
            {state.issues.map((issue, index) => (
              <li key={index}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label={t.name} htmlFor="machine-name" requiredLabel={c.common.ui.required}>
        <Input
          id="machine-name"
          name="name"
          defaultValue={state.status === "error" ? (state.nameText ?? machine.name) : machine.name}
          maxLength={160}
          required
          className="max-w-[480px]"
        />
      </Field>

      <input type="hidden" name="limits" value={limitsField} />

      <Tabs
        ariaLabel={t.sectionLimits}
        items={[
          { value: "typed", label: t.modeTyped },
          { value: "raw", label: t.modeRaw },
        ]}
        value={mode}
        onChange={switchMode}
      />

      {mode === "typed" ? (
        <div className="flex flex-col gap-6">{kindFields()}</div>
      ) : (
        <Field label={t.rawLabel} htmlFor="machine-limits-raw" help={t.rawHelp}>
          <Textarea
            id="machine-limits-raw"
            rows={16}
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            className="mono"
            spellCheck={false}
          />
        </Field>
      )}

      <div className="flex justify-end border-t border-border pt-5">
        <SubmitButton arrow>{t.save}</SubmitButton>
      </div>
    </form>
  );
}

function FamilyGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="panel-title mb-2">{title}</legend>
      <div className="grid gap-4 md:grid-cols-3">{children}</div>
    </fieldset>
  );
}
