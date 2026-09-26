"use client";

/**
 * PartHeader — page header with the editable name (inline form), the
 * source / triage chips, the link back to the quote and the original /
 * PDF downloads (10-minute signed urls through /api/files/[id]/url).
 * File path: /components/parts/part-header.tsx
 */

import Link from "next/link";
import { useId, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { Input } from "@/components/ui/field";
import { TriageChip } from "@/components/triage/triage-chip";
import { routes } from "@/lib/routes";
import type { PartSourceDb } from "@/lib/db/types";
import type { TriageState } from "@/lib/geometry/types";

export type PartHeaderProps = {
  name: string;
  source: PartSourceDb;
  triageState: TriageState | null;
  quoteId: string;
  quoteNumber: string;
  fileId: string | null;
  pdfFileId: string | null;
  disabled?: boolean;
  onRename: (name: string) => void;
};

export function PartHeader({ name, source, triageState, quoteId, quoteNumber, fileId, pdfFileId, disabled = false, onRename }: PartHeaderProps) {
  const c = useContent();
  const t = c.upload.part;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  return (
    <PageHeader
      eyebrow={`${t.eyebrow} · ${quoteNumber}`}
      title={
        editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = draft.trim();
              if (next.length > 0 && next !== name) onRename(next);
              setEditing(false);
            }}
          >
            <label htmlFor={`${id}-name`} className="visually-hidden">
              {t.nameLabel}
            </label>
            <Input id={`${id}-name`} value={draft} onChange={(event) => setDraft(event.target.value)} dense inline maxLength={120} autoFocus className="w-[320px] max-w-full" />
            <button type="submit" className="btn btn-primary btn-sm">
              {t.saveName}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(name); setEditing(false); }}>
              {c.common.actions.cancel}
            </button>
          </form>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-3">
            <span>{name}</span>
            <StatusChip severity={source === "manual" ? "amber" : "neutral"} plain label={c.upload.intake.sources[source]} />
            <TriageChip state={triageState} />
          </span>
        )
      }
      actions={
        <>
          {!disabled && !editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(name); setEditing(true); }}>
              {t.rename}
            </button>
          )}
          {fileId && (
            <a href={routes.api.fileUrl(fileId)} className="btn btn-ghost btn-sm">
              {t.downloadOriginal}
            </a>
          )}
          {pdfFileId && (
            <a href={routes.api.fileUrl(pdfFileId)} className="btn btn-ghost btn-sm">
              {t.downloadPdf}
            </a>
          )}
          <Link href={routes.quoteUpload(quoteId)} className="btn btn-ghost btn-sm">
            {c.common.actions.upload}
          </Link>
          <Link href={routes.quote(quoteId)} className="btn btn-primary btn-sm">
            {t.backToQuote}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </Link>
        </>
      }
    />
  );
}
