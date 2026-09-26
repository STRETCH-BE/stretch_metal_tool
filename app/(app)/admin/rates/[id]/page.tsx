/**
 * Rate version page — opens on the "general" table; the other tables
 * live at /admin/rates/[id]/[table].
 * File path: /app/(app)/admin/rates/[id]/page.tsx
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { RateVersionView } from "@/components/admin/rate-version-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ notice?: string | string[] }>;

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.rates.version.eyebrow };
}

export default async function RateVersionPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const locale = await getLocale();
  const notice = Array.isArray(query.notice) ? query.notice[0] : query.notice;
  return <RateVersionView id={id} table="general" notice={notice} content={getContent(locale)} locale={locale} />;
}
