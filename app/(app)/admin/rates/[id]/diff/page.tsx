/**
 * Diff against the active version — per table, rows keyed by their
 * natural key, marked added / removed / changed with old → new cells.
 * File path: /app/(app)/admin/rates/[id]/diff/page.tsx
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { diffRows } from "@/lib/admin/diff";
import { getActiveRateVersion, getRateVersion, loadAllRateTables } from "@/lib/admin/rates";
import { RATE_TABLES, RATE_TABLE_NAMES, rateRowKey } from "@/lib/admin/tables";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { RateDiffView } from "@/components/admin/rate-diff-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.rates.diff.title };
}

export default async function RateDiffPage({ params }: { params: Params }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.rates.diff;
  const supabase = await createClient();

  const [version, active] = await Promise.all([getRateVersion(supabase, id), getActiveRateVersion(supabase)]);
  if (!version) notFound();

  const back = (
    <Link href={routes.adminRateVersion(id)} className="btn btn-ghost btn-sm">
      {t.backToVersion}
    </Link>
  );

  if (!active || active.id === id) {
    return (
      <>
        <PageHeader eyebrow={t.eyebrow} title={version.label} subtitle={t.subtitle} actions={back} />
        <Notice tone="info">{active ? t.isActive : t.noActive}</Notice>
      </>
    );
  }

  const [baseTables, targetTables] = await Promise.all([loadAllRateTables(supabase, active.id), loadAllRateTables(supabase, id)]);

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={`${version.label} ← ${active.label}`}
        subtitle={t.subtitle}
        actions={back}
      />
      <div className="flex flex-col gap-6">
        {RATE_TABLE_NAMES.map((table) => {
          const columns = RATE_TABLES[table].columns.filter((col) => !col.key).map((col) => col.name);
          const diff = diffRows(baseTables[table], targetTables[table], (row) => rateRowKey(table, row), columns);
          return <RateDiffView key={table} table={table} diff={diff} content={c} locale={locale} />;
        })}
      </div>
    </>
  );
}
