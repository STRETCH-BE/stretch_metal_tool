"use client";

/**
 * FormingEditor — the forming operations (rolling / bending) of one
 * assembly member and their feasibility resolution. Add a roll
 * {insideRadiusMm, angleDeg, widthMm} or a bend {bends, angleDeg,
 * lengthMm}, edit the numbers, save (setItemForming). When the engine
 * flags an operation forming.not_feasible the row shows the reason and
 * two resolutions: step bending (hits prefilled from
 * suggestedStepBendHits, editable) and subcontracting (supplier, cost,
 * extra lead days) → resolveForming. A forming.suspected flag on the
 * item offers "Add forming" / "Confirm: no forming needed"
 * (confirmNoForming — the server stores one operation resolved
 * none_needed with the suspected geometry).
 * File path: /components/quote/forming-editor.tsx
 *
 * The list is a local draft until "Save forming"; resolutions act on the
 * STORED operations directly (they need the server-side id). A not_feasible
 * flag is matched to its operation by kind + geometry (the flags carry no
 * operation id — see components/quote/assembly-view.ts).
 */

import { useEffect, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { StatusChip } from "@/components/ui/status-chip";
import { formatNumber, interpolate } from "@/lib/format";
import { suggestedStepBendHits } from "@/lib/pricing/forming";
import type { Flag, FormingOperation, FormingResolution } from "@/lib/pricing/types";
import { confirmNoForming, resolveForming, setItemForming } from "@/lib/quotes/actions";
import type { FormingReasonCode } from "@/content/quote";
import type { ActionRunner } from "./action-runner";
import { formingSummary, newFormingId, notFeasibleFlag } from "./assembly-view";

export type FormingEditorProps = {
  itemId: string;
  /** Stored operations of the item (server truth). */
  forming: FormingOperation[];
  /** Flags of this item / part (server or preview). */
  flags: Flag[];
  editable: boolean;
  pending: boolean;
  act: ActionRunner;
};

type ResolutionDraft = { hits: number; supplier: string; costEur: number | null; extraLeadDays: number };

function defaultResolutionDraft(op: FormingOperation): ResolutionDraft {
  const hits = op.kind === "roll" ? suggestedStepBendHits(op) : op.bends;
  return { hits: Math.max(1, hits), supplier: "", costEur: null, extraLeadDays: 0 };
}

export function FormingEditor({ itemId, forming, flags, editable, pending, act }: FormingEditorProps) {
  const c = useContent();
  const t = c.quote.builder.forming;
  const storedKey = JSON.stringify(forming);
  const [ops, setOps] = useState<FormingOperation[]>(forming);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, ResolutionDraft>>({});

  useEffect(() => {
    setOps(forming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const dirty = JSON.stringify(ops) !== storedKey;
  const suspected = flags.some((f) => f.code === "forming.suspected");
  const fmt = (n: number) => formatNumber(n, c.locale, { maximumFractionDigits: 1 });

  const update = (id: string, patch: Partial<FormingOperation>) =>
    setOps((list) => list.map((op) => (op.id === id ? ({ ...op, ...patch } as FormingOperation) : op)));
  const remove = (id: string) => setOps((list) => list.filter((op) => op.id !== id));
  const addRoll = () => setOps((list) => [...list, { id: newFormingId(), kind: "roll", insideRadiusMm: 200, angleDeg: 90, widthMm: 0, resolution: null }]); // [CONFIRM] default roll geometry
  const addBend = () => setOps((list) => [...list, { id: newFormingId(), kind: "bend", bends: 1, angleDeg: 90, lengthMm: 0, resolution: null }]);
  // A real operation contradicts an earlier "no forming needed" confirmation: drop the placeholder op on save.
  const save = () =>
    act(
      () => setItemForming(itemId, ops.length > 1 ? ops.filter((op) => op.resolution?.kind !== "none_needed") : ops),
      t.saved
    );

  const draftFor = (op: FormingOperation): ResolutionDraft => resolutionDrafts[op.id] ?? defaultResolutionDraft(op);
  const patchDraft = (op: FormingOperation, patch: Partial<ResolutionDraft>) =>
    setResolutionDrafts((d) => ({ ...d, [op.id]: { ...draftFor(op), ...patch } }));
  const resolve = (op: FormingOperation, resolution: FormingResolution) => act(() => resolveForming(itemId, op.id, resolution), t.resolved);

  const reasonText = (flag: Flag): string => {
    const code = String(flag.params.reason ?? "") as FormingReasonCode;
    const reason = t.reasons[code] ?? code;
    return interpolate(t.notFeasible, { reason, value: fmt(Number(flag.params.value ?? 0)), limit: fmt(Number(flag.params.limit ?? 0)) });
  };

  return (
    <div className="flex flex-col gap-3">
      {suspected && (
        <div className="flex flex-wrap items-center gap-2 border border-flag-red px-3 py-2 text-[12.5px]">
          <StatusChip severity="red" label={c.flags.flags["forming.suspected"].label} />
          <span className="min-w-0 flex-1">{t.suspected}</span>
          {editable && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={addRoll}>
                {t.addForming}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => confirmNoForming(itemId), t.confirmedNone)}>
                {t.confirmNone}
              </button>
            </>
          )}
        </div>
      )}

      {ops.length === 0 && !suspected && <p className="text-[12.5px] text-text-muted">{t.empty}</p>}

      <ul className="flex flex-col gap-2">
        {ops.map((op) => {
          const stored = forming.find((s) => s.id === op.id) ?? null;
          const flag = stored ? notFeasibleFlag(flags, stored) : null;
          const resolution = op.resolution;
          const draft = draftFor(op);
          const summary = op.kind === "roll" ? interpolate(t.rollSummary, { summary: formingSummary(op, fmt) }) : interpolate(t.bendSummary, { summary: formingSummary(op, fmt) });
          return (
            <li key={op.id} className="border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">{t.kinds[op.kind]}</span>
                <span className="text-[12.5px]">{summary}</span>
                {resolution && resolution.kind !== "in_house" && (
                  <StatusChip severity={resolution.kind === "none_needed" ? "neutral" : "amber"} plain label={t.resolution[resolution.kind]} />
                )}
                {flag && <StatusChip severity="red" label={t.unresolved} />}
                {editable && (
                  <button type="button" className="btn btn-ghost btn-sm ml-auto" disabled={pending} onClick={() => remove(op.id)}>
                    {t.remove}
                  </button>
                )}
              </div>
              {editable && (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {op.kind === "roll" ? (
                    <>
                      <Field label={t.fields.insideRadiusMm} htmlFor={`f-${op.id}-r`}>
                        <NumberInput id={`f-${op.id}-r`} dense inline className="w-[90px]" value={op.insideRadiusMm} decimals={1} min={0} onValueChange={(v) => v !== null && update(op.id, { insideRadiusMm: v })} />
                      </Field>
                      <Field label={t.fields.angleDeg} htmlFor={`f-${op.id}-a`}>
                        <NumberInput id={`f-${op.id}-a`} dense inline className="w-[80px]" value={op.angleDeg} decimals={1} min={0} max={360} onValueChange={(v) => v !== null && update(op.id, { angleDeg: v })} />
                      </Field>
                      <Field label={t.fields.widthMm} htmlFor={`f-${op.id}-w`}>
                        <NumberInput id={`f-${op.id}-w`} dense inline className="w-[90px]" value={op.widthMm} decimals={1} min={0} onValueChange={(v) => v !== null && update(op.id, { widthMm: v })} />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label={t.fields.bends} htmlFor={`f-${op.id}-n`}>
                        <NumberInput id={`f-${op.id}-n`} dense inline className="w-[70px]" value={op.bends} decimals={0} min={0} onValueChange={(v) => v !== null && update(op.id, { bends: Math.max(0, Math.round(v)) })} />
                      </Field>
                      <Field label={t.fields.angleDeg} htmlFor={`f-${op.id}-a`}>
                        <NumberInput id={`f-${op.id}-a`} dense inline className="w-[80px]" value={op.angleDeg} decimals={1} min={0} max={360} onValueChange={(v) => v !== null && update(op.id, { angleDeg: v })} />
                      </Field>
                      <Field label={t.fields.lengthMm} htmlFor={`f-${op.id}-l`}>
                        <NumberInput id={`f-${op.id}-l`} dense inline className="w-[90px]" value={op.lengthMm} decimals={1} min={0} onValueChange={(v) => v !== null && update(op.id, { lengthMm: v })} />
                      </Field>
                    </>
                  )}
                </div>
              )}
              {flag && (
                <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
                  <p className="text-[12.5px] font-bold text-red">{reasonText(flag)}</p>
                  {editable && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex flex-wrap items-end gap-2 border border-border p-2">
                        <span className="w-full text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">{t.stepBend}</span>
                        <Field label={t.hits} htmlFor={`f-${op.id}-hits`} help={t.hitsHelp}>
                          <NumberInput id={`f-${op.id}-hits`} dense inline className="w-[80px]" value={draft.hits} decimals={0} min={1} onValueChange={(v) => v !== null && patchDraft(op, { hits: Math.max(1, Math.round(v)) })} />
                        </Field>
                        <button type="button" className="btn btn-primary btn-sm" disabled={pending || dirty} onClick={() => resolve(op, { kind: "step_bend", hits: draft.hits })}>
                          {t.applyStepBend}
                          <span aria-hidden="true" className="btn-arrow">
                            →
                          </span>
                        </button>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 border border-border p-2">
                        <span className="w-full text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">{t.subcontract}</span>
                        <Field label={t.supplier} htmlFor={`f-${op.id}-sup`}>
                          <Input id={`f-${op.id}-sup`} dense inline className="w-[140px]" value={draft.supplier} maxLength={120} onChange={(e) => patchDraft(op, { supplier: e.target.value })} />
                        </Field>
                        <Field label={t.costEur} htmlFor={`f-${op.id}-cost`}>
                          <NumberInput id={`f-${op.id}-cost`} dense inline className="w-[90px]" value={draft.costEur} decimals={2} min={0} onValueChange={(v) => patchDraft(op, { costEur: v })} />
                        </Field>
                        <Field label={t.extraLeadDays} htmlFor={`f-${op.id}-days`}>
                          <NumberInput id={`f-${op.id}-days`} dense inline className="w-[70px]" value={draft.extraLeadDays} decimals={0} min={0} max={365} onValueChange={(v) => v !== null && patchDraft(op, { extraLeadDays: Math.max(0, Math.round(v)) })} />
                        </Field>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={pending || dirty || draft.supplier.trim().length === 0 || draft.costEur === null || draft.costEur < 0}
                          onClick={() => resolve(op, { kind: "subcontract", supplier: draft.supplier.trim(), costEur: draft.costEur ?? 0, extraLeadDays: draft.extraLeadDays })}
                        >
                          {t.applySubcontract}
                          <span aria-hidden="true" className="btn-arrow">
                            →
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={addRoll}>
            {t.addRoll}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={addBend}>
            {t.addBend}
          </button>
          <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={pending || !dirty} onClick={save}>
            {t.save}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
