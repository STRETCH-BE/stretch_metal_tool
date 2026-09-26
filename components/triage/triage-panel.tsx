"use client";

/**
 * TriagePanel — the per-part file-quality panel: state chip + message
 * (content.flags.triage, details interpolated), reasons, the healing
 * sentence, the dropped-entity summary and the one-click answers per
 * amber / red state.
 * File path: /components/triage/triage-panel.tsx
 *
 *   amber_units            → "dimensions are in mm" confirm + calibrate hint
 *   amber_bend_candidates  → "These N lines: Bend up / Bend down / Ignore / Cut"
 *                            (all candidates at once) + hint to tag individually
 *   amber_forming_unknown  → "Is this part bent or rolled?" Flat / Bent / Rolled
 *   red_drawing_sheet      → explanation, "pick the view" instructions, quick part
 *   red_no_closed_contour  → explanation, join-within-tolerance input, quick part
 * The panel never mutates anything itself: it calls back with a
 * TriageAnswer / tolerance and the workspace runs the server action.
 */

import { useId, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { NumberInput } from "@/components/ui/number-input";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { interpolate } from "@/lib/format";
import type { DroppedEntity, HealingReport, PartAnnotations, Triage } from "@/lib/geometry/types";
import { DEFAULT_TOLERANCE_MM, MAX_TOLERANCE_MM } from "@/lib/geometry/heal";
import type { TriageAnswer } from "@/lib/parts/schema";
import {
  droppedSummary,
  healingSentence,
  healingTolerance,
  triageAction,
  triageLabel,
  triageMessage,
  triageReasons,
  triageSeverity,
} from "@/lib/parts/flag-message";

export type TriagePanelProps = {
  triage: Triage | null;
  healing: HealingReport | null;
  dropped: DroppedEntity[];
  annotations: PartAnnotations;
  /** No controls (viewer role / closed quote). */
  disabled?: boolean;
  /** A server action is running. */
  busy?: boolean;
  onAnswer: (answer: TriageAnswer) => void;
  onReanalyse: (toleranceMm: number) => void;
  onQuickPart: () => void;
};

export function TriagePanel({ triage, healing, dropped, annotations, disabled = false, busy = false, onAnswer, onReanalyse, onQuickPart }: TriagePanelProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.triage;
  const f = c.flags;
  const id = useId();
  const [tolerance, setTolerance] = useState<number | null>(Math.min(MAX_TOLERANCE_MM, Math.max(DEFAULT_TOLERANCE_MM, (healing?.toleranceMm ?? DEFAULT_TOLERANCE_MM) * 10)));

  if (!triage) {
    return (
      <Panel title={c.upload.part.panels.triage}>
        <p className="text-[13px] text-text-muted">{c.upload.part.noGeometryBody}</p>
      </Panel>
    );
  }

  const severity = triageSeverity(triage.state);
  const controlsOff = disabled || busy;
  const reasons = triageReasons(f, triage, locale);
  const droppedLines = droppedSummary(f, dropped, locale);
  const candidates = triage.candidateEntityIds.length;
  const answerButton = (label: string, answer: TriageAnswer) => (
    <button type="button" className="btn btn-ghost btn-sm" disabled={controlsOff} onClick={() => onAnswer(answer)}>
      {label}
    </button>
  );

  return (
    <Panel
      title={c.upload.part.panels.triage}
      actions={
        <>
          {busy && <Spinner />}
          <StatusChip severity={severity} label={triageLabel(f, triage.state)} />
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13.5px]">
        <p>{triageMessage(f, triage, locale)}</p>
        {triageAction(f, triage.state) && <p className="text-text-muted">{triageAction(f, triage.state)}</p>}

        {triage.state === "amber_units" && !annotations.unitsConfirmed && (
          <div className="flex flex-col gap-2">
            {answerButton(t.confirmUnits, { kind: "units", confirmed: true })}
            <p className="text-[12px] text-text-faint">{t.calibrateHint}</p>
          </div>
        )}

        {triage.state === "amber_bend_candidates" && (
          <div className="flex flex-col gap-2" role="group" aria-label={interpolate(t.candidatesQuestion, { count: candidates })}>
            <p className="font-bold">{interpolate(t.candidatesQuestion, { count: candidates })}</p>
            <div className="flex flex-wrap gap-2">
              {answerButton(t.bendUp, { kind: "candidates", role: "bend_up" })}
              {answerButton(t.bendDown, { kind: "candidates", role: "bend_down" })}
              {answerButton(t.ignore, { kind: "candidates", role: "ignore" })}
              {answerButton(t.cut, { kind: "candidates", role: "cut" })}
            </div>
            <p className="text-[12px] text-text-faint">{t.tagHint}</p>
          </div>
        )}

        {triage.state === "amber_forming_unknown" && (
          <div className="flex flex-col gap-2" role="group" aria-label={t.formingQuestion}>
            <p className="font-bold">{t.formingQuestion}</p>
            <div className="flex flex-wrap gap-2">
              {answerButton(t.flat, { kind: "forming", value: "flat" })}
              {answerButton(t.bent, { kind: "forming", value: "bent" })}
              {answerButton(t.rolled, { kind: "forming", value: "rolled" })}
            </div>
          </div>
        )}

        {triage.state === "red_drawing_sheet" && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-bold">{t.pickView}</p>
              <p className="text-text-muted">{t.pickViewHelp}</p>
            </div>
            <div>
              <button type="button" className="btn btn-primary btn-sm" disabled={controlsOff} onClick={onQuickPart}>
                {t.quickPart}
                <span aria-hidden="true" className="btn-arrow">
                  →
                </span>
              </button>
            </div>
          </div>
        )}

        {triage.state === "red_no_closed_contour" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t.joinTolerance} htmlFor={`${id}-tol`} className="w-[140px]">
                <NumberInput id={`${id}-tol`} value={tolerance} onValueChange={setTolerance} min={DEFAULT_TOLERANCE_MM} max={MAX_TOLERANCE_MM} decimals={2} dense />
              </Field>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={controlsOff || tolerance === null}
                onClick={() => tolerance !== null && onReanalyse(tolerance)}
              >
                {t.joinAndRetry}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={controlsOff} onClick={onQuickPart}>
                {t.quickPart}
                <span aria-hidden="true" className="btn-arrow">
                  →
                </span>
              </button>
            </div>
          </div>
        )}

        <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr]">
          <dt className="field-label mb-0">{t.reasons}</dt>
          <dd>
            <ul className="list-none">
              {reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="tick tick-sm mt-[6px]" aria-hidden="true" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </dd>
          {healing && (
            <>
              <dt className="field-label mb-0">{t.healing}</dt>
              <dd>
                {healingSentence(f, healing, locale)}
                <span className="text-text-faint"> · {healingTolerance(f, healing, locale)}</span>
              </dd>
            </>
          )}
          <dt className="field-label mb-0">{t.dropped}</dt>
          <dd>
            {droppedLines.length === 0 ? (
              <span className="text-text-faint">{f.dropped.empty}</span>
            ) : (
              <ul className="list-none">
                {droppedLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </div>
    </Panel>
  );
}
