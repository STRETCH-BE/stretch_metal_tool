"use client";

/**
 * NoGeometryPanel — shown instead of the viewer for STEP parts (not
 * unfolded in this phase) and parts without geometry: the manual-entry
 * prompt with the quick-part button.
 * File path: /components/parts/no-geometry.tsx
 */

import { useContent } from "@/components/providers/locale";
import { EmptyState } from "@/components/ui/empty-state";
import type { PartSourceDb } from "@/lib/db/types";

export function NoGeometryPanel({ source, disabled, onQuickPart }: { source: PartSourceDb; disabled?: boolean; onQuickPart: () => void }) {
  const c = useContent();
  const t = c.upload.part;
  return (
    <EmptyState
      title={t.noGeometryTitle}
      body={source === "step" ? t.stepBody : t.noGeometryBody}
      action={
        !disabled ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={onQuickPart}>
            {t.enterQuickPart}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </button>
        ) : undefined
      }
    />
  );
}
