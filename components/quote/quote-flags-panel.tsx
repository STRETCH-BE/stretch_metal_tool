"use client";

/**
 * QuoteFlagsPanel — feasibility flags grouped by severity with the
 * acceptance flow: amber flags get "confirm" (self-approved override) or
 * "request override" (note → admin queue); red flags show the explanation
 * only (never overridable); green flags are information. Below it, the
 * override list with statuses. Rendered from the SERVER flags
 * (bundle.flags) — a preview cannot be confirmed.
 * File path: /components/quote/quote-flags-panel.tsx
 */

import { useRef, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { Flag, FlagSeverity } from "@/lib/pricing/types";
import { flagsBySeverity, flagKey, overrideMatchesFlag } from "@/lib/quotes/shared";
import type { QuoteBundle } from "@/lib/quotes/types";
import { flagMessage, FlagChip } from "./flag-message";

export type QuoteFlagsPanelProps = {
  bundle: QuoteBundle;
  editable: boolean;
  pending: boolean;
  onConfirm: (flag: Flag) => Promise<void>;
  onRequestOverride: (flag: Flag, note: string) => Promise<void>;
};

type Coverage = "none" | "pending" | "approved" | "confirmed" | "rejected";

function coverageOf(bundle: QuoteBundle, flag: Flag): Coverage {
  const matching = bundle.overrides.filter((o) => overrideMatchesFlag(o, flag));
  if (matching.some((o) => o.status === "pending")) return "pending";
  const approved = matching.filter((o) => o.status === "approved");
  if (approved.some((o) => o.decided_by && o.decided_by === o.requested_by)) return "confirmed";
  if (approved.length > 0) return "approved";
  if (matching.some((o) => o.status === "rejected")) return "rejected";
  return "none";
}

export function QuoteFlagsPanel({ bundle, editable, pending, onConfirm, onRequestOverride }: QuoteFlagsPanelProps) {
  const c = useContent();
  const t = c.quote.builder.flags;
  const [dialogFlag, setDialogFlag] = useState<Flag | null>(null);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const partsById = new Map(bundle.parts.map((p) => [p.id, p]));
  const unique = new Map<string, Flag>();
  for (const flag of bundle.flags) if (!unique.has(flagKey(flag))) unique.set(flagKey(flag), flag);
  const groups = flagsBySeverity(Array.from(unique.values()));
  const order: FlagSeverity[] = ["red", "amber", "green"];

  const scope = (flag: Flag) =>
    flag.partId ? { name: partsById.get(flag.partId)?.name ?? flag.partId } : null;

  const submitOverride = async () => {
    if (!dialogFlag || note.trim().length < 3) return;
    await onRequestOverride(dialogFlag, note.trim());
    setDialogFlag(null);
    setNote("");
  };

  return (
    <div className="flex flex-col gap-4">
      {bundle.flags.length === 0 && <p className="text-[13px] text-text-muted">{t.none}</p>}
      {order.map((severity) =>
        groups[severity].length === 0 ? null : (
          <section key={severity} aria-label={t[severity]}>
            <div className="mb-2 flex items-center gap-2">
              <StatusChip severity={severity} label={t[severity]} />
              <span className="text-[12px] text-text-faint">{groups[severity].length}</span>
            </div>
            {severity === "red" && <p className="mb-2 text-[12.5px] text-text-muted">{t.redExplanation}</p>}
            <ul className="flex flex-col divide-y divide-border border border-border">
              {groups[severity].map((flag) => {
                const coverage = coverageOf(bundle, flag);
                const s = scope(flag);
                return (
                  <li key={flagKey(flag)} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <FlagChip content={c} flag={flag} />
                        <span className="text-[11px] tracking-[0.08em] text-text-faint uppercase">
                          {s ? (t.partScope.replace("{name}", s.name)) : t.quoteScope}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px]">{flagMessage(c, flag)}</p>
                    </div>
                    {severity === "amber" && (
                      <div className="flex flex-wrap items-center gap-2">
                        {coverage === "confirmed" && <StatusChip severity="green" label={t.confirmed} />}
                        {coverage === "approved" && <StatusChip severity="green" label={t.overrideApproved} />}
                        {coverage === "pending" && <StatusChip severity="amber" label={t.overrideRequested} />}
                        {coverage === "rejected" && <StatusChip severity="red" label={t.overrideRejected} />}
                        {editable && flag.overridable && (coverage === "none" || coverage === "rejected") && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onConfirm(flag)}>
                              {t.confirm}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={pending}
                              onClick={() => {
                                setDialogFlag(flag);
                                setNote("");
                              }}
                            >
                              {t.requestOverride}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}

      <Modal
        open={dialogFlag !== null}
        onClose={() => setDialogFlag(null)}
        title={t.dialogTitle}
        initialFocusRef={noteRef}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialogFlag(null)}>
              {t.dialogCancel}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending || note.trim().length < 3} onClick={submitOverride}>
              {t.dialogSubmit}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
          </>
        }
      >
        {dialogFlag && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <FlagChip content={c} flag={dialogFlag} />
            </div>
            <p className="text-[13px]">{flagMessage(c, dialogFlag)}</p>
            <Field label={t.dialogNote} htmlFor="override-note" requiredLabel={c.common.ui.required}>
              <Textarea
                id="override-note"
                ref={noteRef}
                rows={4}
                value={note}
                maxLength={2000}
                placeholder={t.dialogNotePlaceholder}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function QuoteOverridesList({ bundle }: { bundle: QuoteBundle }) {
  const c = useContent();
  const t = c.quote.builder.overrides;
  const partsById = new Map(bundle.parts.map((p) => [p.id, p]));
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{t.columns.rule}</Th>
            <Th>{t.columns.part}</Th>
            <Th>{t.columns.note}</Th>
            <Th>{t.columns.status}</Th>
            <Th align="num">{t.columns.decided}</Th>
          </tr>
        </thead>
        <tbody>
          {bundle.overrides.length === 0 ? (
            <tr className="row-muted">
              <Td colSpan={5} className="py-6 text-center">
                {t.empty}
              </Td>
            </tr>
          ) : (
            bundle.overrides.map((o) => {
              const confirmed = o.status === "approved" && o.decided_by !== null && o.decided_by === o.requested_by;
              const severity = o.status === "pending" ? "amber" : o.status === "approved" ? "green" : "red";
              return (
                <tr key={o.id}>
                  <Td className="mono">{o.rule_code}</Td>
                  <Td muted={!o.part_id}>{o.part_id ? (partsById.get(o.part_id)?.name ?? o.part_id) : "—"}</Td>
                  <Td>{o.note}</Td>
                  <Td>
                    <StatusChip severity={severity} label={confirmed ? t.status.confirmed : t.status[o.status]} />
                  </Td>
                  <Td align="num" muted={!o.decided_at}>
                    {o.decided_at ? formatDate(o.decided_at, c.locale) : "—"}
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
