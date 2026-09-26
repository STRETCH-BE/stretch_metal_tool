"use client";

/**
 * UploadWorkspace — the client half of the quote upload page: dropzone,
 * per-file rows with progress (sign → upload → analyse) and result
 * chips, the quick-part modal, and a route refresh after every finished
 * file so the server-rendered parts table updates.
 * File path: /components/intake/upload-workspace.tsx
 *
 * Files are processed one after another (deterministic item positions,
 * one geometry analysis at a time on the server). Client-side
 * validation (extension, size, DWG) fails a row immediately with the
 * same codes the server uses; a DWG row links to the export guide.
 * Rows are keyboard reachable: "open part" is a link, retry / remove
 * are buttons.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Notice } from "@/components/ui/notice";
import { PartThumbnail } from "@/components/viewer/part-thumbnail";
import { TriageChip } from "@/components/triage/triage-chip";
import { createClient } from "@/lib/supabase/client";
import { routes } from "@/lib/routes";
import { interpolate } from "@/lib/format";
import { validateUploadRequest } from "@/lib/files/sniff";
import { healingSentence } from "@/lib/parts/flag-message";
import type { UploadErrorCode } from "@/content/upload";
import { Dropzone } from "./dropzone";
import { QuickPartModal, type QuickPartMaterial } from "./quick-part-modal";
import { uploadFileToQuote, UploadFlowError, type CompleteResponse, type UploadStage } from "./upload-client";

type RowStatus = "queued" | UploadStage | "done" | "error";

type Row = {
  id: string;
  file: File;
  status: RowStatus;
  error: UploadErrorCode | null;
  result: CompleteResponse | null;
};

const PROGRESS: Record<RowStatus, number> = { queued: 5, signing: 20, uploading: 55, analysing: 85, done: 100, error: 100 };
const GUIDE_ERRORS = new Set<UploadErrorCode>(["dwg", "binary_dxf", "unknown_type", "extension", "type_mismatch"]);

export type UploadWorkspaceProps = {
  quoteId: string;
  bucket: string;
  canWrite: boolean;
  materials: QuickPartMaterial[];
};

export function UploadWorkspace({ quoteId, bucket, canWrite, materials }: UploadWorkspaceProps) {
  const c = useContent();
  const t = c.upload.intake;
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const queue = useRef<Row[]>([]);
  const active = useRef(false);
  const seq = useRef(0);

  const patch = useCallback((id: string, changes: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }, []);

  const pump = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    const supabase = createClient();
    try {
      while (queue.current.length > 0) {
        const row = queue.current.shift()!;
        try {
          const result = await uploadFileToQuote({
            quoteId,
            file: row.file,
            bucket,
            supabase,
            onStage: (stage) => patch(row.id, { status: stage }),
          });
          patch(row.id, { status: "done", result, error: null });
          router.refresh();
        } catch (error) {
          const code = error instanceof UploadFlowError ? error.code : "generic";
          patch(row.id, { status: "error", error: code });
        }
      }
    } finally {
      active.current = false;
    }
  }, [bucket, patch, quoteId, router]);

  const addFiles = useCallback(
    (files: File[]) => {
      const next: Row[] = files.map((file) => {
        const validation = validateUploadRequest({ fileName: file.name, size: file.size });
        const id = `f${++seq.current}`;
        return validation.ok
          ? { id, file, status: "queued", error: null, result: null }
          : { id, file, status: "error", error: validation.code, result: null };
      });
      setRows((current) => [...next, ...current]);
      queue.current.push(...next.filter((row) => row.status === "queued"));
      void pump();
    },
    [pump]
  );

  const retry = (row: Row) => {
    patch(row.id, { status: "queued", error: null, result: null });
    queue.current.push({ ...row, status: "queued", error: null, result: null });
    void pump();
  };

  const remove = (id: string) => setRows((current) => current.filter((row) => row.id !== id));

  return (
    <div className="flex flex-col gap-6">
      {!canWrite && <Notice tone="info">{t.readOnly}</Notice>}
      <Dropzone onFiles={addFiles} disabled={!canWrite} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!canWrite} onClick={() => setQuickOpen(true)}>
          {t.addQuickPart}
          <span aria-hidden="true" className="btn-arrow">
            →
          </span>
        </button>
        <Link href={routes.guide} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer">
          {t.guideLink}
        </Link>
      </div>

      <Panel title={t.results.title} flush>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-[13.5px] text-text-muted">{t.results.empty}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t.dropzone.queueLabel}>
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 px-4 py-3">
                <UploadRow row={row} onRetry={() => retry(row)} onRemove={() => remove(row.id)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <QuickPartModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        quoteId={quoteId}
        materials={materials}
        onCreated={(partId) => {
          setQuickOpen(false);
          router.push(routes.part(partId));
        }}
      />
    </div>
  );
}

function UploadRow({ row, onRetry, onRemove }: { row: Row; onRetry: () => void; onRemove: () => void }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.intake;
  const status = t.status[row.status];
  const result = row.result;
  const sizeKb = Math.max(1, Math.round(row.file.size / 1024));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {result && result.kind === "dxf" ? (
            <PartThumbnail svg={result.thumbnailSvg} size={56} label={result.name} />
          ) : (
            <span className="inline-block h-14 w-14 shrink-0 bg-surface" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="truncate font-bold">{row.file.name}</p>
            <p className="text-[12px] text-text-faint num">{sizeKb} kB</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.status === "error" ? (
            <StatusChip severity="red" label={status} />
          ) : row.status === "done" ? (
            result?.kind === "dxf" ? (
              <TriageChip state={result.triage.state} />
            ) : (
              <StatusChip severity="green" label={status} />
            )
          ) : (
            <StatusChip severity="neutral" label={status} />
          )}
          {result?.partId && (
            <Link href={routes.part(result.partId)} className="btn btn-ghost btn-sm">
              {t.results.openPart}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </Link>
          )}
          {row.status === "error" && row.error !== "dwg" && row.error !== "extension" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
              {t.results.retry}
            </button>
          )}
          {(row.status === "error" || row.status === "done") && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`${t.results.remove}: ${row.file.name}`}>
              {t.results.remove}
            </button>
          )}
        </div>
      </div>

      {row.status !== "done" && row.status !== "error" && (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={PROGRESS[row.status]}
          aria-label={`${row.file.name}: ${status}`}
        >
          <span style={{ width: `${PROGRESS[row.status]}%` }} />
        </div>
      )}

      {row.status === "error" && row.error && (
        <Notice tone="error">
          {c.upload.errors[row.error] ?? c.upload.errors.generic}
          {GUIDE_ERRORS.has(row.error) && (
            <>
              {" "}
              <Link href={routes.guide} className="underline" target="_blank" rel="noreferrer">
                {t.results.guideLink}
              </Link>
            </>
          )}
        </Notice>
      )}

      {result && (
        <ul className="flex flex-col gap-1 text-[13px] text-text-muted">
          {result.kind === "dxf" && (
            <>
              <li>
                <span className="font-bold text-text-body">{t.results.healingLabel}:</span> {healingSentence(c.flags, result.healing, locale)}
              </li>
              {result.partCount > 1 && <li>{interpolate(t.results.multiPart, { count: result.partCount })}</li>}
              {result.companion && <li>{interpolate(t.results.companionMatched, { pdf: result.companion.name, part: result.name })}</li>}
              {result.suggestionsSource && <li>{result.suggestionsSource === "ai" ? t.results.suggestionsAi : t.results.suggestionsHeuristic}</li>}
              {result.restoredAnnotations && <li>{t.results.restored}</li>}
            </>
          )}
          {result.kind === "pdf" && (
            <li>{result.attachedTo ? interpolate(t.results.pdfAttached, { part: result.attachedTo }) : t.results.pdfWaiting}</li>
          )}
          {result.kind === "step" && <li>{t.results.stepManual}</li>}
        </ul>
      )}
    </>
  );
}
