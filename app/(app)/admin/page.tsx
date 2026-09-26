/**
 * Admin index — cards for rate tables (active version + placeholders),
 * machines, overrides (pending), users, calculator and audit log.
 * File path: /app/(app)/admin/page.tsx
 *
 * Admin only (requireRole). Numbers come from lib/admin/dashboard.ts.
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { loadAdminDashboard } from "@/lib/admin/dashboard";
import { PageHeader } from "@/components/ui/page-header";
import { AdminCards } from "@/components/admin/admin-cards";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.index.title };
}

export default async function AdminIndexPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const supabase = await createClient();
  const dashboard = await loadAdminDashboard(supabase);
  return (
    <>
      <PageHeader eyebrow={c.admin.index.eyebrow} title={c.admin.index.title} subtitle={c.admin.index.subtitle} />
      <AdminCards dashboard={dashboard} content={c} />
    </>
  );
}
