/**
 * Rate version page for one table (materials, laser, tube_laser, bend,
 * roll, weld, thread, feature, finish — or general).
 * File path: /app/(app)/admin/rates/[id]/[table]/page.tsx
 *
 * Unknown table segment → 404 (the static "diff" segment has its own page).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { isRateTableName } from "@/lib/admin/tables";
import { RateVersionView } from "@/components/admin/rate-version-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ id: string; table: string }>;
type SearchParams = Promise<{ notice?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const c = getContent(await getLocale());
  return { title: isRateTableName(table) ? `${c.admin.rates.tables[table]} — ${c.admin.rates.version.eyebrow}` : c.admin.rates.version.eyebrow };
}

export default async function RateVersionTablePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole(["admin"]);
  const { id, table } = await params;
  if (!UUID.test(id) || !isRateTableName(table)) notFound();
  const query = await searchParams;
  const locale = await getLocale();
  const notice = Array.isArray(query.notice) ? query.notice[0] : query.notice;
  return <RateVersionView id={id} table={table} notice={notice} content={getContent(locale)} locale={locale} />;
}
