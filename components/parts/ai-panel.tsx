"use client";

/**
 * AiPanel — the PDF companion panel: amber chips per pending suggestion
 * (lib/ai/apply suggestionDiff) with accept / dismiss / accept all, the
 * source + model label, coded notes, the "run pre-fill" button and,
 * without an API key, the no-key notice plus the extracted PDF text in a
 * collapsible block.
 * File path: /components/parts/ai-panel.tsx
 *
 * Dismiss is LOCAL state (the suggestion object is never mutated);
 * accept calls the acceptSuggestion action for that one field — nothing
 * is applied without the click.
 */

import { useId, useMemo, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { formatMm, formatNumber, interpolate } from "@/lib/format";
import { pendingSuggestions, suggestionDiff, type CurrentPartValues, type SuggestionDiffEntry, type SuggestionField } from "@/lib/ai/apply";
import type { Suggestions } from "@/lib/ai/types";
import type { Locale } from "@/lib/site-config";
import type { UploadContent } from "@/content/upload";

export type AiPanelProps = {
  suggestions: Suggestions | null;
  current: CurrentPartValues;
  pdfAttached: boolean;
  pdfText: string | null;
  aiAvailable: boolean;
  disabled?: boolean;
  busy?: boolean;
  onAccept: (field: SuggestionField) => void;
  onAcceptAll: (fields: SuggestionField[]) => void;
  onRunPrefill: () => void;
  onExtractText: () => void;
};

export function describeSuggestion(entry: SuggestionDiffEntry, ai: UploadContent["aiSuggestions"], locale: Locale): string {
  switch (entry.field) {
    case "material":
      return entry.suggested ?? "—";
    case "thicknessMm":
      return entry.suggested === null ? "—" : `${formatMm(entry.suggested, locale)} mm`;
    case "qty":
      return entry.suggested === null ? "—" : formatNumber(entry.suggested, locale);
    case "threads":
      return (entry.suggested ?? []).map((t) => (t.count ? `${t.size} × ${t.count}` : t.size)).join(", ");
    case "bends": {
      const b = entry.suggested;
      if (!b) return "—";
      const parts = [
        b.count !== null ? `${ai.fields.bendCount}: ${b.count}` : null,
        b.angles.length ? `${ai.fields.bendAngles}: ${b.angles.map((a) => `${formatNumber(a, locale)}°`).join(", ")}` : null,
        b.directions?.length ? `${ai.fields.bendDirections}: ${b.directions.map((d) => ai.directions[d]).join(", ")}` : null,
      ].filter((s): s is string => Boolean(s));
      return parts.join(" · ");
    }
    case "finish": {
      const f = entry.suggested;
      if (!f) return "—";
      return [f.code ? ai.finishCodes[f.code] : f.text, f.ral ? interpolate(ai.ralLabel, { ral: f.ral }) : null].filter((s): s is string => Boolean(s)).join(" · ");
    }
  }
}

function describeCurrent(entry: SuggestionDiffEntry, ai: UploadContent["aiSuggestions"], locale: Locale): string | null {
  if (entry.current === null) return null;
  const current: SuggestionDiffEntry = { ...entry, suggested: entry.current } as SuggestionDiffEntry;
  return describeSuggestion(current, ai, locale);
}

const FIELD_LABEL: Record<SuggestionField, keyof UploadContent["aiSuggestions"]["fields"]> = {
  material: "material",
  thicknessMm: "thicknessMm",
  qty: "quantity",
  threads: "threads",
  bends: "bends",
  finish: "finish",
};

export function AiPanel({ suggestions, current, pdfAttached, pdfText, aiAvailable, disabled = false, busy = false, onAccept, onAcceptAll, onRunPrefill, onExtractText }: AiPanelProps) {
  const c = useContent();
  const locale = useLocale();
  const ai = c.upload.aiSuggestions;
  const t = c.upload.part.ai;
  const id = useId();
  const [dismissed, setDismissed] = useState<Set<SuggestionField>>(new Set());
  const [showText, setShowText] = useState(false);

  const pending = useMemo(() => {
    if (!suggestions) return [];
    return pendingSuggestions(suggestionDiff(suggestions, current)).filter((entry) => !dismissed.has(entry.field));
  }, [suggestions, current, dismissed]);

  const dismiss = (field: SuggestionField) => setDismissed((set) => new Set(set).add(field));

  return (
    <Panel
      title={c.upload.part.panels.ai}
      actions={
        pdfAttached ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || busy} onClick={onRunPrefill}>
            {busy ? <Spinner /> : null}
            {busy ? t.running : t.runPrefill}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {!pdfAttached && (
          <>
            <p className="text-text-muted">{t.noPdf}</p>
            <p className="text-text-faint">{t.attachPdfHint}</p>
          </>
        )}
        {pdfAttached && !aiAvailable && <Notice tone="info">{ai.noApiKey}</Notice>}
        {suggestions && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip severity={suggestions.source === "ai" ? "amber" : "neutral"} label={suggestions.source === "ai" ? ai.sourceAi : ai.sourceHeuristic} />
            {suggestions.model && <span className="text-text-faint">{interpolate(ai.modelLabel, { model: suggestions.model })}</span>}
            <span className="text-text-faint">
              {ai.confidenceLabel}: {ai.confidence[suggestions.confidence]}
            </span>
          </div>
        )}
        {suggestions && pending.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">{interpolate(t.pending, { count: pending.length })}</span>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || busy} onClick={() => onAcceptAll(pending.map((p) => p.field))}>
                  {ai.acceptAll}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDismissed(new Set(pending.map((p) => p.field)))}>
                  {ai.dismissAll}
                </button>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {pending.map((entry) => {
                const currentText = describeCurrent(entry, ai, locale);
                return (
                  <li key={entry.field} className="flex flex-wrap items-center justify-between gap-2 border border-flag-amber bg-flag-amber-soft px-3 py-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[11px] font-bold tracking-[0.12em] text-flag-amber uppercase">{ai.fields[FIELD_LABEL[entry.field]]}</span>
                      <span className="font-bold">{describeSuggestion(entry, ai, locale)}</span>
                      {currentText && <span className="text-[12px] text-text-muted">{interpolate(ai.differsFromCurrent, { current: currentText })}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-primary btn-sm" disabled={disabled || busy} onClick={() => onAccept(entry.field)}>
                        {ai.accept}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(entry.field)}>
                        {ai.dismiss}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-[12px] text-text-faint">{ai.neverAutoApplied}</p>
          </div>
        )}
        {suggestions && pending.length === 0 && <p className="text-text-muted">{t.allApplied}</p>}
        {suggestions && suggestions.notes.length > 0 && (
          <div>
            <p className="field-label">{ai.fields.notes}</p>
            <ul className="flex flex-col gap-1 text-text-muted">
              {suggestions.notes.map((note, i) => {
                const params = { ...(note.params ?? {}) };
                if (note.code === "ai_value_dropped" && typeof params.field === "string" && params.field in ai.fields) {
                  params.field = ai.fields[params.field as keyof typeof ai.fields];
                }
                return <li key={i}>{interpolate(ai.notes[note.code], params)}</li>;
              })}
            </ul>
          </div>
        )}
        {pdfAttached && (
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={showText}
              aria-controls={`${id}-text`}
              onClick={() => {
                if (!showText && pdfText === null) onExtractText();
                setShowText((v) => !v);
              }}
            >
              {showText ? t.hideText : t.showText}
            </button>
            {showText && (
              <div id={`${id}-text`} className="mt-2 max-h-[280px] overflow-auto border border-border bg-surface p-3">
                {pdfText === null ? (
                  <Spinner />
                ) : pdfText.trim().length === 0 ? (
                  <p className="text-text-muted">{ai.noExtractedText}</p>
                ) : (
                  <pre className="whitespace-pre-wrap font-[inherit] text-[12.5px] leading-relaxed">{pdfText}</pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
