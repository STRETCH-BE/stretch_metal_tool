"use client";

/**
 * PartActions — re-analyse with a tolerance (DXF only), export the
 * annotated DXF, delete the part (inline confirm → redirect to the
 * quote's upload page).
 * File path: /components/parts/part-actions.tsx
 */

import { useId, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DEFAULT_TOLERANCE_MM, MAX_TOLERANCE_MM } from "@/lib/geometry/heal";
import { deletePart } from "@/lib/parts/actions";

export type PartActionsProps = {
  partId: string;
  canReanalyse: boolean;
  canExport: boolean;
  currentToleranceMm: number | null;
  disabled?: boolean;
  busy?: boolean;
  onReanalyse: (toleranceMm: number) => void;
  onExport: () => void;
};

export function PartActions({ partId, canReanalyse, canExport, currentToleranceMm, disabled = false, busy = false, onReanalyse, onExport }: PartActionsProps) {
  const c = useContent();
  const t = c.upload.part.actions;
  const id = useId();
  const [tolerance, setTolerance] = useState<number | null>(currentToleranceMm ?? DEFAULT_TOLERANCE_MM);

  return (
    <Panel title={c.upload.part.panels.actions}>
      <div className="flex flex-col gap-4">
        {canReanalyse && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (tolerance !== null) onReanalyse(tolerance);
            }}
          >
            <Field label={t.tolerance} htmlFor={`${id}-tol`} help={t.toleranceHelp}>
              <NumberInput id={`${id}-tol`} value={tolerance} onValueChange={setTolerance} min={DEFAULT_TOLERANCE_MM} max={MAX_TOLERANCE_MM} decimals={2} dense disabled={disabled} />
            </Field>
            <div>
              <button type="submit" className="btn btn-ghost btn-sm" disabled={disabled || busy || tolerance === null}>
                {t.reanalyse}
              </button>
            </div>
          </form>
        )}
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>
              {t.exportDxf}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
          )}
          {!disabled && (
            <ConfirmButton question={t.deleteConfirm} variant="danger" action={() => deletePart(partId, true)}>
              {t.delete}
            </ConfirmButton>
          )}
        </div>
      </div>
    </Panel>
  );
}
