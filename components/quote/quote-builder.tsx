"use client";

/**
 * QuoteBuilder — the client island of the quote page: editable header,
 * parts table with breakdown, totals by operation type with the internal
 * cost/margin split, welding block, flags + overrides, actions bar (upload,
 * new version, PDF PL/EN with ops toggle, send, won/lost, recalculate).
 * File path: /components/quote/quote-builder.tsx
 *
 * Live preview: the page hands over the RateSnapshot + MachinePark the
 * quote is pinned to; every qty/margin/extras/seam edit re-runs the
 * pure priceQuote() locally (components/quote/preview.ts) and the numbers
 * are labelled "preview" until a server action persists them — the
 * server result (bundle.pricing) then replaces the preview when the
 * refreshed props arrive. Nothing computed here is ever sent to the
 * server as a price.
 *
 * Every mutation is a server action from lib/quotes/actions.ts, run in
 * a transition; error codes map to content.quote.builder.errors and
 * surface as toasts. `canEdit` (role + ownership) and `editable`
 * (status draft / pending_override) gate every control.
 *
 * Header currency ↔ fx: the header state keeps the EUR→PLN rate the
 * quote would use as PLN (components/quote/header-state.ts). An EUR
 * quote stores fx_rate = 1, so switching it to PLN seeds the rate from
 * `fxEurPln` (the environment default passed by the page) instead of
 * carrying the sentinel 1 into PLN prices; a PLN rate ≤ 1 is flagged on
 * the field and rejected by the server schema.
 *
 * Send: the guard requires a customer e-mail exactly when the mailer is
 * configured (the server applies the same rule), and the success toast
 * distinguishes mailed / mailer off / mail failed. The audit excerpt is
 * `null` when the viewer may not see it (not admin, not the owner) and
 * the panel is then not rendered at all.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useContent } from "@/components/providers/locale";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { NumberInput } from "@/components/ui/number-input";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, formatNumber, formatPercent, interpolate } from "@/lib/format";
import type { ExtraOperation, Flag, MachinePark, OperationType, RateSnapshot } from "@/lib/pricing/types";
import { marginToMarkup } from "@/lib/pricing/types";
import { routes } from "@/lib/routes";
import {
  addItem,
  confirmFlag,
  duplicateAsNewVersion,
  removeItem,
  reorderItems,
  repriceQuoteAction,
  requestOverride,
  sendQuoteAction,
  setQuoteStatus,
  updateItem,
  updateQuoteHeader,
  updateWeldingOnly,
} from "@/lib/quotes/actions";
import type { CustomerOption } from "@/lib/quotes/queries";
import { CURRENCIES, type ItemUpdateInput, type QuoteActionResult } from "@/lib/quotes/schema";
import { canSend } from "@/lib/quotes/send-guard";
import { OPERATION_TYPE_ORDER, isQuoteEditable, quoteNumberLabel, validUntilDate } from "@/lib/quotes/shared";
import type { QuoteAuditRow, QuoteBundle, SendCheck } from "@/lib/quotes/types";
import { effectiveFxRate, headerFromBundle, headerFxInvalid, headerToInput, type HeaderState } from "./header-state";
import { makeMoney } from "./money";
import { computePreview, draftFromBundle, isDraftDirty, type QuoteDraft } from "./preview";
import { QuoteAudit } from "./quote-audit";
import { QuoteFlagsPanel, QuoteOverridesList } from "./quote-flags-panel";
import { QuotePartsTable } from "./quote-parts-table";
import { QuoteStatusChip } from "./quote-status-chip";
import { WeldingSeamsEditor } from "./welding-seams-editor";

export type QuoteBuilderProps = {
  bundle: QuoteBundle;
  rates: RateSnapshot | null;
  machines: MachinePark;
  customers: CustomerOption[];
  /** Audit excerpt, or null when this viewer may not see it (panel hidden). */
  audit: QuoteAuditRow[] | null;
  canEdit: boolean;
  isAdmin: boolean;
  mailConfigured: boolean;
  sendCheck: SendCheck;
  /** Environment default EUR→PLN rate (defaultFxEurPln()), seeds the fx field on an EUR → PLN switch. */
  fxEurPln: number;
};

