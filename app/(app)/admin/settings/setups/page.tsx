/**
 * Job setup rates — the four once-per-job setup costs (laser nest, press
 * brake, roll, weld fit-up) as an inline-editable table; the codes are
 * fixed by the migration, only name and cost change.
 * File path: /app/(app)/admin/settings/setups/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { listJobSetupRates } from "@/lib/admin/settings";
import { Panel } from "@/components/ui/panel";
import { SettingsFrame } from "@/components/admin/settings-frame";
import { JobSetupRatesTable } from "@/components/admin/settings-row-tables";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.setups.title };
}

export default async function JobSetupRatesPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const { rows, missing } = await listJobSetupRates(supabase);

  return (
    <SettingsFrame content={c} table="setups" title={t.setups.title} hint={t.setups.hint} missing={missing} placeholderHint>
      <Panel flush>
        <JobSetupRatesTable rows={rows} />
      </Panel>
    </SettingsFrame>
  );
}
