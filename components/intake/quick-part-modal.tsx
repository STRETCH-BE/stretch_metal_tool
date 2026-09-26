"use client";

/**
 * QuickPartModal — manual part entry: name, L × W, thickness, material,
 * holes (Ø + count rows), bends (length, angle, count rows), rolling
 * (radius, axis length). Posts createQuickPart; with `replacePartId` the
 * existing (red / STEP) part is converted in place.
 * File path: /components/intake/quick-part-modal.tsx
 *
 * Validation runs the same zod schema as the server (lib/parts/schema.ts
 * quickPartFormSchema) before the action is called, so a typo is caught
 * without a round trip; the server re-validates anyway. Row add/remove
 * buttons are real buttons, so the whole form is keyboard-operable
 * inside the Modal's focus trap.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { useContent } from "@/components/providers/locale";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { FormError } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { createQuickPart } from "@/lib/parts/actions";
import { quickPartFormSchema } from "@/lib/parts/schema";

export type QuickPartMaterial = { code: string; name: string };

export type QuickPartModalProps = {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  materials: QuickPartMaterial[];
  defaultName?: string;
  replacePartId?: string | null;
  onCreated: (partId: string) => void;
};

type HoleRow = { diameterMm: number | null; count: number | null };
type BendRow = { lengthMm: number | null; angleDeg: number | null; count: number | null };

export function QuickPartModal({ open, onClose, quoteId, materials, defaultName = "", replacePartId = null, onCreated }: QuickPartModalProps) {
  const c = useContent();
  const t = c.upload.quickPart;
  const { toast } = useToast();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(defaultName);
  const [lengthMm, setLengthMm] = useState<number | null>(null);
  const [widthMm, setWidthMm] = useState<number | null>(null);
  const [thicknessMm, setThicknessMm] = useState<number | null>(null);
  const [materialCode, setMaterialCode] = useState("");
  const [holes, setHoles] = useState<HoleRow[]>([]);
  const [bends, setBends] = useState<BendRow[]>([]);
  const [rolled, setRolled] = useState(false);
  const [rollRadius, setRollRadius] = useState<number | null>(null);
  const [rollAxis, setRollAxis] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
    }
  }, [open, defaultName]);

  const submit = () => {
    const form = {
      name,
      lengthMm,
      widthMm,
      thicknessMm,
      materialCode: materialCode || null,
      holes: holes.map((h) => ({ diameterMm: h.diameterMm, count: h.count })),
      bends: bends.map((b) => ({ lengthMm: b.lengthMm, angleDeg: b.angleDeg, count: b.count })),
      roll: rolled ? { radiusMm: rollRadius, axisLengthMm: rollAxis } : null,
    };
    const parsed = quickPartFormSchema.safeParse(form);
    if (!parsed.success) {
      setError(c.upload.errors.validation);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createQuickPart(quoteId, parsed.data, replacePartId);
      if (result.ok) {
        toast(t.created, { tone: "success" });
        onCreated(result.data.partId);
      } else {
        setError(c.upload.errors[result.error] ?? c.upload.errors.generic);
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={replacePartId ? t.replaceTitle : t.title}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={pending}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            {t.submit}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-5"
      >
        <p className="text-[13px] text-text-muted">{t.intro}</p>
        <FormError message={error} />

        <Field label={t.name} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} dense required maxLength={120} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t.length} htmlFor={`${id}-l`}>
            <NumberInput id={`${id}-l`} value={lengthMm} onValueChange={setLengthMm} min={0} decimals={2} dense />
          </Field>
          <Field label={t.width} htmlFor={`${id}-w`}>
            <NumberInput id={`${id}-w`} value={widthMm} onValueChange={setWidthMm} min={0} decimals={2} dense />
          </Field>
          <Field label={t.thickness} htmlFor={`${id}-t`}>
            <NumberInput id={`${id}-t`} value={thicknessMm} onValueChange={setThicknessMm} min={0} decimals={2} dense />
          </Field>
        </div>

        <Field label={t.material} htmlFor={`${id}-m`}>
          <Select id={`${id}-m`} value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} dense>
            <option value="">{t.materialNone}</option>
            {materials.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} — {m.name}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="field-label">{t.holes}</legend>
          {holes.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label={t.holeDiameter} htmlFor={`${id}-hd-${i}`}>
                <NumberInput
                  id={`${id}-hd-${i}`}
                  value={row.diameterMm}
                  onValueChange={(v) => setHoles((rows) => rows.map((r, j) => (j === i ? { ...r, diameterMm: v } : r)))}
                  min={0}
                  decimals={3}
                  dense
                />
              </Field>
              <Field label={t.holeCount} htmlFor={`${id}-hc-${i}`}>
                <NumberInput
                  id={`${id}-hc-${i}`}
                  value={row.count}
                  onValueChange={(v) => setHoles((rows) => rows.map((r, j) => (j === i ? { ...r, count: v } : r)))}
                  min={1}
                  decimals={0}
                  dense
                />
              </Field>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={t.removeHole}
                onClick={() => setHoles((rows) => rows.filter((_, j) => j !== i))}
              >
                {c.common.actions.remove}
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHoles((rows) => [...rows, { diameterMm: null, count: 1 }])}>
              {t.addHole}
            </button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="field-label">{t.bends}</legend>
          {bends.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <Field label={t.bendLength} htmlFor={`${id}-bl-${i}`}>
                <NumberInput
                  id={`${id}-bl-${i}`}
                  value={row.lengthMm}
                  onValueChange={(v) => setBends((rows) => rows.map((r, j) => (j === i ? { ...r, lengthMm: v } : r)))}
                  min={0}
                  decimals={2}
                  dense
                />
              </Field>
              <Field label={t.bendAngle} htmlFor={`${id}-ba-${i}`}>
                <NumberInput
                  id={`${id}-ba-${i}`}
                  value={row.angleDeg}
                  onValueChange={(v) => setBends((rows) => rows.map((r, j) => (j === i ? { ...r, angleDeg: v } : r)))}
                  min={1}
                  max={179}
                  decimals={1}
                  dense
                />
              </Field>
              <Field label={t.bendCount} htmlFor={`${id}-bc-${i}`}>
                <NumberInput
                  id={`${id}-bc-${i}`}
                  value={row.count}
                  onValueChange={(v) => setBends((rows) => rows.map((r, j) => (j === i ? { ...r, count: v } : r)))}
                  min={1}
                  decimals={0}
                  dense
                />
              </Field>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={t.removeBend}
                onClick={() => setBends((rows) => rows.filter((_, j) => j !== i))}
              >
                {c.common.actions.remove}
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBends((rows) => [...rows, { lengthMm: null, angleDeg: 90, count: 1 }])}>
              {t.addBend}
            </button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="field-label">{t.rolled}</legend>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" className="checkbox" checked={rolled} onChange={(e) => setRolled(e.target.checked)} />
            {t.rolledToggle}
          </label>
          {rolled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.rollRadius} htmlFor={`${id}-rr`}>
                <NumberInput id={`${id}-rr`} value={rollRadius} onValueChange={setRollRadius} min={0} decimals={2} dense />
              </Field>
              <Field label={t.rollAxisLength} htmlFor={`${id}-ra`}>
                <NumberInput id={`${id}-ra`} value={rollAxis} onValueChange={setRollAxis} min={0} decimals={2} dense />
              </Field>
            </div>
          )}
        </fieldset>
        <button type="submit" className="visually-hidden" tabIndex={-1} aria-hidden="true">
          {t.submit}
        </button>
      </form>
    </Modal>
  );
}
