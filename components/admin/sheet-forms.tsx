"use client";

/**
 * Sheet-metal admin forms — clone a bend-table version, activate one,
 * add / correct a bend row from a test bend, a press-brake tool, a
 * hardware name rule; each with its delete button. Client components
 * around the server actions of lib/admin/sheetmetal-actions.ts.
 * File path: /components/admin/sheet-forms.tsx
 *
 * Every form is an "add or correct" upsert on the natural key: the
 * table rows above it show what exists, the form saves a row with the
 * same key over it. Results toast; error codes map to
 * content.admin.sheet.errors.
 */

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useToast } from "@/components/ui/toast";
import { MATERIAL_FAMILIES } from "@/lib/admin/tables";
import { INITIAL_SHEET_FORM_STATE, type SheetFormState } from "@/lib/admin/sheetmetal";
import type { BendTableRowDb, HardwareNameRow, PressBrakeToolRow } from "@/lib/db/types";
import {
  activateBendTableVersionAction,
  cloneBendTableVersionAction,
  deleteBendRowAction,
  deleteHardwareNameAction,
  deleteToolAction,
  saveBendRowAction,
  saveHardwareNameAction,
  saveToolAction,
} from "@/lib/admin/sheetmetal-actions";

type Action = (state: SheetFormState, formData: FormData) => Promise<SheetFormState>;

/** Toasts a saved state once and shows the error notice for an error state. */
function useFormOutcome(state: SheetFormState, savedText: string) {
  const c = useContent();
  const { toast } = useToast();
  const handled = useRef<SheetFormState | null>(null);
  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "saved") toast(savedText, { tone: "success" });
  }, [state, toast, savedText]);
  return state.status === "error" ? (
    <Notice tone="error">
      {c.admin.sheet.errors[state.error]}
      {state.message ? ` (${state.message})` : ""}
      {state.field ? ` — ${state.field}` : ""}
    </Notice>
  ) : null;
}

export function BendCloneForm({ sourceId }: { sourceId: string }) {
  const c = useContent();
  const t = c.admin.sheet.bendTable;
  const id = useId();
  const [state, formAction] = useActionState<SheetFormState, FormData>(cloneBendTableVersionAction.bind(null, sourceId) as Action, INITIAL_SHEET_FORM_STATE);
  const notice = useFormOutcome(state, t.notices.cloned);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field label={t.cloneLabel} htmlFor={`${id}-label`} className="min-w-[240px]">
        <Input id={`${id}-label`} name="label" required maxLength={120} dense />
      </Field>
      <SubmitButton variant="ghost" size="sm">
        {t.cloneSubmit}
      </SubmitButton>
      {notice}
    </form>
  );
}

export function BendActivateButton({ versionId, disabled }: { versionId: string; disabled?: boolean }) {
  const c = useContent();
  const t = c.admin.sheet.bendTable;
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  return (
    <ConfirmButton
      question={t.activateQuestion}
      disabled={disabled}
      action={() =>
        startTransition(async () => {
          const result = await activateBendTableVersionAction(versionId);
          toast(result.status === "saved" ? t.notices.activated : c.admin.sheet.errors[result.status === "error" ? result.error : "db"], { tone: result.status === "saved" ? "success" : "error" });
        })
      }
    >
      {t.activate}
    </ConfirmButton>
  );
}

