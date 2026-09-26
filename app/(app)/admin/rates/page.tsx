/**
 * Rate versions list — label, created, active chip, quote usage,
 * placeholder rows; clone / activate / delete per row.
 * File path: /app/(app)/admin/rates/page.tsx
 *
 * Admin only. `?notice=cloned|activated|deleted` and
 * `?error=clone|activate|activateMissing|delete|label` come back from the
 * form actions (they redirect) and render as notices.
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { listRateVersions } from "@/lib/admin/rates";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { RateVersionsTable } from "@/components/admin/rate-versions-table";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.rates.title };
}

type SearchParams = Promise<{ notice?: string | string[]; error?: string | string[] }>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function RateVersionsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.rates;
  const supabase = await createClient();
  const versions = await listRateVersions(supabase);

  const notice = first(params.notice);
  const error = first(params.error);
  const noticeText =
    notice === "cloned" ? t.versions.notices.cloned : notice === "activated" ? t.versions.notices.activated : notice === "deleted" ? t.versions.notices.deleted : null;
  const errorText =
    error === "clone"
      ? t.versions.notices.cloneFailed
      : error === "activate"
        ? t.versions.notices.activateFailed
        : error === "activateMissing"
          ? t.versions.notices.activateMissing
          : error === "delete"
          ? t.versions.notices.deleteFailed
          : error === "label"
            ? t.versions.notices.labelRequired
            : null;

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      {noticeText && (
        <Notice tone="success" className="mb-4">
          {noticeText}
        </Notice>
      )}
      {errorText && (
        <Notice tone="error" className="mb-4">
          {errorText}
        </Notice>
      )}
      {versions.length === 0 ? (
        <EmptyState title={t.versions.empty} body={t.versions.emptyBody} />
      ) : (
        <Panel flush>
          <RateVersionsTable versions={versions} content={c} locale={locale} />
        </Panel>
      )}
    </>
  );
}
