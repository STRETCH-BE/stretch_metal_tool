"use client";

/**
 * CloneVersionForm — label input + submit posting to cloneRateVersionAction
 * (hidden source id). Compact mode sits inline in the versions table.
 * File path: /components/admin/clone-version-form.tsx
 */

import { useId } from "react";
import { useContent } from "@/components/providers/locale";
import { SubmitButton } from "@/components/ui/submit-button";
import { cloneRateVersionAction } from "@/lib/admin/rates-actions";

export function CloneVersionForm({
  sourceId,
  defaultLabel,
  compact = false,
  submitLabel,
}: {
  sourceId: string;
  defaultLabel?: string;
  compact?: boolean;
  submitLabel?: string;
}) {
  const c = useContent();
  const t = c.admin.rates.versions;
  const id = useId();
  return (
    <form action={cloneRateVersionAction} className={compact ? "flex items-center gap-2" : "flex flex-wrap items-end gap-3"}>
      <input type="hidden" name="source" value={sourceId} />
      <div className={compact ? "" : "flex flex-col gap-1"}>
        <label htmlFor={`${id}-label`} className={compact ? "visually-hidden" : "field-label"}>
          {t.cloneLabel}
        </label>
        <input
          id={`${id}-label`}
          name="label"
          type="text"
          required
          maxLength={120}
          defaultValue={defaultLabel}
          placeholder={t.cloneLabelPlaceholder}
          className={`field field-sm ${compact ? "field-inline w-[220px]" : "w-[320px] max-w-full"}`}
          autoComplete="off"
        />
      </div>
      <SubmitButton size="sm" variant={compact ? "ghost" : "primary"} arrow={!compact}>
        {submitLabel ?? t.cloneSubmit}
      </SubmitButton>
    </form>
  );
}
