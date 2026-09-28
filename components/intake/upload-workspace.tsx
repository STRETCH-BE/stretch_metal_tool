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
 *
 * A large model whose analysis outlives the server response (504 / no
 * JSON → "analysis_timeout" with the file id) does not fail: the row goes
 * to `processing` and polls GET /api/files/[id]/status ("Processing… X of
 * Y parts") for up to two minutes, then fetches the full result through
 * POST /api/files/[id]/resume-intake, which also stores whatever is still
 * missing and re-prices. A `partial` row (some parts failed) and Retry on
 * a row whose file the server already has both go through resume, never
 * through a second upload — so nothing is duplicated.
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
import { browserSupabaseConfig, createClient } from "@/lib/supabase/client";
import { routes } from "@/lib/routes";
import { interpolate } from "@/lib/format";
import { MAX_FILE_BYTES, validateUploadRequest } from "@/lib/files/sniff";
import { healingSentence } from "@/lib/parts/flag-message";
import type { UploadErrorCode } from "@/content/upload";
import { Dropzone } from "./dropzone";
import { QuickPartModal, type QuickPartMaterial } from "./quick-part-modal";
import {
  pollIntakeStatus,
  resumeIntakeRequest,
  uploadFileToQuote,
  UploadFlowError,
  type CompleteResponse,
  type UploadStage,
} from "./upload-client";

type RowStatus = "queued" | UploadStage | "processing" | "partial" | "done" | "error";

type Row = {
  id: string;
  file: File;
  status: RowStatus;
  error: UploadErrorCode | null;
  result: CompleteResponse | null;
  /** Set once the server has the upload — Retry / Resume then go through resume-intake. */
  fileId: string | null;
  /** Parts stored so far / expected (processing, partial). */
  progress: { done: number; expected: number } | null;
  /** Bytes sent during a resumable upload, as a percentage. */
  uploadPercent: number | null;
};

const PROGRESS: Record<RowStatus, number> = {
  queued: 5,
  signing: 20,
  uploading: 55,
  analysing: 85,
  processing: 92,
  partial: 100,
  done: 100,
  error: 100,
};
const GUIDE_ERRORS = new Set<UploadErrorCode>(["dwg", "binary_dxf", "unknown_type", "extension", "type_mismatch"]);
const MAX_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

export type UploadWorkspaceProps = {
  quoteId: string;
  bucket: string;
  canWrite: boolean;
  materials: QuickPartMaterial[];
};

function progressOf(result: CompleteResponse): Row["progress"] {
  return result.kind === "assembly" ? { done: result.parts.length, expected: result.expected } : null;
}

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
    const config = browserSupabaseConfig();

    const settle = (row: Row, result: CompleteResponse) => {
      const status: RowStatus = result.kind === "assembly" && result.intakeStatus === "partial" ? "partial" : "done";
      patch(row.id, { status, result, error: null, fileId: result.fileId, progress: progressOf(result), uploadPercent: null });
      router.refresh();
    };
    const fail = (row: Row, error: unknown) => {
      const flow = error instanceof UploadFlowError ? error : null;
      patch(row.id, { status: "error", error: flow?.code ?? "generic", fileId: flow?.fileId ?? row.fileId, uploadPercent: null });
    };
    /** The complete request timed out: the intake may still be running — poll, then fetch the result through resume. */
    const afterTimeout = async (row: Row, fileId: string) => {
      patch(row.id, { status: "processing", fileId, error: null, uploadPercent: null });
      const final = await pollIntakeStatus(fileId, {
        onProgress: (status) => patch(row.id, { progress: { done: status.partsDone ?? 0, expected: status.partsExpected ?? 0 } }),
      });
      if (final && (final.intakeStatus === "done" || final.intakeStatus === "partial")) {
        patch(row.id, { status: "analysing" });
        settle(row, await resumeIntakeRequest(fileId));
        return;
      }
      if (final?.intakeStatus === "failed") throw new UploadFlowError("generic", undefined, fileId);
      throw new UploadFlowError("analysis_timeout", undefined, fileId);
    };

    try {
      while (queue.current.length > 0) {
        const row = queue.current.shift()!;
        try {
          if (row.fileId) {
            patch(row.id, { status: "analysing", error: null });
            settle(row, await resumeIntakeRequest(row.fileId));
          } else {
            settle(
              row,
              await uploadFileToQuote({
                quoteId,
                file: row.file,
                bucket,
                supabase,
                supabaseUrl: config.url,
                supabaseKey: config.key,
                onStage: (stage) => patch(row.id, { status: stage }),
                onUploadProgress: (sent, total) => patch(row.id, { uploadPercent: total > 0 ? Math.round((sent / total) * 100) : null }),
              })
            );
          }
        } catch (error) {
          if (error instanceof UploadFlowError && error.code === "analysis_timeout" && error.fileId) {
            try {
              await afterTimeout(row, error.fileId);
            } catch (later) {
              fail(row, later);
            }
          } else {
            fail(row, error);
          }
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
        const base = { id, file, result: null, fileId: null, progress: null, uploadPercent: null };
        return validation.ok ? { ...base, status: "queued", error: null } : { ...base, status: "error", error: validation.code };
      });
      setRows((current) => [...next, ...current]);
      queue.current.push(...next.filter((row) => row.status === "queued"));
      void pump();
    },
    [pump]
  );

  /** Retry (error) and Resume (partial) — a row the server already has resumes instead of re-uploading. */
  const retry = (row: Row) => {
    const queued: Row = { ...row, status: "queued", error: null, result: null, uploadPercent: null };
    patch(row.id, { status: "queued", error: null, result: null, uploadPercent: null });
    queue.current.push(queued);
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
  const busy = row.status !== "done" && row.status !== "error" && row.status !== "partial";
  const settled = row.status === "error" || row.status === "done" || row.status === "partial";
  const progressText =
    row.status === "processing" && row.progress
      ? interpolate(t.results.processingParts, { done: row.progress.done, expected: row.progress.expected })
      : row.status === "uploading" && row.uploadPercent !== null
        ? interpolate(t.results.uploadProgress, { percent: row.uploadPercent })
        : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {result && (result.kind === "dxf" || result.kind === "step") && result.thumbnailSvg ? (
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
          ) : row.status === "partial" ? (
            <StatusChip severity="amber" label={status} />
          ) : row.status === "done" ? (
            result?.kind === "dxf" || result?.kind === "step" ? (
              <TriageChip state={result.triage.state} />
            ) : (
              <StatusChip severity="green" label={status} />
            )
          ) : (
            <StatusChip severity="neutral" label={progressText ?? status} />
          )}
          {result && result.kind !== "assembly" && result.partId && (
            <Link href={routes.part(result.partId)} className="btn btn-ghost btn-sm">
              {t.results.openPart}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </Link>
          )}
          {row.status === "partial" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
              {t.results.resume}
            </button>
          )}
          {row.status === "error" && row.error !== "dwg" && row.error !== "extension" && row.error !== "intake_done" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
              {row.fileId ? t.results.resume : t.results.retry}
            </button>
          )}
          {settled && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`${t.results.remove}: ${row.file.name}`}>
              {t.results.remove}
            </button>
          )}
        </div>
      </div>

      {busy && (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={row.status === "uploading" && row.uploadPercent !== null ? Math.round(20 + row.uploadPercent * 0.6) : PROGRESS[row.status]}
          aria-label={`${row.file.name}: ${progressText ?? status}`}
        >
          <span style={{ width: `${row.status === "uploading" && row.uploadPercent !== null ? Math.round(20 + row.uploadPercent * 0.6) : PROGRESS[row.status]}%` }} />
        </div>
      )}

      {row.status === "error" && row.error && (
        <Notice tone="error">
          {interpolate(c.upload.errors[row.error] ?? c.upload.errors.generic, { mb: MAX_MB })}
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

      {row.status === "partial" && row.progress && (
        <Notice tone="info">{interpolate(t.results.partialParts, { done: row.progress.done, expected: row.progress.expected })}</Notice>
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
          {result.kind === "step" && (
            <>
              <li>
                {result.flat
                  ? interpolate(t.results.stepFlat, { thickness: result.thicknessMm ?? "?" })
                  : interpolate(t.results.stepManual, result.triage.details)}
              </li>
              {result.restoredAnnotations && <li>{t.results.restored}</li>}
            </>
          )}
          {result.kind === "assembly" && (
            <>
              <li>{interpolate(result.format === "ifc" ? t.results.ifcSplit : t.results.assemblySplit, { count: result.parts.length })}</li>
              {result.skipped > 0 && <li>{interpolate(t.results.resumed, { skipped: result.skipped })}</li>}
              {result.failed.length > 0 && (
                <li className="text-red">{interpolate(t.results.partsFailed, { names: result.failed.map((f) => f.name).join(", ") })}</li>
              )}
              {result.parts.map((p) => (
                <li key={p.partId} className="flex flex-wrap items-center gap-2">
                  {p.thumbnailSvg ? <PartThumbnail svg={p.thumbnailSvg} size={40} label={p.name} /> : <span className="inline-block h-10 w-10 shrink-0 bg-surface" aria-hidden="true" />}
                  <span className="font-bold text-text-body">{p.name}</span>
                  {p.qty > 1 && <span className="num">× {p.qty}</span>}
                  <TriageChip state={p.triage.state} />
                  <Link href={routes.part(p.partId)} className="btn btn-ghost btn-sm">
                    {t.results.openPart}
                    <span aria-hidden="true" className="btn-arrow">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </>
  );
}
