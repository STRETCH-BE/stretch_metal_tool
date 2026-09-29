/**
 * Packaging rates — packed-size / gross-mass bands with their price, in
 * position order (the first band whose limits hold is charged), as an
 * inline-editable table; placeholder rows carry the amber chip until saved.
 * File path: /app/(app)/admin/settings/packaging/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { listPackagingRates } from "@/lib/admin/settings";
import { Panel } from "@/components/ui/panel";
import { SettingsFrame } from "@/components/admin/settings-frame";
import { PackagingRatesTable } from "@/components/admin/settings-row-tables";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.packaging.title };
}

export default async function PackagingRatesPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const { rows, missing } = await listPackagingRates(supabase);

  return (
    <SettingsFrame content={c} table="packaging" title={t.packaging.title} hint={t.packaging.hint} missing={missing} placeholderHint>
      <Panel flush>
        <PackagingRatesTable rows={rows} />
      </Panel>
    </SettingsFrame>
  );
}
