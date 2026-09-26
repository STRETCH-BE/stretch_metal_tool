"use client";

/**
 * CsvImportForm — upload a CSV into one table of a draft version and
 * show the per-row result (imported count + line errors).
 * File path: /components/admin/csv-import-form.tsx
 *
 * useActionState over importRateCsv bound to (versionId, table). After a
 * run the grid is refreshed through router.refresh(); errors are codes
 * resolved here (content.admin.rates.errors), "db" keeps the raw message.
 */

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { useContent } from "@/components/providers/locale";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { interpolate } from "@/lib/format";
import { importRateCsv } from "@/lib/admin/rates-actions";
import { INITIAL_CSV_IMPORT_STATE, type CsvImportState } from "@/lib/admin/rates-types";
import { csvColumns, type RateTableName } from "@/lib/admin/tables";

export function CsvImportForm({ versionId, table }: { versionId: string; table: RateTableName }) {
  const c = useContent();
  const t = c.admin.rates.csv;
  const router = useRouter();
  const [state, formAction] = useActionState(
    (prev: CsvImportState, formData: FormData) => importRateCsv(versionId, table, prev, formData),
    INITIAL_CSV_IMPORT_STATE
  );
  const handled = useRef<CsvImportState | null>(null);

  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "done") router.refresh();
  }, [state, router]);

  const errorText = (code: string, message?: string): string => {
    if (code === "missingColumns") return interpolate(t.missingColumns, { columns: (state.missing ?? []).join(", ") });
    const csvLevel = (t as unknown as Record<string, string>)[code];
    if (csvLevel && ["noFile", "tooLarge", "emptyFile"].includes(code)) return csvLevel;
    const template = (c.admin.rates.errors as Record<string, string>)[code] ?? c.admin.rates.errors.generic;
    return interpolate(template, { message: message ?? "" });
  };

  const inputId = `csv-${table}`;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-[13px] text-text-muted">{t.help}</p>
      <p className="mono text-[12px] text-text-faint">{interpolate(t.helpColumns, { columns: csvColumns(table).join(", ") })}</p>
      <Field label={t.file} htmlFor={inputId} help={t.delimiterHint}>
        <input id={inputId} name="file" type="file" accept=".csv,text/csv" className="field field-sm" required />
      </Field>
      {state.status === "error" && state.error && <Notice tone="error">{errorText(state.error)}</Notice>}
      {state.status === "done" && (
        <Notice tone={state.errors && state.errors.length > 0 ? "info" : "success"}>
          {interpolate(t.imported, { count: state.imported ?? 0 })}
        </Notice>
      )}
      {state.status === "done" && state.errors && state.errors.length > 0 && (
        <div className="flex flex-col gap-1 text-[13px]">
          <p className="font-bold text-red">{interpolate(t.errorsTitle, { count: state.errors.length })}</p>
          <ul className="mono list-none text-[12px]">
            {state.errors.slice(0, 100).map((error, index) => (
              <li key={index}>
                {interpolate(t.lineError, {
                  line: error.line,
                  message: `${error.column ? `${error.column}: ` : ""}${errorText(error.code, error.message)}`,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <SubmitButton size="sm" pendingLabel={t.importing}>
          {t.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
