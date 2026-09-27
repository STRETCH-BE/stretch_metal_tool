"use client";

/**
 * NoGeometryPanel — shown instead of the viewer for parts without a flat
 * pattern: STEP models that are not flat sheets (bent parts, assemblies —
 * the facts read from the model and the quick-part button), STEP parts
 * stored before the reader existed (offer to read the model now), and
 * any other part without geometry (manual-entry prompt).
 * File path: /components/parts/no-geometry.tsx
 */

import { useContent } from "@/components/providers/locale";
import { EmptyState } from "@/components/ui/empty-state";
import type { PartSourceDb } from "@/lib/db/types";
import { interpolate } from "@/lib/format";

export type NoGeometryPanelProps = {
  source: PartSourceDb;
  disabled?: boolean;
  /** triage.details of a red_step_manual geometry (thickness, bends, size). */
  facts?: Record<string, number | string> | null;
  /** STEP part with no stored analysis yet. */
  legacyStep?: boolean;
  onQuickPart: () => void;
  onAnalyseStep?: () => void;
};

export function NoGeometryPanel({ source, disabled, facts = null, legacyStep = false, onQuickPart, onAnalyseStep }: NoGeometryPanelProps) {
  const c = useContent();
  const t = c.upload.part;
  const body =
    source === "step" ? (legacyStep ? t.stepLegacyBody : interpolate(t.stepBody, facts ?? {})) : t.noGeometryBody;
  return (
    <EmptyState
      title={t.noGeometryTitle}
      body={body}
      action={
        !disabled ? (
          <div className="flex flex-wrap gap-2">
            {legacyStep && onAnalyseStep && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onAnalyseStep}>
                {t.analyseStep}
                <span aria-hidden="true" className="btn-arrow">
                  →
                </span>
              </button>
            )}
            <button type="button" className={`btn btn-sm ${legacyStep ? "btn-ghost" : "btn-primary"}`} onClick={onQuickPart}>
              {t.enterQuickPart}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