export function QuoteBuilder({ bundle, rates, machines, customers, audit, canEdit, isAdmin, mailConfigured, sendCheck, fxEurPln }: QuoteBuilderProps) {
  const c = useContent();
  const b = c.quote.builder;
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const quote = bundle.quote;
  const editable = canEdit && isQuoteEditable(quote.status);
  const bundleKey = `${quote.updated_at}|${quote.priced_at ?? ""}|${bundle.items.map((i) => `${i.id}:${i.qty}:${i.position}`).join(",")}`;

  const [draft, setDraft] = useState<QuoteDraft>(() => draftFromBundle(bundle));
  const [header, setHeader] = useState<HeaderState>(() => headerFromBundle(bundle, fxEurPln));
  const [pdfOps, setPdfOps] = useState(quote.show_operations_on_pdf);
  const [sendLocale, setSendLocale] = useState<"pl" | "en">(bundle.customer?.preferred_locale ?? "pl");

  // Server truth arrived (after a save): drop local edits.
  useEffect(() => {
    setDraft(draftFromBundle(bundle));
    setHeader(headerFromBundle(bundle, fxEurPln));
    setPdfOps(bundle.quote.show_operations_on_pdf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleKey]);

  const dirty = isDraftDirty(draft, bundle);
  const preview = useMemo(() => computePreview(bundle, rates, machines, draft), [bundle, rates, machines, draft]);
  const priced = dirty && preview.priced ? preview.priced : bundle.pricing;
  const showingPreview = dirty && preview.priced !== null;
  const money = useMemo(() => makeMoney(draft.currency, draft.fxRate, c.locale), [draft.currency, draft.fxRate, c.locale]);

  const report = (result: QuoteActionResult, success: string) => {
    if (result.ok) toast(success, { tone: "success" });
    else toast(interpolate(b.errors[result.error], { message: result.message ?? "" }), { tone: "error", durationMs: 8000 });
  };

  const run = (fn: () => Promise<QuoteActionResult>, success: string) =>
    startTransition(async () => {
      report(await fn(), success);
    });

  /* ─── Header ─────────────────────────────────────────────── */
  const patchHeader = (patch: Partial<HeaderState>) => {
    const next = { ...header, ...patch };
    setHeader(next);
    setDraft((d) => ({ ...d, marginPct: next.marginPct, currency: next.currency, fxRate: effectiveFxRate(next) }));
  };
  const fxInvalid = headerFxInvalid(header);
  const saveHeader = () => {
    if (fxInvalid) {
      toast(b.errors.invalidFx, { tone: "error" });
      return;
    }
    run(() => updateQuoteHeader(quote.id, headerToInput(header)), b.header.saved);
  };

  /* ─── Items ──────────────────────────────────────────────── */
  const onQtyChange = (itemId: string, qty: number | null) => {
    if (qty === null || qty < 1) return;
    setDraft((d) => ({ ...d, qtyById: { ...d.qtyById, [itemId]: Math.round(qty) } }));
  };
  const onExtrasChange = (itemId: string, extras: ExtraOperation[]) =>
    setDraft((d) => ({ ...d, extrasById: { ...d.extrasById, [itemId]: extras } }));
  const onSaveItem = (itemId: string, input: ItemUpdateInput) => run(() => updateItem(itemId, input), b.extras.saved);
  const onRemoveItem = async (itemId: string) => {
    report(await removeItem(itemId), c.common.actions.saved);
  };
  const onReorder = (ids: string[]) => run(() => reorderItems(quote.id, ids), c.common.actions.saved);
  const onAddItem = (partId: string) => run(() => addItem(quote.id, partId), c.common.actions.saved);

  /* ─── Flags ──────────────────────────────────────────────── */
  const onConfirm = async (flag: Flag) => {
    report(await confirmFlag({ quoteId: quote.id, flagCode: flag.code, partId: flag.partId, itemId: flag.itemId }), b.flags.confirmedToast);
  };
  const onRequestOverride = async (flag: Flag, note: string) => {
    report(await requestOverride({ quoteId: quote.id, flagCode: flag.code, partId: flag.partId, itemId: flag.itemId, note }), b.flags.requestSent);
  };

  /* ─── Send / status ──────────────────────────────────────── */
  const liveSendCheck = useMemo(
    () => (dirty ? sendCheck : canSend(bundle, { requireEmail: mailConfigured })),
    [bundle, dirty, sendCheck, mailConfigured]
  );
  const onSend = async () => {
    const result = await sendQuoteAction(quote.id, { locale: sendLocale });
    if (!result.ok) {
      toast(interpolate(b.errors[result.error], { message: result.message ?? "" }), { tone: "error", durationMs: 8000 });
      return;
    }
    if (!result.sent) {
      toast(`${b.actions.sendBlocked} ${result.reasons.map((r) => b.send.reasons[r]).join("; ")}`, { tone: "error", durationMs: 8000 });
      return;
    }
    if (result.mail === "failed") {
      toast(b.actions.sentMailFailed, { tone: "error", durationMs: 10000 });
      return;
    }
    toast(result.mail === "sent" ? b.actions.sent : b.actions.sentNoMail, { tone: "success", durationMs: 8000 });
  };

  const validUntil = validUntilDate(quote.sent_at ?? quote.created_at, header.validityDays);
  const totals = priced?.totalsByType ?? {};
  const totalTypes = OPERATION_TYPE_ORDER.filter((t) => totals[t]);
  const marginAmount = priced ? priced.subtotalPrice - priced.subtotalCost : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {!canEdit && <Notice tone="info">{b.header.readOnly}</Notice>}
        {canEdit && !editable && <Notice tone="info">{b.header.locked}</Notice>}
        {preview.error && <Notice tone="error">{interpolate(b.errors.pricing, { message: preview.error })}</Notice>}

        {/* Header */}
        <Panel
          title={b.header.eyebrow}
          actions={
            <>
              <QuoteStatusChip status={quote.status} content={c} />
              <span className="text-[12px] text-text-muted">
                {b.header.rateVersion}: {bundle.rateVersionLabel ?? b.header.noRateVersion}
              </span>
            </>
          }
        >
          <fieldset disabled={!editable || pending} className="grid gap-4 md:grid-cols-3">
            <Field label={b.header.customer} htmlFor="q-customer">
              <Select id="q-customer" dense value={header.customerId} onChange={(e) => patchHeader({ customerId: e.target.value })}>
                <option value="">{b.header.noCustomer}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.country}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={b.header.currency} htmlFor="q-currency">
              <Select
                id="q-currency"
                dense
                value={header.currency}
                onChange={(e) => patchHeader({ currency: e.target.value as "PLN" | "EUR" })}
              >
                {CURRENCIES.map((value) => (
                  <option key={value} value={value}>
                    {c.common.currency[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={b.header.fxRate}
              htmlFor="q-fx"
              help={interpolate(b.header.fxRateHelp, { fx: formatNumber(fxEurPln, c.locale, { maximumFractionDigits: 4 }) })}
              error={fxInvalid ? b.errors.invalidFx : undefined}
            >
              <NumberInput
                id="q-fx"
                dense
                value={effectiveFxRate(header)}
                onValueChange={(v) => v !== null && patchHeader({ fxRate: v })}
                decimals={4}
                min={0.0001}
                invalid={fxInvalid}
                disabled={header.currency === "EUR"}
              />
            </Field>
            <Field
              label={b.header.margin}
              htmlFor="q-margin"
              help={interpolate(b.header.markup, { markup: formatPercent(marginToMarkup(header.marginPct), c.locale) })}
            >
              <NumberInput
                id="q-margin"
                dense
                value={header.marginPct}
                onValueChange={(v) => v !== null && patchHeader({ marginPct: v })}
                decimals={2}
                min={0}
                max={99.99}
              />
            </Field>
            <Field label={b.header.validityDays} htmlFor="q-validity" help={interpolate(b.header.validUntil, { date: formatDate(validUntil, c.locale) })}>
              <NumberInput
                id="q-validity"
                dense
                value={header.validityDays}
                onValueChange={(v) => v !== null && patchHeader({ validityDays: Math.max(1, Math.round(v)) })}
                decimals={0}
                min={1}
                max={365}
              />
            </Field>
            <Field label={b.header.leadTime} htmlFor="q-lead">
              <Input id="q-lead" dense value={header.leadTimeText} maxLength={200} onChange={(e) => patchHeader({ leadTimeText: e.target.value })} />
            </Field>
            <Field label={b.header.paymentTerms} htmlFor="q-terms" className="md:col-span-2">
              <Textarea id="q-terms" dense rows={2} value={header.paymentTermsText} maxLength={2000} onChange={(e) => patchHeader({ paymentTermsText: e.target.value })} />
            </Field>
            <Field label={b.header.notes} htmlFor="q-notes">
              <Textarea id="q-notes" dense rows={2} value={header.notes} maxLength={4000} onChange={(e) => patchHeader({ notes: e.target.value })} />
            </Field>
            <div className="flex flex-wrap items-center gap-5 md:col-span-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={header.showOperationsOnPdf}
                  onChange={(e) => patchHeader({ showOperationsOnPdf: e.target.checked })}
                />
                {b.header.showOperationsOnPdf}
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={header.weldingSeparate}
                  onChange={(e) => patchHeader({ weldingSeparate: e.target.checked })}
                />
                {b.header.weldingSeparate}
              </label>
              {editable && (
                <button type="button" className="btn btn-primary btn-sm ml-auto" onClick={saveHeader} disabled={pending || fxInvalid}>
                  {b.header.save}
                  <span aria-hidden="true" className="btn-arrow">
                    →
                  </span>
                </button>
              )}
            </div>
          </fieldset>
        </Panel>

        {/* Parts */}
        <Panel
          flush
          title={b.parts.title}
          actions={
            editable ? (
              <Link href={routes.quoteUpload(quote.id)} className="btn btn-ghost btn-sm">
                {b.parts.uploadParts}
                <span aria-hidden="true" className="btn-arrow">
                  →
                </span>
              </Link>
            ) : undefined
          }
        >
          <QuotePartsTable
            bundle={bundle}
            priced={priced}
            draft={draft}
            rates={rates}
            editable={editable}
            pending={pending}
            money={money}
            onQtyChange={onQtyChange}
            onExtrasChange={onExtrasChange}
            onSaveItem={onSaveItem}
            onRemoveItem={onRemoveItem}
            onReorder={onReorder}
            onAddItem={onAddItem}
          />
        </Panel>

        {/* Welding block */}
        {(quote.type === "welding_only" || priced?.welding) && (
          <Panel title={b.welding.blockTitle} actions={priced?.welding ? <span className="money font-bold">{money(priced.welding.price)}</span> : undefined}>
            {quote.type === "welding_only" ? (
              <WeldingSeamsEditor
                bundle={bundle}
                value={draft.welding ?? { seams: [], partsCount: 0 }}
                editable={editable}
                pending={pending}
                dirty={JSON.stringify(draft.welding) !== JSON.stringify(bundle.weldingOnly)}
                onChange={(next) => setDraft((d) => ({ ...d, welding: next }))}
                onSave={() => run(() => updateWeldingOnly(quote.id, draft.welding ?? { seams: [], partsCount: 0 }), b.welding.saved)}
              />
            ) : null}
            {priced?.welding && (
              <div className={quote.type === "welding_only" ? "mt-4" : ""}>
                <TableWrap>
                  <Table dense>
                    <thead>
                      <tr>
                        <Th>{b.operations.columns.operation}</Th>
                        <Th align="num">{b.operations.columns.driver}</Th>
                        <Th align="num">{b.operations.columns.unitCost}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {priced.welding.operations.map((op) => (
                        <tr key={op.id}>
                          <Td>{(b.operations.labels as Record<string, string>)[op.label] ?? op.label}</Td>
                          <Td align="num">
                            {formatNumber(op.driverQty, c.locale, { maximumFractionDigits: 1 })} {b.operations.units[op.driverUnit]}
                          </Td>
                          <Td align="num" className="money">
                            {money(op.unitCost)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                {priced.welding.minOrderApplied && <p className="mt-2 text-[12px] text-text-muted">{b.welding.minOrderApplied}</p>}
              </div>
            )}
          </Panel>
        )}

        {/* Flags */}
        <Panel title={b.flags.title}>
          <QuoteFlagsPanel bundle={bundle} editable={editable} pending={pending} onConfirm={onConfirm} onRequestOverride={onRequestOverride} />
        </Panel>

        <Panel flush title={b.overrides.title}>
          <QuoteOverridesList bundle={bundle} />
        </Panel>

        {audit && (
          <Panel flush title={b.audit.title}>
            <QuoteAudit rows={audit} content={c} locale={c.locale} />
          </Panel>
        )}
      </div>

      {/* Right column: totals + actions */}
      <div className="flex flex-col gap-6 xl:sticky xl:top-[calc(var(--app-topbar-h)+24px)] xl:self-start">
        <Panel
          title={b.totals.title}
          actions={showingPreview ? <StatusChip severity="amber" label={b.totals.preview} title={b.totals.previewBody} /> : undefined}
        >
          {showingPreview && <Notice tone="info" className="mb-3">{b.totals.previewBody}</Notice>}
          {!priced ? (
            <p className="text-[13px] text-text-muted">{b.totals.notPriced}</p>
          ) : (
            <>
              <Table dense>
                <thead>
                  <tr>
                    <Th>{b.totals.columns.type}</Th>
                    <Th align="num">{b.totals.columns.cost}</Th>
                    <Th align="num">{b.totals.columns.price}</Th>
                  </tr>
                </thead>
                <tbody>
                  {totalTypes.map((type) => (
                    <tr key={type}>
                      <Td>{b.operations.types[type as OperationType]}</Td>
                      <Td align="num" className="money" muted>
                        {money(totals[type]!.cost)}
                      </Td>
                      <Td align="num" className="money">
                        {money(totals[type]!.price)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <Td>{b.totals.subtotalCost}</Td>
                    <Td align="num" className="money" colSpan={2}>
                      {money(priced.subtotalCost)}
                    </Td>
                  </tr>
                  <tr>
                    <Td>{b.totals.subtotalPrice}</Td>
                    <Td align="num" className="money text-[15px]" colSpan={2}>
                      {money(priced.subtotalPrice)}
                    </Td>
                  </tr>
                </tfoot>
              </Table>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
                <dt className="text-text-muted">{b.totals.margin}</dt>
                <dd className="num">
                  {formatPercent(priced.marginPct, c.locale)} · {interpolate(b.header.markup, { markup: formatPercent(priced.markupPct, c.locale) })}
                </dd>
                <dt className="text-text-muted">{b.totals.marginAmount}</dt>
                <dd className="num money">{money(marginAmount)}</dd>
              </dl>
              {draft.currency === "PLN" && (
                <p className="mt-2 text-[11.5px] text-text-faint">
                  {interpolate(b.totals.fxNote, { currency: draft.currency, fx: formatNumber(draft.fxRate, c.locale, { maximumFractionDigits: 4 }) })}
                </p>
              )}
              <p className="mt-2 text-[11.5px] text-text-faint">{b.totals.internalOnly}</p>
              {priced.usesPlaceholderRates && <p className="mt-2 text-[11.5px] text-flag-amber">{b.totals.placeholderRates}</p>}
              {quote.priced_at && !showingPreview && (
                <p className="mt-2 text-[11.5px] text-text-faint">{interpolate(b.totals.pricedAt, { date: formatDateTime(quote.priced_at, c.locale) })}</p>
              )}
            </>
          )}
        </Panel>

        <Panel title={b.actions.title}>
          <div className="flex flex-col gap-3">
            {canEdit && (
              <>
                {editable && (
                  <Link href={routes.quoteUpload(quote.id)} className="btn btn-ghost btn-sm">
                    {b.actions.upload}
                    <span aria-hidden="true" className="btn-arrow">
                      →
                    </span>
                  </Link>
                )}
                {editable && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={() => run(() => repriceQuoteAction(quote.id), b.actions.recalculated)}
                  >
                    {b.actions.recalculate}
                  </button>
                )}
                <ConfirmButton
                  action={async () => {
                    const result = await duplicateAsNewVersion(quote.id);
                    if (!result.ok) report(result, b.actions.duplicated);
                  }}
                  question={b.actions.duplicateConfirm}
                  disabled={pending}
                >
                  {b.actions.duplicate}
                </ConfirmButton>
              </>
            )}

            <div className="divider" />
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="checkbox" checked={pdfOps} onChange={(e) => setPdfOps(e.target.checked)} />
              {b.actions.withOperations}
            </label>
            <div className="flex flex-wrap gap-2">
              <a href={routes.quotePdfExport(quote.id, "pl", pdfOps)} className="btn btn-ghost btn-sm" download>
                {b.actions.exportPdfPl}
              </a>
              <a href={routes.quotePdfExport(quote.id, "en", pdfOps)} className="btn btn-ghost btn-sm" download>
                {b.actions.exportPdfEn}
              </a>
            </div>

            {canEdit && editable && (
              <>
                <div className="divider" />
                {!mailConfigured && <p className="text-[11.5px] text-text-faint">{b.actions.mailNotConfigured}</p>}
                <Field label={b.send.sendLocale} htmlFor="q-send-locale">
                  <Select id="q-send-locale" dense value={sendLocale} onChange={(e) => setSendLocale(e.target.value as "pl" | "en")}>
                    <option value="pl">{b.send.localePl}</option>
                    <option value="en">{b.send.localeEn}</option>
                  </Select>
                </Field>
                <ConfirmButton
                  action={onSend}
                  question={b.actions.sendConfirm}
                  variant="danger"
                  size="md"
                  disabled={pending || !liveSendCheck.ok}
                >
                  {b.actions.send}
                </ConfirmButton>
                {!liveSendCheck.ok && (
                  <div className="text-[12px] text-text-muted" title={liveSendCheck.reasons.map((r) => b.send.reasons[r]).join("; ")}>
                    <span className="font-bold">{b.actions.sendBlocked}</span>
                    <ul className="mt-1 list-disc pl-4">
                      {liveSendCheck.reasons.map((reason) => (
                        <li key={reason}>{b.send.reasons[reason]}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {canEdit && quote.status === "sent" && (
              <>
                <div className="divider" />
                <div className="flex flex-wrap gap-2">
                  <ConfirmButton action={() => setQuoteStatus(quote.id, "won").then((r) => report(r, b.actions.decisionSaved))} disabled={pending}>
                    {b.actions.markWon}
                  </ConfirmButton>
                  <ConfirmButton action={() => setQuoteStatus(quote.id, "lost").then((r) => report(r, b.actions.decisionSaved))} disabled={pending}>
                    {b.actions.markLost}
                  </ConfirmButton>
                </div>
              </>
            )}
            {isAdmin && bundle.overrides.some((o) => o.status === "pending") && (
              <Link href={routes.adminOverrides} className="lnk text-[12px] font-bold uppercase tracking-[0.1em]">
                {c.common.nav.overrides}
              </Link>
            )}
          </div>
        </Panel>

        <Panel title={quoteNumberLabel(quote)}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-text-muted">{b.header.created}</dt>
            <dd>{formatDateTime(quote.created_at, c.locale)}</dd>
            {quote.sent_at && (
              <>
                <dt className="text-text-muted">{b.header.sent}</dt>
                <dd>{formatDateTime(quote.sent_at, c.locale)}</dd>
              </>
            )}
            <dt className="text-text-muted">{c.quote.customers.history.columns.type}</dt>
            <dd>{b.types[quote.type]}</dd>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