export function BendRowForm({ versionId, disabled }: { versionId: string; disabled?: boolean }) {
  const c = useContent();
  const t = c.admin.sheet.bendTable.version;
  const id = useId();
  const [state, formAction] = useActionState<SheetFormState, FormData>(saveBendRowAction.bind(null, versionId) as Action, INITIAL_SHEET_FORM_STATE);
  const notice = useFormOutcome(state, c.admin.sheet.bendTable.notices.saved);
  const f = t.fields;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-[13px] text-text-muted">{t.addHelp}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={f.family} htmlFor={`${id}-family`}>
          <Select id={`${id}-family`} name="material_family" defaultValue="mild_steel" dense disabled={disabled}>
            {MATERIAL_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {c.admin.rates.options.family[family]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={f.thickness} htmlFor={`${id}-t`}>
          <Input id={`${id}-t`} name="thickness_mm" inputMode="decimal" required dense disabled={disabled} />
        </Field>
        <Field label={f.radius} htmlFor={`${id}-r`}>
          <Input id={`${id}-r`} name="inner_radius_mm" inputMode="decimal" required dense disabled={disabled} />
        </Field>
        <Field label={f.vDie} htmlFor={`${id}-v`}>
          <Input id={`${id}-v`} name="v_die_mm" inputMode="decimal" dense disabled={disabled} />
        </Field>
        <Field label={f.angle} htmlFor={`${id}-a`}>
          <Input id={`${id}-a`} name="angle_deg" inputMode="decimal" defaultValue="90" dense disabled={disabled} />
        </Field>
        <Field label={f.allowance} htmlFor={`${id}-ba`} help={t.computedHelp}>
          <Input id={`${id}-ba`} name="bend_allowance_mm" inputMode="decimal" dense disabled={disabled} />
        </Field>
        <Field label={f.flatLength} htmlFor={`${id}-flat`}>
          <Input id={`${id}-flat`} name="flat_length_mm" inputMode="decimal" dense disabled={disabled} />
        </Field>
        <Field label={f.legA} htmlFor={`${id}-la`}>
          <Input id={`${id}-la`} name="leg_a_mm" inputMode="decimal" dense disabled={disabled} />
        </Field>
        <Field label={f.legB} htmlFor={`${id}-lb`}>
          <Input id={`${id}-lb`} name="leg_b_mm" inputMode="decimal" dense disabled={disabled} />
        </Field>
        <Field label={f.note} htmlFor={`${id}-note`} className="sm:col-span-3">
          <Input id={`${id}-note`} name="note" maxLength={200} dense disabled={disabled} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" arrow disabled={disabled}>
          {t.save}
        </SubmitButton>
        {notice}
      </div>
    </form>
  );
}

export function BendRowDelete({ versionId, row, disabled }: { versionId: string; row: BendTableRowDb; disabled?: boolean }) {
  const c = useContent();
  const t = c.admin.sheet.bendTable;
  const { toast } = useToast();
  return (
    <ConfirmButton
      question={t.version.deleteQuestion}
      variant="danger"
      disabled={disabled}
      action={async () => {
        const result = await deleteBendRowAction(versionId, row.id);
        toast(result.status === "saved" ? t.notices.deleted : c.admin.sheet.errors[result.status === "error" ? result.error : "db"], { tone: result.status === "saved" ? "success" : "error" });
      }}
    >
      {t.version.delete}
    </ConfirmButton>
  );
}

export function ToolForm() {
  const c = useContent();
  const t = c.admin.sheet.tooling;
  const id = useId();
  const [kind, setKind] = useState<"punch" | "die">("punch");
  const [state, formAction] = useActionState<SheetFormState, FormData>(saveToolAction, INITIAL_SHEET_FORM_STATE);
  const notice = useFormOutcome(state, t.notices.saved);
  const f = t.fields;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={f.kind} htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" value={kind} onChange={(e) => setKind(e.target.value === "die" ? "die" : "punch")} dense>
            <option value="punch">{t.kinds.punch}</option>
            <option value="die">{t.kinds.die}</option>
          </Select>
        </Field>
        <Field label={f.code} htmlFor={`${id}-code`}>
          <Input id={`${id}-code`} name="code" required maxLength={60} dense />
        </Field>
        <Field label={f.name} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required maxLength={160} dense />
        </Field>
        {kind === "punch" ? (
          <>
            <Field label={f.height} htmlFor={`${id}-h`}>
              <Input id={`${id}-h`} name="height_mm" inputMode="decimal" required dense />
            </Field>
            <Field label={f.type} htmlFor={`${id}-type`}>
              <Select id={`${id}-type`} name="type" defaultValue="straight" dense>
                <option value="straight">{t.types.straight}</option>
                <option value="gooseneck">{t.types.gooseneck}</option>
              </Select>
            </Field>
            <Field label={f.tipRadius} htmlFor={`${id}-tip`}>
              <Input id={`${id}-tip`} name="tip_radius_mm" inputMode="decimal" dense />
            </Field>
            <Field label={f.throat} htmlFor={`${id}-throat`}>
              <Input id={`${id}-throat`} name="throat_depth_mm" inputMode="decimal" dense />
            </Field>
          </>
        ) : (
          <>
            <Field label={f.v} htmlFor={`${id}-v`}>
              <Input id={`${id}-v`} name="v_mm" inputMode="decimal" required dense />
            </Field>
            <Field label={f.minFlange} htmlFor={`${id}-mf`}>
              <Input id={`${id}-mf`} name="min_flange_mm" inputMode="decimal" required dense />
            </Field>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" arrow>
          {t.save}
        </SubmitButton>
        {notice}
      </div>
    </form>
  );
}

export function ToolDelete({ tool }: { tool: PressBrakeToolRow }) {
  const c = useContent();
  const t = c.admin.sheet.tooling;
  const { toast } = useToast();
  return (
    <ConfirmButton
      question={t.deleteQuestion}
      variant="danger"
      action={async () => {
        const result = await deleteToolAction(tool.code);
        toast(result.status === "saved" ? t.notices.deleted : c.admin.sheet.errors[result.status === "error" ? result.error : "db"], { tone: result.status === "saved" ? "success" : "error" });
      }}
    >
      {t.delete}
    </ConfirmButton>
  );
}

export function HardwareNameForm() {
  const c = useContent();
  const t = c.admin.sheet.hardware;
  const id = useId();
  const [state, formAction] = useActionState<SheetFormState, FormData>(saveHardwareNameAction, INITIAL_SHEET_FORM_STATE);
  const notice = useFormOutcome(state, t.notices.saved);
  const f = t.fields;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-[13px] text-text-muted">{t.addHelp}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={f.pattern} htmlFor={`${id}-pattern`}>
          <Input id={`${id}-pattern`} name="pattern" required maxLength={120} dense />
        </Field>
        <Field label={f.kind} htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" defaultValue="insert" dense>
            <option value="insert">{t.kinds.insert}</option>
            <option value="weld_stud">{t.kinds.weld_stud}</option>
            <option value="unknown">{t.kinds.unknown}</option>
          </Select>
        </Field>
        <Field label={f.size} htmlFor={`${id}-size`}>
          <Input id={`${id}-size`} name="size" required maxLength={40} dense />
        </Field>
        <Field label={f.featureCode} htmlFor={`${id}-code`}>
          <Input id={`${id}-code`} name="feature_code" maxLength={60} dense />
        </Field>
        <Field label={f.note} htmlFor={`${id}-note`} className="sm:col-span-2">
          <Input id={`${id}-note`} name="note" maxLength={200} dense />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" arrow>
          {t.save}
        </SubmitButton>
        {notice}
      </div>
    </form>
  );
}

export function HardwareNameDelete({ row }: { row: HardwareNameRow }) {
  const c = useContent();
  const t = c.admin.sheet.hardware;
  const { toast } = useToast();
  return (
    <ConfirmButton
      question={t.deleteQuestion}
      variant="danger"
      action={async () => {
        const result = await deleteHardwareNameAction(row.id);
        toast(result.status === "saved" ? t.notices.deleted : c.admin.sheet.errors[result.status === "error" ? result.error : "db"], { tone: result.status === "saved" ? "success" : "error" });
      }}
    >
      {t.delete}
    </ConfirmButton>
  );
}
