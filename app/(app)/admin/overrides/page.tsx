/**
 * Overrides queue — pending requests with quote context and the rule
 * that fired (approve / reject with a note), decided list with filters.
 * File path: /app/(app)/admin/overrides/page.tsx
 *
 * Filters are GET params (?status=approved|rejected&q=) so the URL is
 * shareable. Rule codes resolve through content.flags (tolerant lookup,
 * falls back to the code).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent, type Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatDateTime, interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { resolveFlagLabel } from "@/lib/admin/flag-message";
import { listOverrides, type OverrideListRow } from "@/lib/admin/overrides";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { OverrideDecisionForm } from "@/components/admin/override-decision-form";
import { ageText } from "@/components/admin/override-age";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.overrides.title };
}

type SearchParams = Promise<{ status?: string | string[]; q?: string | string[] }>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function QuoteCell({ row, content }: { row: OverrideListRow; content: Content }) {
  const t = content.admin.overrides;
  if (!row.quote) return <span className="text-text-faint">{t.unknownQuote}</span>;
  return (
    <Link href={routes.quote(row.quote.id)} className="lnk mono font-bold">
      {row.quote.number}
      {row.quote.version > 1 && ` ${interpolate(t.quoteVersion, { version: row.quote.version })}`}
    </Link>
  );
}

function RuleCell({ row, content }: { row: OverrideListRow; content: Content }) {
  const label = resolveFlagLabel(content.flags, row.rule_code);
  return (
    <span className="flex flex-col">
      <span>{label}</span>
      {label !== row.rule_code && <span className="mono text-[11px] text-text-faint">{row.rule_code}</span>}
    </span>
  );
}

export default async function OverridesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const locale: Locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.overrides;
  const status = first(params.status);
  const decidedStatus = status === "approved" || status === "rejected" ? status : null;
  const search = first(params.q).trim().slice(0, 100);

  const supabase = await createClient();
  const [pending, decided] = await Promise.all([
    listOverrides(supabase, { status: "pending" }),
    listOverrides(supabase, { status: "decided", decidedStatus, search }),
  ]);
  const now = Date.now();

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-6">
        <Panel flush title={t.pending.title} actions={<StatusChip severity={pending.length ? "amber" : "neutral"} plain label={String(pending.length)} />}>
          <TableWrap>
            <Table dense>
              <thead>
                <tr>
                  <Th>{t.columns.quote}</Th>
                  <Th>{t.columns.customer}</Th>
                  <Th>{t.columns.part}</Th>
                  <Th>{t.columns.rule}</Th>
                  <Th>{t.columns.requester}</Th>
                  <Th>{t.columns.note}</Th>
                  <Th>{t.columns.age}</Th>
                  <Th>{t.columns.actions}</Th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr className="row-muted">
                    <Td colSpan={8} className="py-8 text-center">
                      {t.pending.empty}
                    </Td>
                  </tr>
                )}
                {pending.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <QuoteCell row={row} content={c} />
                    </Td>
                    <Td muted={!row.customerName}>{row.customerName ?? "—"}</Td>
                    <Td muted={!row.partName}>{row.partName ?? t.wholeQuote}</Td>
                    <Td>
                      <RuleCell row={row} content={c} />
                    </Td>
                    <Td muted={!row.requesterName}>{row.requesterName ?? t.unknownUser}</Td>
                    <Td className="max-w-[320px] whitespace-pre-wrap">{row.note}</Td>
                    <Td className="num whitespace-nowrap" title={formatDateTime(row.created_at, locale)}>
                      {ageText(c, row.created_at, now)}
                    </Td>
                    <Td>
                      <OverrideDecisionForm overrideId={row.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>

        <Panel
          flush
          title={t.decided.title}
          actions={
            <form method="get" action={routes.adminOverrides} className="flex flex-wrap items-center gap-2">
              <label htmlFor="ov-status" className="visually-hidden">
                {t.decided.filters.status}
              </label>
              <select id="ov-status" name="status" defaultValue={decidedStatus ?? ""} className="field field-sm field-inline">
                <option value="">{t.decided.filters.all}</option>
                <option value="approved">{t.decided.filters.approved}</option>
                <option value="rejected">{t.decided.filters.rejected}</option>
              </select>
              <label htmlFor="ov-q" className="visually-hidden">
                {t.decided.filters.search}
              </label>
              <input
                id="ov-q"
                name="q"
                type="search"
                defaultValue={search}
                placeholder={t.decided.filters.searchPlaceholder}
                className="field field-sm field-inline w-[240px] max-w-full"
                autoComplete="off"
              />
              <button type="submit" className="btn btn-ghost btn-sm">
                {t.decided.filters.apply}
              </button>
              {(decidedStatus || search) && (
                <Link href={routes.adminOverrides} className="btn btn-ghost btn-sm">
                  {t.decided.filters.reset}
                </Link>
              )}
            </form>
          }
        >
          <TableWrap>
            <Table dense>
              <thead>
                <tr>
                  <Th>{t.columns.quote}</Th>
                  <Th>{t.columns.customer}</Th>
                  <Th>{t.columns.part}</Th>
                  <Th>{t.columns.rule}</Th>
                  <Th>{t.columns.status}</Th>
                  <Th>{t.columns.requester}</Th>
                  <Th>{t.columns.decidedBy}</Th>
                  <Th>{t.columns.decidedAt}</Th>
                  <Th>{t.columns.decisionNote}</Th>
                </tr>
              </thead>
              <tbody>
                {decided.length === 0 && (
                  <tr className="row-muted">
                    <Td colSpan={9} className="py-8 text-center">
                      {t.decided.empty}
                    </Td>
                  </tr>
                )}
                {decided.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <QuoteCell row={row} content={c} />
                    </Td>
                    <Td muted={!row.customerName}>{row.customerName ?? "—"}</Td>
                    <Td muted={!row.partName}>{row.partName ?? t.wholeQuote}</Td>
                    <Td>
                      <RuleCell row={row} content={c} />
                    </Td>
                    <Td>
                      <StatusChip severity={row.status === "approved" ? "green" : "red"} label={t.status[row.status]} />
                    </Td>
                    <Td muted={!row.requesterName}>{row.requesterName ?? t.unknownUser}</Td>
                    <Td muted={!row.deciderName}>{row.deciderName ?? t.unknownUser}</Td>
                    <Td className="num whitespace-nowrap">{row.decided_at ? formatDateTime(row.decided_at, locale) : "—"}</Td>
                    <Td className="max-w-[320px] whitespace-pre-wrap" muted={!row.decision_note}>
                      {row.decision_note ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>
      </div>
    </>
  );
}
