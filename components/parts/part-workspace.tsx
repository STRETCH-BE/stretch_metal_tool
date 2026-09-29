"use client";

/**
 * PartWorkspace — the client shell of the part page: viewer (left, ~2/3)
 * + panels (right), stacking below 1280 px. Holds the annotations state
 * for the viewer, debounces saveAnnotations (800 ms) with toasts, and
 * runs every panel action (material, triage answers, threads, bends,
 * qty, suggestions, re-analyse, prefill) followed by router.refresh() so
 * the server-computed measures, triage, thumbnail and flags re-render.
 * File path: /components/parts/part-workspace.tsx
 *
 * `geometry` is the STORED (annotated) geometry — measures, holes and
 * bends read from it; `viewerGeometry` is the base analysis the viewer
 * applies annotations to itself (the page derives it; they coincide
 * unless the annotations scale / mirror / delete). Export DXF navigates
 * to the route (attachment download). splitParts requests from the
 * viewer are not supported server-side in this phase and are ignored.
 *
 * Seam hand-off (assembly mode): when the part's quote item is a member
 * of a welded assembly (`assembly` prop, read-only from the page) the
 * welds table offers "Add as assembly seam" per weld → addSeamFromPart
 * (lib/quotes/actions.ts, matchSeam applied server-side). The state per
 * weld (idle / pending / added / paired / already) is derived by
 * components/quote/seam-handoff.ts from the assembly's stored seams and
 * the outcomes of this session; router.refresh() then brings the new
 * seam rows so a second click reads "already added".
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useContent } from "@/components/providers/locale";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { PartViewer, type ReanalyseRequest } from "@/components/viewer";
import { TriagePanel } from "@/components/triage/triage-panel";
import { SheetReportPanel } from "@/components/triage/sheet-report";
import { QuickPartModal } from "@/components/intake/quick-part-modal";
import { routes } from "@/lib/routes";
import type { AssemblySeamRow, PartSourceDb } from "@/lib/db/types";
import type { PartAnnotations, PartGeometry, Triage, WeldAnnotation } from "@/lib/geometry/types";
import { addSeamFromPart } from "@/lib/quotes/actions";
import { handoffOutcome, seamStateForWeld, weldToSeamInput, type SeamHandoffState } from "@/components/quote/seam-handoff";
import { interpolate } from "@/lib/format";
import type { Flag } from "@/lib/pricing/types";
import type { Suggestions } from "@/lib/ai/types";
import type { CurrentPartValues, SuggestionField } from "@/lib/ai/apply";
import { normalizeThreadSize } from "@/lib/ai/threads";
import { finishRateCodeFor, materialiseBends } from "@/lib/parts/annotation-edits";
import type { RatesInfo } from "@/lib/parts/queries";
import type { BendParams, TriageAnswer } from "@/lib/parts/schema";
import {
  acceptSuggestion,
  answerTriage,
  confirmThreadGroup,
  extractPartPdfText,
  reanalysePart,
  renamePart,
  runPrefill,
  saveAnnotations,
  setBendParams,
  setItemQty,
  setPartMaterial,
  type ActionResult,
} from "@/lib/parts/actions";
import { PartHeader } from "./part-header";
import { MaterialPanel } from "./material-panel";
import { MeasuresPanel } from "./measures-panel";
import { HolesTable, type ThreadChoice } from "./holes-table";
import { BendsTable, type BendRow } from "./bends-table";
import { WeldsTable } from "./welds-table";
import { RollSummary } from "./roll-summary";
import { AiPanel } from "./ai-panel";
import { FlagsPanel } from "./flags-panel";
import { QuantityPrice } from "./quantity-price";
import { PartActions } from "./part-actions";
import { NoGeometryPanel } from "./no-geometry";
import { DEFAULT_TOLERANCE_MM } from "@/lib/geometry/heal";

export type PartWorkspaceProps = {
  partId: string;
  quoteId: string;
  quoteNumber: string;
  name: string;
  source: PartSourceDb;
  materialCode: string | null;
  thicknessMm: number | null;
  geometry: PartGeometry | null;
  viewerGeometry: PartGeometry | null;
  annotations: PartAnnotations;
  triage: Triage | null;
  suggestions: Suggestions | null;
  flags: Flag[];
  item: { id: string; qty: number; unitCost: number; unitPrice: number | null; finishCodes: string[] } | null;
  quote: { currency: "PLN" | "EUR"; fxRate: number; priced: boolean };
  fileId: string | null;
  /** Production DXF of a STEP sheet part, when one was written at intake. */
  flatFileId: string | null;
  pdfFileId: string | null;
  pdfText: string | null;
  rates: RatesInfo;
  canWrite: boolean;
  aiAvailable: boolean;
  /** The welded assembly this part's item belongs to (with the assembly's seams), or null for a loose part. */
  assembly?: { id: string; name: string; seams: AssemblySeamRow[] } | null;
};

