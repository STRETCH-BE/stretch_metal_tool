/**
 * RateVersionView — the body of /admin/rates/[id] and
 * /admin/rates/[id]/[table]: version header + meta, read-only notice with
 * "clone to edit" for active / used versions, table tabs, the grid (or
 * the general form), CSV export link and import form.
 * File path: /components/admin/rate-version-view.tsx
 *
 * Server component shared by both routes so only the selected table's
 * rows are loaded per request.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatDate, interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { getRateVersionState, loadRateTableRows } from "@/lib/admin/rates";
import { RATE_TABLES, type RateTableName } from "@/lib/admin/tables";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { CloneVersionForm } from "@/components/admin/clone-version-form";
import { CsvImportForm } from "@/components/admin/csv-import-form";
import { RateGeneralForm } from "@/components/admin/rate-general-form";
import { RateGrid } from "@/components/admin/rate-grid";
import { RateVersionTabs } from "@/components/admin/rate-version-tabs";

export async function RateVersionView({
  id,
  table,
  notice,
  content,
  locale,
}: {
  id: string;
  table: RateTableName;
  notice?: string;
  content: Content;
  locale: Locale;
}) {
  const supabase = await createClient();
  const state = await getRateVersionState(supabase, id);
  if (!state) notFound();
  const rows = await loadRateTableRows(supabase, id, table);
  const t = content.admin.rates;
  const { version } = state;
  const def = RATE_TABLES[table];

  const meta = [
    `${t.version.meta.created}: ${formatDate(version.created_at, locale)}`,
    `${t.version.meta.createdBy}: ${state.createdByName ?? content.admin.audit.system}`,
    `${t.version.meta.usedBy}: ${state.quoteCount}`,
    `${t.version.meta.placeholders}: ${state.placeholderCount}`,
  ].join(" · ");

  return (
    <>
      <PageHeader
        eyebrow={t.version.eyebrow}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {version.label}
            {version.active ? (
              <StatusChip severity="green" label={t.versions.statusActive} />
            ) : (
              <StatusChip severity="neutral" label={t.versions.statusDraft} />
            )}
            {state.quoteCount > 0 && <StatusChip severity="dark" plain label={t.versions.statusUsed} />}
          </span>
        }
        subtitle={meta}
        actions={
          <>
            <Link href={routes.adminRates} className="btn btn-ghost btn-sm">
              {t.version.backToList}
            </Link>
            <Link href={routes.adminRateVersionDiff(id)} className="btn btn-ghost btn-sm">
              {t.version.diffLink}
            </Link>
            <a href={routes.api.adminRateCsv(id, table)} className="btn btn-ghost btn-sm" download>
              {t.version.csvExport}
            </a>
          </>
        }
      />

      {notice === "cloned" && (
        <Notice tone="success" className="mb-4">
          {t.versions.notices.cloned}
        </Notice>
      )}
      {version.note && <p className="mb-4 max-w-[860px] text-[13px] text-text-muted">{version.note}</p>}

      {!state.editable && (
        <Panel className="mb-6" title={t.version.cloneToEdit}>
          <div className="flex flex-col gap-4">
            <Notice tone="info">
              {version.active ? t.version.readOnlyActive : interpolate(t.version.readOnlyUsed, { count: state.quoteCount })}
            </Notice>
            <CloneVersionForm sourceId={id} submitLabel={t.version.cloneToEditSubmit} />
          </div>
        </Panel>
      )}

      <RateVersionTabs versionId={id} current={table} />

      <div className="flex flex-col gap-6">
        <Panel
          flush={!def.singleRow}
          title={t.tables[table]}
          id={`rates-${id}-panel-${table}`}
          actions={<span className="num text-[12px] text-text-muted">{rows.length}</span>}
        >
          <div role="tabpanel" aria-labelledby={`rates-${id}-tab-${table}`} className={def.singleRow ? "" : "p-0"}>
            {def.singleRow ? (
              <RateGeneralForm versionId={id} row={rows[0] ?? null} editable={state.editable} />
            ) : (
              <div className="p-3">
                <RateGrid versionId={id} table={table} rows={rows} editable={state.editable} />
              </div>
            )}
          </div>
        </Panel>

        {state.editable && (
          <Panel title={t.csv.title} className="max-w-[860px]">
            <CsvImportForm versionId={id} table={table} />
          </Panel>
        )}
      </div>
    </>
  );
}