const SAVE_DEBOUNCE_MS = 800;

export function PartWorkspace(props: PartWorkspaceProps) {
  const c = useContent();
  const t = c.upload.part;
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // STEP models that are not flat sheets: geometry without entities whose
  // triage details (thickness, bends, size) pre-fill the quick part. A STEP
  // part stored before the reader existed has no geometry at all.
  const stepManual = props.source === "step" && props.geometry !== null && props.geometry.entities.length === 0;
  const legacyStep = props.source === "step" && props.geometry === null;
  const stepFacts = stepManual && props.geometry ? props.geometry.triage.details : null;
  const numOrNull = (v: number | string | undefined): number | null => (typeof v === "number" ? v : null);
  const quickDefaults = stepFacts
    ? {
        lengthMm: numOrNull(stepFacts.bboxX),
        widthMm: numOrNull(stepFacts.bboxY),
        thicknessMm: numOrNull(stepFacts.thicknessMm) ?? props.thicknessMm,
      }
    : undefined;
  const [annotations, setAnnotations] = useState<PartAnnotations>(props.annotations);
  const timer = useRef<number | null>(null);
  const pendingSave = useRef<PartAnnotations | null>(null);
  const saving = useRef(false);
  const disabled = !props.canWrite;

  // Server data changed (refresh after an action): adopt it unless an edit is in flight.
  useEffect(() => {
    if (!saving.current && pendingSave.current === null) setAnnotations(props.annotations);
  }, [props.annotations]);

  const errorText = useCallback((code: keyof typeof c.upload.errors) => c.upload.errors[code] ?? c.upload.errors.generic, [c]);

  const flushSave = useCallback(async () => {
    const next = pendingSave.current;
    if (!next || saving.current) return;
    pendingSave.current = null;
    saving.current = true;
    try {
      const result = await saveAnnotations(props.partId, next);
      if (result.ok) toast(t.saved, { tone: "success", durationMs: 2000 });
      else toast(`${t.saveError} ${errorText(result.error)}`, { tone: "error" });
    } catch {
      toast(t.saveError, { tone: "error" });
    } finally {
      saving.current = false;
    }
    if (pendingSave.current) void flushSave();
    else router.refresh();
  }, [errorText, props.partId, router, t.saveError, t.saved, toast]);

  const onAnnotationsChange = useCallback(
    (next: PartAnnotations) => {
      setAnnotations(next);
      pendingSave.current = next;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  useEffect(() => {
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        void flushSave();
      }
    };
  }, [flushSave]);

  /** Runs a server action, toasts the outcome and refreshes the route. */
  const act = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, successMessage?: string) => {
      setBusy(true);
      startTransition(async () => {
        try {
          const result = await fn();
          if (result.ok) {
            if (successMessage) toast(successMessage, { tone: "success", durationMs: 2500 });
            router.refresh();
          } else {
            toast(errorText(result.error), { tone: "error" });
          }
        } catch {
          toast(c.upload.errors.generic, { tone: "error" });
        } finally {
          setBusy(false);
        }
      });
    },
    [c.upload.errors.generic, errorText, router, toast]
  );

  const bendRows = useMemo<BendRow[]>(() => {
    if (annotations.bends.length > 0) return annotations.bends.map((b) => ({ ...b, source: "annotation" as const }));
    const lines = props.geometry?.measures.bendLines ?? [];
    const sources = new Map(lines.map((l) => [l.id, l.source] as const));
    return materialiseBends(annotations, props.geometry, props.thicknessMm).map((b) => ({ ...b, source: sources.get(b.id) ?? "layer" }));
  }, [annotations, props.geometry, props.thicknessMm]);

  const currentValues = useMemo<CurrentPartValues>(() => {
    const threadCounts = new Map<string, number>();
    for (const size of Object.values(annotations.threads)) {
      if (!size) continue;
      const key = normalizeThreadSize(size) ?? size;
      threadCounts.set(key, (threadCounts.get(key) ?? 0) + 1);
    }
    const suggestedFinish = props.suggestions?.finish ?? null;
    const finishAccepted =
      suggestedFinish?.code && props.item ? props.item.finishCodes.includes(finishRateCodeFor(suggestedFinish.code) ?? "") : false;
    return {
      material: props.materialCode,
      thicknessMm: props.thicknessMm,
      qty: props.item?.qty ?? null,
      threads: Array.from(threadCounts.entries()).map(([size, count]) => ({ size, count })),
      bends: bendRows.length > 0 ? { count: bendRows.length, angles: bendRows.map((b) => b.angleDeg) } : null,
      finish: finishAccepted ? suggestedFinish : null,
    };
  }, [annotations.threads, bendRows, props.item, props.materialCode, props.suggestions, props.thicknessMm]);

  const onReanalyse = (toleranceMm: number) =>
    act(async () => {
      const result = await reanalysePart(props.partId, toleranceMm);
      if (result.ok) toast(result.data.fromCache ? t.actions.reanalysedCached : t.actions.reanalysed, { tone: "success", durationMs: 2500 });
      return result;
    });

  const onViewerReanalyse = (request: ReanalyseRequest) => {
    if (request.toleranceMm !== undefined) onReanalyse(request.toleranceMm);
  };

  const onAcceptAll = (fields: SuggestionField[]) =>
    act(async () => {
      let last: ActionResult<{ applied: string }> = { ok: false, error: "nothing_to_apply" };
      for (const field of fields) {
        const result = await acceptSuggestion(props.partId, field);
        if (result.ok) last = result;
        else if (result.error !== "nothing_to_apply") return result;
      }
      return last;
    }, t.ai.applied);

  const priced = props.quote.priced && props.item !== null;

  /* ─── Seam hand-off (assembly member) ───────────────────── */
  const assembly = props.assembly ?? null;
  const [pendingWeldId, setPendingWeldId] = useState<string | null>(null);
  const [handoffOutcomes, setHandoffOutcomes] = useState<Record<string, SeamHandoffState>>({});
  const handoffStates = useMemo(() => {
    if (!assembly) return {};
    const states: Record<string, SeamHandoffState> = {};
    for (const weld of annotations.welds) states[weld.id] = seamStateForWeld(weld, props.partId, assembly.seams, pendingWeldId, handoffOutcomes);
    return states;
  }, [assembly, annotations.welds, props.partId, pendingWeldId, handoffOutcomes]);
  const onAddSeam = (weld: WeldAnnotation) => {
    if (!assembly || pendingWeldId) return;
    const h = c.quote.builder.assembly.handoff;
    const existing = new Set(assembly.seams.map((s) => s.id));
    setPendingWeldId(weld.id);
    startTransition(async () => {
      try {
        const result = await addSeamFromPart(props.partId, weldToSeamInput(weld, props.partId, props.thicknessMm));
        const outcome = handoffOutcome(result, existing);
        if (!result.ok) {
          toast(interpolate(c.quote.builder.errors[result.error], { message: result.message ?? "" }), { tone: "error" });
        } else if (outcome) {
          setHandoffOutcomes((o) => ({ ...o, [weld.id]: outcome }));
          toast(outcome === "paired" ? c.quote.builder.assembly.seams.addedPaired : outcome === "already" ? h.alreadyAdded : c.quote.builder.assembly.seams.added, { tone: "success", durationMs: 3000 });
          router.refresh();
        }
      } catch {
        toast(h.failed, { tone: "error" });
      } finally {
        setPendingWeldId(null);
      }
    });
  };

  return (
    <>
      <PartHeader
        name={props.name}
        source={props.source}
        triageState={props.triage?.state ?? null}
        quoteId={props.quoteId}
        quoteNumber={assembly ? `${props.quoteNumber} · ${assembly.name}` : props.quoteNumber}
        fileId={props.fileId}
        pdfFileId={props.pdfFileId}
        disabled={disabled}
        onRename={(name) => act(() => renamePart(props.partId, name), c.common.actions.saved)}
      />
      {disabled && (
        <Notice tone="info" className="mb-4">
          {t.readOnlyNotice}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {props.viewerGeometry && props.geometry && !stepManual ? (
            <section aria-label={t.viewerLabel}>
              <PartViewer
                geometry={props.viewerGeometry}
                annotations={annotations}
                onAnnotationsChange={disabled ? undefined : onAnnotationsChange}
                thicknessMm={props.thicknessMm}
                readOnly={disabled}
                onExportDxf={() => window.location.assign(routes.partExportDxf(props.partId))}
                onRequestReanalyse={disabled ? undefined : onViewerReanalyse}
                height={560}
              />
            </section>
          ) : (
            <NoGeometryPanel
              source={props.source}
              disabled={disabled}
              facts={stepFacts}
              legacyStep={legacyStep}
              onQuickPart={() => setQuickOpen(true)}
              onAnalyseStep={() => onReanalyse(DEFAULT_TOLERANCE_MM)}
            />
          )}
          {props.geometry && !stepManual && <MeasuresPanel geometry={props.geometry} />}
          {props.geometry && !stepManual && (
            <HolesTable
              holes={props.geometry.measures.holes}
              threads={annotations.threads}
              threadOptions={props.rates.threads}
              materialCode={props.materialCode}
              thicknessMm={props.thicknessMm}
              disabled={disabled || busy}
              onConfirm={(loopIds, choice: ThreadChoice) => act(() => confirmThreadGroup(props.partId, loopIds, choice), c.common.actions.saved)}
            />
          )}
          {props.geometry && !stepManual && (
            <BendsTable
              bends={bendRows}
              thicknessMm={props.thicknessMm}
              disabled={disabled || busy}
              onSave={(bendId, params: BendParams) => act(() => setBendParams(props.partId, bendId, params), c.common.actions.saved)}
            />
          )}
          <WeldsTable
            welds={annotations.welds}
            handoff={assembly ? { assemblyName: assembly.name, states: handoffStates, disabled: disabled || busy || pendingWeldId !== null, onAdd: onAddSeam } : null}
          />
          <RollSummary roll={annotations.roll} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <MaterialPanel
            materialCode={props.materialCode}
            thicknessMm={props.thicknessMm}
            rates={props.rates}
            disabled={disabled || busy}
            onSave={(input) => act(() => setPartMaterial(props.partId, input), c.common.actions.saved)}
          />
          <TriagePanel
            triage={props.triage}
            healing={props.geometry?.healing ?? null}
            dropped={props.geometry?.dropped ?? []}
            annotations={annotations}
            disabled={disabled}
            busy={busy}
            onAnswer={(answer: TriageAnswer) => act(() => answerTriage(props.partId, answer), t.triage.answered)}
            onReanalyse={onReanalyse}
            onQuickPart={() => setQuickOpen(true)}
          />
          {props.geometry?.sheet && (
            <SheetReportPanel
              geometry={props.geometry}
              annotations={annotations}
              flags={props.flags}
              densityKgM3={props.rates.materials.find((m) => m.code.toLowerCase() === (props.materialCode ?? "").toLowerCase())?.densityKgM3 ?? null}
              flatFileId={props.flatFileId}
            />
          )}
          <AiPanel
            suggestions={props.suggestions}
            current={currentValues}
            pdfAttached={props.pdfFileId !== null}
            pdfText={props.pdfText}
            aiAvailable={props.aiAvailable}
            disabled={disabled}
            busy={busy}
            onAccept={(field) => act(() => acceptSuggestion(props.partId, field), t.ai.applied)}
            onAcceptAll={onAcceptAll}
            onRunPrefill={() => act(() => runPrefill(props.partId), t.ai.prefillDone)}
            onExtractText={() => act(() => extractPartPdfText(props.partId))}
          />
          <FlagsPanel flags={props.flags} priced={priced} />
          {props.item && (
            <QuantityPrice
              qty={props.item.qty}
              unitCostEur={props.item.unitCost}
              unitPriceEur={props.item.unitPrice}
              currency={props.quote.currency}
              fxRate={props.quote.fxRate}
              priced={priced}
              disabled={disabled || busy}
              onQtyChange={(qty) => act(() => setItemQty(props.partId, qty), c.common.actions.saved)}
            />
          )}
          <PartActions
            partId={props.partId}
            canReanalyse={(props.source === "dxf" || props.source === "step") && props.fileId !== null}
            canExport={props.geometry !== null}
            currentToleranceMm={props.geometry?.healing.toleranceMm ?? null}
            disabled={disabled}
            busy={busy}
            onReanalyse={onReanalyse}
            onExport={() => window.location.assign(routes.partExportDxf(props.partId))}
          />
        </div>
      </div>

      <QuickPartModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        quoteId={props.quoteId}
        materials={props.rates.choices}
        defaultName={props.name}
        defaults={quickDefaults}
        replacePartId={props.partId}
        onCreated={() => {
          setQuickOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
